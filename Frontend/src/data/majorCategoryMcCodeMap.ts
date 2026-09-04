// @ts-ignore
import mcCodeListData from './mc-code-list-major-category.json';

type McCodeListRow = {
  mc_code?: number | string;
  'mc code'?: number | string;
  'mc des'?: string;
  MC_DESC?: string;
  division?: string;
  'sub division'?: string;
};

const normalizeCategory = (value?: string | null): string =>
  (value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/_*-_*/g, '-')
    .replace(/[^A-Z0-9_\-]/g, '');

const rows = (mcCodeListData as McCodeListRow[])
  .map((row) => ({
    name: String(row['mc des'] ?? row.MC_DESC ?? '').trim(),
    code: String(row.mc_code ?? row['mc code'] ?? '').trim()
  }))
  .filter((row) => row.name && row.code);

const uniqueNames = Array.from(new Set(rows.map((row) => row.name)));

export const MAJOR_CATEGORY_ALLOWED_VALUES = uniqueNames.map((name) => ({
  shortForm: name,
  fullForm: name
}));

const mcCodeLookup = new Map<string, string>(
  rows.map((row) => [normalizeCategory(row.name), row.code])
);

export const getMcCodeByMajorCategory = (majorCategory?: string | null): string | null => {
  const key = normalizeCategory(majorCategory);
  if (!key) return null;
  return mcCodeLookup.get(key) || null;
};

// Normalize "MEN" → "MENS" to match mc-code-list division values
const normalizeDivision = (div: string): string =>
  div.trim().toUpperCase() === 'MEN' ? 'MENS' : div.trim().toUpperCase();

export const getMajorCategoriesByDivision = (division: string): string[] => {
  const div = normalizeDivision(division);
  return (mcCodeListData as McCodeListRow[])
    .filter(row => (row.division || '').toUpperCase() === div)
    .map(row => String(row['mc des'] ?? row.MC_DESC ?? '').trim())
    .filter(Boolean);
};

// Narrows the major category list down to the user-selected division AND
// sub-division (e.g. MENS + MW), so e.g. MW's list never leaks MS-U/MS-L items.
export const getMajorCategoriesBySubDivision = (division: string, subDivision: string): string[] => {
  const div = normalizeDivision(division);
  const subDiv = (subDivision || '').trim().toUpperCase();
  if (!subDiv) return getMajorCategoriesByDivision(division);
  return (mcCodeListData as McCodeListRow[])
    .filter(
      row =>
        (row.division || '').toUpperCase() === div &&
        (row['sub division'] || '').trim().toUpperCase() === subDiv,
    )
    .map(row => String(row['mc des'] ?? row.MC_DESC ?? '').trim())
    .filter(Boolean);
};
