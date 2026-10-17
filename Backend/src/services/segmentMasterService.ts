import { prismaClient as prisma } from '../utils/prisma';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';

/**
 * Segment (E / V / P / SP) for a major category + MRP, read from Admin → Segment
 * Master (maj_cat_segment) — the table admins maintain and the article card uses.
 *
 * The bundled data/segment-ranges.json is an older snapshot with no set (S-…)
 * categories, so it is used only when the category has no rows in the table.
 */
export async function getSegmentFromMaster(majorCategory?: string | null, mrp?: unknown): Promise<string | null> {
  const mc = (majorCategory || '').trim().toUpperCase();
  const m = Number(mrp);
  if (!mc || mrp === null || mrp === undefined || mrp === '' || !Number.isFinite(m)) return null;

  const rows = await prisma.$queryRaw<{ segment_type: string; min: unknown; max: unknown }[]>`
    SELECT segment_type, "min", "max"
    FROM maj_cat_segment
    WHERE UPPER(TRIM(major_category)) = ${mc}
    ORDER BY "min"
  `;
  if (rows.length === 0) return getSegmentByCategoryAndMrp(majorCategory, mrp);

  const hit = rows.find((r) => m >= Number(r.min) && m <= Number(r.max));
  return hit ? hit.segment_type : null;
}
