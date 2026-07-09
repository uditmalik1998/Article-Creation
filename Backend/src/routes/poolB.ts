/**
 * Pool B article-attribute-value uploader routes (Admin only).
 *
 *   POST /api/poolb/preview    — parse (no SAP call)
 *   POST /api/poolb/commit     — sync (≤500 rows) or async job (>500 rows)
 *   GET  /api/poolb/job/:jobId — poll async job status
 *   GET  /api/poolb/jobs       — list recent jobs
 *
 * Mounted in index.ts behind `authenticate, requireAdmin`.
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler';
import { PoolBController } from '../controllers/poolBController';

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx / .xls) are allowed'));
    }
  },
});

const router = Router();

router.post('/preview', excelUpload.single('file'), asyncHandler(PoolBController.preview));
router.post('/commit', excelUpload.single('file'), asyncHandler(PoolBController.commit));
router.get('/jobs', asyncHandler(PoolBController.listJobs));
router.get('/job/:jobId', asyncHandler(PoolBController.getJob));

export default router;
