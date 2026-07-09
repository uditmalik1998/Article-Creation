-- Add Pool B job tracking tables
-- Safe to run: only creates new types/tables, touches nothing existing.

CREATE TYPE "PoolBJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "PoolBBatchStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE IF NOT EXISTS pool_b_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        "PoolBJobStatus" NOT NULL DEFAULT 'QUEUED',
  env           TEXT NOT NULL,
  test          BOOLEAN NOT NULL DEFAULT false,
  total_rows    INTEGER NOT NULL,
  total_batches INTEGER NOT NULL,
  batch_size    INTEGER NOT NULL,
  success_rows  INTEGER NOT NULL DEFAULT 0,
  failed_rows   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pool_b_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES pool_b_jobs(id) ON DELETE CASCADE,
  batch_index   INTEGER NOT NULL,
  status        "PoolBBatchStatus" NOT NULL DEFAULT 'QUEUED',
  start_row     INTEGER NOT NULL,
  end_row       INTEGER NOT NULL,
  row_count     INTEGER NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  results       JSONB,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS pool_b_batches_job_id_idx ON pool_b_batches(job_id);
