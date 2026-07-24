import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { runBatchPipeline, ensureOutputFolder } from '../services/modelGenerationService';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import bulkRoutes from './modelGenerationBulk';

const router = Router();

// Mount bulk-upload sub-routes (POST /bulk/upload, GET /bulk/job/:id, POST /bulk/job/:id/cancel)
router.use('/', bulkRoutes);

// ───────────────────────────────────────────────────────────────────────────
// MAJOR CATEGORY MASTER (major_cat_master)
// Lookup of MAJ CAT → name / division / ideal-for / model-image FRAME.
// The model-generation article flow resolves a MAJ CAT to its FRAME here.
// ───────────────────────────────────────────────────────────────────────────
const FRAME_VALUES = ['fw', 'upper', 'lower', 'set'] as const;

const MajorCatSchema = z.object({
  majCat: z.string().min(1).max(100).transform((s) => s.trim()),
  name: z.string().max(200).optional().transform((s) => (s ? s.trim() : undefined)),
  div: z.string().max(50).optional().transform((s) => (s ? s.trim() : undefined)),
  idealFor: z.string().max(50).optional().transform((s) => (s ? s.trim() : undefined)),
  frame: z.enum(FRAME_VALUES),
});

// GET /major-categories — list all (active) categories, newest-relevant first.
router.get('/major-categories', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await withPrismaRetry(() =>
      prisma.majorCatMaster.findMany({
        where: { isActive: true },
        orderBy: { majCat: 'asc' },
        select: { id: true, majCat: true, name: true, div: true, idealFor: true, frame: true },
      })
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /major-categories — add a new MAJ CAT to the master (or update if it exists).
router.post('/major-categories', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = MajorCatSchema.parse(req.body);
    const row = await withPrismaRetry(() =>
      prisma.majorCatMaster.upsert({
        where: { majCat: v.majCat },
        create: {
          majCat: v.majCat,
          name: v.name ?? null,
          div: v.div ?? null,
          idealFor: v.idealFor ?? null,
          frame: v.frame,
          isActive: true,
        },
        update: {
          name: v.name ?? null,
          div: v.div ?? null,
          idealFor: v.idealFor ?? null,
          frame: v.frame,
          isActive: true,
        },
      })
    );
    res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.issues });
      return;
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP'));
  },
});

const uploadFields = upload.fields([
  { name: 'designs', maxCount: 10 },
  { name: 'pattern', maxCount: 1 },
  { name: 'broach', maxCount: 1 },
  { name: 'color_image', maxCount: 1 },
]);

router.post('/generate', uploadFields, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[ModelGen] POST /generate called');
    const files = req.files as Record<string, Express.Multer.File[]>;
    const designs = files?.['designs'] || [];
    const patternFile = files?.['pattern']?.[0];
    const broachFile = files?.['broach']?.[0];
    const colorImageFile = files?.['color_image']?.[0];

    console.log('[ModelGen] Files received:', {
      designs: designs.map(f => ({ name: f.originalname, size: f.size, mime: f.mimetype })),
      pattern: patternFile ? { name: patternFile.originalname, size: patternFile.size } : null,
      broach: broachFile ? { name: broachFile.originalname, size: broachFile.size } : null,
      color_image: colorImageFile ? { name: colorImageFile.originalname, size: colorImageFile.size } : null,
    });

    if (!designs.length) {
      console.warn('[ModelGen] Rejected: no design files');
      res.status(400).json({ success: false, error: 'At least one garment image is required.' });
      return;
    }

    const { gender, bodytype, imagesCount, broach_placement, special_instructions, color_name } = req.body;
    console.log('[ModelGen] Body fields:', { gender, bodytype, imagesCount, broach_placement, special_instructions, color_name });

    if (!gender || !bodytype) {
      console.warn('[ModelGen] Rejected: missing gender or bodytype');
      res.status(400).json({ success: false, error: 'gender and bodytype are required.' });
      return;
    }

    const uploadsBase = path.join(process.cwd(), 'uploads');
    const { todayStr, hitFolder, hitIndex } = ensureOutputFolder(uploadsBase);
    console.log('[ModelGen] Output folder:', hitFolder);

    console.log('[ModelGen] Starting batch pipeline for', designs.length, 'file(s), imagesCount:', imagesCount || '1');
    const results = await runBatchPipeline(
      designs,
      gender,
      bodytype,
      imagesCount || '1',
      patternFile,
      broachFile,
      broach_placement,
      special_instructions,
      color_name,
      colorImageFile
    );
    console.log('[ModelGen] Batch pipeline done, results count:', results.length);

    const outputUrls: Array<{ file: string; view: string; url: string }> = [];
    const errors: Array<{ file: string; view: string; error: string }> = [];

    for (const item of results) {
      if (typeof item.output === 'string') {
        errors.push({ file: item.fileName, view: item.view, error: item.output });
        console.error(`[ModelGen] Failed ${item.fileName}/${item.view}: ${item.output}`);
        continue;
      }

      const safeName = path.basename(item.fileName, path.extname(item.fileName));
      const filename = `${safeName}_${item.view.replace(/\s+/g, '_')}.png`;
      const filepath = path.join(hitFolder, filename);
      fs.writeFileSync(filepath, item.output as Buffer);

      outputUrls.push({
        file: item.fileName,
        view: item.view,
        url: `/uploads/model-generation/${todayStr}/${hitIndex}/${filename}`,
      });
    }

    if (outputUrls.length === 0 && errors.length > 0) {
      res.status(500).json({
        success: false,
        error: errors[0].error,
        errors,
      });
      return;
    }

    res.json({
      success: true,
      count: outputUrls.length,
      results: outputUrls,
      errors: errors.length > 0 ? errors : undefined,
      date_folder: todayStr,
      hit_folder: hitIndex,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
