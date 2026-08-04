/**
 * Kids Division Duplication Service
 *
 * After an ExtractionResultFlat record is saved for the KIDS division,
 * this service creates exactly 2 copies of the original record so that
 * 3 total articles exist (1 original + 2 copies), all with the same
 * majorCategory and subDivision.
 *
 * Each copy gets its own new UUID, a freshly re-uploaded R2 image, and
 * a new synthetic ExtractionJob.
 */

import path from 'path';
// import fs from 'fs';
// import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { prismaClient as prisma } from '../utils/prisma';
import { Prisma } from '../generated/prisma';
import { storageService } from './storageService';
import { upsert360ArticleFlatRow } from '../utils/mirror360Flat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ── OLD: Excel-based sibling mapping (kept for reference) ──────────────────
// interface KidsMappingRow {
//   'SUB-DIV': string;
//   MAJ_CAT: string;
//   NAME: string;
// }

// interface SiblingMapping {
//   subDiv: string;
//   majCat: string;
//   name: string;
// }
// ── END OLD ────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// OLD: Excel loading (cached after first read so we don't hit disk on every call)
// ---------------------------------------------------------------------------

// let cachedMappings: KidsMappingRow[] | null = null;

// function loadKidsMappings(): KidsMappingRow[] {
//   if (cachedMappings) return cachedMappings;
//
//   const excelPath = path.resolve(__dirname, '../data/kids-division-mapping.xlsx');
//
//   if (!fs.existsSync(excelPath)) {
//     console.warn(`[KidsDuplication] Excel file not found at ${excelPath}`);
//     cachedMappings = [];
//     return cachedMappings;
//   }
//
//   try {
//     const workbook = XLSX.readFile(excelPath);
//     const sheetName = workbook.SheetNames[0];
//     const worksheet = workbook.Sheets[sheetName];
//     const rows = XLSX.utils.sheet_to_json<KidsMappingRow>(worksheet);
//     cachedMappings = rows;
//     console.log(`[KidsDuplication] Loaded ${rows.length} rows from kids-division-mapping.xlsx`);
//     return cachedMappings;
//   } catch (err) {
//     console.error('[KidsDuplication] Failed to load Excel mapping file:', err);
//     cachedMappings = [];
//     return cachedMappings;
//   }
// }

// ---------------------------------------------------------------------------
// Helper: normalise the division string so KIDS / KID / kids all match
// ---------------------------------------------------------------------------

function isKidsDivision(division: string | null | undefined): boolean {
  if (!division) return false;
  const norm = division.trim().toUpperCase();
  return norm === 'KIDS' || norm === 'KID';
}

// ---------------------------------------------------------------------------
// OLD: Helper: find siblings for a given MAJ_CAT
// Returns all mapping rows that share the same NAME but have a different MAJ_CAT
// ---------------------------------------------------------------------------

// function findSiblings(majCat: string, mappings: KidsMappingRow[]): SiblingMapping[] {
//   const sourceMajCat = (majCat || '').trim().toUpperCase();
//
//   // Find the NAME for the source MAJ_CAT
//   const sourceRow = mappings.find(
//     (r) => (r.MAJ_CAT || '').trim().toUpperCase() === sourceMajCat
//   );
//
//   if (!sourceRow) {
//     console.log(`[KidsDuplication] MAJ_CAT '${majCat}' not found in Excel mapping — skipping duplication`);
//     return [];
//   }
//
//   const sourceName = (sourceRow.NAME || '').trim().toUpperCase();
//
//   // All rows with same NAME but different MAJ_CAT
//   const siblings = mappings
//     .filter(
//       (r) =>
//         (r.NAME || '').trim().toUpperCase() === sourceName &&
//         (r.MAJ_CAT || '').trim().toUpperCase() !== sourceMajCat
//     )
//     .map((r) => ({
//       subDiv: r['SUB-DIV'],
//       majCat: r.MAJ_CAT,
//       name: r.NAME,
//     }));
//
//   console.log(
//     `[KidsDuplication] Found ${siblings.length} sibling(s) for MAJ_CAT='${majCat}' (NAME='${sourceRow.NAME}')`
//   );
//
//   return siblings;
// }

// ---------------------------------------------------------------------------
// Helper: re-upload image from URL to R2 with a new unique key
// ---------------------------------------------------------------------------

async function reuseOrCopyImageToR2(sourceImageUrl: string): Promise<string> {
  // Fetch the image bytes from the source URL (which is our own R2 CDN/signed URL)
  let response: Response;
  try {
    response = await fetch(sourceImageUrl);
  } catch (fetchErr: any) {
    throw new Error(
      `[KidsDuplication] Failed to fetch source image for re-upload: ${fetchErr?.message || fetchErr}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `[KidsDuplication] Source image fetch returned HTTP ${response.status} for URL: ${sourceImageUrl}`
    );
  }

  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const ext =
    mimeType.includes('png')
      ? 'png'
      : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const fakeOriginalName = `kids-dup-${randomUUID()}.${ext}`;

  const uploadResult = await storageService.uploadFile(
    imageBuffer,
    fakeOriginalName,
    mimeType,
    'fashion-images'
  );

  console.log(
    `[KidsDuplication] Re-uploaded image to R2: ${uploadResult.key} → ${uploadResult.url}`
  );

  return uploadResult.url;
}

// ---------------------------------------------------------------------------
// Main export: duplicateForKidsDivision
// ---------------------------------------------------------------------------

const KIDS_COPY_COUNT = 2; // total articles = 1 original + KIDS_COPY_COUNT copies

/**
 * Given a freshly-saved ExtractionResultFlat record (identified by its DB id),
 * this function:
 *  1. Checks if the record's division is KIDS/KID.
 *  2. Creates exactly KIDS_COPY_COUNT copies of the record, each with the
 *     same majorCategory and subDivision as the original.
 *  3. Each copy gets a new UUID, a freshly re-uploaded R2 image, and a new
 *     synthetic ExtractionJob.
 *
 * The function is designed to be called fire-and-forget (no await at call site)
 * so it wraps itself in a top-level try/catch and logs instead of throwing.
 */
export async function duplicateForKidsDivision(flatId: string): Promise<void> {
  try {
    // ── 1. Fetch the original record ────────────────────────────────────────
    const original = await prisma.extractionResultFlat.findUnique({
      where: { id: flatId },
    });

    if (!original) {
      console.warn(`[KidsDuplication] Record ${flatId} not found — skipping`);
      return;
    }

    // ── 2. Check division ───────────────────────────────────────────────────
    if (!isKidsDivision(original.division)) {
      return;
    }

    console.log(
      `[KidsDuplication] Kids record detected (id=${flatId}, division=${original.division}, majCat=${original.majorCategory}) — creating ${KIDS_COPY_COUNT} copies`
    );

    // ── 3. Must have a MAJ_CAT ──────────────────────────────────────────────
    if (!original.majorCategory) {
      console.warn(`[KidsDuplication] Record ${flatId} has no majorCategory — skipping duplication`);
      return;
    }

    // ── OLD: Excel load + sibling lookup ────────────────────────────────────
    // const mappings = loadKidsMappings();
    // const siblings = findSiblings(original.majorCategory, mappings);
    // if (siblings.length === 0) {
    //   console.log(`[KidsDuplication] No siblings found for '${original.majorCategory}' — nothing to duplicate`);
    //   return;
    // }
    // ── END OLD ─────────────────────────────────────────────────────────────

    // ── 4. Create KIDS_COPY_COUNT identical copies ──────────────────────────
    for (let i = 0; i < KIDS_COPY_COUNT; i++) {
      try {
        console.log(
          `[KidsDuplication] Creating copy ${i + 1}/${KIDS_COPY_COUNT} for MAJ_CAT='${original.majorCategory}' SUB-DIV='${original.subDivision}'`
        );

        // Re-upload image to R2 so each copy has its own independent URL
        let newImageUrl = original.imageUrl;
        if (original.imageUrl) {
          try {
            newImageUrl = await reuseOrCopyImageToR2(original.imageUrl);
          } catch (imgErr: any) {
            console.error(
              `[KidsDuplication] Image re-upload failed for copy ${i + 1}: ${imgErr.message} — using original URL as fallback`
            );
            newImageUrl = original.imageUrl;
          }
        }

        // Fetch the original job to get its category
        const originalJob = original.jobId
          ? await prisma.extractionJob.findUnique({
              where: { id: original.jobId },
              select: { categoryId: true, userId: true, aiModel: true },
            })
          : null;

        if (!originalJob) {
          console.warn(`[KidsDuplication] Original job ${original.jobId} not found — skipping copy ${i + 1}`);
          continue;
        }

        // Create a new synthetic ExtractionJob for this copy
        const newJob = await prisma.extractionJob.create({
          data: {
            userId: originalJob.userId,
            categoryId: originalJob.categoryId,
            imageUrl: newImageUrl || '',
            status: 'COMPLETED',
            aiModel: originalJob.aiModel,
            processingTimeMs: original.processingTimeMs,
            tokensUsed: original.totalTokens,
            inputTokens: original.inputTokens,
            outputTokens: original.outputTokens,
            apiCost: original.apiCost,
            totalAttributes: original.totalAttributes,
            extractedCount: original.extractedCount,
            avgConfidence: original.avgConfidence,
            completedAt: new Date(),
            designNumber: original.articleNumber,
          },
        });

        // Clone the flat record — same majorCategory and subDivision as original
        const {
          id: _id,
          jobId: _jobId,
          imageUrl: _imageUrl,
          imageUncPath: _imageUncPath,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          approvalStatus: _approvalStatus,
          approvedBy: _approvedBy,
          approvedAt: _approvedAt,
          sapSyncStatus: _sapSyncStatus,
          sapArticleId: _sapArticleId,
          sapSyncMessage: _sapSyncMessage,
          imageExtractionRawData: _imageExtractionRawData,
          ...rest
        } = original;

        const kidsId = randomUUID();
        const kidsData = {
          ...rest,
          id: kidsId,
          jobId: newJob.id,
          imageUrl: newImageUrl,
          approvalStatus: 'PENDING' as const,
          approvedBy: null,
          approvedAt: null,
          sapSyncStatus: 'NOT_SYNCED' as const,
          sapArticleId: null,
          sapSyncMessage: null,
          imageUncPath: null,
          imageExtractionRawData: _imageExtractionRawData ?? Prisma.DbNull,
        };

        await prisma.extractionResultFlat.create({ data: kidsData });

        // Mirror to 360article (fire-and-forget)
        void upsert360ArticleFlatRow(kidsId, kidsData as Record<string, unknown>);

        console.log(
          `[KidsDuplication] Created copy ${i + 1}/${KIDS_COPY_COUNT} (id=${kidsId}, jobId=${newJob.id})`
        );
      } catch (copyErr: any) {
        console.error(
          `[KidsDuplication] Error creating copy ${i + 1}:`,
          copyErr?.message || copyErr
        );
      }
    }

    console.log(`[KidsDuplication] Duplication complete for flatId=${flatId} — ${KIDS_COPY_COUNT} copies created`);
  } catch (err: any) {
    console.error('[KidsDuplication] Unexpected error in duplicateForKidsDivision:', err?.message || err);
  }
}
