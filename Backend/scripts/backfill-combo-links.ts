/**
 * Link existing SRM combo/set rows (Baba Suit, Kurti Set, ...) to their pieces
 * (Top, Lower, ...) by presentation + design number. New rows are linked by the
 * raw-article cron; this covers rows imported before that.
 *
 * --drop-template-children also deletes blank children auto-created by the old
 * template flow (no SRM origin, still PENDING).
 *
 * Usage:
 *   ts-node scripts/backfill-combo-links.ts --dry-run
 *   ts-node scripts/backfill-combo-links.ts [--drop-template-children]
 */

import { prismaClient as prisma } from '../src/utils/prisma';
import { isComboMajorCategory, COMBO_MAJOR_CATEGORIES } from '../src/config/comboMajorCategories';
import { linkComboGroup } from '../src/services/comboLinkService';

const isDryRun = process.argv.includes('--dry-run');
const dropTemplateChildren = process.argv.includes('--drop-template-children');

async function run() {
    console.log(`🔗 Backfill combo links (dry run: ${isDryRun ? 'yes' : 'no'})`);

    const candidates = await prisma.extractionResultFlat.findMany({
        where: {
            isGeneric: true,
            approvalStatus: 'PENDING',
            pptNumber: { not: null },
            srmOriginalDesignNumber: { not: null },
            OR: COMBO_MAJOR_CATEGORIES.map((c) => ({ majorCategory: { contains: c, mode: 'insensitive' as const } })),
        },
        select: { id: true, pptNumber: true, srmOriginalDesignNumber: true, majorCategory: true },
    });
    const parents = candidates.filter((c) => isComboMajorCategory(c.majorCategory));
    console.log(`Found ${parents.length} candidate set article(s)`);

    if (dropTemplateChildren) {
        const templateChildren = await prisma.extractionResultFlat.findMany({
            where: { comboRole: 'CHILD', srmUniqueId: null, srmOriginalDesignNumber: null, approvalStatus: 'PENDING' },
            select: { id: true, majorCategory: true, comboParentId: true },
        });
        console.log(`Template children to delete: ${templateChildren.length}`);
        if (!isDryRun && templateChildren.length > 0) {
            await prisma.extractionResultFlat.deleteMany({ where: { id: { in: templateChildren.map((c) => c.id) } } });
        }
    }

    let linked = 0;
    for (const p of parents) {
        if (isDryRun) {
            const pieces = await prisma.extractionResultFlat.count({
                where: { pptNumber: p.pptNumber, srmOriginalDesignNumber: p.srmOriginalDesignNumber, isGeneric: true, id: { not: p.id } },
            });
            console.log(`  ${p.pptNumber}/${p.srmOriginalDesignNumber} ${p.majorCategory}: ${pieces} piece(s)`);
            continue;
        }
        if (await linkComboGroup(p.pptNumber, p.srmOriginalDesignNumber)) linked++;
    }

    console.log(isDryRun ? 'Dry run complete' : `✅ Linked ${linked} set article(s)`);
}

run()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
