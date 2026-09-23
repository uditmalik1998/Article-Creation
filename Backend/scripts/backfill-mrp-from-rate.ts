/**
 * Backfill missing MRP values from existing rate/cost.
 *
 * Formula:
 *   MRP = ceil((rate + 47%) / 50) * 50
 *
 * Usage:
 *   ts-node scripts/backfill-mrp-from-rate.ts --dry-run
 *   ts-node scripts/backfill-mrp-from-rate.ts
 */

import { prismaClient as prisma } from '../src/utils/prisma';
import { calculateMrpFromRate } from '../src/utils/mrpCalculator';

const isDryRun = process.argv.includes('--dry-run');

async function run() {
    console.log('🔧 Backfill missing MRP from rate');
    console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`);

    const rows = await prisma.extractionResultFlat.findMany({
        where: {
            mrp: null
        },
        select: {
            id: true,
            rate: true,
            mrp: true
        }
    });

    let updated = 0;
    let skippedNoRate = 0;
    let skippedInvalidRate = 0;

    for (const row of rows) {
        if (row.rate === null || row.rate === undefined) {
            skippedNoRate++;
            continue;
        }

        const computedMrp = calculateMrpFromRate(row.rate);
        if (computedMrp === null) {
            skippedInvalidRate++;
            continue;
        }

        if (!isDryRun) {
            await prisma.extractionResultFlat.update({
                where: { id: row.id },
                data: { mrp: computedMrp }
            });
        }

        updated++;
    }

    console.log(`\nextractionResultFlat: ${rows.length} missing MRP rows scanned`);
    console.log(`extractionResultFlat: ${updated} ${isDryRun ? 'would be updated' : 'updated'}`);
    console.log(`extractionResultFlat: ${skippedNoRate} skipped (no rate)`);
    console.log(`extractionResultFlat: ${skippedInvalidRate} skipped (invalid rate)`);
}

run()
    .catch((error) => {
        console.error('❌ MRP backfill failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
