/**
 * seed-major-cat-master.ts
 *
 * Seeds public.major_cat_master from the baked-in JSON export of
 * "CATEGORY SHEET MJ WISE FINAL" (src/data/major-cat-master.json).
 * Each row: { majCat, name, div, idealFor, frame } where frame ∈ fw|upper|lower|set.
 *
 * Idempotent: upserts by majCat, so re-running refreshes name/div/idealFor/frame
 * without creating duplicates and without wiping manually-added categories.
 *
 * Run: npx ts-node prisma/seed-major-cat-master.ts
 */

import { PrismaClient } from '../src/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface MajorCatRow {
  majCat: string;
  name: string;
  div: string;
  idealFor: string;
  frame: string;
}

async function main() {
  const jsonPath = path.join(__dirname, '..', 'src', 'data', 'major-cat-master.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Data file not found at: ${jsonPath}`);
  }

  const rows: MajorCatRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${rows.length} rows from major-cat-master.json`);

  let upserted = 0;
  for (const r of rows) {
    const majCat = String(r.majCat || '').trim();
    if (!majCat) continue;
    const frame = String(r.frame || '').trim().toLowerCase() || 'upper';

    await prisma.majorCatMaster.upsert({
      where: { majCat },
      create: {
        majCat,
        name: r.name?.trim() || null,
        div: r.div?.trim() || null,
        idealFor: r.idealFor?.trim() || null,
        frame,
        isActive: true,
      },
      update: {
        name: r.name?.trim() || null,
        div: r.div?.trim() || null,
        idealFor: r.idealFor?.trim() || null,
        frame,
      },
    });
    upserted++;
  }

  const total = await prisma.majorCatMaster.count();
  console.log(`\nDone. Upserted ${upserted} rows. Table now has ${total} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
