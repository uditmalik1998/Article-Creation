/**
 * Set MC master (table set_mc_master) — the SAP "S-" merchandise categories of
 * set articles (MDM file "SET MC FINAL.xlsx", sheet BM-H (2), 14-Oct-2026).
 *
 * - A major category is a SET category when it has an ACT PARENT row.
 * - The set's parent is created in SAP under the PARENT row's MC
 *   (e.g. JB_B_SUIT_SL -> 131830101 S-JB_B_SUIT_SL).
 * - Each part is created under the S- MC of its own category WITHIN its set
 *   (e.g. JB_TEES_SL in JB_B_SUIT_SL -> 131830102 S-JB_TEES_SL). The same part
 *   name has a different code in each set, so a part is looked up by
 *   (set category, part category), never by name alone.
 * - A part category without an ACT PART row in its set cannot be created.
 */
import { prismaClient as prisma } from '../utils/prisma';

export type SetMcRow = {
    setMajCat: string;
    rowType: 'PARENT' | 'PART';
    partPosition: string | null;
    partMajCat: string | null;
    sMcCode: string;
    sMcDes: string;
    div: string | null;
    subDiv: string | null;
    hsnCode: string | null;
    status: string;
};

/** What an article is sent to SAP with: MC_CD, HSN_CODE and SUB_DIV. */
export type SetMc = { mcCode: string; mcDes: string; div: string | null; subDiv: string | null; hsnCode: string | null };

const norm = (v?: string | null): string => (v ?? '').trim().toUpperCase();

const toSetMc = (r: SetMcRow): SetMc => ({
    mcCode: r.sMcCode, mcDes: r.sMcDes, div: r.div, subDiv: r.subDiv, hsnCode: r.hsnCode,
});

/** In-memory lookups over the ACT rows of the master. */
export class SetMcIndex {
    private readonly parents = new Map<string, SetMcRow>();
    private readonly parts = new Map<string, Map<string, SetMcRow>>();

    constructor(rows: SetMcRow[]) {
        for (const r of rows) {
            if (norm(r.status) !== 'ACT') continue;
            const set = norm(r.setMajCat);
            if (r.rowType === 'PARENT') {
                this.parents.set(set, r);
            } else if (r.partMajCat) {
                if (!this.parts.has(set)) this.parts.set(set, new Map());
                this.parts.get(set)!.set(norm(r.partMajCat), r);
            }
        }
    }

    isSetCategory(majorCategory?: string | null): boolean {
        return this.parents.has(norm(majorCategory));
    }

    setCategories(): string[] {
        return [...this.parents.keys()].sort();
    }

    parentMc(setCategory?: string | null): SetMc | null {
        const r = this.parents.get(norm(setCategory));
        return r ? toSetMc(r) : null;
    }

    /** The part's S- MC within an ACTIVE set, or null. */
    partMc(setCategory?: string | null, partCategory?: string | null): SetMc | null {
        if (!this.isSetCategory(setCategory)) return null;
        const r = this.parts.get(norm(setCategory))?.get(norm(partCategory));
        return r ? toSetMc(r) : null;
    }

    allowedParts(setCategory?: string | null): { majorCategory: string; position: string | null; mcCode: string; mcDes: string }[] {
        if (!this.isSetCategory(setCategory)) return [];
        return [...(this.parts.get(norm(setCategory))?.values() ?? [])].map((r) => ({
            majorCategory: norm(r.partMajCat), position: r.partPosition, mcCode: r.sMcCode, mcDes: r.sMcDes,
        }));
    }
}

const notASet = (setCategory?: string | null) =>
    `${setCategory?.trim() || '(no category)'} is not an active set category in the Set MC Master.`;
const notAPart = (index: SetMcIndex, setCategory: string | null | undefined, partCategory: string | null | undefined) =>
    `${partCategory?.trim() || '(no category)'} is not a part of ${index.parentMc(setCategory)?.mcDes ?? setCategory} in the Set MC Master.`;

/**
 * The S- MC an article goes to SAP with. null = a normal article (not part of
 * a set). `{ error }` = a set article that has no S- MC and must not be sent.
 */
export function resolveSetMc(
    index: SetMcIndex,
    comboRole: string | null | undefined,
    majorCategory: string | null | undefined,
    parentMajorCategory: string | null | undefined,
): SetMc | null | { error: string } {
    if (comboRole === 'PARENT') return index.parentMc(majorCategory) ?? { error: notASet(majorCategory) };
    if (comboRole === 'CHILD') {
        if (!index.isSetCategory(parentMajorCategory)) return { error: notASet(parentMajorCategory) };
        return index.partMc(parentMajorCategory, majorCategory) ?? { error: notAPart(index, parentMajorCategory, majorCategory) };
    }
    return null;
}

export type SetMember = { label: string; majorCategory: string | null };

/** Everything that stops a set from being created under its S- MCs. Empty = OK. */
export function setProblems(index: SetMcIndex, setCategory: string | null | undefined, parts: SetMember[]): string[] {
    const parent = index.parentMc(setCategory);
    if (!parent) return [notASet(setCategory)];
    const problems: string[] = [];
    if (!parent.hsnCode) problems.push(`${parent.mcDes} has no HSN code in the Set MC Master.`);
    for (const p of parts) {
        const mc = index.partMc(setCategory, p.majorCategory);
        if (!mc) problems.push(`${p.label}: ${notAPart(index, setCategory, p.majorCategory)}`);
        else if (!mc.hsnCode) problems.push(`${p.label}: ${mc.mcDes} has no HSN code in the Set MC Master.`);
    }
    return problems;
}

// ─── Upload parsing ───────────────────────────────────────────────────────────

/** Template columns, in order (sheet SET_MC_MASTER, headers row 3, data from row 5). */
export const SET_MC_MASTER_HEADERS = [
    'SET_MAJ_CAT', 'ROW_TYPE', 'PART_POSITION', 'PART_MAJ_CAT', 'S_MC_CODE',
    'S_MC_DES', 'DIV', 'SUB_DIV', 'HSN_CODE', 'STATUS',
] as const;

/** Validate and normalise the uploaded rows. Any error rejects the whole file. */
export function parseSetMcMasterRows(input: { rowNo: number; cells: string[] }[]): { rows: SetMcRow[]; errors: string[] } {
    const rows: SetMcRow[] = [];
    const errors: string[] = [];
    const parentRow = new Map<string, number>();
    const seenParts = new Set<string>();
    const setsWithParts = new Set<string>();

    for (const { rowNo, cells } of input) {
        const c = cells.map((v) => (v ?? '').toString().trim());
        if (c.every((v) => !v)) continue;
        const [setRaw, typeRaw, posRaw, partRaw, code, des, div, subDiv, hsn, statusRaw] = c;
        const setMajCat = norm(setRaw);
        const rowType = norm(typeRaw);
        const status = norm(statusRaw) || 'ACT';
        const partMajCat = norm(partRaw) || null;
        const before = errors.length;

        if (!setMajCat) errors.push(`Row ${rowNo}: SET_MAJ_CAT is required.`);
        if (rowType !== 'PARENT' && rowType !== 'PART') errors.push(`Row ${rowNo}: ROW_TYPE must be PARENT or PART (got "${typeRaw}").`);
        if (!/^\d{9}$/.test(code)) errors.push(`Row ${rowNo}: S_MC_CODE "${code}" must be 9 digits.`);
        if (!des.startsWith('S-')) errors.push(`Row ${rowNo}: S_MC_DES "${des}" must start with "S-".`);
        if (rowType === 'PART' && !partMajCat) errors.push(`Row ${rowNo}: PART_MAJ_CAT is required on a PART row.`);
        if (status !== 'ACT' && status !== 'INACT') errors.push(`Row ${rowNo}: STATUS must be ACT or INACT (got "${statusRaw}").`);

        if (rowType === 'PARENT' && setMajCat) {
            if (parentRow.has(setMajCat)) errors.push(`Row ${rowNo}: ${setMajCat} has more than one PARENT row.`);
            else parentRow.set(setMajCat, rowNo);
        }
        if (rowType === 'PART' && setMajCat && partMajCat) {
            setsWithParts.add(setMajCat);
            const key = `${setMajCat}||${partMajCat}`;
            if (seenParts.has(key)) errors.push(`Row ${rowNo}: ${partMajCat} is listed twice for ${setMajCat}.`);
            seenParts.add(key);
        }
        if (errors.length > before) continue;

        rows.push({
            setMajCat,
            rowType: rowType as 'PARENT' | 'PART',
            partPosition: rowType === 'PART' ? norm(posRaw) || null : null,
            partMajCat: rowType === 'PART' ? partMajCat : null,
            sMcCode: code,
            sMcDes: des,
            div: div || null,
            subDiv: subDiv || null,
            hsnCode: hsn || null,
            status,
        });
    }
    for (const set of setsWithParts) {
        if (!parentRow.has(set)) errors.push(`${set} has PART rows but no PARENT row.`);
    }
    return { rows, errors };
}

/**
 * Fill blank DIV / SUB_DIV / HSN_CODE from the article's normal category
 * (major_category_details): the set's own category for a PARENT row, the
 * part's category for a PART row. Values given in the file are kept.
 */
export function fillSetMcDefaults(
    rows: SetMcRow[],
    lookup: Map<string, { div: string | null; subDiv: string | null; hsnCode: string | null }>,
): SetMcRow[] {
    return rows.map((r) => {
        const d = lookup.get(norm(r.rowType === 'PARENT' ? r.setMajCat : r.partMajCat));
        if (!d) return r;
        return { ...r, div: r.div || d.div, subDiv: r.subDiv || d.subDiv, hsnCode: r.hsnCode || d.hsnCode };
    });
}

// ─── DB-backed index (cached) ─────────────────────────────────────────────────

const CACHE_MS = 5 * 60 * 1000;
let cached: { index: SetMcIndex; at: number } | null = null;

export function invalidateSetMcCache(): void {
    cached = null;
}

export async function readSetMcRows(): Promise<SetMcRow[]> {
    return prisma.$queryRaw<SetMcRow[]>`
        SELECT set_maj_cat AS "setMajCat", row_type AS "rowType", part_position AS "partPosition",
               part_maj_cat AS "partMajCat", s_mc_code AS "sMcCode", s_mc_des AS "sMcDes",
               div, sub_div AS "subDiv", hsn_code AS "hsnCode", status
        FROM public.set_mc_master
        ORDER BY set_maj_cat, row_type DESC, part_position, part_maj_cat`;
}

/** The master as lookups, refreshed every 5 minutes and right after an upload. */
export async function getSetMcIndex(): Promise<SetMcIndex> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.index;
    let rows: SetMcRow[];
    try {
        rows = await readSetMcRows();
    } catch (err: any) {
        // Code deployed before prisma/migrations/create_set_mc_master.sql ran: no
        // category is a set, so nothing is linked or sent to SAP as a set. Retry in a minute.
        if (!/set_mc_master" does not exist|42P01/.test(String(err?.message ?? err))) throw err;
        console.error('[SetMcMaster] Table set_mc_master is missing — set articles are disabled until the migration is applied.');
        cached = { index: new SetMcIndex([]), at: Date.now() - CACHE_MS + 60_000 };
        return cached.index;
    }
    const index = new SetMcIndex(rows);
    cached = { index, at: Date.now() };
    return index;
}

/** The S- MC for one article row (looks up the parent's category for a part). */
export async function setMcForArticle(item: Record<string, unknown>): Promise<SetMc | null | { error: string }> {
    const role = typeof item.comboRole === 'string' ? item.comboRole : null;
    if (role !== 'PARENT' && role !== 'CHILD') return null;
    let parentCategory: string | null = null;
    if (role === 'CHILD' && typeof item.comboParentId === 'string') {
        const parent = await prisma.extractionResultFlat.findUnique({
            where: { id: item.comboParentId }, select: { majorCategory: true },
        });
        parentCategory = parent?.majorCategory ?? null;
    }
    return resolveSetMc(await getSetMcIndex(), role, item.majorCategory as string | null, parentCategory);
}
