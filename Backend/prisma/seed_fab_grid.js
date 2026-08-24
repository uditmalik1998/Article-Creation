// Seeds fabric_maj_cat_grid_values from the MASTER sheet of FAB DATA.xlsx
const XLSX = require('../node_modules/xlsx');
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

async function main() {
  const wb = XLSX.readFile('C:/Users/Administrator/Desktop/FAB DATA.xlsx');
  const ws = wb.Sheets['MASTER'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Row index 1 = header (M_FAB_DIV, FULL FORM, M_YARN, FULL FORM, ...)
  // Row index 2 = empty spacer
  // Row index 3+ = data
  const headerRow = rows[1];

  // Build list of characteristics: { name, colIndex }
  const characteristics = [];
  for (let c = 0; c < headerRow.length; c += 2) {
    const name = String(headerRow[c] || '').trim();
    if (name && name !== 'FULL FORM') {
      characteristics.push({ name, colIndex: c });
    }
  }

  const records = [];
  for (const { name, colIndex } of characteristics) {
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const code = String(row[colIndex] || '').trim();
      const fullForm = String(row[colIndex + 1] || '').trim();
      if (!code) continue;
      records.push({ characteristic: name, code, fullForm });
    }
  }

  console.log(`Inserting ${records.length} records across ${characteristics.length} characteristics...`);

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    await Promise.all(
      batch.map((r) =>
        prisma.fabricMajCatGridValue.upsert({
          where: { characteristic_code: { characteristic: r.characteristic, code: r.code } },
          create: r,
          update: { fullForm: r.fullForm },
        })
      )
    );
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${records.length}`);
  }
  console.log('\nDone.');

  // Print summary
  const counts = await prisma.fabricMajCatGridValue.groupBy({
    by: ['characteristic'],
    _count: { id: true },
    orderBy: { characteristic: 'asc' },
  });
  counts.forEach((c) => console.log(`  ${c.characteristic}: ${c._count.id} values`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
