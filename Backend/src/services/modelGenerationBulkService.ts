import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runSingleGeneration, backgroundForGarment } from './modelGenerationService';
import { storageService } from './storageService';
import { outputKeyFor } from './articleListParser';
import type { ResolvedArticle } from './articleModelSourceService';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

// ─── Rate-limit / pacing config ──────────────────────────────────────────────
// MIN_GAP_MS is the minimum gap between the START of consecutive Gemini calls,
// measured globally (across all jobs running in this process).
const MIN_GAP_MS = parseInt(process.env.GEMINI_MIN_GAP_MS || '4000', 10);
const CONCURRENCY = Math.max(1, parseInt(process.env.MODELGEN_CONCURRENCY || '3', 10));
const MAX_ATTEMPTS_PER_TASK = parseInt(process.env.GEMINI_MAX_ATTEMPTS || '5', 10);
const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

let lastCallStartedAt = 0;
let pacingChain: Promise<void> = Promise.resolve();

// Serialize the "wait, then claim a slot" step so two callers can never both pass
// the gap check at the same instant. Each caller queues behind the previous one.
function acquireGeminiSlot(): Promise<void> {
  const next = pacingChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, MIN_GAP_MS - (now - lastCallStartedAt));
    if (wait > 0) await sleep(wait);
    lastCallStartedAt = Date.now();
  });
  pacingChain = next.catch(() => undefined);
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function viewsForCount(imagesCount: string): string[] {
  if (imagesCount === '5') return ['front', 'back', 'side', 'three_quarter', 'closeup'];
  if (imagesCount === '1') return ['front'];
  return ['front', 'back', 'left_side', 'closeup'];
}

// ─── Job + task types ────────────────────────────────────────────────────────
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'PARTIAL';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface BulkTask {
  id: string;
  fileName: string;
  sourcePath?: string;   // set for kind 'file'
  sourceKey?: string;    // set for kind 'r2key' — key in the APPROVED bucket
  sourceUrl?: string;    // set for kind 'article' — HTTP image URL from extraction_results_flat
  articleCode?: string;  // set for kind 'r2key' | 'article' — the article number
  kind: 'file' | 'r2key' | 'article';
  view: string;
  status: TaskStatus;
  outputUrl?: string;
  error?: string;
  attempts: number;
  // Per-task generation params — used by the 'article' kind, where gender/colour/etc.
  // are resolved per-article from the DB rather than shared across the whole job.
  gender?: string;
  bodytype?: string;
  colorName?: string;
  featuredGarment?: 'top' | 'bottom' | 'full' | 'unknown'; // which piece a colour swap targets
  attributesText?: string;
  // true when this article's source photo is a sibling colour variant reused as
  // a stand-in (the exact article+colour code had no extracted photo of its own)
  // — colorName must then be actively enforced as a recolour instruction.
  isColorFallback?: boolean;
}

// Fetch a source image over HTTP (the article flow stores an imageUrl, not a local
// path or an approved-bucket key). Returns null on any network/HTTP failure so the
// task can be marked FAILED with a clear reason instead of crashing the worker.
async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return { buffer: Buffer.from(ab), mime };
  } catch {
    return null;
  }
}

export interface BulkJobParams {
  gender: string;
  bodytype: string;
  imagesCount: string;
  color_name?: string;
  broach_placement?: string;
  special_instructions?: string;
}

export interface BulkJob {
  id: string;
  userId?: number | string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  params: BulkJobParams;
  patternPath?: string;
  broachPath?: string;
  colorImagePath?: string;
  tasks: BulkTask[];
  inputDir: string;
  outputDir: string;
  jobDir: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

const jobs = new Map<string, BulkJob>();

// ─── Disk persistence (lightweight — survives crash, helps debugging) ─────────
function jobStateFile(job: BulkJob): string {
  return path.join(job.jobDir, 'job.json');
}

// Coalesced, single-writer disk persistence. Rapid persistJob() calls from concurrent
// workers collapse into one writeFileSync per event-loop tick — this both avoids
// concurrent-write corruption on Windows and keeps I/O cheap for large jobs.
const dirtyJobIds = new Set<string>();
let flushScheduled = false;

function flushDirtyJobs(): void {
  flushScheduled = false;
  for (const id of Array.from(dirtyJobIds)) {
    dirtyJobIds.delete(id);
    const job = jobs.get(id);
    if (!job) continue;
    try {
      fs.writeFileSync(jobStateFile(job), JSON.stringify(job, null, 2));
    } catch (err) {
      console.error('[ModelGenBulk] Failed to persist job', id, (err as Error).message);
    }
  }
}

function persistJob(job: BulkJob): void {
  job.updatedAt = Date.now();
  dirtyJobIds.add(job.id);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flushDirtyJobs);
  }
}

// Load any persisted jobs at module init so /status survives a restart.
//
// A job that was still QUEUED/RUNNING when the server stopped is NOT auto-resumed
// by default: doing so re-fires Gemini image generation on every boot, which was
// pegging the event loop at 100% CPU and wedging the whole backend ("restart →
// stuck on Starting…"). Instead the interrupted job is marked done-with-failures so
// its state is honest, and the user can simply run it again from the UI. Set
// MODELGEN_AUTO_RESUME=true to explicitly opt back into resume-on-boot.
const AUTO_RESUME_ON_BOOT = process.env.MODELGEN_AUTO_RESUME === 'true';

function rehydrateJobsFromDisk(): void {
  const root = path.join(process.cwd(), 'uploads', 'model-generation', 'jobs');
  if (!fs.existsSync(root)) return;
  let restored = 0;
  for (const id of fs.readdirSync(root)) {
    const file = path.join(root, id, 'job.json');
    if (!fs.existsSync(file)) continue;
    try {
      const job: BulkJob = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (job.status === 'QUEUED' || job.status === 'RUNNING') {
        if (AUTO_RESUME_ON_BOOT) {
          // Explicit opt-in only: reset in-flight tasks to PENDING and resume.
          for (const t of job.tasks) {
            if (t.status === 'RUNNING') t.status = 'PENDING';
          }
          job.status = 'QUEUED';
          persistJob(job);
          jobs.set(job.id, job);
          console.log(`[ModelGenBulk] Resuming job ${job.id} — ${job.tasks.filter(t => t.status === 'PENDING').length} pending task(s)`);
          startJob(job.id);
        } else {
          // Default: do NOT re-trigger generation on boot. Mark whatever was still
          // in flight as failed-by-restart and close the job out.
          for (const t of job.tasks) {
            if (t.status === 'RUNNING' || t.status === 'PENDING') {
              t.status = 'FAILED';
              t.error = t.error || 'Interrupted by server restart';
            }
          }
          job.done = job.tasks.filter(t => t.status === 'DONE').length;
          job.failed = job.tasks.filter(t => t.status === 'FAILED').length;
          job.status = job.done > 0 ? 'PARTIAL' : 'FAILED';
          job.finishedAt = job.finishedAt ?? Date.now();
          persistJob(job);
          jobs.set(job.id, job);
          console.log(`[ModelGenBulk] Job ${job.id} was interrupted by a restart — marked ${job.status}, NOT auto-resumed (set MODELGEN_AUTO_RESUME=true to resume on boot).`);
        }
        restored++;
        continue;
      }
      jobs.set(job.id, job);
      restored++;
    } catch (err) {
      console.error('[ModelGenBulk] Could not rehydrate', id, (err as Error).message);
    }
  }
  if (restored > 0) console.log(`[ModelGenBulk] Rehydrated ${restored} job(s) from disk`);
}
rehydrateJobsFromDisk();

// ─── Mime detection by extension ─────────────────────────────────────────────
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function mimeFromPath(p: string): string {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || 'image/jpeg';
}

export function isSupportedImagePath(p: string): boolean {
  return path.extname(p).toLowerCase() in MIME_BY_EXT;
}

// ─── Job creation ────────────────────────────────────────────────────────────
export function newJobId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createJobDirs(jobId: string): { jobDir: string; inputDir: string; outputDir: string } {
  const root = path.join(process.cwd(), 'uploads', 'model-generation', 'jobs', jobId);
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  return { jobDir: root, inputDir, outputDir };
}

export function createJob(args: {
  id: string;
  userId?: number | string;
  jobDir: string;
  inputDir: string;
  outputDir: string;
  sourceImagePaths: string[];
  params: BulkJobParams;
  patternPath?: string;
  broachPath?: string;
  colorImagePath?: string;
}): BulkJob {
  const views = viewsForCount(args.params.imagesCount);

  const tasks: BulkTask[] = [];
  for (const src of args.sourceImagePaths) {
    for (const view of views) {
      tasks.push({
        id: crypto.randomBytes(6).toString('hex'),
        fileName: path.basename(src),
        sourcePath: src,
        kind: 'file',
        view,
        status: 'PENDING',
        attempts: 0,
      });
    }
  }

  const job: BulkJob = {
    id: args.id,
    userId: args.userId,
    status: 'QUEUED',
    total: tasks.length,
    done: 0,
    failed: 0,
    params: args.params,
    patternPath: args.patternPath,
    broachPath: args.broachPath,
    colorImagePath: args.colorImagePath,
    tasks,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    jobDir: args.jobDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(job.id, job);
  persistJob(job);
  return job;
}

export function createArticleJob(args: {
  id: string;
  userId?: number | string;
  jobDir: string;
  inputDir: string;
  outputDir: string;
  articles: ResolvedArticle[];   // resolved from extraction_results_flat (found + not-found)
  params: BulkJobParams;
}): BulkJob {
  const views = viewsForCount(args.params.imagesCount);
  const tasks: BulkTask[] = [];
  let failed = 0;

  for (const article of args.articles) {
    for (const view of views) {
      const base: BulkTask = {
        id: crypto.randomBytes(6).toString('hex'),
        fileName: article.articleCode,
        articleCode: article.articleCode,
        kind: 'article',
        view,
        status: 'PENDING',
        attempts: 0,
      };

      if (!article.found || !article.imageUrl) {
        // Article couldn't be resolved — surface it as a FAILED task so the user
        // sees exactly which codes were skipped and why, instead of a silent drop.
        base.status = 'FAILED';
        base.error = article.reason || 'not found in extraction data';
        failed++;
      } else {
        base.sourceUrl = article.imageUrl;
        base.gender = article.gender;
        base.bodytype = article.bodytype;       // 'auto'
        base.colorName = article.colorName;
        base.featuredGarment = article.featuredGarment;
        base.attributesText = article.attributesText;
        base.isColorFallback = article.isColorFallback;
      }

      tasks.push(base);
    }
  }

  const job: BulkJob = {
    id: args.id,
    userId: args.userId,
    status: 'QUEUED',
    total: tasks.length,
    done: 0,
    failed,
    params: args.params,
    tasks,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    jobDir: args.jobDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  persistJob(job);
  return job;
}

export function getJob(id: string): BulkJob | undefined {
  return jobs.get(id);
}

export function listRecentJobsForUser(userId: number | string | undefined, limit = 20): BulkJob[] {
  if (userId === undefined || userId === null) return [];
  const uid = String(userId);
  return Array.from(jobs.values())
    .filter(j => String(j.userId ?? '') === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// Cancellation flag — the running worker checks this between tasks.
const cancelFlags = new Set<string>();

// Cross-view consistency cache: the first successfully generated view of a garment
// is stashed here so the remaining views of the SAME garment (same job + fileName)
// can be generated against it as a style reference instead of each independently
// re-deriving color/texture from the flat source photo. This is what keeps front,
// back, side, three_quarter, and closeup visually consistent with each other.
// In-memory only (never persisted to job.json) — cleared once the job finishes.
const groupReferenceCache = new Map<string, { buffer: Buffer; mime: string }>();
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'DONE' || job.status === 'FAILED' || job.status === 'PARTIAL') return false;
  cancelFlags.add(id);
  return true;
}

// ─── Worker ──────────────────────────────────────────────────────────────────
function classify429(err: any): boolean {
  if (!err) return false;
  if (err.status === 429) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('rate') || msg.includes('quota') || msg.includes('resource_exhausted');
}

function extractRetryAfterMs(err: any): number | null {
  const msg = err?.message || '';
  // Gemini errors sometimes include "retry in 23.4s" or "retryDelay: 12s"
  const m = msg.match(/retry[^0-9]*(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  return null;
}

async function runTaskWithRetry(job: BulkJob, task: BulkTask): Promise<void> {
  const patternBuf = job.patternPath ? fs.readFileSync(job.patternPath) : undefined;
  const patternMime = job.patternPath ? mimeFromPath(job.patternPath) : undefined;
  const broachBuf = job.broachPath ? fs.readFileSync(job.broachPath) : undefined;
  const broachMime = job.broachPath ? mimeFromPath(job.broachPath) : undefined;
  const colorImgBuf = job.colorImagePath ? fs.readFileSync(job.colorImagePath) : undefined;
  const colorImgMime = job.colorImagePath ? mimeFromPath(job.colorImagePath) : undefined;

  let backoff = INITIAL_BACKOFF_MS;
  let generatedBuf: Buffer | null = null; // cached across retries so an upload-only failure never re-generates

  while (task.attempts < MAX_ATTEMPTS_PER_TASK) {
    task.attempts++;

    try {
      // Generate once. On a retry that follows a successful generation (e.g. the upload
      // failed), skip straight to the output step — do not re-fetch or re-call Gemini.
      if (!generatedBuf) {
        let imgBuf: Buffer;
        let imgMime: string;
        if (task.kind === 'article') {
          const src = await fetchImageFromUrl(task.sourceUrl!);
          if (!src) {
            task.status = 'FAILED';
            task.error = `could not fetch source image from extraction data (${task.sourceUrl})`;
            return;
          }
          imgBuf = src.buffer;
          imgMime = src.mime;
        } else if (task.kind === 'r2key') {
          const src = await storageService.fetchApprovedImage(task.sourceKey!);
          if (!src) {
            task.status = 'FAILED';
            task.error = `source image not found in article-master bucket (${task.sourceKey})`;
            return;
          }
          imgBuf = src.buffer;
          imgMime = src.mime;
        } else {
          imgBuf = fs.readFileSync(task.sourcePath!);
          imgMime = mimeFromPath(task.sourcePath!);
        }

        // Article tasks carry per-article gender resolved from the DB; other kinds
        // use the shared job-level params.
        const gender = task.gender ?? job.params.gender;
        const bodytype = task.bodytype ?? job.params.bodytype;
        // For an exact article match the source image already IS the article's colour,
        // so we preserve it (passing the abbreviated DB colour code like "NV_BL" as a
        // recolor instruction risks misinterpretation). But when the source photo was
        // reused from a sibling colour variant (isColorFallback), the requested colour
        // must be actively enforced so the AI actually recolours the garment. Other
        // flows keep their explicit colour.
        const colorName =
          task.kind === 'article'
            ? (task.isColorFallback ? task.colorName : undefined)
            : job.params.color_name;

        // If another view of this same garment has already been generated, use it as
        // a style reference so this view's color/pattern/texture match it exactly
        // instead of being re-derived independently from the source photo.
        const refKey = `${job.id}:${task.fileName}`;
        const styleReference = groupReferenceCache.get(refKey);

        // Pick ONE backdrop for this whole article from its garment colour (dark garment
        // → light backdrop, light garment → deeper backdrop). task.colorName is identical
        // for every view of an article, so all views resolve to the SAME backdrop.
        const backgroundColor = backgroundForGarment(task.colorName);

        await acquireGeminiSlot();
        console.log(`[ModelGenBulk] Job ${job.id} task ${task.fileName}/${task.view} attempt ${task.attempts}${styleReference ? ' (with style reference)' : ''}`);
        generatedBuf = await runSingleGeneration(
          imgBuf,
          imgMime,
          gender,
          bodytype,
          job.params.imagesCount,
          task.view,
          patternBuf,
          patternMime,
          broachBuf,
          broachMime,
          job.params.broach_placement,
          job.params.special_instructions,
          colorName,
          colorImgBuf,
          colorImgMime,
          task.attributesText,
          styleReference?.buffer,
          styleReference?.mime,
          backgroundColor,
          task.featuredGarment,
        );

        // The first view to finish for this garment becomes the reference the rest match.
        if (!groupReferenceCache.has(refKey)) {
          groupReferenceCache.set(refKey, { buffer: generatedBuf, mime: 'image/png' });
        }
      }

      if (task.kind === 'r2key' || task.kind === 'article') {
        const key = outputKeyFor(task.articleCode!, task.view);
        const url = await storageService.uploadModelImage(key, generatedBuf!, 'image/png');
        task.status = 'DONE';
        task.outputUrl = url;
        task.error = undefined;
        return;
      }

      const safeName = path.basename(task.fileName, path.extname(task.fileName)).replace(/[^a-zA-Z0-9_-]/g, '_');
      const outName = `${safeName}_${task.view.replace(/\s+/g, '_')}_${task.id.slice(0, 6)}.png`;
      const outPath = path.join(job.outputDir, outName);
      fs.writeFileSync(outPath, generatedBuf!);

      task.status = 'DONE';
      task.outputUrl = `/uploads/model-generation/jobs/${job.id}/output/${outName}`;
      task.error = undefined;
      return;
    } catch (err: any) {
      const is429 = classify429(err);
      const message = err?.message || String(err);
      console.warn(`[ModelGenBulk] Task ${task.id} attempt ${task.attempts} failed: ${message} | rateLimited=${is429}`);

      if (task.attempts >= MAX_ATTEMPTS_PER_TASK) {
        task.status = 'FAILED';
        task.error = message;
        return;
      }

      const hint = extractRetryAfterMs(err);
      let wait: number;
      if (is429) {
        wait = Math.min(MAX_BACKOFF_MS, hint ?? backoff * 2);
        backoff = wait;
      } else {
        wait = Math.min(MAX_BACKOFF_MS, backoff);
        backoff *= 1.5;
      }
      // jitter
      wait += Math.floor(Math.random() * 500);
      console.log(`[ModelGenBulk] Backing off ${wait}ms before retry`);
      await sleep(wait);
    }
  }
}

// Persist one row per article (jobId + articleNumber) to model_generation_results,
// recording whether the article got its model images. Best-effort: a DB failure here
// never fails the job — the results already live in memory and on disk (job.json).
// Only runs for flows that carry a real article number (article / r2key kinds).
async function persistJobResultsToDb(job: BulkJob): Promise<void> {
  const byArticle = new Map<string, BulkTask[]>();
  for (const t of job.tasks) {
    if (!t.articleCode) continue;
    const list = byArticle.get(t.articleCode) ?? [];
    list.push(t);
    byArticle.set(t.articleCode, list);
  }
  if (byArticle.size === 0) return;

  const userId = typeof job.userId === 'number' ? job.userId : Number(job.userId);
  const userIdVal = Number.isFinite(userId) ? userId : null;

  for (const [articleNumber, tasks] of byArticle) {
    const done = tasks.filter((t) => t.status === 'DONE');
    const failed = tasks.filter((t) => t.status === 'FAILED');
    const status = done.length === 0 ? 'FAILED' : failed.length > 0 ? 'PARTIAL' : 'DONE';
    const imageUrls: Record<string, string> = {};
    for (const t of done) if (t.outputUrl) imageUrls[t.view] = t.outputUrl;
    const error = failed.find((t) => t.error)?.error ?? null;
    const sample = tasks[0];

    try {
      await withPrismaRetry(() =>
        prisma.modelGenerationResult.upsert({
          where: { jobId_articleNumber: { jobId: job.id, articleNumber } },
          create: {
            jobId: job.id,
            articleNumber,
            status,
            viewsTotal: tasks.length,
            viewsDone: done.length,
            viewsFailed: failed.length,
            imageUrls,
            error,
            gender: sample.gender ?? null,
            colour: sample.colorName ?? null,
            userId: userIdVal,
          },
          update: {
            status,
            viewsTotal: tasks.length,
            viewsDone: done.length,
            viewsFailed: failed.length,
            imageUrls,
            error,
          },
        })
      );
    } catch (err) {
      console.error('[ModelGenBulk] Failed to persist result for', articleNumber, (err as Error).message);
    }
  }
  console.log(`[ModelGenBulk] Persisted ${byArticle.size} article result(s) to DB for job ${job.id}`);
}

export function startJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.status !== 'QUEUED') return;

  // Fire-and-forget. Errors are caught inside; nothing else awaits this.
  (async () => {
    job.status = 'RUNNING';
    job.startedAt = Date.now();
    persistJob(job);
    console.log(`[ModelGenBulk] Starting job ${job.id} — ${job.total} task(s), gap=${MIN_GAP_MS}ms`);

    // Group tasks by garment (fileName) — createJob/createArticleJob always push a
    // garment's views contiguously, so a simple run-length grouping recovers the
    // per-garment view lists without needing a separate key.
    const groups: BulkTask[][] = [];
    {
      let current: BulkTask[] = [];
      let currentKey: string | undefined;
      for (const t of job.tasks) {
        if (t.fileName !== currentKey) {
          if (current.length) groups.push(current);
          current = [];
          currentKey = t.fileName;
        }
        current.push(t);
      }
      if (current.length) groups.push(current);
    }

    const runOneTask = async (task: BulkTask): Promise<void> => {
      task.status = 'RUNNING';
      persistJob(job);
      await runTaskWithRetry(job, task);
      const finalStatus = task.status as TaskStatus;
      if (finalStatus === 'DONE') job.done++;
      else if (finalStatus === 'FAILED') job.failed++;
      persistJob(job);
    };

    let nextGroupIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (cancelFlags.has(job.id)) return;
        const gi = nextGroupIndex++;
        if (gi >= groups.length) return;
        const pending = groups[gi].filter((t) => t.status === 'PENDING');
        if (pending.length === 0) continue;

        // Run the first view alone so it can populate the style-reference cache,
        // then the remaining views of this garment run concurrently against it.
        const [anchor, ...rest] = pending;
        await runOneTask(anchor);
        if (cancelFlags.has(job.id)) continue;
        await Promise.all(rest.map((t) => runOneTask(t)));
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));

    // Drop this job's cached reference images now that every garment is finished.
    for (const key of Array.from(groupReferenceCache.keys())) {
      if (key.startsWith(`${job.id}:`)) groupReferenceCache.delete(key);
    }

    // Any tasks left PENDING because the job was cancelled → mark FAILED.
    if (cancelFlags.has(job.id)) {
      for (const t of job.tasks) {
        if (t.status === 'PENDING') { t.status = 'FAILED'; t.error = 'Cancelled'; job.failed++; }
      }
    }

    cancelFlags.delete(job.id);
    if (job.failed === 0) job.status = 'DONE';
    else if (job.done === 0) job.status = 'FAILED';
    else job.status = 'PARTIAL';
    job.finishedAt = Date.now();
    persistJob(job);
    void persistJobResultsToDb(job); // best-effort DB record of per-article success/failure
    console.log(`[ModelGenBulk] Job ${job.id} finished — status=${job.status} done=${job.done} failed=${job.failed}`);
  })().catch(err => {
    console.error(`[ModelGenBulk] Job ${job.id} crashed:`, err);
    job.status = 'FAILED';
    job.error = err?.message || String(err);
    job.finishedAt = Date.now();
    persistJob(job);
  });
}

// ─── Public summary for the status endpoint ──────────────────────────────────
export interface JobSummary {
  id: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  params: BulkJobParams;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  results: Array<{ fileName: string; view: string; status: TaskStatus; url?: string; sourceUrl?: string; error?: string }>;
}

export interface JobListItem {
  id: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export function listItem(job: BulkJob): JobListItem {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export function summarizeJob(job: BulkJob): JobSummary {
  let pending = 0, running = 0;
  const results = job.tasks.map(t => {
    if (t.status === 'PENDING') pending++;
    if (t.status === 'RUNNING') running++;
    return {
      fileName: t.fileName,
      view: t.view,
      status: t.status,
      url: t.outputUrl,
      // Public URL of the source garment image. file kind → served from the uploads/
      // static mount; article kind → the extraction imageUrl (already a public URL);
      // r2key kind → public URL of the source in the article-master bucket.
      sourceUrl: t.sourcePath
        ? `/uploads/model-generation/jobs/${job.id}/input/${path.basename(t.sourcePath)}`
        : t.sourceUrl
          ? t.sourceUrl
          : t.sourceKey
            ? (storageService.getApprovedPublicUrl(t.sourceKey) ?? undefined)
            : undefined,
      error: t.error,
    };
  });
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    pending,
    running,
    params: job.params,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    results,
  };
}
