/**
 * sync-mandatory-grid.ts
 *
 * Reads Backend/data/MANDATORY GRID DATA.xlsx and:
 *   1. Writes Frontend/src/data/maj-cat-mandatory.json  (SAP code arrays per MAJ_CAT)
 *   2. Updates CategoryAttribute.isRequired in the DB for every category/attribute pair
 *
 * Strategy for duplicate MAJ_CAT rows (KIDS sub-divs KGU / KG-U): UNION
 * — if either row marks a column as 1, that attribute is mandatory for the category.
 *
 * Run:
 *   cd Backend
 *   ts-node scripts/sync-mandatory-grid.ts
 *
 * Flags:
 *   --json-only   Only write the JSON file; skip DB updates
 *   --db-only     Only update the DB; skip JSON file
 *   --dry-run     Print what would change without writing anything
 */

import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { PrismaClient } from '../src/generated/prisma';

// ---------------------------------------------------------------------------
// Excel → SAP code mapping (column header in Excel → SAP attribute code)
// ---------------------------------------------------------------------------
const EXCEL_TO_SAP: Record<string, string> = {
  'OTHER MVGR':           'M_MACRO_MVGR',
  'F_YARN':               'M_YARN',
  'F_FABRIC MAIN MVGR-01':'M_YARN_02',
  'F_FABRIC MAIN MVGR-02':'M_WEAVE_2',
  'F_WEAVE_01':           'M_FAB',
  'F_WEAVE_02':           'M_FAB2',
  'F_COMP':               'M_COMPOSITION',
  'F_COUNT':              'M_COUNT',
  'F_CONSTRUCTION':       'M_CONSTRUCTION',
  'F_STRETCH':            'M_LYCRA',
  'F_FINISH':             'M_FINISH',
  'F_GSM_GLM':            'M_GSM',
  'F_OUNCE':              'M_OUNZ',
  'F_WIDTH':              'M_WIDTH',
  'F_UOM':                'M_UOM',
  'COLLAR TYPE':          'M_COLLAR',
  'COLLAR STYLE':         'M_COLLAR_STYLE',
  'NECK STYLE':           'M_NECK_BAND_STYLE',
  'NECK TYPE':            'M_NECK_BAND',
  'PLACKET':              'M_PLACKET',
  'BELT':                 'M_BLT_MAIN_STYLE',
  'SLEEVE':               'M_SLEEVES_MAIN_STYLE',
  'SLEEVE FOLD':          'M_SLEEVE_FOLD',
  'BOTTOM FOLD':          'M_BTM_FOLD',
  'NO. OF POCKET':        'M_NO_OF_POCKET',
  'POCKET TYPE':          'M_POCKET',
  'EXTRA POCKET':         'M_EXTRA_POCKET',
  'FIT':                  'M_FIT',
  'BODY STYLE':           'M_PATTERN',
  'LENGTH':               'M_LENGTH',
  'DC_TYPE':              'M_DC_SUB_STYLE',
  'DC_SHAPE':             'M_DC_SHAPE',
  'BTN_TYPE':             'M_BTN_MAIN_MVGR',
  'BTN_CLR':              'M_BTN_CLR',
  'ZIP_TYPE':             'M_ZIP',
  'ZIP_CLR':              'M_ZIP_COL',
  'PATCH_STYLE':          'M_PATCH_TYPE',
  'PATCH_TYPE':           'M_PATCHES',
  'PRT_TYPE':             'M_PRINT_TYPE',
  'PRT_STYLE':            'M_PRINT_STYLE',
  'PRT_PLCMNT':           'M_PRINT_PLACEMENT',
  'EMB_PLACEMENT':        'M_EMB_PLACEMENT',
  'EMB_STYLE':            'M_EMB_TYPE',
  'EMB_TYPE':             'M_EMBROIDERY',
  'WASH':                 'M_WASH',
  'AGE GROUP':            'M_AGE_GROUP',
  'SEGMENT':              'Price Band Category',
  'ARTICLE FASHION TYPE': 'Fashion Grade',
  'COST':                 'Cost',
  'MRP':                  'Mrp ( Char Val)',
  'VENDOR-NM':            'Vendor',
  'ARTICLE WEIGHT':       'Weight (Net)(g)',
  'ARTICLE DIMENSION':    'M_ARTICLE_DIMENSION',
};

// SAP code → frontend schema key (mirrors SAP_NAME_TO_SCHEMA_KEY in majCatAttributeMap.ts)
const SAP_TO_SCHEMA_KEY: Record<string, string> = {
  M_MACRO_MVGR:          'macro_mvgr',
  M_YARN:                'yarn_01',
  M_YARN_02:             'main_mvgr',
  M_WEAVE_2:             'fabric_main_mvgr',
  M_FAB:                 'weave',
  M_FAB2:                'm_fab2',
  M_COMPOSITION:         'composition',
  M_COUNT:               'f_count',
  M_CONSTRUCTION:        'f_construction',
  M_LYCRA:               'lycra_non_lycra',
  M_FINISH:              'finish',
  M_GSM:                 'gsm',
  M_OUNZ:                'f_ounce',
  M_WIDTH:               'f_width',
  M_UOM:                 'f_uom',
  M_COLLAR:              'collar',
  M_COLLAR_STYLE:        'collar_style',
  M_NECK_BAND_STYLE:     'neck_details',
  M_NECK_BAND:           'neck',
  M_PLACKET:             'placket',
  M_BLT_MAIN_STYLE:      'father_belt',
  M_SLEEVES_MAIN_STYLE:  'sleeve',
  M_SLEEVE_FOLD:         'sleeve_fold',
  M_BTM_FOLD:            'bottom_fold',
  M_NO_OF_POCKET:        'no_of_pocket',
  M_POCKET:              'pocket_type',
  M_EXTRA_POCKET:        'extra_pocket',
  M_FIT:                 'fit',
  M_PATTERN:             'body_style',
  M_LENGTH:              'length',
  M_DC_SUB_STYLE:        'drawcord',
  M_DC_SHAPE:            'dc_shape',
  M_BTN_MAIN_MVGR:       'button',
  M_BTN_CLR:             'btn_colour',
  M_ZIP:                 'zipper',
  M_ZIP_COL:             'zip_colour',
  M_PATCHES:             'patches',
  M_PATCH_TYPE:          'patches_type',
  M_PRINT_TYPE:          'print_type',
  M_PRINT_STYLE:         'print_style',
  M_PRINT_PLACEMENT:     'print_placement',
  M_EMBROIDERY:          'embroidery',
  M_EMB_TYPE:            'embroidery_type',
  M_EMB_PLACEMENT:       'emb_placement',
  M_WASH:                'wash',
  M_AGE_GROUP:           'age_group',
  'Price Band Category': 'segment',
  'Fashion Grade':       'article_fashion_type',
  'Cost':                'rate',
  'Mrp ( Char Val)':     'mrp',
  'Vendor':              'vendor_name',
  'Weight (Net)(g)':     'weight',
  M_ARTICLE_DIMENSION:   'article_dimension',
};

// ---------------------------------------------------------------------------
// Parse flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json-only');
const dbOnly   = args.includes('--db-only');
const dryRun   = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const EXCEL_PATH = path.resolve(__dirname, '..', 'data', 'MANDATORY GRID DATA.xlsx');
const JSON_OUT   = path.resolve(__dirname, '..', '..', 'Frontend', 'src', 'data', 'maj-cat-mandatory.json');

// ---------------------------------------------------------------------------
// Build mandatory map from Excel: MAJ_CAT → Set<SAP code>  (union for dupes)
// ---------------------------------------------------------------------------
function buildMandatoryMap(): Map<string, Set<string>> {
  console.log(`Reading: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Row 4 (0-indexed) = attribute headers (row 5 in Excel 1-indexed)
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as (string | number | null)[][];

  // Row index 4 (5th row) = attribute column headers
  const headerRow = raw[4] as (string | null)[];
  // Attribute columns start at index 3 (col D onwards)
  const attrHeaders = headerRow.slice(3);

  const result = new Map<string, Set<string>>();

  // Data rows start at index 6 (row 7 in Excel)
  for (let i = 6; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[2]) continue;
    const majCat = String(row[2]).trim();
    if (!majCat) continue;

    if (!result.has(majCat)) result.set(majCat, new Set());
    const mandatorySet = result.get(majCat)!;

    for (let col = 0; col < attrHeaders.length; col++) {
      const header = attrHeaders[col];
      if (!header) continue;
      const normalizedHeader = String(header).trim();
      const sapCode = EXCEL_TO_SAP[normalizedHeader];
      if (!sapCode) continue;
      if (row[col + 3] === 1) {
        mandatorySet.add(sapCode);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Write frontend JSON
// ---------------------------------------------------------------------------
function writeJson(mandatoryMap: Map<string, Set<string>>): void {
  // Preserve SAP code order from EXCEL_TO_SAP for deterministic output
  const sapOrder = [...new Set(Object.values(EXCEL_TO_SAP))];
  const out: Record<string, string[]> = {};
  for (const [cat, sapSet] of mandatoryMap) {
    out[cat] = sapOrder.filter(s => sapSet.has(s));
  }

  if (dryRun) {
    console.log(`[dry-run] Would write ${Object.keys(out).length} categories to ${JSON_OUT}`);
    return;
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ Wrote ${Object.keys(out).length} categories → ${JSON_OUT}`);
}

// ---------------------------------------------------------------------------
// Update DB CategoryAttribute.isRequired
// ---------------------------------------------------------------------------
async function updateDb(mandatoryMap: Map<string, Set<string>>): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // Load all category codes → IDs
    const categories = await prisma.category.findMany({ select: { id: true, code: true } });
    const catCodeToId = new Map(categories.map(c => [c.code, c.id]));

    // Load all master attribute keys → IDs (key = schema key e.g. 'macro_mvgr')
    const masterAttrs = await prisma.masterAttribute.findMany({ select: { id: true, key: true } });
    const schemaKeyToAttrId = new Map(masterAttrs.map(a => [a.key, a.id]));

    let updated = 0;
    let skippedMissingCat = 0;
    let skippedMissingAttr = 0;
    let skippedMissingRow = 0;

    for (const [majCat, mandatorySapSet] of mandatoryMap) {
      const categoryId = catCodeToId.get(majCat);
      if (!categoryId) {
        skippedMissingCat++;
        continue;
      }

      // Build schema key set for this category
      const mandatorySchemaKeys = new Set<string>();
      for (const sap of mandatorySapSet) {
        const sk = SAP_TO_SCHEMA_KEY[sap];
        if (sk) mandatorySchemaKeys.add(sk);
      }

      // Fetch existing CategoryAttribute rows for this category
      const catAttrs = await prisma.categoryAttribute.findMany({
        where: { categoryId },
        select: { id: true, attributeId: true, isRequired: true },
      });

      for (const ca of catAttrs) {
        // Find the schema key for this attribute
        const attrEntry = masterAttrs.find(a => a.id === ca.attributeId);
        if (!attrEntry) continue;

        const shouldBeRequired = mandatorySchemaKeys.has(attrEntry.key);
        if (ca.isRequired === shouldBeRequired) continue; // no change

        if (dryRun) {
          console.log(`  [dry-run] ${majCat}.${attrEntry.key}: isRequired ${ca.isRequired} → ${shouldBeRequired}`);
        } else {
          await prisma.categoryAttribute.update({
            where: { id: ca.id },
            data: { isRequired: shouldBeRequired },
          });
        }
        updated++;
      }

      // Check for schema keys in mandatory set that have no CategoryAttribute row yet
      for (const sk of mandatorySchemaKeys) {
        const attrId = schemaKeyToAttrId.get(sk);
        if (!attrId) { skippedMissingAttr++; continue; }
        const exists = catAttrs.some(ca => ca.attributeId === attrId);
        if (!exists) skippedMissingRow++;
      }
    }

    console.log(`✓ DB: ${updated} isRequired flags updated`);
    if (skippedMissingCat > 0)  console.log(`  ⚠ ${skippedMissingCat} Excel categories not found in the categories table`);
    if (skippedMissingAttr > 0) console.log(`  ⚠ ${skippedMissingAttr} SAP codes have no matching MasterAttribute in DB`);
    if (skippedMissingRow > 0)  console.log(`  ⚠ ${skippedMissingRow} mandatory attributes have no CategoryAttribute row (they are not linked to the category yet)`);
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`Excel file not found: ${EXCEL_PATH}`);
    process.exit(1);
  }

  const mandatoryMap = buildMandatoryMap();
  console.log(`Parsed ${mandatoryMap.size} unique major categories`);

  if (!dbOnly)   writeJson(mandatoryMap);
  if (!jsonOnly) await updateDb(mandatoryMap);

  console.log('Done.');
})();
