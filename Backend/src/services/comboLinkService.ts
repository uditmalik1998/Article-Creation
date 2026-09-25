/**
 * Combo/Set article linking + aggregation (Baba Suit, Kurti Set, ...).
 *
 * SRM sends every piece of a set as its own row — e.g. "Baba Suit", "Top" and
 * "Lower" — sharing the same presentation number + design number. Here we:
 *   1. link them: the row whose major category is a combo category becomes the
 *      PARENT, the others become its CHILDren (each keeps its own major category);
 *   2. derive the parent from its children: all cost fields are the SUM of the
 *      children, descriptive attributes MIRROR the primary (Top) child.
 */
import { Prisma } from '../generated/prisma';
import { prismaClient as prisma } from '../utils/prisma';
import { isComboMajorCategory } from '../config/comboMajorCategories';
import { sortComboChildren } from '../config/comboChildTemplates';
import { ARTICLE_DESCRIPTION_SOURCE_FIELDS, buildArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';

// Parent value = sum of children.
export const COMBO_SUMMED_FIELDS = [
    'rate', 'mrp', 'cmtpCost', 'cmpCost', 'fabCost',
    'valueAddCost', 'valueAddProcessCost', 'vendorFabricRate',
] as const;

// Parent value = primary (Top) child's value.
export const COMBO_MIRRORED_FIELDS = [
    // Fabric
    'yarn1', 'yarn2', 'fabricMainMvgr', 'weave', 'weaveFullForm', 'composition', 'finish', 'gsm',
    'macroMvgr', 'macroMvgrFullForm', 'mainMvgr', 'mainMvgrFullForm', 'mFab2', 'mFab2FullForm',
    'shade', 'weight', 'lycra', 'fCount', 'fConstruction', 'fOunce', 'fWidth', 'fabDiv', 'fabVdr',
    'fabCons', 'width',
    // Body
    'size', 'neck', 'neckDetails', 'collar', 'collarStyle', 'placket', 'sleeve', 'sleeveFold', 'mSet',
    'bottomFold', 'frontOpenStyle', 'pocketType', 'noOfPocket', 'extraPocket', 'fit', 'pattern', 'length',
    'colour', 'secondaryColour', 'fatherBelt', 'childBelt',
    // VA accessories / processing
    'drawcord', 'dcShape', 'button', 'btnColour', 'zipper', 'zipColour', 'patches', 'patchesType',
    'htrfType', 'htrfStyle', 'printType', 'printStyle', 'printPlacement',
    'embroidery', 'embroideryType', 'embPlacement', 'wash',
    // Business attributes
    'ageGroup', 'articleFashionType', 'articleDimension', 'mNoOfSize', 'mNoOfClr', 'impAtrbt2',
    'valueAddAccCostType',
    // Fabric / body article references
    'fabricArticleNumber', 'fabricArticleDescription', 'bodyArticle', 'bodyArticleDescription',
] as const;

/** Fields a user may not edit directly on a PARENT — they're derived from the children. */
export const COMBO_PARENT_DERIVED_FIELDS = new Set<string>([...COMBO_SUMMED_FIELDS, ...COMBO_MIRRORED_FIELDS, 'segment', 'articleDescription']);

const sumDecimal = (values: (Prisma.Decimal | number | null)[]): number | null => {
    const nums = values.map((v) => (v == null ? null : Number(v))).filter((n): n is number => n != null && !Number.isNaN(n));
    if (nums.length === 0) return null;
    return Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
};

/**
 * Link the rows of one SRM presentation + design into a parent/children set.
 * Idempotent — safe to call on every ingest and every page open. Returns the
 * parent id, or null when the group isn't a (single) combo set.
 */
export async function linkComboGroup(pptNumber?: string | null, designNumber?: string | null): Promise<string | null> {
    if (!pptNumber || !designNumber) return null;

    const rows = await prisma.extractionResultFlat.findMany({
        where: { pptNumber, srmOriginalDesignNumber: designNumber, isGeneric: true },
        select: { id: true, majorCategory: true, createdAt: true, comboRole: true, comboParentId: true, comboChildOrder: true, approvalStatus: true },
    });

    const parents = rows.filter((r) => isComboMajorCategory(r.majorCategory));
    if (parents.length !== 1) {
        if (parents.length > 1) console.warn(`[Combo] ${pptNumber}/${designNumber}: ${parents.length} set rows — ambiguous, not linking`);
        return null;
    }
    const parent = parents[0];
    // Never re-shape a set that's already been submitted.
    if (parent.approvalStatus !== 'PENDING') return parent.comboRole === 'PARENT' ? parent.id : null;

    const children = sortComboChildren(rows.filter((r) => r.id !== parent.id));
    if (children.length === 0) return null; // pieces haven't arrived yet

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    if (parent.comboRole !== 'PARENT' || parent.comboParentId) {
        updates.push(prisma.extractionResultFlat.update({ where: { id: parent.id }, data: { comboRole: 'PARENT', comboParentId: null, comboChildOrder: null } }));
    }
    children.forEach((c, i) => {
        if (c.comboRole !== 'CHILD' || c.comboParentId !== parent.id || c.comboChildOrder !== i + 1) {
            updates.push(prisma.extractionResultFlat.update({ where: { id: c.id }, data: { comboRole: 'CHILD', comboParentId: parent.id, comboChildOrder: i + 1 } }));
        }
    });
    if (updates.length > 0) {
        await prisma.$transaction(updates);
        console.log(`[Combo] Linked ${pptNumber}/${designNumber}: parent ${parent.id} + ${children.length} child(ren)`);
        await recomputeComboParent(parent.id);
    }
    return parent.id;
}

/** Link the set a given flat row belongs to (if any). */
export async function linkComboGroupForRow(flatId: string): Promise<string | null> {
    const row = await prisma.extractionResultFlat.findUnique({ where: { id: flatId }, select: { pptNumber: true, srmOriginalDesignNumber: true } });
    return row ? linkComboGroup(row.pptNumber, row.srmOriginalDesignNumber) : null;
}

/** Re-derive a PARENT's summed costs + mirrored attributes from its children. */
export async function recomputeComboParent(parentId: string): Promise<void> {
    const parent = await prisma.extractionResultFlat.findUnique({ where: { id: parentId } });
    if (!parent || parent.comboRole !== 'PARENT' || parent.approvalStatus !== 'PENDING') return;

    const children = await prisma.extractionResultFlat.findMany({
        where: { comboParentId: parentId, comboRole: 'CHILD' },
        orderBy: { comboChildOrder: 'asc' },
    });
    if (children.length === 0) return;
    const primary = children[0];

    const data: Record<string, unknown> = {};
    for (const f of COMBO_SUMMED_FIELDS) data[f] = sumDecimal(children.map((c) => (c as any)[f]));
    for (const f of COMBO_MIRRORED_FIELDS) data[f] = (primary as any)[f] ?? null;

    data.segment = getSegmentByCategoryAndMrp(parent.majorCategory, data.mrp) ?? parent.segment;
    // The parent card is read-only — inherit a vendor code if SRM didn't send one.
    if (!parent.vendorCode && primary.vendorCode) data.vendorCode = primary.vendorCode;

    const descriptionSource: Record<string, unknown> = {};
    for (const f of ARTICLE_DESCRIPTION_SOURCE_FIELDS) descriptionSource[f] = f in data ? data[f] : (parent as any)[f];
    data.articleDescription = buildArticleDescription(descriptionSource as any, 40, {
        excludeFields: await getExcludedDescriptionFields(parent.majorCategory) as any,
    }) || parent.articleDescription;

    await prisma.extractionResultFlat.update({ where: { id: parentId }, data: data as any });
}
