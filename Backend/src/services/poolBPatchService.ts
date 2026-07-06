/**
 * poolBPatchService.ts
 *
 * "Pool B" of the MDM handover — writes attribute VALUES onto individual
 * articles (AUSP), the counterpart to the KSML class-characteristic assignment
 * (Pool A).
 *
 * Input Excel shape (Deepak "ART" template):
 *   | Matnr | M_FAB_DIV | M_YARN | ... |   ← headers: first col = article, rest = SAP characteristic names
 *   | 1110..| K         | P      | ... |   ← cells = the value to write
 *
 * For each article row we push its non-empty (characteristic → value) cells to
 * SAP via pushRawAttributesToSap (MATKL lookup → class link → patch FM). The FM
 * itself does an atomic-fail retry that drops locked/unknown fields, so the good
 * values still apply. Articles are processed in parallel (SAP_RFC_CONCURRENCY).
 *
 *   parsePoolBExcel()  — pure parse. NEVER calls SAP.
 *   runPoolBPatch()    — the live push. Only on explicit commit.
 */

import { mapWithConcurrency } from '../utils/concurrency';
import { pushRawAttributesToSap, isAttributePushEnabled } from './sapAttributePushService';

const SAP_RFC_CONCURRENCY = parseInt(process.env.SAP_RFC_CONCURRENCY || '7', 10);

export interface PoolBRow {
  matnr: string;
  changes: Record<string, string>; // ATNAM → value (non-empty only)
}

export interface PoolBParseResult {
  rows: PoolBRow[];
  matnrCount: number;
  attributeColumns: string[];
  totalValueCells: number;
  matnrColumn: string;
  skipped: number;
  warnings: string[];
  sample: { matnr: string; attrs: number; preview: string }[];
}

export interface PoolBItemResult {
  matnr: string;
  ok: boolean;
  matkl?: string;
  writtenCount: number;
  nicCount: number;
  lockedCount: number;
  errorMessage?: string;
}

export interface PoolBReport {
  env: string; // informational — actual env comes from SAP_ENV on the proxy
  test: boolean;
  matnrs: number;
  ok: number;
  failed: number;
  totalWritten: number;
  totalNic: number;
  totalLocked: number;
  durationMs: number;
  results: PoolBItemResult[];
}

// Matnr / article column detection (first column that looks like an article no.)
const MATNR_HEADER = /^(matnr|article|article[_ ]?no|article[_ ]?number|material|material[_ ]?no)$/i;
// A characteristic column looks like a SAP attribute name (M_*, NET_WEIGHT, DSG_NO, ...)
const CHAR_HEADER = /^(m_|net_weight$|dsg_no$)/i;

export async function parsePoolBExcel(buffer: Buffer): Promise<PoolBParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheets found in the uploaded Excel file.');

  const warnings: string[] = [];

  // Header = first non-empty row.
  let headerRowIdx = 1;
  for (let r = 1; r <= ws.rowCount; r++) {
    const anyValue = (ws.getRow(r).values as unknown[]).some((v) => v != null && String(v).trim() !== '');
    if (anyValue) { headerRowIdx = r; break; }
  }
  const headerRow = ws.getRow(headerRowIdx);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  // Find the Matnr column (prefer explicit header, else first column).
  let matnrIdx = headers.findIndex((h) => MATNR_HEADER.test(h));
  if (matnrIdx === -1) {
    matnrIdx = 0;
    warnings.push(`No explicit "Matnr" header found — using the first column ("${headers[0] || 'col1'}") as the article number.`);
  }

  // Characteristic columns = every other column whose header looks like a SAP attr.
  const attrIdxs: number[] = [];
  const attributeColumns: string[] = [];
  headers.forEach((h, i) => {
    if (i === matnrIdx) return;
    if (h && CHAR_HEADER.test(h)) { attrIdxs.push(i); attributeColumns.push(h.toUpperCase()); }
  });

  if (attrIdxs.length === 0) {
    throw new Error(
      `No SAP characteristic columns detected (expected headers like M_FAB_DIV, M_YARN, NET_WEIGHT, DSG_NO). ` +
      `Found headers: [${headers.filter(Boolean).join(', ')}].`,
    );
  }

  const rows: PoolBRow[] = [];
  let totalValueCells = 0;
  let skipped = 0;

  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const matnr = String(row.getCell(matnrIdx + 1).value ?? '').trim();
    if (!matnr) { // blank article row
      const anyAttr = attrIdxs.some((i) => String(row.getCell(i + 1).value ?? '').trim() !== '');
      if (anyAttr) skipped++;
      continue;
    }
    const changes: Record<string, string> = {};
    for (let k = 0; k < attrIdxs.length; k++) {
      const val = String(row.getCell(attrIdxs[k] + 1).value ?? '').trim();
      if (val) { changes[attributeColumns[k]] = val; totalValueCells++; }
    }
    if (Object.keys(changes).length === 0) { skipped++; continue; } // article with no values
    rows.push({ matnr, changes });
  }

  if (skipped > 0) warnings.push(`${skipped} row(s) skipped (no article number or no values).`);
  if (rows.length === 0) warnings.push('No article rows with values found.');

  return {
    rows,
    matnrCount: rows.length,
    attributeColumns,
    totalValueCells,
    matnrColumn: headers[matnrIdx] || 'col1',
    skipped,
    warnings,
    sample: rows.slice(0, 15).map((r) => ({
      matnr: r.matnr,
      attrs: Object.keys(r.changes).length,
      preview: Object.entries(r.changes).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', '),
    })),
  };
}

export async function runPoolBPatch(
  rows: PoolBRow[],
  opts: { test?: boolean; env: string },
): Promise<PoolBReport> {
  const test = opts.test ?? false;
  const env = opts.env;
  const t0 = Date.now();

  if (!isAttributePushEnabled()) {
    throw new Error('SAP attribute push is disabled (SAP_ATTRIBUTE_PUSH_ENABLED=false).');
  }

  const results = await mapWithConcurrency(rows, SAP_RFC_CONCURRENCY, async (row): Promise<PoolBItemResult> => {
    const res = await pushRawAttributesToSap(row.matnr, row.changes, { test, env });
    return {
      matnr: row.matnr,
      ok: res.ok,
      matkl: res.matkl,
      writtenCount: res.writtenCount,
      nicCount: res.nicCount,
      lockedCount: res.lockedCount,
      errorMessage: res.errorMessage,
    };
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalWritten = results.reduce((s, r) => s + r.writtenCount, 0);
  const totalNic = results.reduce((s, r) => s + r.nicCount, 0);
  const totalLocked = results.reduce((s, r) => s + r.lockedCount, 0);

  return {
    env,
    test,
    matnrs: rows.length,
    ok,
    failed,
    totalWritten,
    totalNic,
    totalLocked,
    durationMs: Date.now() - t0,
    results,
  };
}
