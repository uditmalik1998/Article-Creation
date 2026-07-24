/**
 * Category Field Visibility
 *
 * Determines which article-description fields are visible in the approver card
 * for a given major category, by checking two DB grids:
 *
 *   1. maj_cat_mandatory_grid  — field is MANDATORY (is_active = true)
 *   2. maj_cat_grid_values     — field has dropdown values (OPTIONAL / Tier-2)
 *
 * A description field is INCLUDED only when at least one of its known grid keys
 * appears in either grid for the major category.
 *
 * FALLBACK: if the major category has NO data in either grid at all (not yet
 * configured), ALL description fields are included (no exclusions).
 *
 * Caches are invalidated whenever an admin re-uploads either grid.
 */

import { prismaClient as prisma } from './prisma';

// ─── Grid key maps ────────────────────────────────────────────────────────────

/**
 * Maps each ArticleDescriptionSource field → the SAP keys that might appear
 * as `sap_key` in maj_cat_mandatory_grid for that field.
 */
const FIELD_MANDATORY_KEYS: Record<string, readonly string[]> = {
  fabDiv:         ['M_FAB_DIV'],
  yarn1:          ['M_YARN'],
  fabricMainMvgr: ['M_FAB_MAIN_MVGR_2', 'FAB-MAIN-MVGR-2', 'FAB_MAIN_MVGR-2'],
  weave:          ['M_WEAVE_01', 'WEAVE-01', 'WEAVE 01', 'WEAVE_01'],
  mFab2:          ['M_WEAVE_02', 'WEAVE 02', 'WEAVE-02', 'WEAVE_02'],
  lycra:          ['M_LYCRA'],
  neck:           ['M_NECK_TYPE', 'M_NECK_BAND'],
  neckDetails:    ['M_NECK_STYLE'],
  collar:         ['M_COLLAR', 'M_COLLAR_TYPE'],
  collarStyle:    ['M_COLLAR_STYLE'],
  sleeve:         ['M_SLEEVES_MAIN_STYLE', 'M_SLEEVE'],
  sleeveFold:     ['M_SLEEVE_FOLD'],
  fatherBelt:     ['M_BLT_TYPE'],
  pocketType:     ['M_POCKET'],
  childBelt:      ['M_BLT_STYLE', 'M_SUB_STYLE_BLT'],
  noOfPocket:     ['M_NO_OF_POCKET'],
  length:         ['M_LENGTH'],
  fit:            ['M_FIT'],
  pattern:        ['M_BODY_STYLE', 'BODY STYLE', 'M_PATTERN', 'BODY_STYLE'],
  printType:      ['M_PRINT_TYPE'],
  embroidery:     ['M_EMB_TYPE'],
  embroideryType: ['M_EMBROIDERY_STYLE', 'M_EMBROIDERY'],
  wash:           ['M_WASH'],
};

/**
 * Maps each ArticleDescriptionSource field → the attribute_name values that
 * might appear in maj_cat_grid_values for that field.
 */
const FIELD_MAJCAT_KEYS: Record<string, readonly string[]> = {
  fabDiv:         ['M_FAB_DIV'],
  yarn1:          ['M_YARN'],
  fabricMainMvgr: ['M_FAB_MAIN_MVGR_2', 'FAB-MAIN-MVGR-2', 'FAB_MAIN_MVGR-2'],
  weave:          ['M_WEAVE_01', 'WEAVE-01', 'WEAVE 01', 'WEAVE_01'],
  mFab2:          ['M_WEAVE_02', 'WEAVE 02', 'WEAVE-02', 'WEAVE_02'],
  lycra:          ['M_LYCRA'],
  neck:           ['M_NECK_TYPE'],
  neckDetails:    ['M_NECK_STYLE'],
  collar:         ['M_COLLAR_TYPE', 'M_COLLAR'],
  collarStyle:    ['M_COLLAR_STYLE'],
  sleeve:         ['M_SLEEVES_MAIN_STYLE'],
  sleeveFold:     ['M_SLEEVE_FOLD'],
  fatherBelt:     ['M_BLT_TYPE'],
  pocketType:     ['M_POCKET'],
  childBelt:      ['M_BLT_STYLE'],
  noOfPocket:     ['M_NO_OF_POCKET'],
  length:         ['M_LENGTH'],
  fit:            ['M_FIT'],
  pattern:        ['M_BODY_STYLE', 'BODY STYLE', 'BODY_STYLE'],
  printType:      ['M_PRINT_TYPE'],
  embroidery:     ['M_EMB_TYPE'],
  embroideryType: ['M_EMBROIDERY_STYLE'],
  wash:           ['M_WASH'],
};

// ─── Caches ───────────────────────────────────────────────────────────────────

// majorCategory (UPPER) → Set<sapKey (UPPER)> active in mandatory grid
let _mandatoryActiveCache: Map<string, Set<string>> | null = null;
// Set of ALL major categories present in mandatory grid (even inactive rows)
let _mandatoryConfiguredCats: Set<string> | null = null;

// majorCategory (UPPER) → Set<attribute_name (UPPER)> in majcat grid
let _majcatGridCache: Map<string, Set<string>> | null = null;

/** Invalidate both caches — call after any admin grid upload. */
export function invalidateFieldVisibilityCache(): void {
  _mandatoryActiveCache = null;
  _mandatoryConfiguredCats = null;
  _majcatGridCache = null;
}

async function loadMandatoryCache(): Promise<void> {
  if (_mandatoryActiveCache) return;

  const rows = await prisma.$queryRaw<
    { major_category: string; sap_key: string; is_active: boolean }[]
  >`SELECT major_category, sap_key, is_active FROM maj_cat_mandatory_grid`;

  const activeMap = new Map<string, Set<string>>();
  const configured = new Set<string>();

  for (const row of rows) {
    const cat = row.major_category.trim().toUpperCase();
    configured.add(cat);
    if (row.is_active) {
      if (!activeMap.has(cat)) activeMap.set(cat, new Set());
      activeMap.get(cat)!.add(row.sap_key.trim().toUpperCase());
    }
  }

  _mandatoryActiveCache = activeMap;
  _mandatoryConfiguredCats = configured;
}

async function loadMajcatCache(): Promise<void> {
  if (_majcatGridCache) return;

  const rows = await prisma.$queryRaw<
    { major_category: string; attribute_name: string }[]
  >`SELECT DISTINCT major_category, attribute_name FROM maj_cat_grid_values`;

  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const cat = row.major_category.trim().toUpperCase();
    if (!map.has(cat)) map.set(cat, new Set());
    map.get(cat)!.add(row.attribute_name.trim().toUpperCase());
  }

  _majcatGridCache = map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the set of ArticleDescriptionSource field names that should be
 * EXCLUDED from the article description for the given major category.
 *
 * A field is excluded when:
 *  - The major category IS configured in at least one grid (has some data), AND
 *  - The field's known grid keys are NOT found in either grid for that category
 *
 * If the major category has no grid data at all → returns an empty set
 * (include everything — fallback for unconfigured categories).
 */
export async function getExcludedDescriptionFields(
  majorCategory: string | null | undefined
): Promise<ReadonlySet<string>> {
  if (!majorCategory?.trim()) return new Set();

  const cat = majorCategory.trim().toUpperCase();

  await Promise.all([loadMandatoryCache(), loadMajcatCache()]);

  const mandatoryFields = _mandatoryActiveCache!.get(cat);   // Set<sapKey> or undefined
  const majcatFields    = _majcatGridCache!.get(cat);         // Set<attr_name> or undefined
  const isCategoryConfigured =
    (_mandatoryConfiguredCats!.has(cat)) || (majcatFields !== undefined);

  // No grid data for this category → include all fields (no exclusions)
  if (!isCategoryConfigured) return new Set();

  const excluded = new Set<string>();

  for (const field of Object.keys(FIELD_MANDATORY_KEYS)) {
    const mandatoryKeys = FIELD_MANDATORY_KEYS[field];
    const majcatKeys    = FIELD_MAJCAT_KEYS[field];

    const visibleInMandatory = mandatoryKeys.some(
      k => mandatoryFields?.has(k.toUpperCase())
    );
    const visibleInMajcat = majcatKeys.some(
      k => majcatFields?.has(k.toUpperCase())
    );

    if (!visibleInMandatory && !visibleInMajcat) {
      excluded.add(field);
    }
  }

  return excluded;
}
