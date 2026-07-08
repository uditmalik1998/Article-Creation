import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runSingleGeneration } from './modelGenerationService';
import { storageService } from './storageService';
import { outputKeyFor } from './articleListParser';

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
  articleCode?: string;  // set for kind 'r2key' — the FINAL ART code
  kind: 'file' | 'r2key';
  view: string;
  status: TaskStatus;
  outputUrl?: string;
  error?: string;
  attempts: number;
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

function persistJob(job: BulkJob): void {
  job.updatedAt = Date.now();
  try {
    fs.writeFileSync(jobStateFile(job), JSON.stringify(job, null, 2));
  } catch (err) {
    console.error('[ModelGenBulk] Failed to persist job', job.id, (err as Error).message);
  }
}

// Load any persisted jobs at module init so /status survives a restart for finished jobs.
// In-flight (RUNNING/QUEUED) jobs are marked FAILED — we cannot safely resume them.
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
        // Reset in-flight tasks back to PENDING and re-queue the job so a restart resumes it.
        for (const t of job.tasks) {
          if (t.status === 'RUNNING') t.status = 'PENDING';
        }
        job.status = 'QUEUED';
        persistJob(job);
        jobs.set(job.id, job);
        if (process.env.MODELGEN_AUTO_RESUME !== 'false') {
          console.log(`[ModelGenBulk] Resuming job ${job.id} — ${job.tasks.filter(t => t.status === 'PENDING').length} pending task(s)`);
          startJob(job.id);
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
  codes: string[];
  sourceKeys: string[];          // parallel to codes: APPROVED-bucket keys
  params: BulkJobParams;
}): BulkJob {
  const views = viewsForCount(args.params.imagesCount);
  const tasks: BulkTask[] = [];
  for (let i = 0; i < args.codes.length; i++) {
    for (const view of views) {
      tasks.push({
        id: crypto.randomBytes(6).toString('hex'),
        fileName: args.codes[i],
        sourceKey: args.sourceKeys[i],
        articleCode: args.codes[i],
        kind: 'r2key',
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

  let imgBuf: Buffer;
  let imgMime: string;
  if (task.kind === 'r2key') {
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

  let backoff = INITIAL_BACKOFF_MS;

  while (task.attempts < MAX_ATTEMPTS_PER_TASK) {
    task.attempts++;

    try {
      await acquireGeminiSlot();
      console.log(`[ModelGenBulk] Job ${job.id} task ${task.fileName}/${task.view} attempt ${task.attempts}`);
      const buf = await runSingleGeneration(
        imgBuf,
        imgMime,
        job.params.gender,
        job.params.bodytype,
        job.params.imagesCount,
        task.view,
        patternBuf,
        patternMime,
        broachBuf,
        broachMime,
        job.params.broach_placement,
        job.params.special_instructions,
        job.params.color_name,
        colorImgBuf,
        colorImgMime,
      );

      if (task.kind === 'r2key') {
        const key = outputKeyFor(task.articleCode!, task.view);
        const url = await storageService.uploadModelImage(key, buf, 'image/png');
        task.status = 'DONE';
        task.outputUrl = url;
        task.error = undefined;
        return;
      }

      const safeName = path.basename(task.fileName, path.extname(task.fileName)).replace(/[^a-zA-Z0-9_-]/g, '_');
      const outName = `${safeName}_${task.view.replace(/\s+/g, '_')}_${task.id.slice(0, 6)}.png`;
      const outPath = path.join(job.outputDir, outName);
      fs.writeFileSync(outPath, buf);

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

    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (cancelFlags.has(job.id)) return;
        const i = nextIndex++;
        if (i >= job.tasks.length) return;
        const task = job.tasks[i];
        if (task.status !== 'PENDING') continue;

        task.status = 'RUNNING';
        persistJob(job);

        await runTaskWithRetry(job, task);

        const finalStatus = task.status as TaskStatus;
        if (finalStatus === 'DONE') job.done++;
        else if (finalStatus === 'FAILED') job.failed++;
        persistJob(job);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));

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
      // Public URL of the source garment image — served from uploads/ static mount (file kind only).
      sourceUrl: t.sourcePath ? `/uploads/model-generation/jobs/${job.id}/input/${path.basename(t.sourcePath)}` : undefined,
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
