/**
 * snowflakeFlatSyncService.ts
 *
 * Copies APPROVED extraction_results_flat rows to Snowflake
 * V2RETAIL.BRONZE.ARTICLE_CREATION_EXTRACTION_RESULTS_FLAT — only rows changed
 * since the last successful run (updated_at watermark), plus approver name/email.
 *
 *   1. Watermark = last OK run in ARTICLE_CREATION_SYNC_LOG − 10 min (none → full load).
 *   2. Export changed APPROVED rows (NDJSON) and every APPROVED id from Supabase.
 *   3. PUT both to the user stage, COPY into per-run staging tables,
 *      MERGE on id, delete rows whose id is no longer APPROVED.
 *   4. Log the run to ARTICLE_CREATION_SYNC_LOG.
 *
 * Triggered by the nightly cron (index.ts, 00:00 IST) or Admin › Expenses › Sync Now.
 * Staging names are per run, so prod / local / dev can run it without clashing.
 *
 * Env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY_B64 (base64 of the
 * unencrypted .p8), SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE.
 *
 * updated_at only catches raw-SQL writes once Backend/prisma/flat_updated_at_trigger.sql
 * is applied; the id check still removes un-approved / deleted rows either way.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import snowflake from 'snowflake-sdk';
import { prismaClient as prisma } from '../utils/prisma';

snowflake.configure({ logLevel: 'ERROR' });

const TARGET   = 'V2RETAIL.BRONZE.ARTICLE_CREATION_EXTRACTION_RESULTS_FLAT';
const LOG      = 'V2RETAIL.BRONZE.ARTICLE_CREATION_SYNC_LOG';
const OVERLAP_MS = 10 * 60_000;
// Never delete more than this share of Snowflake rows in one run (guards a bad export).
const MAX_DELETE_SHARE = 0.10;
const PAGE = 2000;

export interface SnowflakeSyncRun {
  status: string;              // OK | OK_COUNT_DIFF | FAIL
  runStarted: string | null;   // ISO, UTC
  runFinished: string | null;
  changedRows: number | null;
  deletedRows: number | null;
  supabaseApproved: number | null;
  snowflakeRows: number | null;
  message: string | null;
  triggeredBy: string | null;
  source: string | null;
}

let syncInProgress = false;

export function isSnowflakeSyncInProgress(): boolean {
  return syncInProgress;
}

export function isSnowflakeSyncConfigured(): boolean {
  return !!(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USER && process.env.SNOWFLAKE_PRIVATE_KEY_B64);
}

// ─── Snowflake helpers ────────────────────────────────────────────────────────

async function connect(): Promise<snowflake.Connection> {
  const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: Buffer.from(process.env.SNOWFLAKE_PRIVATE_KEY_B64!, 'base64').toString('utf8'),
    role: process.env.SNOWFLAKE_ROLE || undefined,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || undefined,
  });
  await conn.connectAsync(() => undefined);
  return conn;
}

function exec<T = any>(conn: snowflake.Connection, sqlText: string, binds?: any[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows ?? []) as T[])),
    });
  });
}

function destroy(conn: snowflake.Connection): Promise<void> {
  return new Promise(resolve => conn.destroy(() => resolve()));
}

const q = (s: string | null | undefined) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const ident = (c: string) => `"${c.replace(/"/g, '""')}"`;

async function ensureLogTable(conn: snowflake.Connection): Promise<void> {
  await exec(conn, `CREATE TABLE IF NOT EXISTS ${LOG} (
    RUN_STARTED TIMESTAMP_NTZ, RUN_FINISHED TIMESTAMP_NTZ, STATUS VARCHAR,
    WATERMARK_FROM TIMESTAMP_NTZ, WATERMARK_TO TIMESTAMP_NTZ,
    CHANGED_ROWS NUMBER, DELETED_ROWS NUMBER, SUPABASE_APPROVED NUMBER, SNOWFLAKE_ROWS NUMBER,
    MESSAGE VARCHAR)`);
  await exec(conn, `ALTER TABLE ${LOG} ADD COLUMN IF NOT EXISTS TRIGGERED_BY VARCHAR`);
  await exec(conn, `ALTER TABLE ${LOG} ADD COLUMN IF NOT EXISTS SOURCE VARCHAR`);
}

function sourceName(): string {
  return `${process.env.NODE_ENV || 'development'}@${os.hostname()}`;
}

// ─── Supabase export ──────────────────────────────────────────────────────────

/** Column list in target order (approver name/email right after approved_by) + select expressions. */
async function buildSelect(): Promise<{ cols: string[]; select: string }> {
  const info = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'extraction_results_flat' order by ordinal_position`);
  const cols: string[] = [];
  const exprs: string[] = [];
  for (const { column_name: c, data_type: t } of info) {
    cols.push(c);
    // timestamptz → plain UTC timestamp so Snowflake stores it as TIMESTAMP_NTZ like the rest.
    exprs.push(t === 'timestamp with time zone'
      ? `(f.${ident(c)} at time zone 'utc') as ${ident(c)}`
      : `f.${ident(c)}`);
    if (c === 'approved_by') {
      cols.push('approved_by_name', 'approved_by_email');
      exprs.push('u.name as approved_by_name', 'u.email as approved_by_email');
    }
  }
  return { cols, select: exprs.join(', ') };
}

/** Write changed APPROVED rows as NDJSON, paging by id. Returns the row count. */
async function exportChanged(file: string, select: string, wmFrom: string | null): Promise<number> {
  const out = fs.createWriteStream(file, { encoding: 'utf8' });
  let lastId = '';
  let total = 0;
  try {
    for (;;) {
      const rows = await prisma.$queryRawUnsafe<{ id: string; j: string }[]>(
        `select t.id, row_to_json(t)::text as j from (
           select ${select}
           from public.extraction_results_flat f
           left join public.users u on u.id = f.approved_by
           where f.approval_status = 'APPROVED'
             ${wmFrom ? `and f.updated_at > $2::timestamp` : ''}
             and f.id collate "C" > $1
           order by f.id collate "C"
           limit ${PAGE}
         ) t`,
        lastId, ...(wmFrom ? [wmFrom] : []));
      if (rows.length === 0) break;
      for (const r of rows) {
        out.write(r.j + '\n');
        if (r.id > lastId) lastId = r.id;
      }
      total += rows.length;
      if (rows.length < PAGE) break;
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  }
  return total;
}

async function exportApprovedIds(file: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `select id from public.extraction_results_flat where approval_status = 'APPROVED'`);
  fs.writeFileSync(file, rows.map(r => JSON.stringify({ id: r.id })).join('\n') + '\n', 'utf8');
  return rows.length;
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncFlatToSnowflake(triggeredBy: string): Promise<SnowflakeSyncRun> {
  if (!isSnowflakeSyncConfigured()) throw new Error('Snowflake sync is not configured (SNOWFLAKE_* env vars missing)');
  if (syncInProgress) throw new Error('Snowflake sync already in progress');
  syncInProgress = true;

  const runId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = new Date();
  const stg = `${TARGET}_STG_${runId}`.toUpperCase();
  const stgIds = `${TARGET}_IDS_${runId}`.toUpperCase();
  const stagePath = `@~/article_flat_sync/${runId}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flat-sync-'));
  const changedFile = path.join(dir, 'changed.json');
  const idsFile = path.join(dir, 'ids.json');
  let conn: snowflake.Connection | null = null;
  let wmFrom: string | null = null;
  let wmTo: string | null = null;

  console.log(`[SnowflakeSync] Starting (${triggeredBy}, ${sourceName()})`);
  try {
    conn = await connect();
    await ensureLogTable(conn);

    const last = await exec<{ W: string | null }>(conn,
      `SELECT TO_VARCHAR(MAX(WATERMARK_TO), 'YYYY-MM-DD HH24:MI:SS.FF6') AS W FROM ${LOG} WHERE STATUS LIKE 'OK%'`);
    if (last[0]?.W) {
      wmFrom = new Date(new Date(last[0].W + 'Z').getTime() - OVERLAP_MS).toISOString().replace('T', ' ').replace('Z', '');
    }
    const now = await prisma.$queryRawUnsafe<{ t: string }[]>(`select (now() at time zone 'utc')::timestamp::text as t`);
    wmTo = now[0].t;

    // Columns must exist on both sides.
    const { cols, select } = await buildSelect();
    const tcols = (await exec<{ COLUMN_NAME: string }>(conn,
      `SELECT COLUMN_NAME FROM V2RETAIL.INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'BRONZE' AND TABLE_NAME = 'ARTICLE_CREATION_EXTRACTION_RESULTS_FLAT'`)).map(r => r.COLUMN_NAME);
    const missing = cols.filter(c => !tcols.includes(c));
    if (missing.length) throw new Error(`Snowflake table is missing columns (add them first): ${missing.join(', ')}`);

    const changed = await exportChanged(changedFile, select, wmFrom);
    const sbApproved = await exportApprovedIds(idsFile);
    console.log(`[SnowflakeSync] Export: from=${wmFrom ?? 'start'} to=${wmTo} changed=${changed} approved=${sbApproved}`);

    const sfBefore = Number((await exec<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${TARGET}`))[0].N);
    if (sbApproved === 0 || (sfBefore && sbApproved < sfBefore * (1 - MAX_DELETE_SHARE))) {
      throw new Error(`Supabase APPROVED ids (${sbApproved}) far below Snowflake rows (${sfBefore}); refusing to sync`);
    }

    // Upload + stage.
    const fileUrl = (p: string) => `'file://${p.replace(/\\/g, '/')}'`;
    await exec(conn, `PUT ${fileUrl(changedFile)} ${stagePath} AUTO_COMPRESS=TRUE OVERWRITE=TRUE`);
    await exec(conn, `PUT ${fileUrl(idsFile)} ${stagePath} AUTO_COMPRESS=TRUE OVERWRITE=TRUE`);
    await exec(conn, `CREATE TRANSIENT TABLE ${stg} LIKE ${TARGET}`);
    await exec(conn, `COPY INTO ${stg} FROM ${stagePath}/changed.json.gz
      FILE_FORMAT = (TYPE = JSON) MATCH_BY_COLUMN_NAME = CASE_SENSITIVE`);
    await exec(conn, `CREATE TRANSIENT TABLE ${stgIds} (ID VARCHAR)`);
    await exec(conn, `COPY INTO ${stgIds} FROM ${stagePath}/ids.json.gz
      FILE_FORMAT = (TYPE = JSON) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE`);

    const stgRows = Number((await exec<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${stg}`))[0].N);
    const idRows = Number((await exec<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${stgIds}`))[0].N);
    if (stgRows !== changed || idRows !== sbApproved) {
      throw new Error(`Stage load mismatch: changed ${changed} vs ${stgRows}, ids ${sbApproved} vs ${idRows}`);
    }
    const toDelete = Number((await exec<{ N: number }>(conn,
      `SELECT COUNT(*) AS N FROM ${TARGET} t WHERE NOT EXISTS (SELECT 1 FROM ${stgIds} i WHERE i.ID = t."id")`))[0].N);
    if (sfBefore && toDelete > sfBefore * MAX_DELETE_SHARE) {
      throw new Error(`Would delete ${toDelete} of ${sfBefore} rows; refusing`);
    }

    // Merge + delete in one transaction.
    const upd = cols.filter(c => c !== 'id').map(c => `t.${ident(c)} = s.${ident(c)}`).join(', ');
    const insCols = cols.map(ident).join(', ');
    const insVals = cols.map(c => `s.${ident(c)}`).join(', ');
    await exec(conn, 'BEGIN');
    try {
      await exec(conn, `MERGE INTO ${TARGET} t USING ${stg} s ON t."id" = s."id"
        WHEN MATCHED THEN UPDATE SET ${upd}
        WHEN NOT MATCHED THEN INSERT (${insCols}) VALUES (${insVals})`);
      await exec(conn, `DELETE FROM ${TARGET} t WHERE NOT EXISTS (SELECT 1 FROM ${stgIds} i WHERE i.ID = t."id")`);
      await exec(conn, 'COMMIT');
    } catch (err) {
      await exec(conn, 'ROLLBACK').catch(() => undefined);
      throw err;
    }

    const sfAfter = Number((await exec<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${TARGET}`))[0].N);
    const status = sfAfter === sbApproved ? 'OK' : 'OK_COUNT_DIFF';
    const message = `rows before=${sfBefore} after=${sfAfter}`;
    await exec(conn, `INSERT INTO ${LOG} (RUN_STARTED, RUN_FINISHED, STATUS, WATERMARK_FROM, WATERMARK_TO,
        CHANGED_ROWS, DELETED_ROWS, SUPABASE_APPROVED, SNOWFLAKE_ROWS, MESSAGE, TRIGGERED_BY, SOURCE)
      VALUES (${q(startedAt.toISOString().replace('T', ' ').replace('Z', ''))}, SYSDATE(), ${q(status)},
        ${q(wmFrom)}, ${q(wmTo)}, ${changed}, ${toDelete}, ${sbApproved}, ${sfAfter},
        ${q(message)}, ${q(triggeredBy)}, ${q(sourceName())})`);
    console.log(`[SnowflakeSync] ${status}: changed=${changed} deleted=${toDelete} supabase=${sbApproved} snowflake=${sfAfter}`);

    return {
      status, runStarted: startedAt.toISOString(), runFinished: new Date().toISOString(),
      changedRows: changed, deletedRows: toDelete, supabaseApproved: sbApproved, snowflakeRows: sfAfter,
      message, triggeredBy, source: sourceName(),
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 4000);
    console.error(`[SnowflakeSync] Failed: ${msg}`);
    if (conn) {
      await exec(conn, `INSERT INTO ${LOG} (RUN_STARTED, RUN_FINISHED, STATUS, WATERMARK_FROM, WATERMARK_TO, MESSAGE, TRIGGERED_BY, SOURCE)
        VALUES (${q(startedAt.toISOString().replace('T', ' ').replace('Z', ''))}, SYSDATE(), 'FAIL',
          ${q(wmFrom)}, ${q(wmTo)}, ${q(msg)}, ${q(triggeredBy)}, ${q(sourceName())})`).catch(() => undefined);
    }
    throw err;
  } finally {
    if (conn) {
      await exec(conn, `DROP TABLE IF EXISTS ${stg}`).catch(() => undefined);
      await exec(conn, `DROP TABLE IF EXISTS ${stgIds}`).catch(() => undefined);
      await exec(conn, `REMOVE ${stagePath}`).catch(() => undefined);
      await destroy(conn);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    syncInProgress = false;
  }
}

// ─── Status for the Admin card ────────────────────────────────────────────────

export async function getSnowflakeSyncStatus(): Promise<{ lastRun: SnowflakeSyncRun | null; lastOk: SnowflakeSyncRun | null }> {
  const conn = await connect();
  try {
    await ensureLogTable(conn);
    const pick = (where: string) => exec<any>(conn, `SELECT STATUS,
        TO_VARCHAR(RUN_STARTED, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RUN_STARTED,
        TO_VARCHAR(RUN_FINISHED, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RUN_FINISHED,
        CHANGED_ROWS, DELETED_ROWS, SUPABASE_APPROVED, SNOWFLAKE_ROWS, MESSAGE, TRIGGERED_BY, SOURCE
      FROM ${LOG} ${where} ORDER BY RUN_FINISHED DESC NULLS LAST LIMIT 1`);
    const map = (r: any): SnowflakeSyncRun | null => r ? {
      status: r.STATUS,
      runStarted: r.RUN_STARTED ? r.RUN_STARTED + 'Z' : null,
      runFinished: r.RUN_FINISHED ? r.RUN_FINISHED + 'Z' : null,
      changedRows: r.CHANGED_ROWS ?? null,
      deletedRows: r.DELETED_ROWS ?? null,
      supabaseApproved: r.SUPABASE_APPROVED ?? null,
      snowflakeRows: r.SNOWFLAKE_ROWS ?? null,
      message: r.MESSAGE ?? null,
      triggeredBy: r.TRIGGERED_BY ?? null,
      source: r.SOURCE ?? null,
    } : null;
    const [lastRun, lastOk] = await Promise.all([pick(''), pick(`WHERE STATUS LIKE 'OK%'`)]);
    return { lastRun: map(lastRun[0]), lastOk: map(lastOk[0]) };
  } finally {
    await destroy(conn);
  }
}
