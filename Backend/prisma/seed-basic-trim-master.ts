/**
 * Seed basic_trim_master from "BASIC TRIMS 2 TYPE COSTING (1).xlsx".
 * Deletes all existing rows, then inserts fresh from the Excel.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/seed-basic-trim-master.ts [path-to-xlsx]
 */

import XLSX from 'xlsx';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const XLSX_PATH =
  process.argv[2] ??
  'C:\\Users\\Administrator\\Downloads\\BASIC TRIMS 2 TYPE COSTING (1).xlsx';

function toNum(v: unknown): number | null {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

async function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];

  // Row 0 is header; data from row 1 onward. Skip rows where TYPE is "-" or empty.
  const dataRows = rows.slice(1).filter((r) => {
    const attributeName = String(r[0] ?? '').trim();
    const type          = String(r[1] ?? '').trim();
    return attributeName && type && type !== '-';
  });

  console.log(`Loaded ${dataRows.length} data rows from "${wb.SheetNames[0]}"`);

  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  try {
    const { rowCount: deleted } = await client.query('DELETE FROM basic_trim_master');
    console.log(`Deleted ${deleted} existing rows`);

    await client.query('BEGIN');
    let inserted = 0;

    for (const row of dataRows) {
      const attributeName = String(row[0] ?? '').trim();
      const type          = String(row[1] ?? '').trim();
      const bt1           = toNum(row[2]);
      const bt2           = toNum(row[3]);

      await client.query(
        `INSERT INTO basic_trim_master (attribute_name, type, bt_1, bt_2, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [attributeName, type, bt1, bt2],
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
