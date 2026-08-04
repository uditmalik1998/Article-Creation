/**
 * Raw Article Extraction Service
 *
 * Worker that processes raw_articles rows with status PENDING or FAILED,
 * runs VLM extraction on each image, then pushes results to
 * extraction_results_flat (creating or updating the record).
 *
 * Concurrency-safe: uses PostgreSQL FOR UPDATE SKIP LOCKED so multiple
 * server instances / cron runs never process the same row twice.
 *
 * Flow:
 *   raw_articles (PENDING / FAILED)
 *     → claim batch (PROCESSING + locked_until)
 *     → find or create extraction_results_flat record
 *     → run VLM via enrichSrmRowWithVlmAdmin
 *     → COMPLETED + flat_id stored   OR   FAILED (retry_count++)
 *     → if retry_count >= MAX_RETRIES → PERM_FAILED
 */

import { prismaClient as prisma, isDbCircuitOpen, openDbCircuit } from '../utils/prisma';
import { enrichSrmRowWithVlmAdmin, insertRawArticleAsFlat, type SrmRow } from './srmSyncService';


// ── Cutoff: presentations on or before this date are already in extraction_results_flat
//    via the old direct pipeline. Only stage rows AFTER this date to raw_articles.
export const RAW_PIPELINE_CUTOFF = new Date('2026-05-26T23:59:59.999Z');

// ── Constants ─────────────────────────────────────────────────────────────────
const BATCH_SIZE      = 10;   // rows claimed per run
const LOCK_MINUTES    = 12;   // lock duration (must be > max VLM time per row)
const MAX_RETRIES     = 3;    // after this many failures → PERM_FAILED

// ── Running guard ─────────────────────────────────────────────────────────────
let _isRunning = false;

export function isExtractionRunning(): boolean { return _isRunning; }

// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractionRunResult {
  claimed:   number;
  completed: number;
  failed:    number;
  errors:    number;
}

/**
 * Main entry point — call from cron, admin button, or post-fetch trigger.
 * Returns immediately if another run is already in progress.
 */
export async function runRawArticleExtraction(
  triggeredBy = 'MANUAL',
): Promise<ExtractionRunResult> {
  if (_isRunning) {
    console.log('[RawExtract] Already running — skipping duplicate invocation');
    return { claimed: 0, completed: 0, failed: 0, errors: 0 };
  }

  if (isDbCircuitOpen()) {
    console.log('[RawExtract] DB circuit open — skipping this tick');
    return { claimed: 0, completed: 0, failed: 0, errors: 0 };
  }

  _isRunning = true;
  let completed = 0, failed = 0, errors = 0;

  try {
    console.log(`[RawExtract] Starting (triggered by: ${triggeredBy})`);

    // ── Atomically claim a batch with SKIP LOCKED ─────────────────────────
    const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);

    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "public"."raw_articles"
      SET
        status       = 'PROCESSING'::"RawArticleStatus",
        locked_until = ${lockUntil}
      WHERE id IN (
        SELECT id
        FROM   "public"."raw_articles"
        WHERE  status IN (
                 'PENDING'::"RawArticleStatus",
                 'FAILED'::"RawArticleStatus",
                 -- Re-claim rows orphaned in PROCESSING (worker crashed/redeployed
                 -- mid-batch). The locked_until guard below means only rows whose
                 -- lock has EXPIRED are picked up, so actively-processing rows are
                 -- never stolen. Without this, a row left in PROCESSING is never
                 -- advanced again — it stays stuck forever.
                 'PROCESSING'::"RawArticleStatus"
               )
          AND  retry_count < ${MAX_RETRIES}
          AND  (locked_until IS NULL OR locked_until < NOW())
        ORDER  BY created_at ASC
        LIMIT  ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    if (claimed.length === 0) {
      console.log('[RawExtract] Nothing to process — queue is empty');
      return { claimed: 0, completed: 0, failed: 0, errors: 0 };
    }

    console.log(`[RawExtract] Claimed ${claimed.length} rows`);

    // Fetch full row data for claimed IDs
    const rows = await prisma.rawArticle.findMany({
      where: { id: { in: claimed.map(r => r.id) } },
    });

    // ── Process each row ──────────────────────────────────────────────────
    for (const row of rows) {
      try {
        await processOneRow(row);
        completed++;
      } catch (err: any) {
        errors++;
        const newCount = (row.retryCount ?? 0) + 1;
        const isPermFailed = newCount >= MAX_RETRIES;
        console.error(`[RawExtract] ❌ Error on ${row.id} (attempt ${newCount}): ${err.message}`);

        // Re-fetch current flat_id (processOneRow may have saved it before failing)
        const current = await prisma.rawArticle.findUnique({
          where:  { id: row.id },
          select: { flatId: true },
        });
        let flatId = current?.flatId ?? null;

        // PERM_FAILED guarantee: if still no flat record exists, create one now
        // with the raw SRM data (extractionStatus = 'SRM_IMPORT') so the article
        // is always visible in extraction_results_flat even without VLM attributes.
        if (isPermFailed && !flatId) {
          try {
            const srmRow: SrmRow = {
              presentation_no:            row.presentationNo,
              vendor_code:                row.vendorCode    ?? '',
              vendor_name:                row.vendorName,
              division:                   row.division      ?? '',
              sub_division:               row.subDivision   ?? '',
              major_category:             row.majorCategory ?? '',
              presentation_received_date: row.presentationReceivedDate?.toISOString() ?? '',
              design_number:              row.designNumber  ?? '',
              fabric:                     row.fabric        ?? '',
              no_of_colors:               row.noOfColors    ?? 0,
              price:                      row.price != null ? Number(row.price) : 0,
              image_url:                  row.imageUrl,
              presentations_type:         (row as any).presentationsType ?? null,
            };
            const created = await insertRawArticleAsFlat(srmRow, row.id);
            if (created) {
              flatId = created.id;
              console.log(`[RawExtract] ⚠️ PERM_FAILED fallback — created SRM-only flat record ${flatId} for ${row.presentationNo}/${row.designNumber}`);
            }
          } catch (flatErr: any) {
            console.error(`[RawExtract] ⚠️ Could not create fallback flat record for ${row.id}: ${flatErr.message}`);
          }
        }

        await prisma.rawArticle.update({
          where: { id: row.id },
          data: {
            status:       isPermFailed ? 'PERM_FAILED' : 'FAILED',
            retryCount:   newCount,
            errorMessage: (err.message ?? 'Unknown error').slice(0, 1000),
            lockedUntil:  null,
            ...(flatId ? { flatId } : {}),
          },
        });
        failed++;
      }
    }

    console.log(`[RawExtract] Done — completed:${completed} failed:${failed} errors:${errors}`);
    return { claimed: claimed.length, completed, failed, errors };

  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('ecircuitbreaker') || msg.includes('too many authentication failures')) {
      openDbCircuit();
    }
    throw err;
  } finally {
    _isRunning = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single raw_article row:
 * 1. Find or create the corresponding extraction_results_flat record.
 * 2. Run VLM enrichment via the shared srmSyncService helper.
 * 3. Mark COMPLETED and store flat_id.
 */
async function processOneRow(row: {
  id: string;
  presentationNo: string;
  vendorCode: string | null;
  vendorName: string | null;
  division: string | null;
  subDivision: string | null;
  majorCategory: string | null;
  presentationReceivedDate: Date | null;
  designNumber: string | null;
  fabric: string | null;
  noOfColors: number | null;
  price: any;
  imageUrl: string | null;
  flatId: string | null;
  retryCount: number;
}): Promise<void> {
  // ── Step 1: Resolve flat record ──────────────────────────────────────────
  let flatId = row.flatId ?? null;
  let flatImageUrl: string | null = row.imageUrl;
  let flatMajorCategory: string | null = row.majorCategory;

  if (!flatId) {
    // Look up existing flat record using presentation_no + design_number + image_url.
    // All three must match — two rows with the same design_number but different image_urls
    // (e.g. two colour variants) must each get their own flat record.
    const existing = row.designNumber
      ? await prisma.extractionResultFlat.findFirst({
          where: {
            srmOriginalDesignNumber: row.designNumber,
            pptNumber:               row.presentationNo,
            ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
          },
          select: { id: true, imageUrl: true, majorCategory: true, srmUniqueId: true },
        })
      : null;

    if (existing) {
      flatId            = existing.id;
      flatImageUrl      = existing.imageUrl ?? row.imageUrl;
      flatMajorCategory = existing.majorCategory ?? row.majorCategory;
      console.log(`[RawExtract] Found existing flat record ${flatId} for design ${row.designNumber}`);

      // Backfill srm_unique_id if not already set (handles records created before this feature)
      if (!existing.srmUniqueId) {
        await prisma.extractionResultFlat.update({
          where: { id: flatId },
          data:  { srmUniqueId: row.id },
        });
      }
    } else {
      // Create a new flat record (same path as srmSyncService insertRow)
      const srmRow: SrmRow = {
        presentation_no:            row.presentationNo,
        vendor_code:                row.vendorCode    ?? '',
        vendor_name:                row.vendorName,
        division:                   row.division      ?? '',
        sub_division:               row.subDivision   ?? '',
        major_category:             row.majorCategory ?? '',
        presentation_received_date: row.presentationReceivedDate?.toISOString() ?? '',
        design_number:              row.designNumber  ?? '',
        fabric:                     row.fabric        ?? '',
        no_of_colors:               row.noOfColors    ?? 0,
        price:                      row.price != null ? Number(row.price) : 0,
        image_url:                  row.imageUrl,
        presentations_type:         (row as any).presentationsType ?? null,
      };

      // Pass row.id so srm_unique_id is set on the flat record from creation
      const created = await insertRawArticleAsFlat(srmRow, row.id);
      if (!created) throw new Error('insertRawArticleAsFlat returned null — insertRow failed');

      flatId           = created.id;
      flatImageUrl     = created.imageUrl ?? row.imageUrl;
      console.log(`[RawExtract] Created flat record ${flatId} for design ${row.designNumber}`);
    }

    // Persist flat_id so future re-runs skip the lookup
    await prisma.rawArticle.update({
      where: { id: row.id },
      data:  { flatId },
    });
  } else {
    // flat_id already known — fetch current imageUrl and majorCategory
    const existing = await prisma.extractionResultFlat.findUnique({
      where:  { id: flatId },
      select: { imageUrl: true, majorCategory: true },
    });
    if (existing) {
      flatImageUrl      = existing.imageUrl      ?? row.imageUrl;
      flatMajorCategory = existing.majorCategory ?? row.majorCategory;
    }
  }

  if (!flatImageUrl) {
    throw new Error(`No image URL available for row ${row.id} / flat ${flatId} — cannot run VLM`);
  }

  // ── Step 2: Run VLM enrichment ───────────────────────────────────────────
  console.log(`[RawExtract] Running VLM on flat ${flatId} (${row.presentationNo} / ${row.designNumber})`);
  const ok = await enrichSrmRowWithVlmAdmin(flatId, flatImageUrl, flatMajorCategory);

  if (!ok) {
    throw new Error('VLM enrichment returned false — 0 usable attributes after all retries');
  }

  // ── Step 3: Mark COMPLETED ───────────────────────────────────────────────
  await prisma.rawArticle.update({
    where: { id: row.id },
    data: {
      status:       'COMPLETED',
      extractedAt:  new Date(),
      lockedUntil:  null,
      errorMessage: null,
      flatId,
    },
  });

  console.log(`[RawExtract] ✅ Completed ${row.id} → flat ${flatId}`);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns counts of raw_articles by status — used for Admin pipeline status card.
 */
export async function getRawArticlePipelineStatus(): Promise<{
  PENDING:    number;
  PROCESSING: number;
  COMPLETED:  number;
  FAILED:     number;
  PERM_FAILED: number;
  total:      number;
}> {
  const groups = await prisma.rawArticle.groupBy({
    by:     ['status'],
    _count: { _all: true },
  });

  const result = {
    PENDING:     0,
    PROCESSING:  0,
    COMPLETED:   0,
    FAILED:      0,
    PERM_FAILED: 0,
    total:       0,
  };

  for (const g of groups) {
    const key = g.status as keyof typeof result;
    if (key in result) result[key] = g._count._all;
    result.total += g._count._all;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage a single SRM row into raw_articles with status PENDING.
 *
 * Called by:
 *   - syncFromSrm() (12PM/8PM cron) for new presentations after the cutoff date
 *   - testApiController fetchPresentationToRaw / fetchByPptNo (Admin panel)
 *
 * Dedup key: presentation_no::design_number::image_url
 * If a row with the same uniqueKey already exists → returns 'skipped' (no update).
 *
 * @param row    SRM row data
 * @param source 'CRON_SYNC' | 'ADMIN_MANUAL'
 * @returns 'inserted' | 'skipped'
 */
export async function upsertRawArticleFromSrm(
  row: SrmRow,
  source: 'CRON_SYNC' | 'ADMIN_MANUAL',
): Promise<'inserted' | 'skipped'> {
  const uniqueKey = `${row.presentation_no}::${row.design_number ?? ''}::${row.image_url ?? ''}`;

  const existing = await prisma.rawArticle.findUnique({
    where:  { uniqueKey },
    select: { id: true },
  });

  if (existing) return 'skipped';

  // Normalise vendor code to last 6 digits
  const normCode = row.vendor_code
    ? (() => {
        const digits = row.vendor_code.replace(/\D/g, '');
        return digits.length > 6 ? digits.slice(-6) : digits || null;
      })()
    : null;

  await prisma.rawArticle.create({
    data: {
      presentationNo:           row.presentation_no,
      vendorCode:               normCode,
      vendorName:               row.vendor_name               ?? null,
      division:                 row.division                  || null,
      subDivision:              row.sub_division              || null,
      majorCategory:            row.major_category            || null,
      presentationReceivedDate: row.presentation_received_date
        ? new Date(row.presentation_received_date) : null,
      designNumber:             row.design_number             || null,
      fabric:                   row.fabric                    || null,
      noOfColors:               row.no_of_colors              ?? null,
      price:                    row.price != null ? row.price : null,
      imageUrl:                 row.image_url                 ?? null,
      uniqueKey,
      source,
      status: 'PENDING',
    },
  });

  return 'inserted';
}
