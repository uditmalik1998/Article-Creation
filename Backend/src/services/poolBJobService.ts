/**
 * poolBJobService.ts
 *
 * Manages async batch jobs for large Pool B uploads (> POOL_B_BATCH_SIZE rows).
 * Uses raw SQL so no Prisma-generate cycle is needed at deploy time.
 *
 * Flow:
 *   createAndRunPoolBJob() → inserts job + batch rows in DB, fires background
 *                           processing without blocking the HTTP response.
 *   getPoolBJob()          → fetches job + batches for status polling.
 *
 * Each batch processes up to POOL_B_BATCH_SIZE articles through the same
 * pushRawAttributesToSap() chain used by the synchronous commit path.
 * Batches run SEQUENTIALLY to avoid overwhelming SAP; within each batch,
 * individual articles run at SAP_RFC_CONCURRENCY concurrency (same as sync).
 */

import { prismaClient as prisma } from '../utils/prisma';
import { mapWithConcurrency } from '../utils/concurrency';
import { pushRawAttributesToSap, isAttributePushEnabled } from './sapAttributePushService';
import { PoolBRow } from './poolBPatchService';

export const POOL_B_BATCH_SIZE = parseInt(process.env.POOL_B_BATCH_SIZE || '500', 10);
const SAP_RFC_CONCURRENCY = parseInt(process.env.SAP_RFC_CONCURRENCY || '7', 10);

// ─── DB row shapes (raw SQL result types) ────────────────────────────────────

export interface PoolBJobRow {
  id: string;
  status: string;
  env: string;
  test: boolean;
  total_rows: number;
  total_batches: number;
  batch_size: number;
  success_rows: number;
  failed_rows: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface PoolBBatchRow {
  id: string;
  job_id: string;
  batch_index: number;
  status: string;
  start_row: number;
  end_row: number;
  row_count: number;
  success_count: number;
  failed_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  results: unknown;
  error_message: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function insertJob(
  env: string,
  test: boolean,
  totalRows: number,
  totalBatches: number,
  batchSize: number,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO pool_b_jobs (env, test, total_rows, total_batches, batch_size)
    VALUES (${env}, ${test}, ${totalRows}, ${totalBatches}, ${batchSize})
    RETURNING id
  `;
  return rows[0].id;
}

async function insertBatches(
  jobId: string,
  batches: Array<{ batchIndex: number; startRow: number; endRow: number; rowCount: number }>,
): Promise<void> {
  for (const b of batches) {
    await prisma.$executeRaw`
      INSERT INTO pool_b_batches (job_id, batch_index, start_row, end_row, row_count)
      VALUES (${jobId}::uuid, ${b.batchIndex}, ${b.startRow}, ${b.endRow}, ${b.rowCount})
    `;
  }
}

async function updateBatchStart(batchId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pool_b_batches
    SET status = 'PROCESSING', started_at = now()
    WHERE id = ${batchId}::uuid
  `;
}

async function updateBatchDone(
  batchId: string,
  ok: boolean,
  successCount: number,
  failedCount: number,
  results: unknown,
  errorMessage?: string,
): Promise<void> {
  const status = ok ? 'COMPLETED' : 'FAILED';
  const resultsJson = JSON.stringify(results);
  if (errorMessage) {
    await prisma.$executeRaw`
      UPDATE pool_b_batches
      SET status = ${status}::"PoolBBatchStatus",
          success_count = ${successCount},
          failed_count = ${failedCount},
          results = ${resultsJson}::jsonb,
          error_message = ${errorMessage},
          completed_at = now()
      WHERE id = ${batchId}::uuid
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE pool_b_batches
      SET status = ${status}::"PoolBBatchStatus",
          success_count = ${successCount},
          failed_count = ${failedCount},
          results = ${resultsJson}::jsonb,
          completed_at = now()
      WHERE id = ${batchId}::uuid
    `;
  }
}

async function updateJobProgress(
  jobId: string,
  addSuccess: number,
  addFailed: number,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pool_b_jobs
    SET success_rows = success_rows + ${addSuccess},
        failed_rows  = failed_rows  + ${addFailed}
    WHERE id = ${jobId}::uuid
  `;
}

async function updateJobFinal(jobId: string, status: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pool_b_jobs
    SET status = ${status}::"PoolBJobStatus", completed_at = now()
    WHERE id = ${jobId}::uuid
  `;
}

async function updateJobStarted(jobId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pool_b_jobs
    SET status = 'PROCESSING'::"PoolBJobStatus", started_at = now()
    WHERE id = ${jobId}::uuid
  `;
}

async function getBatchIds(jobId: string): Promise<{ id: string; batch_index: number }[]> {
  return prisma.$queryRaw<{ id: string; batch_index: number }[]>`
    SELECT id, batch_index FROM pool_b_batches
    WHERE job_id = ${jobId}::uuid
    ORDER BY batch_index ASC
  `;
}

// ─── Core background processor ───────────────────────────────────────────────

async function processJobInBackground(
  jobId: string,
  allRows: PoolBRow[],
  opts: { test: boolean; env: string },
): Promise<void> {
  if (!isAttributePushEnabled()) {
    await updateJobFinal(jobId, 'FAILED');
    return;
  }
  try {
    await updateJobStarted(jobId);
    const batchMeta = await getBatchIds(jobId);

    for (const meta of batchMeta) {
      const startIdx = meta.batch_index * POOL_B_BATCH_SIZE;
      const batchRows = allRows.slice(startIdx, startIdx + POOL_B_BATCH_SIZE);

      await updateBatchStart(meta.id);

      try {
        const results = await mapWithConcurrency(batchRows, SAP_RFC_CONCURRENCY, async (row) => {
          const res = await pushRawAttributesToSap(row.matnr, row.changes, {
            test: opts.test,
            env: opts.env,
          });
          return {
            matnr: row.matnr,
            ok: res.ok,
            matkl: res.matkl,
            writtenCount: res.writtenCount,
            nicCount: res.nicCount,
            lockedCount: res.lockedCount,
            errorMessage: res.errorMessage,
          };
        });

        const successCount = results.filter((r) => r.ok).length;
        const failedCount = results.length - successCount;

        await updateBatchDone(meta.id, failedCount === 0, successCount, failedCount, results);
        await updateJobProgress(jobId, successCount, failedCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Batch processing error';
        await updateBatchDone(meta.id, false, 0, batchRows.length, [], msg);
        await updateJobProgress(jobId, 0, batchRows.length);
      }
    }

    // Determine final job status from batch outcomes
    const finalBatches = await prisma.$queryRaw<{ status: string }[]>`
      SELECT status FROM pool_b_batches WHERE job_id = ${jobId}::uuid
    `;
    const hasCompleted = finalBatches.some((b) => b.status === 'COMPLETED');
    const hasFailed = finalBatches.some((b) => b.status === 'FAILED');
    const finalStatus = hasFailed && hasCompleted ? 'PARTIAL' : hasFailed ? 'FAILED' : 'COMPLETED';
    await updateJobFinal(jobId, finalStatus);
  } catch (err) {
    console.error('[PoolBJob] fatal background error:', err);
    try { await updateJobFinal(jobId, 'FAILED'); } catch { /* best effort */ }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface PoolBJobCreateResult {
  jobId: string;
  totalRows: number;
  totalBatches: number;
  batchSize: number;
}

export async function createAndRunPoolBJob(
  rows: PoolBRow[],
  opts: { test: boolean; env: string },
): Promise<PoolBJobCreateResult> {
  const batchSize = POOL_B_BATCH_SIZE;
  const totalBatches = Math.ceil(rows.length / batchSize);

  // Insert job header
  const jobId = await insertJob(opts.env, opts.test, rows.length, totalBatches, batchSize);

  // Insert batch rows
  const batchMeta = Array.from({ length: totalBatches }, (_, i) => ({
    batchIndex: i,
    startRow: i * batchSize,
    endRow: Math.min((i + 1) * batchSize, rows.length) - 1,
    rowCount: Math.min((i + 1) * batchSize, rows.length) - i * batchSize,
  }));
  await insertBatches(jobId, batchMeta);

  // Fire background — intentionally NOT awaited so the HTTP response returns immediately
  setImmediate(() => {
    processJobInBackground(jobId, rows, opts).catch((err) => {
      console.error('[PoolBJob] unhandled background error:', err);
    });
  });

  return { jobId, totalRows: rows.length, totalBatches, batchSize };
}

export interface PoolBJobStatus {
  id: string;
  status: string;
  env: string;
  test: boolean;
  totalRows: number;
  totalBatches: number;
  batchSize: number;
  successRows: number;
  failedRows: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  batches: Array<{
    id: string;
    batchIndex: number;
    status: string;
    startRow: number;
    endRow: number;
    rowCount: number;
    successCount: number;
    failedCount: number;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
    results: unknown;
  }>;
}

export async function getPoolBJob(jobId: string): Promise<PoolBJobStatus | null> {
  const jobs = await prisma.$queryRaw<PoolBJobRow[]>`
    SELECT * FROM pool_b_jobs WHERE id = ${jobId}::uuid
  `;
  if (!jobs.length) return null;
  const job = jobs[0];

  const batches = await prisma.$queryRaw<PoolBBatchRow[]>`
    SELECT * FROM pool_b_batches WHERE job_id = ${jobId}::uuid ORDER BY batch_index ASC
  `;

  return {
    id: job.id,
    status: job.status,
    env: job.env,
    test: job.test,
    totalRows: job.total_rows,
    totalBatches: job.total_batches,
    batchSize: job.batch_size,
    successRows: job.success_rows,
    failedRows: job.failed_rows,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    batches: batches.map((b) => ({
      id: b.id,
      batchIndex: b.batch_index,
      status: b.status,
      startRow: b.start_row,
      endRow: b.end_row,
      rowCount: b.row_count,
      successCount: b.success_count,
      failedCount: b.failed_count,
      startedAt: b.started_at,
      completedAt: b.completed_at,
      errorMessage: b.error_message,
      results: b.results,
    })),
  };
}

export async function listRecentPoolBJobs(limit = 20): Promise<PoolBJobRow[]> {
  return prisma.$queryRaw<PoolBJobRow[]>`
    SELECT * FROM pool_b_jobs ORDER BY created_at DESC LIMIT ${limit}
  `;
}
