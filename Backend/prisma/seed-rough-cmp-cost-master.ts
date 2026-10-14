/**
 * Seed rough_cmp_cost_master from ROUGH- CMP_COST_MASTER_EXPORT.xlsx.
 * Clears the table first, then inserts all rows fresh.
 *
 * Usage:
 *   npx ts-node prisma/seed-rough-cmp-cost-master.ts [path-to-xlsx]
 */

import XLSX from 'xlsx';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const XLSX_PATH =
  process.argv[2] ??
  'C:\\Users\\Administrator\\Downloads\\ROUGH- CMP_COST_MASTER_EXPORT.xlsx';

function toNum(v: unknown): number | null {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

async function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const sheetName =
    wb.SheetNames.find((s) => s.trim().toUpperCase() === 'CMP COST') ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];

  // Row 0: title, Row 1: headers, Row 2: empty — data starts at index 3
  const dataRows = rows.slice(3).filter((r) => r[0] && r[2]);
  console.log(`Loaded ${dataRows.length} data rows from "${sheetName}"`);

  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  try {
    // ── 1. Wipe existing data ──────────────────────────────────────────────────
    const { rowCount: deleted } = await client.query('DELETE FROM rough_cmp_cost_master');
    console.log(`Deleted ${deleted} existing rows`);

    // ── 2. Insert all rows in one transaction ──────────────────────────────────
    await client.query('BEGIN');

    let inserted = 0;
    for (const row of dataRows) {
      const div          = String(row[0] ?? '').trim() || null;
      const subDiv       = String(row[1] ?? '').trim() || null;
      const majCat       = String(row[2] ?? '').trim();
      if (!majCat) continue;

      const cuttingSam   = toNum(row[3]);
      const cuttingVal   = toNum(row[4]);
      const stitchingSam = toNum(row[5]);
      const stitchingVal = toNum(row[6]);
      const ironingSam   = toNum(row[7]);
      const ironingVal   = toNum(row[8]);
      const finishingSam = toNum(row[9]);
      const finishingVal = toNum(row[10]);
      const cmpCost      = toNum(row[11]);

      await client.query(
        `INSERT INTO rough_cmp_cost_master
           (div, sub_div, maj_cat,
            cutting_sam, cutting_val,
            stitching_sam, stitching_val,
            ironing_sam, ironing_val,
            finishing_sam, finishing_val,
            cmp_cost,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
        [div, subDiv, majCat,
         cuttingSam, cuttingVal,
         stitchingSam, stitchingVal,
         ironingSam, ironingVal,
         finishingSam, finishingVal,
         cmpCost],
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`Inserted ${inserted} rows — done.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
