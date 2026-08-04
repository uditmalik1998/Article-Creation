/**
 * Variant Creation Service
 *
 * After a generic ExtractionResultFlat is created, this service reads the
 * active sizes for the MAJ_CAT from the `maj_cat_sizes` table (status='ACT')
 * and creates size variant copies of the generic article.
 */
import { randomUUID } from 'crypto';
import { prismaClient as prisma } from '../utils/prisma';
import { Prisma } from '../generated/prisma';
import { upsert360ArticleFlatRow, mirror360FlatUpdate } from '../utils/mirror360Flat';

/**
 * Active sizes for a major category, read from the `maj_cat_sizes` table
 * (status = 'ACT'). Replaces the old active-size-mapping.xlsx source.
 * Order is preserved by row id (the order the size master was uploaded in).
 */
export async function getSizesForMajCat(majCat: string): Promise<string[]> {
  const upper = (majCat || '').trim().toUpperCase();
  if (!upper) return [];

  const rows = await prisma.$queryRaw<{ size: string }[]>`
    SELECT size
    FROM maj_cat_sizes
    WHERE UPPER(TRIM(major_category)) = ${upper}
      AND UPPER(TRIM(status)) = 'ACT'
      AND size IS NOT NULL AND TRIM(size) <> ''
    ORDER BY id
  `;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const s = String(r.size).trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * Server-side size guard: is `size` allowed for `majorCategory`?
 * Calls the Supabase RPC public.is_size_allowed via Prisma (no @supabase/supabase-js).
 * Throws on DB error so callers can surface a 500.
 */
export async function isSizeAllowed(majorCategory: string, size: string): Promise<boolean> {
  const mc = (majorCategory || '').trim();
  const sz = (size || '').trim();
  if (!mc || !sz) return false;
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT public.is_size_allowed(${mc}, ${sz}) AS ok
  `;
  return rows[0]?.ok === true;
}

// Fields that should NOT be synced from generic to variants (variant-specific)
export const VARIANT_ONLY_FIELDS = ['variantSize', 'variantColor', 'size', 'colour'];

export async function createVariantsForGeneric(genericId: string): Promise<void> {
  try {
    const generic = await prisma.extractionResultFlat.findUnique({ where: { id: genericId } });
    if (!generic || !generic.majorCategory) return;
    if (!generic.isGeneric) return;

    const sizes = await getSizesForMajCat(generic.majorCategory);
    if (sizes.length === 0) {
      console.log(`[VariantCreation] No sizes found for ${generic.majorCategory}`);
      return;
    }

    console.log(`[VariantCreation] Creating ${sizes.length} variants for ${generic.majorCategory}`);

    const {
      id: _id, jobId: _jobId, imageUncPath: _unc, createdAt: _ca, updatedAt: _ua,
      approvalStatus: _as, approvedBy: _ab, approvedAt: _aat,
      sapSyncStatus: _sss, sapArticleId: _sai, sapSyncMessage: _ssm,
      isGeneric: _ig, genericArticleId: _gai, variantSize: _vs, variantColor: _vc,
      imageExtractionRawData: _ied1,
      ...rest
    } = generic;

    for (const size of sizes) {
      try {
        const variantId = randomUUID();
        const variantData = {
          ...rest,
          id: variantId,
          jobId: null,
          imageUncPath: null,
          approvalStatus: 'PENDING' as const,
          approvedBy: null,
          approvedAt: null,
          sapSyncStatus: 'NOT_SYNCED' as const,
          sapArticleId: null,
          sapSyncMessage: null,
          isGeneric: false,
          genericArticleId: genericId,
          variantSize: size,
          size: size,
          colour: generic.colour || null,
          variantColor: generic.colour || null,
          imageExtractionRawData: _ied1 ?? Prisma.DbNull,
        };
        await prisma.extractionResultFlat.create({ data: variantData });

        // Mirror to 360article (fire-and-forget)
        void upsert360ArticleFlatRow(variantId, variantData as Record<string, unknown>);

        console.log(`[VariantCreation] Created variant size=${size} for generic=${genericId}`);
      } catch (err: any) {
        console.error(`[VariantCreation] Failed for size ${size}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error('[VariantCreation] Unexpected error:', err?.message);
  }
}

export async function addColorVariants(
  genericId: string,
  color: string,
  sizesOverride?: string[],
  imageUrlOverride?: string,
): Promise<number> {
  const generic = await prisma.extractionResultFlat.findUnique({ where: { id: genericId } });
  if (!generic) return 0;

  if (!generic.majorCategory) throw new Error('No Major Category found on this article — cannot create variants.');
  const allowedSizes = await getSizesForMajCat(generic.majorCategory);
  if (allowedSizes.length === 0) throw new Error(`No active sizes are defined for Major Category "${generic.majorCategory}". Please upload them via the Size Master in the Admin page.`);

  // Manual mode: restrict to the requested sizes, keeping only those actually
  // allowed for this Major Category (the dropdown is MC-filtered, but this also
  // guards against tampering). Auto mode (no override) uses all allowed sizes.
  const requestedSizes = sizesOverride && sizesOverride.length > 0
    ? allowedSizes.filter((s) => sizesOverride.some((o) => o.trim().toUpperCase() === s.trim().toUpperCase()))
    : allowedSizes;
  if (requestedSizes.length === 0) throw new Error('None of the selected sizes are valid for this Major Category.');

  // Skip any (size, color) combinations that already exist for this generic so
  // re-adding a color for a new size never duplicates existing variant rows.
  const colorUpper = color.trim().toUpperCase();
  const existingForColor = await prisma.extractionResultFlat.findMany({
    where: { genericArticleId: genericId, isGeneric: false },
    select: { variantSize: true, variantColor: true },
  });
  const existingSizesForColor = new Set(
    existingForColor
      .filter((v) => (v.variantColor || '').trim().toUpperCase() === colorUpper)
      .map((v) => (v.variantSize || '').trim().toUpperCase()),
  );
  const sizes = requestedSizes.filter((s) => !existingSizesForColor.has(s.trim().toUpperCase()));
  if (sizes.length === 0) return 0; // every requested size already has this color

  const {
    id: _id, jobId: _jobId, imageUncPath: _unc, createdAt: _ca, updatedAt: _ua,
    approvalStatus: _as, approvedBy: _ab, approvedAt: _aat,
    sapSyncStatus: _sss, sapArticleId: _sai, sapSyncMessage: _ssm,
    isGeneric: _ig, genericArticleId: _gai, variantSize: _vs, variantColor: _vc,
    imageExtractionRawData: _ied2,
    ...rest
  } = generic;

  // A per-color image (uploaded in the Add Color flow) overrides the generic's
  // image so every size of this color shows that color's photo.
  const variantImageUrl = (imageUrlOverride && imageUrlOverride.trim()) || generic.imageUrl || '';

  let created = 0;
  for (const size of sizes) {
    try {
      const colorVariantId = randomUUID();
      const colorVariantData = {
        ...rest,
        id: colorVariantId,
        jobId: null,
        imageUrl: variantImageUrl,
        imageUncPath: null,
        approvalStatus: 'PENDING' as const,
        approvedBy: null,
        approvedAt: null,
        sapSyncStatus: 'NOT_SYNCED' as const,
        sapArticleId: null,
        sapSyncMessage: null,
        isGeneric: false,
        genericArticleId: genericId,
        variantSize: size,
        size: size,
        variantColor: color,
        colour: color,
        imageExtractionRawData: _ied2 ?? Prisma.DbNull,
      };
      await prisma.extractionResultFlat.create({ data: colorVariantData });

      // Mirror to 360article (fire-and-forget)
      void upsert360ArticleFlatRow(colorVariantId, colorVariantData as Record<string, unknown>);

      created++;
    } catch (err: any) {
      console.error(`[VariantCreation] addColor failed for size=${size}:`, err?.message);
    }
  }
  return created;
}

export async function syncGenericToVariants(genericId: string, updatedData: Record<string, any>): Promise<void> {
  try {
    // Remove variant-specific fields from sync payload
    const syncData: Record<string, any> = {};
    for (const [key, val] of Object.entries(updatedData)) {
      if (!VARIANT_ONLY_FIELDS.includes(key)) {
        syncData[key] = val;
      }
    }

    // Special case: sync colour from generic to variants that have no variantColor set yet
    // (variants with explicit variantColor keep their own colour)
    if (updatedData.colour !== undefined) {
      await prisma.extractionResultFlat.updateMany({
        where: { genericArticleId: genericId, isGeneric: false, variantColor: null },
        data: { colour: updatedData.colour, variantColor: updatedData.colour }
      });
    }

    if (Object.keys(syncData).length === 0) return;

    const variantIds = await prisma.extractionResultFlat.findMany({
      where: { genericArticleId: genericId, isGeneric: false },
      select: { id: true }
    });

    await prisma.extractionResultFlat.updateMany({
      where: { genericArticleId: genericId, isGeneric: false },
      data: syncData
    });

    // Mirror sync to 360article (fire-and-forget)
    void Promise.all(variantIds.map(v => mirror360FlatUpdate(v.id, syncData)));

    console.log(`[VariantSync] Synced ${Object.keys(syncData).length} fields to variants of generic=${genericId}`);
  } catch (err: any) {
    // Log but do not rethrow — variant sync failure must not crash the main update request
    console.error(`[VariantSync] Failed to sync variants for generic=${genericId}:`, err?.message ?? err);
  }
}
