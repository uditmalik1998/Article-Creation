/**
 * SRM writes buying_type on raw_articles / fabric_raw_data / gm_raw_data in any casing.
 * 'planned' / 'Planned' → PLANNED, 'ready' → READY (the page dropdown values);
 * anything else is kept as sent (trimmed); empty → null (user picks on the page).
 */
export function normalizeBuyingType(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  if (!s) return null;
  const up = s.toUpperCase();
  return up === 'PLANNED' || up === 'READY' ? up : s.slice(0, 50);
}
