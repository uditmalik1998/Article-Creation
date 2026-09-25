// Combo/set children (Top, Lower, Dupatta, ...) arrive from SRM as their own
// rows — this file only decides which child is the "primary" (Top/Upper)
// piece. The parent's descriptive attributes (body, fit, composition, ...)
// mirror the primary child; costs are summed across all children.
//
// Matched as substrings of the child's major category code, in priority order.
export const COMBO_PRIMARY_CHILD_PATTERNS = ['TOP', 'UPR', 'UPPER', 'SHIRT', 'KURTA', 'KURTI', 'TEE', 'T_SHIRT'];

export function primaryChildRank(majorCategory?: string | null): number {
  const normalized = (majorCategory || '').trim().toUpperCase();
  const idx = COMBO_PRIMARY_CHILD_PATTERNS.findIndex((p) => normalized.includes(p));
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

// Stable child ordering: primary (Top) first, then by creation time.
export function sortComboChildren<T extends { majorCategory?: string | null; createdAt: Date }>(children: T[]): T[] {
  return [...children].sort((a, b) =>
    primaryChildRank(a.majorCategory) - primaryChildRank(b.majorCategory)
    || a.createdAt.getTime() - b.createdAt.getTime());
}
