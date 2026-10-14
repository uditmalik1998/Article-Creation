import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const filePath = path.resolve(
    'C:/Users/Administrator/Downloads/MAJ_CAT_GRID_2026-10-06-VALIDATION.xlsx'
  );

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Headers on row 3 (index 2), data starts row 5 (index 4)
  const rows = raw.slice(4).filter((r) => r[0] && r[1]);

  const records = rows.map((r) => ({
    fgMajCat: String(r[0]).trim(),
    attributesMajCat: String(r[1]).trim(),
    frGridStatus: String(r[2] ?? '').trim(),
  }));

  console.log(`Truncating existing data...`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE public.body_article_description_formate RESTART IDENTITY`);

  console.log(`Inserting ${records.length} rows in batches...`);
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    await (prisma as any).bodyArticleDescriptionFormate.createMany({ data: chunk, skipDuplicates: true });
    inserted += chunk.length;
    console.log(`  ${inserted}/${records.length}`);
  }

  console.log(`Done — ${inserted} rows inserted.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
