/**
 * importNationalGrid.ts
 *
 * One-time script: reads 'FINAL GRID APPROVED-NEW-FINAL (1).xlsx', sheet 'BASE_HORIZONTAL ',
 * parses all attribute code/full_form pairs, and upserts them into national_grid_master.
 *
 * Sheet layout (1-indexed rows):
 *   Row 1: Title
 *   Row 2: Status row ("OK" markers)
 *   Row 3: Display attribute names
 *   Row 4: SAP attribute keys  ← reliable source of block positions
 *   Row 5: Empty separator
 *   Row 6+: Data rows
 *
 * Block structure (two variants, detected from Row 4):
 *   Blocks 1-11 (cols 1-44): 4-col blocks  [attr_name, code, full_form, divider]
 *   Blocks 12+  (col 44+):   3-col blocks  [attr_name, code, full_form]
 *   (some 3-col blocks have an extra STATUS/DIV column after them)
 *
 * Block start detection: scan Row 4 for columns whose value is NOT one of the
 * generic labels (VALUE, FULL FORM, STATUS, DIV). Those are real SAP attribute keys.
 * Within each block: code is at col+1, full_form is at col+2.
 *
 * Run: npx ts-node src/scripts/importNationalGrid.ts [/path/to/file.xlsx]
 */

import ExcelJS from 'exceljs';
import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

const EXCEL_PATH =
  process.argv[2] ??
  'C:/Users/Administrator/Desktop/FINAL GRID APPROVED-NEW-FINAL (1).xlsx';

const SHEET_NAME = 'BASE_HORIZONTAL '; // trailing space is intentional
const SAP_KEY_ROW = 4;
const DATA_START_ROW = 6;

// Column values in Row 4 that are NOT attribute names (checked case-insensitively)
const SKIP_LABELS = new Set(['VALUE', 'FULL FORM', 'STATUS', 'DIV', 'OK', 'IMP ATBT', 'AGE GROUP', '']);

function cellStr(row: ExcelJS.Row, colIdx: number): string {
  const cell = row.getCell(colIdx);
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in (v as any)) {
    return (v as any).richText.map((r: any) => r.text ?? '').join('').trim();
  }
  return String(v).trim();
}

async function main() {
  console.log(`Reading: ${EXCEL_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    const available = wb.worksheets.map((s) => JSON.stringify(s.name));
    console.error(`Sheet "${SHEET_NAME}" not found. Available: ${available.join(', ')}`);
    process.exit(1);
  }

  console.log(`Sheet dimensions: rows 1-${ws.rowCount}, cols 1-${ws.columnCount}`);

  // Discover attribute blocks: scan Row 4 for real SAP attribute keys.
  // Keep only the FIRST occurrence of each unique attribute name to avoid duplicates
  // from 4-column blocks (which repeat the attr name in col+1 of Row 4).
  const sapKeyRow = ws.getRow(SAP_KEY_ROW);
  const blocks: { startCol: number; attributeName: string }[] = [];
  const seenAttrs = new Set<string>();
  for (let c = 1; c <= ws.columnCount; c++) {
    const v = cellStr(sapKeyRow, c);
    if (v && !SKIP_LABELS.has(v.toUpperCase()) && !SKIP_LABELS.has(v) && !seenAttrs.has(v)) {
      blocks.push({ startCol: c, attributeName: v });
      seenAttrs.add(v);
    }
  }
  console.log(`Discovered ${blocks.length} attribute blocks from Row ${SAP_KEY_ROW}:`);
  blocks.forEach((b) => console.log(`  col ${b.startCol}: ${b.attributeName}`));

  // Build attribute → { code → fullForm } map from data rows
  const entries: Map<string, Map<string, string | null>> = new Map();
  for (const { attributeName } of blocks) {
    entries.set(attributeName, new Map());
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber < DATA_START_ROW) return;
    for (const { startCol, attributeName } of blocks) {
      const code = cellStr(row, startCol + 1); // code is always at attr_col + 1
      if (!code) continue;
      const fullForm = cellStr(row, startCol + 2) || null; // full_form at attr_col + 2
      const attrMap = entries.get(attributeName)!;
      if (!attrMap.has(code)) attrMap.set(code, fullForm);
    }
  });

  // Flatten to upsert list and print summary
  const upsertData: { attributeName: string; code: string; fullForm: string | null }[] = [];
  for (const [attrName, codeMap] of entries) {
    if (codeMap.size === 0) continue;
    console.log(`  ${attrName}: ${codeMap.size} codes`);
    for (const [code, fullForm] of codeMap) {
      upsertData.push({ attributeName: attrName, code, fullForm });
    }
  }

  const total = upsertData.length;
  console.log(`\nTotal unique (attribute, code) pairs: ${total}`);
  console.log('Upserting into national_grid_master ...');

  // Deactivate all existing rows first so stale values are cleaned up
  await prisma.nationalGridMaster.updateMany({ where: {}, data: { isActive: false } });

  // Upsert in batches of 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < upsertData.length; i += BATCH) {
    const batch = upsertData.slice(i, i + BATCH);
    await Promise.all(
      batch.map((row) =>
        prisma.nationalGridMaster.upsert({
          where: { attributeName_code: { attributeName: row.attributeName, code: row.code } },
          update: { fullForm: row.fullForm, isActive: true },
          create: { attributeName: row.attributeName, code: row.code, fullForm: row.fullForm },
        }),
      ),
    );
    inserted += batch.length;
    process.stdout.write(`\r  Progress: ${inserted}/${total}`);
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
