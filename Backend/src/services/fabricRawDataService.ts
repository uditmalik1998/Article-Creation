import { prismaClient as prisma } from '../utils/prisma';
import { storageService } from './storageService';
import { extractIntoFabricArticle, extractionToJson, isFabricVlmEnabled } from './fabricVlmService';
import { mapWithConcurrency } from '../utils/concurrency';

const BATCH_SIZE = 40;

export async function getFabricRawPipelineStatus(): Promise<{
  PENDING: number; PROCESSING: number; COMPLETED: number; FAILED: number; total: number;
}> {
  const groups = await prisma.fabricRawData.groupBy({ by: ['status'], _count: { _all: true } });
  const result = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, total: 0 };
  for (const g of groups) {
    const key = g.status as keyof typeof result;
    if (key in result) result[key] = g._count._all;
    result.total += g._count._all;
  }
  return result;
}
const LOCK_MINUTES = 20; // covers the Gemini step (4 parallel, ~5-15s each)

let _isRunning = false;

export function isFabricRawRunning(): boolean {
  return _isRunning;
}

export interface FabricRawRunResult {
  claimed: number;
  completed: number;
  failed: number;
}

/**
 * Downloads a fabric SRM image URL and uploads it to R2 (articlecreation bucket).
 * SRM fabric image URLs are publicly accessible — no auth headers needed.
 * Returns the permanent R2 URL on success, or null on failure.
 */
async function mirrorFabricImageToR2(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`[FabricRaw] Image fetch failed ${res.status}: ${imageUrl.slice(0, 120)}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeBase = contentType.split(';')[0].trim().toLowerCase();
    const ext = mimeBase.includes('png') ? 'png'
      : mimeBase.includes('webp') ? 'webp'
      : mimeBase.includes('gif') ? 'gif'
      : 'jpg';

    const buffer = Buffer.from(await res.arrayBuffer());
    const result = await storageService.uploadFile(buffer, `fabric-image.${ext}`, mimeBase, 'fabric-images');
    console.log(`[FabricRaw] Image mirrored to R2: ${result.url.slice(0, 80)}...`);
    return result.url;
  } catch (err: any) {
    console.warn(`[FabricRaw] Image mirror failed: ${err.message}`);
    return null;
  }
}

/**
 * Processes a single fabric_raw_data row:
 * 1. Tries to upload the image to R2; falls back to original URL on failure.
 * 2. Creates a fabric_article_data record with available SRM fields.
 * 3. Updates fabric_raw_data: sets flat_id = fabric_article_data.id,
 *    status = COMPLETED (image uploaded) or FAILED (image upload failed but record still created).
 * No retries — once FAILED it stays FAILED.
 */
async function processRow(row: {
  id: string;
  imageUrl: string | null;
  backImageUrl: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  division: string | null;
  subDivision: string | null;
  majorCategory: string | null;
  designNumber: string | null;
  presentationNo: string | null;
  price: any;
  presentationsType: string | null;
  source: string | null;
  fabric?: string | null;
}): Promise<{ success: boolean }> {
  let finalImageUrl: string | null = row.imageUrl;
  let imageUploaded = false;

  // Step 1: Decide whether to mirror to R2
  if (!row.imageUrl) {
    // No image at all — nothing to upload
    imageUploaded = true;
  } else if (row.imageUrl.includes('r2.dev')) {
    // Already a Cloudflare R2 URL — use as-is, no re-upload needed
    finalImageUrl = row.imageUrl;
    imageUploaded = true;
    console.log(`[FabricRaw] Image already in R2, skipping upload for row ${row.id}`);
  } else {
    // Supabase bucket URL (or other) — try to mirror to R2
    const r2Url = await mirrorFabricImageToR2(row.imageUrl);
    if (r2Url) {
      finalImageUrl = r2Url;
      imageUploaded = true;
    } else {
      // R2 upload failed — keep original Supabase URL as-is
      console.warn(`[FabricRaw] R2 upload failed for row ${row.id} — keeping original URL`);
      finalImageUrl = row.imageUrl;
    }
  }

  // Back photo: copied only when SRM sent one (else stays null), mirrored to R2 like
  // the front. Display-only — it never decides COMPLETED/FAILED.
  let finalBackImageUrl: string | null = null;
  if (row.backImageUrl) {
    finalBackImageUrl = row.backImageUrl.includes('r2.dev')
      ? row.backImageUrl
      : (await mirrorFabricImageToR2(row.backImageUrl)) ?? row.backImageUrl;
  }

  // Step 2: Insert into fabric_article_data
  try {
    const fabricArticle = await prisma.fabricArticleData.create({
      data: {
        vendorCode:        row.vendorCode,
        vendorName:        row.vendorName,
        division:          row.division,
        subDivision:       row.subDivision,
        majorCategory:     row.majorCategory,
        designNumber:      row.designNumber,
        pptNumber:         row.presentationNo ?? null,
        fabricRate:        row.price ?? null,
        rate:              row.price ?? null, // SRM price also fills rate (same as the uploader's Fabric Rate)
        fabricArticleType: row.presentationsType || 'Fabric Article', // SRM rows: default when SRM sends none
        source:            'SRM',
        imageUrl:          finalImageUrl,
        backImageUrl:      finalBackImageUrl,
        // m_* FAB fields: filled by the Gemini step below (fabricVlmService); user edits later.
      },
    });

    // Step 2b: Gemini fabric extraction → fills the empty m_* columns. Never fails the row:
    // the article stays visible with empty FAB fields if Gemini or the image fetch fails.
    let extractedData: any = undefined;
    if (isFabricVlmEnabled() && finalImageUrl) {
      try {
        const ex = await extractIntoFabricArticle(fabricArticle.id, { hints: { fabricText: row.fabric ?? null } });
        extractedData = extractionToJson(ex);
      } catch (vlmErr: any) {
        console.warn(`[FabricRaw] Gemini extraction failed for ${fabricArticle.id}: ${vlmErr.message}`);
        extractedData = { vlm: { ok: false, error: String(vlmErr.message).slice(0, 500), at: new Date().toISOString() } };
      }
    }

    // Step 3: Mark fabric_raw_data as COMPLETED or FAILED based on image upload
    await prisma.fabricRawData.update({
      where: { id: row.id },
      data: {
        flatId:       fabricArticle.id,
        status:       imageUploaded ? 'COMPLETED' : 'FAILED',
        errorMessage: imageUploaded ? null : 'Cloudflare R2 image upload failed; original SRM URL used',
        extractedAt:  new Date(),
        lockedUntil:  null,
        ...(extractedData !== undefined ? { extractedData } : {}),
      },
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[FabricRaw] Failed to create fabric_article_data for row ${row.id}:`, err.message);
    await prisma.fabricRawData.update({
      where: { id: row.id },
      data: {
        status:       'FAILED',
        errorMessage: `fabric_article_data insert failed: ${err.message}`,
        lockedUntil:  null,
      },
    });
    return { success: false };
  }
}

/**
 * Main entry point called by the cron.
 * Claims up to BATCH_SIZE PENDING rows (flat_id IS NULL) with FOR UPDATE SKIP LOCKED,
 * processes each one, and returns a summary.
 * No retries — FAILED rows are never picked up again.
 */
export async function runFabricRawDataProcessing(triggeredBy = 'CRON'): Promise<FabricRawRunResult> {
  if (_isRunning) {
    console.log(`[FabricRaw] Already running — skipping ${triggeredBy} trigger`);
    return { claimed: 0, completed: 0, failed: 0 };
  }

  _isRunning = true;
  const result: FabricRawRunResult = { claimed: 0, completed: 0, failed: 0 };

  try {
    // Claim PENDING rows that have never been processed (flat_id IS NULL).
    // SKIP LOCKED prevents concurrent cron ticks from grabbing the same rows.
    const claimedRows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE public.fabric_raw_data
      SET status       = 'PROCESSING',
          locked_until = now() + (${LOCK_MINUTES} || ' minutes')::interval
      WHERE id IN (
        SELECT id FROM public.fabric_raw_data
        WHERE flat_id IS NULL
          AND status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    if (claimedRows.length === 0) return result;

    result.claimed = claimedRows.length;

    // Fetch full row data for the claimed IDs
    const rows = await prisma.fabricRawData.findMany({
      where: { id: { in: claimedRows.map((r: { id: string }) => r.id) } },
      select: {
        id: true, imageUrl: true, backImageUrl: true, vendorCode: true, vendorName: true,
        division: true, subDivision: true, majorCategory: true,
        designNumber: true, presentationNo: true, price: true, presentationsType: true, source: true,
        fabric: true,
      },
    });

    // 4 rows at a time (the Gemini step is the slow part), like the FG raw worker.
    const outcomes = await mapWithConcurrency(rows, 4, (row) => processRow(row));
    for (const { success } of outcomes) {
      if (success) result.completed++;
      else result.failed++;
    }
  } catch (err: any) {
    console.error(`[FabricRaw] Unhandled error in processing run:`, err.message);
  } finally {
    _isRunning = false;
  }

  return result;
}
