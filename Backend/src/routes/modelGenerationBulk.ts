import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import {
  newJobId,
  createJobDirs,
  createJob,
  createArticleJob,
  startJob,
  getJob,
  cancelJob,
  summarizeJob,
  isSupportedImagePath,
  listRecentJobsForUser,
  listItem,
} from '../services/modelGenerationBulkService';
import { parseArticleCodesFromXlsx, parseArticleCodesFromText } from '../services/articleListParser';
import { resolveArticleForGeneration } from '../services/articleModelSourceService';
import { storageService } from '../services/storageService';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

const router = Router();

// ─── Pre-middleware: allocate jobId + dirs BEFORE multer streams files ──────
// We attach the dirs to the request so multer's diskStorage knows where to write.
function allocateJob(req: Request, _res: Response, next: NextFunction): void {
  // Extend per-request timeouts on the underlying socket — large uploads can
  // exceed the global 90s /api/ timer set in index.ts. We give the upload itself
  // up to 20 minutes; the route handler still returns jobId quickly once files
  // are on disk (the worker runs in the background).
  req.setTimeout(20 * 60 * 1000);

  const jobId = newJobId();
  const dirs = createJobDirs(jobId);
  (req as any)._jobId = jobId;
  (req as any)._jobDirs = dirs;
  next();
}

// ─── Multer: disk storage, big batches, accept images + one optional zip ─────
const bulkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dirs = (req as any)._jobDirs as { jobDir: string; inputDir: string; outputDir: string };
      if (file.fieldname === 'designs' || file.fieldname === 'archive') {
        cb(null, dirs.inputDir);
      } else {
        cb(null, dirs.jobDir);
      }
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const prefix = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      cb(null, `${prefix}_${safe}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,   // 25 MB per file (covers oversize source images and zip parts)
    files: 1500,                  // hard cap so a runaway client can't fill disk
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'archive') {
      const okMime = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'multipart/x-zip'].includes(file.mimetype);
      const okExt = file.originalname.toLowerCase().endsWith('.zip');
      if (okMime || okExt) return cb(null, true);
      return cb(new Error('archive must be a .zip file'));
    }
    const okMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (okMime) return cb(null, true);
    return cb(new Error(`Invalid file type for ${file.fieldname}. Allowed: JPEG, PNG, WebP`));
  },
});

const bulkFields = bulkUpload.fields([
  { name: 'designs', maxCount: 1000 },
  { name: 'archive', maxCount: 1 },
  { name: 'pattern', maxCount: 1 },
  { name: 'broach', maxCount: 1 },
  { name: 'color_image', maxCount: 1 },
]);

const listUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname)
      || file.mimetype.includes('spreadsheet')
      || file.mimetype === 'text/csv';
    return ok ? cb(null, true) : cb(new Error('Upload an .xlsx, .xls, or .csv file'));
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function safeRm(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function listImagesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isSupportedImagePath(full)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function extractZipSafely(zipPath: string, intoDir: string): { extracted: number; skipped: number } {
  const zip = new AdmZip(zipPath);
  let extracted = 0;
  let skipped = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) { skipped++; continue; }
    const name = entry.entryName;
    // skip macOS / Windows junk and any path-traversal entries
    if (name.startsWith('__MACOSX/') || /(^|\/)\._/.test(name) || /(^|\/)Thumbs\.db$/i.test(name) || /(^|\/)\.DS_Store$/.test(name)) {
      skipped++; continue;
    }
    if (name.includes('..')) { skipped++; continue; }
    const ext = path.extname(name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) { skipped++; continue; }

    // flatten — drop folder structure, keep just the basename, sanitize and disambiguate
    const safeBase = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(intoDir, `zip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}`);
    fs.writeFileSync(target, entry.getData());
    extracted++;
  }
  return { extracted, skipped };
}

// ─── POST /bulk/upload — accepts: single, many, folder (webkitdirectory), zip
router.post('/bulk/upload', allocateJob, bulkFields, async (req: Request, res: Response, next: NextFunction) => {
  const jobId = (req as any)._jobId as string;
  const dirs = (req as any)._jobDirs as { jobDir: string; inputDir: string; outputDir: string };

  try {
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const designs = files['designs'] || [];
    const archive = files['archive']?.[0];
    const pattern = files['pattern']?.[0];
    const broach = files['broach']?.[0];
    const colorImage = files['color_image']?.[0];

    console.log('[ModelGenBulk] Upload received', {
      jobId,
      designs: designs.length,
      archive: archive?.originalname,
      pattern: pattern?.originalname,
      broach: broach?.originalname,
      color_image: colorImage?.originalname,
    });

    // If a zip was uploaded, extract it into inputDir and delete the zip.
    if (archive) {
      try {
        const { extracted, skipped } = extractZipSafely(archive.path, dirs.inputDir);
        console.log(`[ModelGenBulk] Zip extracted: ${extracted} image(s), skipped ${skipped}`);
        safeRm(archive.path);
      } catch (zipErr: any) {
        safeRm(dirs.jobDir);
        res.status(400).json({ success: false, error: `Failed to read zip: ${zipErr?.message || 'unknown error'}` });
        return;
      }
    }

    // Collect every image now sitting on disk for this job.
    const sourcePaths = listImagesRecursive(dirs.inputDir).filter(p => p !== archive?.path);

    if (sourcePaths.length === 0) {
      safeRm(dirs.jobDir);
      res.status(400).json({ success: false, error: 'No images found. Upload images directly, pick a folder, or upload a zip containing images.' });
      return;
    }

    const { gender, bodytype, imagesCount, broach_placement, special_instructions, color_name } = req.body;
    if (!gender || !bodytype) {
      safeRm(dirs.jobDir);
      res.status(400).json({ success: false, error: 'gender and bodytype are required.' });
      return;
    }

    const job = createJob({
      id: jobId,
      userId: (req as any).user?.id,
      jobDir: dirs.jobDir,
      inputDir: dirs.inputDir,
      outputDir: dirs.outputDir,
      sourceImagePaths: sourcePaths,
      params: {
        gender,
        bodytype,
        imagesCount: imagesCount || '1',
        color_name,
        broach_placement,
        special_instructions,
      },
      patternPath: pattern?.path,
      broachPath: broach?.path,
      colorImagePath: colorImage?.path,
    });

    // Kick off the worker; do NOT await it.
    startJob(job.id);

    res.status(202).json({
      success: true,
      jobId: job.id,
      totalImages: sourcePaths.length,
      totalTasks: job.total,
      status: job.status,
    });
  } catch (err) {
    safeRm(dirs.jobDir);
    next(err);
  }
});

// ─── GET /bulk/jobs/recent — list this user's recent jobs (lightweight) ─────
router.get('/bulk/jobs/recent', (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
  const jobs = listRecentJobsForUser(userId, limit).map(listItem);
  res.json({ success: true, jobs });
});

// ─── GET /bulk/job/:id — status + per-task results so far ────────────────────
router.get('/bulk/job/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({ success: true, job: summarizeJob(job) });
});

// ─── POST /bulk/job/:id/cancel — stop the worker after the current task ─────
router.post('/bulk/job/:id/cancel', (req: Request, res: Response) => {
  const ok = cancelJob(req.params.id);
  if (!ok) {
    res.status(400).json({ success: false, error: 'Cannot cancel — job is already finished or not found' });
    return;
  }
  res.json({ success: true });
});

// ─── GET /bulk/job/:id/download-zip — bundle all DONE outputs into one .zip ──
// Handles both flows: garment-upload outputs live on local disk, while article-list
// outputs live in R2 (fetched over HTTP by their public URL).
router.get('/bulk/job/:id/download-zip', async (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  const doneTasks = job.tasks.filter((t) => t.status === 'DONE' && t.outputUrl);
  if (doneTasks.length === 0) {
    res.status(409).json({ success: false, error: 'No generated images yet for this job' });
    return;
  }

  const safeName = (t: { articleCode?: string; fileName: string; view: string }) => {
    const base = (t.articleCode || path.basename(t.fileName, path.extname(t.fileName))).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${base}_${t.view.replace(/\s+/g, '_')}.png`;
  };

  try {
    const zip = new AdmZip();
    let added = 0;

    // Fetch R2-hosted outputs in small parallel batches so large jobs stay quick.
    const BATCH = 10;
    for (let i = 0; i < doneTasks.length; i += BATCH) {
      const batch = doneTasks.slice(i, i + BATCH);
      const parts = await Promise.all(
        batch.map(async (t) => {
          try {
            if (t.kind === 'file') {
              // Local output: outputUrl is /uploads/.../output/<name>
              const full = path.join(job.outputDir, path.basename(t.outputUrl!));
              return fs.existsSync(full) ? { name: safeName(t), buffer: fs.readFileSync(full) } : null;
            }
            const r = await fetch(t.outputUrl!);
            if (!r.ok) return null;
            return { name: safeName(t), buffer: Buffer.from(await r.arrayBuffer()) };
          } catch {
            return null;
          }
        })
      );
      for (const p of parts) {
        if (p) { zip.addFile(p.name, p.buffer); added++; }
      }
    }

    if (added === 0) {
      res.status(409).json({ success: false, error: 'Generated images could not be retrieved for this job' });
      return;
    }

    const buf = zip.toBuffer();
    const safeJobName = job.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeJobName}.zip"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (err: any) {
    console.error('[ModelGenBulk] Zip build failed for job', job.id, err?.message);
    res.status(500).json({ success: false, error: `Failed to build zip: ${err?.message || 'unknown error'}` });
  }
});

// ─── POST /bulk/from-articles — list of article codes → generate from R2 source ──
router.post('/bulk/from-articles', listUpload.single('list'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { imagesCount, codesText } = req.body as Record<string, string>;

    // Gender, body type and colour are NOT taken from the request — they are resolved
    // per-article from extraction_results_flat (division → gender, garment → AI framing,
    // colour → colour lock). The list only needs article numbers.
    let codes: string[] = [];
    if (req.file) {
      codes = /\.csv$/i.test(req.file.originalname)
        ? parseArticleCodesFromText(req.file.buffer.toString('utf-8'))
        : parseArticleCodesFromXlsx(req.file.buffer);
    } else if (codesText) {
      codes = parseArticleCodesFromText(codesText);
    }

    if (codes.length === 0) {
      res.status(400).json({ success: false, error: 'No article codes found. Upload a file or paste codes.' });
      return;
    }

    // Resolve every code against the DB (imageUrl + gender + colour + attributes).
    const articles = await Promise.all(codes.map((c) => resolveArticleForGeneration(c)));
    const resolvedCount = articles.filter((a) => a.found).length;

    const jobId = newJobId();
    const dirs = createJobDirs(jobId); // reused only for job.json persistence
    const job = createArticleJob({
      id: jobId,
      userId: (req as any).user?.id,
      jobDir: dirs.jobDir,
      inputDir: dirs.inputDir,
      outputDir: dirs.outputDir,
      articles,
      params: {
        // Fallbacks only — each article task carries its own resolved gender/bodytype.
        gender: 'female',
        bodytype: 'auto',
        imagesCount: imagesCount || '5',
      },
    });

    startJob(job.id);

    res.status(202).json({
      success: true,
      jobId: job.id,
      totalArticles: codes.length,
      resolvedArticles: resolvedCount,
      skippedArticles: codes.length - resolvedCount,
      totalTasks: job.total,
      status: job.status,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /model-images — browse the model-images bucket (gallery) ────────────
// Returns a page of image objects grouped client-side by article number
// ("{articleNumber}/{view}.jpg"). Supports ?prefix= (article filter), ?cursor=, ?limit=.
router.get('/model-images', async (req: Request, res: Response) => {
  const prefix = String(req.query.prefix || '').trim();
  const cursor = String(req.query.cursor || '').trim() || undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? '300'), 10) || 300, 1000);

  try {
    const { objects, nextCursor } = await storageService.listModelImages({ prefix, cursor, limit });
    // Attach parsed article number + view so the frontend can group without re-parsing.
    const items = objects.map((o) => {
      const slash = o.key.indexOf('/');
      const articleNumber = slash > 0 ? o.key.slice(0, slash) : o.key;
      const rest = slash > 0 ? o.key.slice(slash + 1) : o.key;
      const view = rest.replace(/\.[^.]+$/, '');
      return { ...o, articleNumber, view };
    });
    res.json({ success: true, items, nextCursor });
  } catch (err: any) {
    console.error('[ModelGenBulk] listModelImages failed:', err?.message);
    res.status(500).json({ success: false, error: err?.message || 'Failed to list model images' });
  }
});

// ─── GET /model-images/download?key= — stream one object as an attachment ────
// R2 public URLs don't send CORS headers, so a browser can't fetch+save them
// directly. This proxy fetches the object server-side and returns it with a
// Content-Disposition so the browser downloads instead of navigating to it.
router.get('/model-images/download', async (req: Request, res: Response) => {
  const key = String(req.query.key || '').trim();
  if (!key || key.includes('..')) {
    res.status(400).json({ success: false, error: 'A valid key is required' });
    return;
  }
  try {
    const obj = await storageService.fetchModelImage(key);
    if (!obj) {
      res.status(404).json({ success: false, error: 'Image not found' });
      return;
    }
    const filename = key.replace(/\//g, '_');
    res.setHeader('Content-Type', obj.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(obj.buffer.length));
    res.end(obj.buffer);
  } catch (err: any) {
    console.error('[ModelGenBulk] model-image download failed:', err?.message);
    res.status(500).json({ success: false, error: err?.message || 'Download failed' });
  }
});

// ─── POST /model-images/approve-ecommerce — copy an article's views into E-commerce/
// Promotes a generated article's model images into the E-commerce/ folder of the same
// bucket, renamed sequentially (no gaps) in canonical view order:
//   E-commerce/{articleNumber}/1.jpg (front), 2.jpg (back), 3.jpg (side), 4.jpg (3/4), 5.jpg (closeup)
const ECOMMERCE_PREFIX = 'E-commerce';
const APPROVE_VIEW_ORDER = ['front', 'back', 'side', 'three_quarter', 'left_side', 'closeup'];

router.post('/model-images/approve-ecommerce', async (req: Request, res: Response) => {
  const articleNumber = String(req.body?.articleNumber || '').trim();
  if (!articleNumber || articleNumber.includes('..') || articleNumber.includes('/')) {
    res.status(400).json({ success: false, error: 'A valid articleNumber is required' });
    return;
  }

  try {
    // Gather this article's view images (prefix "{articleNumber}/" — never matches the
    // E-commerce/ copies, which live under a different top-level prefix).
    const { objects } = await storageService.listModelImages({ prefix: `${articleNumber}/`, limit: 1000 });
    const views = objects
      .map((o) => {
        const rest = o.key.slice(articleNumber.length + 1); // strip "{articleNumber}/"
        const view = rest.replace(/\.[^.]+$/, '');
        return { key: o.key, view };
      })
      .filter((v) => v.view && !v.view.includes('/')); // only direct "{article}/{view}.ext" objects

    if (views.length === 0) {
      res.status(404).json({ success: false, error: 'No model images found for this article' });
      return;
    }

    // Sort by canonical view order; unknown views go last but keep a stable order.
    views.sort((a, b) => {
      const ia = APPROVE_VIEW_ORDER.indexOf(a.view);
      const ib = APPROVE_VIEW_ORDER.indexOf(b.view);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    // Sanitize the destination folder name — replace whitespace with hyphens so the
    // E-commerce/ path is URL-safe (e.g. "DARK GREY" → "DARK-GREY"). Source keys keep
    // their original spaced names; only the copy destination is normalized.
    const safeArticleFolder = articleNumber.replace(/\s+/g, '-');

    // Number sequentially with NO gaps: 1.jpg, 2.jpg, 3.jpg, ...
    const copied: Array<{ view: string; number: number; url: string }> = [];
    const ecommerceUrls: Record<string, string> = {};
    for (let i = 0; i < views.length; i++) {
      const number = i + 1;
      const destKey = `${ECOMMERCE_PREFIX}/${safeArticleFolder}/${number}.jpg`;
      const url = await storageService.copyModelImage(views[i].key, destKey);
      copied.push({ view: views[i].view, number, url });
      ecommerceUrls[String(number)] = url;
    }

    // Record who approved (last-approver-wins). Best-effort: the copy already succeeded,
    // so a DB hiccup here shouldn't fail the whole request.
    const approver = (req as any).user as { id: number; name: string } | undefined;
    let approvedAt = new Date();
    try {
      const row = await withPrismaRetry(() =>
        prisma.modelImageApproval.upsert({
          where: { articleNumber },
          create: { id: crypto.randomUUID(), articleNumber, approvedBy: approver?.id ?? null, ecommerceUrls },
          update: { approvedBy: approver?.id ?? null, approvedAt: new Date(), ecommerceUrls },
        })
      );
      approvedAt = row.approvedAt;
    } catch (dbErr: any) {
      console.error('[ModelGenBulk] approval DB record failed (files copied OK):', dbErr?.message);
    }

    console.log(`[ModelGenBulk] Approved ${copied.length} image(s) to ${ECOMMERCE_PREFIX}/ for article ${articleNumber} by user ${approver?.id ?? '?'}`);
    res.json({
      success: true,
      articleNumber,
      count: copied.length,
      copied,
      approvedBy: approver ? { id: approver.id, name: approver.name } : null,
      approvedAt,
    });
  } catch (err: any) {
    console.error('[ModelGenBulk] approve-ecommerce failed for', articleNumber, err?.message);
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve for e-commerce' });
  }
});

// ─── GET /model-images/meta — per-article generator + approval info for the gallery ──
// Returns a map { articleNumber: { generatedBy, approved, approvedBy, approvedAt } } so
// the browser can show "Generated by …" and an "Approved" tag. Data is small (tens of
// articles) so we return everything in one call.
router.get('/model-images/meta', async (_req: Request, res: Response) => {
  try {
    const [genRows, apprRows] = await Promise.all([
      withPrismaRetry(() =>
        prisma.modelGenerationResult.findMany({
          orderBy: { createdAt: 'desc' },
          select: { articleNumber: true, userId: true, createdAt: true },
        })
      ),
      withPrismaRetry(() =>
        prisma.modelImageApproval.findMany({
          select: { articleNumber: true, approvedBy: true, approvedAt: true },
        })
      ),
    ]);

    // Collect all user ids we need names for, then fetch in one query.
    const userIds = new Set<number>();
    for (const g of genRows) if (g.userId != null) userIds.add(g.userId);
    for (const a of apprRows) if (a.approvedBy != null) userIds.add(a.approvedBy);
    const users = userIds.size
      ? await withPrismaRetry(() =>
          prisma.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } })
        )
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const meta: Record<string, any> = {};
    // genRows are newest-first — keep the first (latest) generator seen per article.
    for (const g of genRows) {
      if (!meta[g.articleNumber]) {
        meta[g.articleNumber] = {
          generatedBy: g.userId != null ? { id: g.userId, name: nameById.get(g.userId) || `User ${g.userId}` } : null,
          approved: false,
          approvedBy: null,
          approvedAt: null,
        };
      }
    }
    for (const a of apprRows) {
      const entry = meta[a.articleNumber] || (meta[a.articleNumber] = { generatedBy: null, approved: false, approvedBy: null, approvedAt: null });
      entry.approved = true;
      entry.approvedBy = a.approvedBy != null ? { id: a.approvedBy, name: nameById.get(a.approvedBy) || `User ${a.approvedBy}` } : null;
      entry.approvedAt = a.approvedAt;
    }

    res.json({ success: true, meta });
  } catch (err: any) {
    console.error('[ModelGenBulk] model-images/meta failed:', err?.message);
    res.status(500).json({ success: false, error: err?.message || 'Failed to load image meta' });
  }
});

export default router;
