/**
 * Imports the "MAJ CAT WISE BASIC ACCESSORIES DETAILS" workbook into
 * basic_trim_cost_master + basic_trim_cost_component.
 *
 * Usage: npm run db:import:basic-trim-cost -- "C:\\path\\to\\MAJ CAT WISE BASIC ACCESSORIES DETAILS.xlsx"
 *
 * Workbook layout (both sheets: data starts at column C, header on row 3, data from row 4):
 *   ACC LIST         C=DIV D=SUB DIV E=MAJ CAT, then 7 trim groups of (QTY, RATE, VALUE),
 *                    AA = TOTAL VALUE PER PC
 *   Packaging Master C=DIV D=SUB DIV E=MAJ CAT, then 6 packaging groups of (QTY, RATE, VALUE),
 *                    X = TOTAL VALUE PER PC, Y = THREAD COST, Z = BASIC & TRIMS COST
 *
 * Re-runnable: upserts by maj_cat and replaces that row's components.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { PrismaClient, Prisma } from '../src/generated/prisma';

const prisma = new PrismaClient();

type ComponentSpec = { component: string; startCol: string };

/** DATABASE_URL points at the pgbouncer pooler, which cannot hold interactive
 *  transactions open — so this import writes in bulk statements instead. */
const CHUNK = 200;

function chunked<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// First column letter of each group's (QTY, RATE, VALUE) triplet.
const TRIM_COMPONENTS: ComponentSpec[] = [
  { component: 'BUTTON',        startCol: 'F' },
  { component: 'ZIPPER',        startCol: 'I' },
  { component: 'ELASTIC',       startCol: 'L' },
  { component: 'LACE',          startCol: 'O' },
  { component: 'DRAW_CORD',     startCol: 'R' },
  { component: 'HOOK_AND_LOOP', startCol: 'U' },
  { component: 'INTERLINING',   startCol: 'X' },
];

const PACKAGING_COMPONENTS: ComponentSpec[] = [
  { component: 'POLY_BAG',     startCol: 'F' },
  { component: 'PRICE_TAG',    startCol: 'I' },
  { component: 'KIMBALL_TAG',  startCol: 'L' },
  { component: 'HANGER',       startCol: 'O' },
  { component: 'TISSUE_PAPER', startCol: 'R' },
  { component: 'CARTON',       startCol: 'U' },
];

const HEADER_ROW = 3;
const FIRST_DATA_ROW = 4;

/** Workbook uses "-" and "" for "not applicable"; both mean no value. */
function num(sheet: XLSX.WorkSheet, col: string, row: number): number | null {
  const cell = sheet[`${col}${row}`];
  if (!cell || cell.v === null || cell.v === undefined) return null;
  if (typeof cell.v === 'string' && !/^-?\d/.test(cell.v.trim())) return null;
  const n = Number(cell.v);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

function text(sheet: XLSX.WorkSheet, col: string, row: number): string | null {
  const cell = sheet[`${col}${row}`];
  if (!cell || cell.v === null || cell.v === undefined) return null;
  const s = String(cell.v).trim();
  return s && s !== '-' ? s : null;
}

/** Shifts a column letter right by n (e.g. 'F' + 1 = 'G', 'Z' + 1 = 'AA'). */
function shiftCol(col: string, n: number): string {
  return XLSX.utils.encode_col(XLSX.utils.decode_col(col) + n);
}

function readComponents(
  sheet: XLSX.WorkSheet,
  row: number,
  kind: 'TRIM' | 'PACKAGING',
  specs: ComponentSpec[],
) {
  return specs
    .map(({ component, startCol }) => ({
      kind,
      component,
      qty:   num(sheet, startCol, row),
      rate:  num(sheet, shiftCol(startCol, 1), row),
      value: num(sheet, shiftCol(startCol, 2), row),
    }))
    .filter((c) => c.qty !== null || c.rate !== null || c.value !== null);
}

function lastRow(sheet: XLSX.WorkSheet): number {
  return XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').e.r + 1;
}

function assertLayout(sheet: XLSX.WorkSheet, name: string, totalCol: string, totalLabel: string) {
  const majCatHeader = text(sheet, 'E', HEADER_ROW);
  const totalHeader = text(sheet, totalCol, HEADER_ROW);
  if (majCatHeader !== 'MAJ CAT' || totalHeader !== totalLabel) {
    throw new Error(
      `Unexpected layout in sheet "${name}": E${HEADER_ROW}="${majCatHeader}" ` +
      `${totalCol}${HEADER_ROW}="${totalHeader}" (expected "MAJ CAT" / "${totalLabel}"). ` +
      `The workbook columns have moved — update this script before importing.`,
    );
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    throw new Error('Workbook path is required: npm run db:import:basic-trim-cost -- "<path to .xlsx>"');
  }
  const filePath = path.resolve(arg);
  if (!fs.existsSync(filePath)) throw new Error(`Workbook not found: ${filePath}`);

  const wb = XLSX.readFile(filePath);
  const accSheet = wb.Sheets['ACC LIST'];
  const pkgSheet = wb.Sheets['Packaging Master'];
  if (!accSheet || !pkgSheet) {
    throw new Error(`Workbook must contain "ACC LIST" and "Packaging Master" sheets, found: ${wb.SheetNames.join(', ')}`);
  }

  assertLayout(accSheet, 'ACC LIST', 'AA', 'TOTAL VALUE PER PC (RS)');
  assertLayout(pkgSheet, 'Packaging Master', 'Z', 'BASIC & TRIMS COST');

  // ACC LIST keyed by major category — the trims side of each row.
  const trims = new Map<string, { total: number | null; components: ReturnType<typeof readComponents> }>();
  for (let row = FIRST_DATA_ROW; row <= lastRow(accSheet); row++) {
    const majCat = text(accSheet, 'E', row);
    if (!majCat) continue;
    trims.set(majCat.toUpperCase(), {
      total: num(accSheet, 'AA', row),
      components: readComponents(accSheet, row, 'TRIM', TRIM_COMPONENTS),
    });
  }

  type Record = {
    majCat: string;
    div: string | null;
    subDiv: string | null;
    trimsTotal: number | null;
    packagingTotal: number | null;
    threadCost: number | null;
    basicTrimsCost: number | null;
    components: ReturnType<typeof readComponents>;
  };

  const records: Record[] = [];
  const seen = new Set<string>();
  const missingTrims: string[] = [];

  for (let row = FIRST_DATA_ROW; row <= lastRow(pkgSheet); row++) {
    const majCat = text(pkgSheet, 'E', row);
    if (!majCat) continue;
    const key = majCat.toUpperCase();
    if (seen.has(key)) {
      console.warn(`  ! duplicate MAJ CAT in Packaging Master, ignoring later row: ${majCat}`);
      continue;
    }
    seen.add(key);

    const trim = trims.get(key);
    if (!trim) missingTrims.push(majCat);

    records.push({
      majCat,
      div:            text(pkgSheet, 'C', row),
      subDiv:         text(pkgSheet, 'D', row),
      trimsTotal:     trim?.total ?? null,
      packagingTotal: num(pkgSheet, 'X', row),
      threadCost:     num(pkgSheet, 'Y', row),
      basicTrimsCost: num(pkgSheet, 'Z', row),
      components: [
        ...(trim?.components ?? []),
        ...readComponents(pkgSheet, row, 'PACKAGING', PACKAGING_COMPONENTS),
      ],
    });
  }

  for (const batch of chunked(records, CHUNK)) {
    const values = batch.map((r) => Prisma.sql`(
      ${r.majCat}, ${r.div}, ${r.subDiv}, ${r.trimsTotal}, ${r.packagingTotal},
      ${r.threadCost}, ${r.basicTrimsCost}, NOW(), NOW()
    )`);
    await prisma.$executeRaw`
      INSERT INTO basic_trim_cost_master
        (maj_cat, div, sub_div, trims_total, packaging_total, thread_cost, basic_trims_cost, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (maj_cat) DO UPDATE SET
        div              = EXCLUDED.div,
        sub_div          = EXCLUDED.sub_div,
        trims_total      = EXCLUDED.trims_total,
        packaging_total  = EXCLUDED.packaging_total,
        thread_cost      = EXCLUDED.thread_cost,
        basic_trims_cost = EXCLUDED.basic_trims_cost,
        updated_at       = NOW()
    `;
  }

  const ids = new Map(
    (await prisma.basicTrimCostMaster.findMany({ select: { id: true, majCat: true } }))
      .map((m) => [m.majCat, m.id]),
  );

  const componentRows = records.flatMap((r) => {
    const masterId = ids.get(r.majCat);
    return masterId === undefined ? [] : r.components.map((c) => ({ masterId, ...c }));
  });

  for (const batch of chunked([...ids.values()], CHUNK)) {
    await prisma.basicTrimCostComponent.deleteMany({ where: { masterId: { in: batch } } });
  }
  for (const batch of chunked(componentRows, 1000)) {
    await prisma.basicTrimCostComponent.createMany({ data: batch });
  }

  const withCost = records.filter((r) => r.basicTrimsCost !== null).length;
  console.log(`\nImported ${records.length} major categories from ${path.basename(filePath)}`);
  console.log(`  ${componentRows.length} component rows (trim + packaging consumption/rate)`);
  console.log(`  ${withCost} have a "BASIC & TRIMS COST" value and will auto-fill; ${records.length - withCost} are blank in the workbook`);
  if (missingTrims.length > 0) {
    console.log(`  ${missingTrims.length} not present in ACC LIST (no trims breakdown): ${missingTrims.slice(0, 10).join(', ')}${missingTrims.length > 10 ? ', ...' : ''}`);
  }
}

main()
  .catch((err) => {
    console.error(`\nImport failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
