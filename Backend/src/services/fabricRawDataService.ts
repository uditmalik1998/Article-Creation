import { prismaClient as prisma } from '../utils/prisma';
import { storageService } from './storageService';

const BATCH_SIZE = 20;

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
const LOCK_MINUTES = 10;

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
  vendorCode: string | null;
  vendorName: string | null;
  division: string | null;
  subDivision: string | null;
  majorCategory: string | null;
  designNumber: string | null;
  price: any;
  presentationsType: string | null;
  source: string | null;
}): Promise<{ success: boolean }> {
  let finalImageUrl: string | null = row.imageUrl;
  let imageUploaded = false;

  // Step 1: Upload image to R2
  if (row.imageUrl) {
    const r2Url = await mirrorFabricImageToR2(row.imageUrl);
    if (r2Url) {
      finalImageUrl = r2Url;
      imageUploaded = true;
    } else {
      // Keep original SRM URL as fallback — record will still be created
      console.warn(`[FabricRaw] R2 upload failed for row ${row.id} — using original URL as fallback`);
    }
  } else {
    // No image at all — treat as uploaded (nothing to upload)
    imageUploaded = true;
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
        fabricRate:        row.price ?? null,
        fabricArticleType: row.presentationsType ?? null,
        source:            'SRM',
        imageUrl:          finalImageUrl,
        // All m_* construction fields left null — filled in by user later
      },
    });

    // Step 3: Mark fabric_raw_data as COMPLETED or FAILED based on image upload
    await prisma.fabricRawData.update({
      where: { id: row.id },
      data: {
        flatId:       fabricArticle.id,
        status:       imageUploaded ? 'COMPLETED' : 'FAILED',
        errorMessage: imageUploaded ? null : 'Cloudflare R2 image upload failed; original SRM URL used',
        extractedAt:  new Date(),
        lockedUntil:  null,
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
        id: true, imageUrl: true, vendorCode: true, vendorName: true,
        division: true, subDivision: true, majorCategory: true,
        designNumber: true, price: true, presentationsType: true, source: true,
      },
    });

    for (const row of rows) {
      const { success } = await processRow(row);
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
