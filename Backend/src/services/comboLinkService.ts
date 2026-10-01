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
export async function linkComboGroup(pptNumber?: string | null, designNumber?: string | null, setGroupId?: string | null): Promise<string | null> {
    // SRM set article: every photo of one set shares a set_group_id (parent photo
    // + pieces), so one presentation can hold several sets.
    if (pptNumber && setGroupId) return linkSetGroup(pptNumber, setGroupId);

    if (!pptNumber || !designNumber) return null;

    const rows = await prisma.extractionResultFlat.findMany({
        where: { pptNumber, srmOriginalDesignNumber: designNumber, isGeneric: true },
        select: { id: true, majorCategory: true, createdAt: true, comboRole: true, comboParentId: true, comboChildOrder: true, approvalStatus: true, setRole: true },
    });

    const parents = rows.filter((r) => isComboMajorCategory(r.majorCategory));
    if (parents.length !== 1) {
        if (parents.length > 1) console.warn(`[Combo] ${pptNumber}/${designNumber}: ${parents.length} set rows — ambiguous, not linking`);
        return null;
    }
    return applyComboLinks(`${pptNumber}/${designNumber}`, parents[0], rows.filter((r) => r.id !== parents[0].id));
}

/** Link one SRM set: the PARENT-role photo plus every other photo sharing its set_group_id. */
async function linkSetGroup(pptNumber: string, setGroupId: string): Promise<string | null> {
    const rows = await prisma.extractionResultFlat.findMany({
        where: { pptNumber, setGroupId, isGeneric: true },
        select: { id: true, majorCategory: true, createdAt: true, comboRole: true, comboParentId: true, comboChildOrder: true, approvalStatus: true, setRole: true },
    });
    const parents = rows.filter((r) => r.setRole === 'PARENT');
    if (parents.length !== 1) {
        console.warn(`[Combo] ${pptNumber}/set ${setGroupId}: ${parents.length} PARENT photo(s) — need exactly one, not linking`);
        return null;
    }
    return applyComboLinks(`${pptNumber}/set ${setGroupId}`, parents[0], rows.filter((r) => r.id !== parents[0].id));
}

type ComboLinkRow = {
    id: string; majorCategory: string | null; createdAt: Date; setRole: string | null;
    comboRole: string; comboParentId: string | null; comboChildOrder: number | null; approvalStatus: string;
};

/** Write PARENT/CHILD roles + child order for one set. Idempotent. Returns the parent id, or null. */
async function applyComboLinks(label: string, parent: ComboLinkRow, rest: ComboLinkRow[]): Promise<string | null> {
    // Never re-shape a set that's already been submitted.
    if (parent.approvalStatus !== 'PENDING') return parent.comboRole === 'PARENT' ? parent.id : null;

    const children = sortComboChildren(rest);
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
        console.log(`[Combo] Linked ${label}: parent ${parent.id} + ${children.length} child(ren)`);
        await recomputeComboParent(parent.id);
    }
    return parent.id;
}

/** Link the set a given flat row belongs to (if any). */
export async function linkComboGroupForRow(flatId: string): Promise<string | null> {
    let row = await prisma.extractionResultFlat.findUnique({ where: { id: flatId }, select: { pptNumber: true, srmOriginalDesignNumber: true, setGroupId: true } });
    if (row && !row.setGroupId) {
        // Its set fields may still be sitting on raw_articles only (see syncSetsFromRaw).
        await syncSetsFromRaw(true);
        row = await prisma.extractionResultFlat.findUnique({ where: { id: flatId }, select: { pptNumber: true, srmOriginalDesignNumber: true, setGroupId: true } });
    }
    return row ? linkComboGroup(row.pptNumber, row.srmOriginalDesignNumber, row.setGroupId) : null;
}

let lastSetSyncAt = 0;
const SET_SYNC_INTERVAL_MS = 60_000;

/**
 * SRM set photos can be turned into articles by a worker that doesn't know
 * about sets (e.g. a server still running older code on the shared DB). Those
 * articles arrive without set fields, so they'd show as separate articles.
 * Copy set_group_id/set_role/set_name from their raw_articles row (via
 * raw_articles.flat_id) and link every pending set that isn't linked yet.
 * Throttled to once a minute unless forced. Returns the number of sets linked.
 */
export async function syncSetsFromRaw(force = false): Promise<number> {
    if (!force && Date.now() - lastSetSyncAt < SET_SYNC_INTERVAL_MS) return 0;
    lastSetSyncAt = Date.now();

    await prisma.$executeRaw`
        UPDATE public.extraction_results_flat e
        SET set_group_id = r.set_group_id, set_role = r.set_role, set_name = r.set_name
        FROM public.raw_articles r
        WHERE r.set_group_id IS NOT NULL
          AND r.flat_id IS NOT NULL
          AND e.id = r.flat_id
          AND e.set_group_id IS NULL`;

    const groups = await prisma.$queryRaw<{ ppt_number: string; set_group_id: string }[]>`
        SELECT e.ppt_number, e.set_group_id
        FROM public.extraction_results_flat e
        WHERE e.set_group_id IS NOT NULL
          AND e.ppt_number IS NOT NULL
          AND e.is_generic = true
          AND e.approval_status::text = 'PENDING'
          AND e.combo_role::text = 'NONE'
        GROUP BY e.ppt_number, e.set_group_id`;

    let linked = 0;
    for (const g of groups) {
        if (await linkSetGroup(g.ppt_number, g.set_group_id)) linked++;
    }
    return linked;
}

/** Re-derive a PARENT's summed costs + mirrored attributes from its children. */
export async function recomputeComboParent(parentId: string): Promise<void> {
    const parent = await prisma.extractionResultFlat.findUnique({ where: { id: parentId } });
    if (!parent || parent.comboRole !== 'PARENT' || parent.approvalStatus !== 'PENDING') return;

    const children = sortComboChildren(await prisma.extractionResultFlat.findMany({
        where: { comboParentId: parentId, comboRole: 'CHILD' },
    }));
    if (children.length === 0) return;
    const primary = children[0];

    // Keep the Top piece first — a piece's major category may have just changed.
    const reorders = children
        .map((c, i) => ({ c, order: i + 1 }))
        .filter(({ c, order }) => c.comboChildOrder !== order)
        .map(({ c, order }) => prisma.extractionResultFlat.update({ where: { id: c.id }, data: { comboChildOrder: order } }));
    if (reorders.length > 0) await prisma.$transaction(reorders);

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
