import * as XLSX from 'xlsx';

const HEADER_TOKENS = new Set(['final art', 'article', 'article number', 'code', 'final article']);

function normalize(raw: unknown): string {
  return String(raw ?? '').trim();
}

/** Dedupe while preserving first-seen order; drop blanks and header-looking rows. */
function cleanCodes(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = normalize(r);
    if (!v) continue;
    if (HEADER_TOKENS.has(v.toLowerCase())) continue;
    const keyLower = v.toLowerCase();
    if (seen.has(keyLower)) continue;
    seen.add(keyLower);
    out.push(v);
  }
  return out;
}

/** Parse pasted text — one code per line (or comma-separated). */
export function parseArticleCodesFromText(text: string): string[] {
  const rows = String(text || '')
    .split(/[\r\n,]+/)
    .map(normalize);
  return cleanCodes(rows);
}

/** Parse an uploaded .xlsx/.xls buffer — reads the first column of the first sheet. */
export function parseArticleCodesFromXlsx(buffer: Buffer): string[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const firstCol = matrix.map((row) => normalize(row?.[0]));
  return cleanCodes(firstCol);
}

/** Source garment image key in the APPROVED bucket: "{FINAL_ART}.jpg". */
export function sourceKeyFor(code: string): string {
  return `${code}.jpg`;
}

/** Output key in the model-images bucket: "{FINAL_ART}/{view}.jpg". */
export function outputKeyFor(code: string, view: string): string {
  return `${code}/${view}.jpg`;
}
