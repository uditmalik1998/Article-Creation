/**
 * poolBController.ts
 *
 * HTTP layer for the Pool B article-attribute-value uploader (Admin only).
 *
 *   POST /api/poolb/preview           — parse the grid (no SAP call)
 *   POST /api/poolb/commit            — live AUSP patch
 *                                       ≤ POOL_B_BATCH_SIZE rows → sync response
 *                                       >  POOL_B_BATCH_SIZE rows → async job, returns jobId
 *   GET  /api/poolb/job/:jobId        — poll async job status + batch results
 *   GET  /api/poolb/jobs              — list recent jobs (last 20)
 */

import { Request, Response } from 'express';
import { parsePoolBExcel, runPoolBPatch } from '../services/poolBPatchService';
import {
  createAndRunPoolBJob,
  getPoolBJob,
  listRecentPoolBJobs,
  POOL_B_BATCH_SIZE,
} from '../services/poolBJobService';

export class PoolBController {
  static async preview(req: Request, res: Response) {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ success: false, error: 'No Excel file uploaded (field name must be "file").' });
      }
      const result = await parsePoolBExcel(req.file.buffer);
      return res.json({
        success: true,
        defaultEnv: 'qa',
        batchSize: POOL_B_BATCH_SIZE,
        willQueue: result.matnrCount > POOL_B_BATCH_SIZE,
        ...result,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message || 'Failed to parse Excel' });
    }
  }

  static async commit(req: Request, res: Response) {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ success: false, error: 'No Excel file uploaded (field name must be "file").' });
      }

      const env = String(req.body?.env || '').trim().toLowerCase();
      if (env !== 'qa' && env !== 'prod') {
        return res.status(400).json({ success: false, error: 'env must be explicitly "qa" or "prod".' });
      }
      const test = String(req.body?.test ?? 'false').toLowerCase() === 'true';

      const parsed = await parsePoolBExcel(req.file.buffer);
      if (parsed.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'No article rows with values to push.' });
      }

      // ── Large file: async queue ───────────────────────────────────────────
      if (parsed.rows.length > POOL_B_BATCH_SIZE) {
        console.log(
          `[PoolB] queuing async job env=${env} test=${test} ` +
          `rows=${parsed.rows.length} batchSize=${POOL_B_BATCH_SIZE}`,
        );
        const job = await createAndRunPoolBJob(parsed.rows, { test, env });
        return res.json({
          success: true,
          queued: true,
          jobId: job.jobId,
          totalRows: job.totalRows,
          totalBatches: job.totalBatches,
          batchSize: job.batchSize,
          message: `${job.totalRows} records split into ${job.totalBatches} batches of ${job.batchSize}. Poll /api/poolb/job/${job.jobId} for progress.`,
        });
      }

      // ── Small file: synchronous (existing behaviour) ──────────────────────
      console.log(`[PoolB] commit env=${env} test=${test} matnrs=${parsed.rows.length} cells=${parsed.totalValueCells}`);
      const report = await runPoolBPatch(parsed.rows, { test, env });
      console.log(`[PoolB] done ok=${report.ok} failed=${report.failed} written=${report.totalWritten} nic=${report.totalNic} (${report.durationMs}ms)`);

      return res.json({ success: true, queued: false, ...report });
    } catch (err: any) {
      console.error('[PoolB] commit error:', err?.message);
      return res.status(500).json({ success: false, error: err?.message || 'Pool B patch failed' });
    }
  }

  static async getJob(req: Request, res: Response) {
    try {
      const { jobId } = req.params;
      if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });
      const job = await getPoolBJob(jobId);
      if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
      return res.json({ success: true, ...job });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch job' });
    }
  }

  static async listJobs(_req: Request, res: Response) {
    try {
      const jobs = await listRecentPoolBJobs(20);
      return res.json({ success: true, jobs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to list jobs' });
    }
  }
}
