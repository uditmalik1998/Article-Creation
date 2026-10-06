// Major categories that use the combo/set article flow: the FG article is
// assembled from multiple child pieces (e.g. Kurti Upper, Lower, Dupatta),
// and only the assembled parent is ever created in SAP.
// `extraction_results_flat.major_category` stores the short SAP code, not the
// full name — e.g. "LW_KURTI_ST", "L_KURTI_ST", "IB_B_SUIT_FS", "JB_B_SUIT_ST_HS".
// Matched as a substring so any division/season-qualified variant is caught.
export const COMBO_MAJOR_CATEGORIES = ['KURTI_ST', 'B_SUIT'];

// Further set major categories from the business list "SET MAJ CAT.xlsx"
// (2026-10-06). Matched exactly, in addition to the substrings above.
export const SET_MAJOR_CATEGORIES = [
  // LADIES
  'L_CO-ORD_SET', // LU
  'L_KURTI_ST', // LK&L
  'L_N_SUIT', // LN&L
  'LW_CO_ORD_SET', // LW
  'LW_KURTI_ST', // LW
  'LW_NIGHT_SUIT', // LW
  // MENS
  'M_SUIT', // MO
  'MW_TRACK_SUIT', // MW
  // KIDS
  'IB_H_B_SUIT_HS', // KI
  'IB_H_DNGR_SUIT', // KI
  'IB_ROMPER_SUIT', // KI
  'IB_T_DNGR_SUIT', // KI
  'IG_DNGR_SUIT', // KI
  'IG_HOT_PANT_ST', // KI
  'IG_ST', // KI
  'KI_B_SUIT_SL', // KI
  'KI_B_SUIT_ST_HS', // KI
  'KI_SKRT_TOP_ST', // KI
  'JG_H_HOT_PANT_ST', // KG-U
  'JG_H_SKRT_TOP_ST', // KG-U
  'JG_H_ST', // KG-U
  'JG_ST_FS', // KG-U
  'JG_T_HOT_PANT_ST', // KG-U
  'JG_T_SKRT_TOP_ST', // KG-U
  'JG_T_ST', // KG-U
  'YG_ST', // KG-U
  'YG_ST_FS', // KG-U
  'JB_B_SUIT_SL', // KB-SETS
  'JB_H_B_SUIT_HS', // KB-SETS
  'IB_H_B_SUIT_FS', // KB-SETS
  'JB_H_B_SUIT_FS', // KB-SETS
  'JB_T_B_SUIT_HS', // KB-SETS
  'YB_H_B_SUIT_HS', // KB-SETS
  'IB_DNGR_SUIT_FS', // KB-SETS
  'JB_KURTA_ST', // KB-SETS
  'JB_B_SUIT_ST_HS', // KB-SETS
  'IB_T_B_SUIT_FS', // KB-SETS
  'YB_KURTA_ST', // KB-SETS
  'JB_T_B_SUIT_FS', // KB-SETS
  'JB_SUIT', // KB-SETS
  'YB_SUIT', // KB-SETS
  'KIW_GIFT_ST', // KBW-SETS
  'JBW_T_SUIT', // KBW-SETS
  'YBW_T_SUIT', // KBW-SETS
  'IBW_PLFL_B_SUIT', // KBW-SETS
  'KIW_ST', // KGW-U
  'JGW_ST', // KGW-U
  'JBW_B_SUIT', // KBW-SETS
  'YG_SKRT_TOP_ST', // KG-U
  'KI_T_B_SUIT_HS', // KI
];

const SET_MAJOR_CATEGORY_SET = new Set(SET_MAJOR_CATEGORIES);

export function isComboMajorCategory(majorCategory?: string | null): boolean {
  if (!majorCategory) return false;
  const normalized = majorCategory.trim().toUpperCase();
  return (
    SET_MAJOR_CATEGORY_SET.has(normalized) ||
    COMBO_MAJOR_CATEGORIES.some((c) => normalized.includes(c))
  );
}
