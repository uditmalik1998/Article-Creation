// Major categories that use the combo/set article flow: the FG article is
// assembled from multiple child pieces (e.g. Kurti Upper, Lower, Dupatta),
// and only the assembled parent is ever created in SAP.
// `extraction_results_flat.major_category` stores the short SAP code, not the
// full name — e.g. "LW_KURTI_ST", "L_KURTI_ST", "IB_B_SUIT_FS", "JB_B_SUIT_ST_HS".
// Matched as a substring so any division/season-qualified variant is caught.
export const COMBO_MAJOR_CATEGORIES = ['KURTI_ST', 'B_SUIT'];

export function isComboMajorCategory(majorCategory?: string | null): boolean {
  if (!majorCategory) return false;
  const normalized = majorCategory.trim().toUpperCase();
  return COMBO_MAJOR_CATEGORIES.some((c) => normalized.includes(c));
}
