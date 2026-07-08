import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
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
import { parseArticleCodesFromXlsx, parseArticleCodesFromText, sourceKeyFor } from '../services/articleListParser';

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
router.get('/bulk/job/:id/download-zip', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  if (!fs.existsSync(job.outputDir)) {
    res.status(404).json({ success: false, error: 'Job output folder no longer exists on disk' });
    return;
  }

  // Walk outputDir, collect generated PNGs. We add a friendly per-file name
  // based on the originating garment so the zip is easy to browse.
  const entries = fs.readdirSync(job.outputDir).filter(f => {
    const full = path.join(job.outputDir, f);
    return fs.statSync(full).isFile() && /\.(png|jpe?g|webp)$/i.test(f);
  });

  if (entries.length === 0) {
    res.status(409).json({ success: false, error: 'No generated images yet for this job' });
    return;
  }

  try {
    const zip = new AdmZip();
    for (const name of entries) {
      const full = path.join(job.outputDir, name);
      zip.addLocalFile(full);
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
    const { gender, bodytype, imagesCount, codesText } = req.body as Record<string, string>;
    if (!gender || !bodytype) {
      res.status(400).json({ success: false, error: 'gender and bodytype are required.' });
      return;
    }

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

    const jobId = newJobId();
    const dirs = createJobDirs(jobId); // reused only for job.json persistence
    const job = createArticleJob({
      id: jobId,
      userId: (req as any).user?.id,
      jobDir: dirs.jobDir,
      inputDir: dirs.inputDir,
      outputDir: dirs.outputDir,
      codes,
      sourceKeys: codes.map(sourceKeyFor),
      params: {
        gender,
        bodytype,
        imagesCount: imagesCount || '5',
      },
    });

    startJob(job.id);

    res.status(202).json({
      success: true,
      jobId: job.id,
      totalArticles: codes.length,
      totalTasks: job.total,
      status: job.status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
