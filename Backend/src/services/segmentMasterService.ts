import { prismaClient as prisma } from '../utils/prisma';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';

type Band = { segmentType: string; min: number; max: number };

// Bands per major category, cached briefly: ingestion calls this once per row,
// and Segment Master uploads should still show up within minutes.
const CACHE_TTL_MS = 5 * 60_000;
const bandCache = new Map<string, { bands: Band[]; at: number }>();

async function getBands(mc: string): Promise<Band[]> {
  const cached = bandCache.get(mc);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.bands;

  const rows = await prisma.$queryRaw<{ segment_type: string; min: unknown; max: unknown }[]>`
    SELECT segment_type, "min", "max"
    FROM maj_cat_segment
    WHERE UPPER(TRIM(major_category)) = ${mc}
    ORDER BY "min"
  `;
  const bands = rows.map((r) => ({ segmentType: r.segment_type, min: Number(r.min), max: Number(r.max) }));
  bandCache.set(mc, { bands, at: Date.now() });
  return bands;
}

/**
 * Segment (E / V / P / SP) for a major category + MRP, read from Admin → Segment
 * Master (maj_cat_segment) — the table admins maintain and the article card uses.
 *
 * The bundled data/segment-ranges.json is an older snapshot with no set (S-…)
 * categories, so it is used only when the category has no rows in the table.
 */
export async function getSegmentFromMaster(majorCategory?: string | null, mrp?: unknown): Promise<string | null> {
  const mc = (majorCategory || '').trim().toUpperCase();
  if (!mc || mrp === null || mrp === undefined || mrp === '') return null;
  const m = Number(mrp);
  if (!Number.isFinite(m)) return null;

  const bands = await getBands(mc);
  if (bands.length === 0) return getSegmentByCategoryAndMrp(majorCategory, mrp);

  const hit = bands.find((b) => m >= b.min && m <= b.max);
  return hit ? hit.segmentType : null;
}
