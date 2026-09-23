// Hardcoded mandatory-child templates per combo major category. When a combo
// parent (see comboMajorCategories.ts) is opened for the first time, its
// mandatory children are auto-created from this list — each pre-set with its
// own major category, matching the parent/child breakdown the business
// defines (e.g. Kurti Set → Kurti Upper + Kurti Lower). Users can still add
// extra optional children (e.g. a Dupatta) on top of these via "Add Child Article".
//
// Extend this map as more combo categories + their child breakdowns are confirmed.
export interface ComboChildTemplate {
  label: string;
  majorCategory: string;
}

// Keyed by the same substrings used in COMBO_MAJOR_CATEGORIES (comboMajorCategories.ts).
export const COMBO_CHILD_TEMPLATES: Record<string, ComboChildTemplate[]> = {
  KURTI_ST: [
    { label: 'Kurti Upper', majorCategory: 'L_KURTI_UPR' },
    { label: 'Kurti Lower', majorCategory: 'L_KURTI_LOW' },
  ],
};

export function getComboChildTemplate(majorCategory?: string | null): ComboChildTemplate[] {
  if (!majorCategory) return [];
  const normalized = majorCategory.trim().toUpperCase();
  for (const [key, templates] of Object.entries(COMBO_CHILD_TEMPLATES)) {
    if (normalized.includes(key)) return templates;
  }
  return [];
}
