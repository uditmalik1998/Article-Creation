/**
 * nationalGridValidation.ts
 *
 * Validates article attribute values against the national_grid_master table.
 * Called in modifyItem before any SAP or DB update.
 */

import { PrismaClient } from '../generated/prisma';

export interface GridValidationError {
  field: string;      // SAP key / attribute name (e.g. "M_FAB_DIV")
  value: string;      // the submitted value that failed
  message: string;
}

export interface GridValidationResult {
  valid: boolean;
  errors: GridValidationError[];
}

// SAP attribute keys that are covered by national_grid_master.
// Only attributes present in the grid are validated; unknown keys are passed through.
const GRID_ATTRIBUTES = new Set([
  'M_FAB_DIV', 'M_YARN', 'FAB_MAIN_MVGR-1', 'FAB-MAIN-MVGR-2',
  'WEAVE-01', 'WEAVE 02', 'M_COUNT', 'M_GSM', 'M_OUNZ',
  'M_CONSTRUCTION', 'M_COMPOSITION', 'M_FINISH', 'M_WIDTH',
  'M_LYCRA', 'M_NECK_TYPE', 'M_NECK_STYLE', 'M_COLLAR_TYPE',
  'M_COLLAR_STYLE', 'M_SLEEVES_MAIN_STYLE', 'M_SLEEVE_FOLD',
  'M_PLACKET', 'M_BLT_TYPE', 'M_BLT_STYLE', 'M_BTM_FOLD',
  'M_POCKET', 'M_NO_OF_POCKET', 'M_EXTRA_POCKET', 'M_LENGTH',
  'M_FIT', 'BODY STYLE', 'M_DC_STYLE', 'M_DC_SHAPE', 'M_ZIP_TYPE',
  'M_ZIP_COL', 'M_BTN_TYPE', 'M_BTN_CLR', 'M_PATCH_STYLE', 'M_PATCHE_TYPE',
]);

/**
 * Validate a map of { attributeName → value } against national_grid_master.
 * Only attributes listed in GRID_ATTRIBUTES are checked.
 * Empty/null values are skipped (field not being changed).
 */
export async function validateAgainstNationalGrid(
  prisma: PrismaClient,
  attributes: Record<string, string | null | undefined>,
): Promise<GridValidationResult> {
  const toCheck: { field: string; value: string }[] = [];

  for (const [field, value] of Object.entries(attributes)) {
    if (!GRID_ATTRIBUTES.has(field)) continue;
    if (!value || value.trim() === '') continue;
    toCheck.push({ field, value: value.trim() });
  }

  if (toCheck.length === 0) return { valid: true, errors: [] };

  // Bulk lookup: fetch all valid (attributeName, code) pairs for the attributes in play
  const attributeNames = [...new Set(toCheck.map((x) => x.field))];
  const validPairs = await prisma.nationalGridMaster.findMany({
    where: {
      attributeName: { in: attributeNames },
      isActive: true,
    },
    select: { attributeName: true, code: true },
  });

  // Build a set for O(1) lookup
  const validSet = new Set(validPairs.map((p) => `${p.attributeName}||${p.code}`));

  const errors: GridValidationError[] = [];
  for (const { field, value } of toCheck) {
    if (!validSet.has(`${field}||${value}`)) {
      errors.push({
        field,
        value,
        message: `"${value}" is not a valid code for attribute ${field}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
