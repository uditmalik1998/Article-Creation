/**
 * Expense Data sections (FG / Fabric / GM / Body / Others) and per-table
 * display info — shared by the Expense Data cards page and the table page.
 * Add every new EXPENSE_TABLE_CONFIGS key here, or it lands under Others.
 */

export type SectionKey = 'FG' | 'FABRIC' | 'GM' | 'BODY' | 'OTHERS';

export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'FG', label: 'FG Articles' },
  { key: 'FABRIC', label: 'Fabric Articles' },
  { key: 'GM', label: 'GM Articles' },
  { key: 'BODY', label: 'Body Articles' },
  { key: 'OTHERS', label: 'Others' },
];

/** Which section a table sits in, the DB table behind it, and what it feeds. */
export const TABLE_META: Record<string, { section: SectionKey; table: string; usedFor: string }> = {
  'major-category-grid': { section: 'FG', table: 'maj_cat_grid_values', usedFor: 'Attribute dropdowns + Bgt / Pd Cont%' },
  'mandatory-grid': { section: 'FG', table: 'maj_cat_mandatory_grid', usedFor: 'Which fields show and are required' },
  'broader-menu': { section: 'FG', table: 'broader_menu', usedFor: 'Merchandising master per MC CD' },
  'segment-master': { section: 'FG', table: 'maj_cat_segment', usedFor: 'Price segment from the MRP range' },
  'size-master': { section: 'FG', table: 'maj_cat_sizes', usedFor: 'Sizes created for each colour' },
  'national-grid': { section: 'FG', table: 'national_grid_master', usedFor: 'Shared attribute codes' },
  'basic-accessories': { section: 'FG', table: 'basic_trim_cost_master', usedFor: 'B TRIM + PKG COST per major category' },
  hierarchy: { section: 'FG', table: 'categories', usedFor: 'Division › Sub-division › Major category' },
  'cmp-cost-master': { section: 'FG', table: 'rough_cmp_cost_master', usedFor: 'CMP COST SAM breakdown' },
  'color-master': { section: 'FG', table: 'color_master', usedFor: 'Father / child colours' },
  'basic-trim-master': { section: 'FG', table: 'basic_trim_master', usedFor: 'BT-1 / BT-2 trim costs' },
  'precise-fabric-article-data': { section: 'FABRIC', table: 'precise_fabric_article_data', usedFor: 'Fabric rates + attributes' },
  'fabric-article-data': { section: 'FABRIC', table: 'fabric_article_data', usedFor: 'Fabric article pages + FG FAB desc search' },
  'fabric-grid-values': { section: 'FABRIC', table: 'fabric_maj_cat_grid_values', usedFor: 'FAB card dropdown codes' },
  'fabric-article-master': { section: 'FABRIC', table: 'fabric_article_master', usedFor: 'Fabric division › sub-division › major category' },
  'fabric-main-mvgr-mapping': { section: 'FABRIC', table: 'm_fabric_main_mvgr_mapping', usedFor: 'MVGR-2 fills MVGR-1' },
  'gm-size-master': { section: 'GM', table: 'gm_size_master', usedFor: 'Sizes for GM colours' },
  'body-article-data': { section: 'BODY', table: 'body_article_data', usedFor: 'Body article pages' },
  'body-fabric-consumption': { section: 'BODY', table: 'body_fabric_consumption', usedFor: 'Fab cons / width / GSM per major category' },
  'precise-body-article': { section: 'BODY', table: 'precise_body_article_consumption', usedFor: 'Exact consumption — re-upload the Excel to refresh' },
  'raw-articles': { section: 'OTHERS', table: 'raw_articles', usedFor: 'SRM pipeline staging' },
  'vendor-master': { section: 'OTHERS', table: 'master_vendor_details', usedFor: 'Synced from the DAB vendor master' },
};

/** Tables left off the Expense Data cards page (asked 2026-11-23). The
 * tables, their routes and the admin Expenses page are unchanged. */
export const HIDDEN_ON_EXPENSE_DATA_PAGE = new Set([
  'broader-menu',
  'basic-accessories',
  'hierarchy',
  'cmp-cost-master',
  'basic-trim-master',
  'fabric-article-data',
  'precise-fabric-article-data',
  'raw-articles',
]);

/** Kept up to date by a sync or an Excel re-upload — no change requests. */
export const READ_ONLY_KEYS = new Set(['precise-body-article', 'raw-articles', 'vendor-master']);

export const sectionLabel = (tableKey: string): string =>
  SECTIONS.find((s) => s.key === (TABLE_META[tableKey]?.section ?? 'OTHERS'))?.label ?? 'Others';
