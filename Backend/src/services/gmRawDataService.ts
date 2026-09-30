/**
 * gmRawDataService.ts
 * Processes gm_raw_data rows → gm_article_data.
 * Pattern mirrors fabricRawDataService: claim → mirror image → insert → mark COMPLETED/FAILED.
 * No retries — FAILED rows stay FAILED.
 */

import { prismaClient as prisma } from '../utils/prisma';
import { storageService } from './storageService';

const BATCH_SIZE  = 20;
const LOCK_MINUTES = 10;

let _isRunning = false;

export function isGmRawRunning(): boolean {
  return _isRunning;
}

export interface GmRawRunResult {
  claimed: number;
  completed: number;
  failed: number;
}

export async function getGmRawPipelineStatus(): Promise<{
  PENDING: number; PROCESSING: number; COMPLETED: number; FAILED: number; total: number;
}> {
  const groups = await prisma.gmRawData.groupBy({ by: ['status'], _count: { _all: true } });
  const result = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, total: 0 };
  for (const g of groups) {
    const key = g.status as keyof typeof result;
    if (key in result) result[key] = g._count._all;
    result.total += g._count._all;
  }
  return result;
}

/**
 * Downloads a GM image URL and uploads it to R2 (gm-images bucket).
 * Returns the permanent R2 URL on success, or null on failure.
 */
async function mirrorGmImageToR2(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`[GmRaw] Image fetch failed ${res.status}: ${imageUrl.slice(0, 120)}`);
      return null;
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeBase = contentType.split(';')[0].trim().toLowerCase();
    const ext = mimeBase.includes('png') ? 'png'
      : mimeBase.includes('webp') ? 'webp'
      : mimeBase.includes('gif') ? 'gif'
      : 'jpg';

    const buffer = Buffer.from(await res.arrayBuffer());
    const result = await storageService.uploadFile(buffer, `gm-image.${ext}`, mimeBase, 'gm-images');
    console.log(`[GmRaw] Image mirrored to R2: ${result.url.slice(0, 80)}...`);
    return result.url;
  } catch (err: any) {
    console.warn(`[GmRaw] Image mirror failed: ${err.message}`);
    return null;
  }
}

/**
 * Processes a single gm_raw_data row:
 * 1. Tries to upload the image to R2; falls back to original URL on failure.
 * 2. Creates a gm_article_data record with available fields from the raw row.
 * 3. Updates gm_raw_data: sets flat_id = gm_article_data.id,
 *    status = COMPLETED (image uploaded) or FAILED (image upload failed but record still created).
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
  presentationNo: string;
  price: any;
  source: string | null;
  presentationsType: string | null;
  season: string | null;
}): Promise<{ success: boolean }> {
  let finalImageUrl: string | null = row.imageUrl;
  let imageUploaded = false;

  // Step 1: Decide whether to mirror to R2
  if (!row.imageUrl) {
    imageUploaded = true;
  } else if (row.imageUrl.includes('r2.dev')) {
    finalImageUrl = row.imageUrl;
    imageUploaded = true;
    console.log(`[GmRaw] Image already in R2, skipping upload for row ${row.id}`);
  } else {
    const r2Url = await mirrorGmImageToR2(row.imageUrl);
    if (r2Url) {
      finalImageUrl = r2Url;
      imageUploaded = true;
    } else {
      console.warn(`[GmRaw] R2 upload failed for row ${row.id} — keeping original URL`);
      finalImageUrl = row.imageUrl;
    }
  }

  // Step 2: Insert into gm_article_data
  try {
    const gmArticle = await prisma.gmArticleData.create({
      data: {
        vendorCode:    row.vendorCode,
        vendorName:    row.vendorName,
        division:      row.division,
        subDivision:   row.subDivision,
        majorCategory: row.majorCategory,
        designNumber:  row.designNumber,
        pptNumber:     row.presentationNo ?? null,
        rate:          row.price ?? null,
        source:        'SRM',
        imageUrl:      finalImageUrl,
        gmArticleType: row.presentationsType ?? null,
        gmSeason:      row.season ?? null,
        // All other GM attribute fields left null — filled in by user later
      },
    });

    // Step 3: Mark gm_raw_data as COMPLETED or FAILED based on image upload
    await prisma.gmRawData.update({
      where: { id: row.id },
      data: {
        flatId:       gmArticle.id,
        status:       imageUploaded ? 'COMPLETED' : 'FAILED',
        errorMessage: imageUploaded ? null : 'Cloudflare R2 image upload failed; original URL used',
        extractedAt:  new Date(),
        lockedUntil:  null,
      },
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[GmRaw] Failed to create gm_article_data for row ${row.id}:`, err.message);
    await prisma.gmRawData.update({
      where: { id: row.id },
      data: {
        status:       'FAILED',
        errorMessage: `gm_article_data insert failed: ${err.message}`,
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
export async function runGmRawDataProcessing(triggeredBy = 'CRON'): Promise<GmRawRunResult> {
  if (_isRunning) {
    console.log(`[GmRaw] Already running — skipping ${triggeredBy} trigger`);
    return { claimed: 0, completed: 0, failed: 0 };
  }

  _isRunning = true;
  const result: GmRawRunResult = { claimed: 0, completed: 0, failed: 0 };

  try {
    const claimedRows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE public.gm_raw_data
      SET status       = 'PROCESSING',
          locked_until = now() + (${LOCK_MINUTES} || ' minutes')::interval
      WHERE id IN (
        SELECT id FROM public.gm_raw_data
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

    const rows = await prisma.gmRawData.findMany({
      where: { id: { in: claimedRows.map((r) => r.id) } },
      select: {
        id: true, imageUrl: true, vendorCode: true, vendorName: true,
        division: true, subDivision: true, majorCategory: true,
        designNumber: true, presentationNo: true, price: true, source: true,
        presentationsType: true, season: true,
      },
    });

    for (const row of rows) {
      const { success } = await processRow(row);
      if (success) result.completed++;
      else result.failed++;
    }
  } catch (err: any) {
    console.error(`[GmRaw] Unhandled error in processing run:`, err.message);
  } finally {
    _isRunning = false;
  }

  return result;
}
