/**
 * Major Category Grid contribution % — Bgt Cont% / Pd Cont% / Auto Cont% on
 * maj_cat_grid_values.
 *
 * A "block" is one (major_category, attribute_name) pair, e.g. M_TEES_HS ->
 * M_FIT; its rows are that attribute's VALUES (REG_FIT, LOOSE_FIT, ...).
 * Within a block every filled column must sum to 100.
 *
 *   creator (BGT or PD, for one division)
 *     -> CONT_APPROVER stage (ONLY the approver paired with that creator)
 *     -> MDM stage (whoever is tagged Business Division MDM)
 *     -> applied to maj_cat_grid_values
 *
 * Who may fill / approve what is `grid_contribution_assignments` — one row
 * per (kind, division, creator) with that creator's approver. It is NOT the
 * user's own businessDivision (that doesn't match the business sheet), and
 * BGT and PD pairs are independent: a BGT creator can never touch Pd Cont%
 * and vice versa. Auto Cont% has no workflow yet (display only).
 *
 * Requests reuse expense_change_requests (tableKey 'major-category-grid',
 * requestKind BGT_CONT / PD_CONT, blockKey, routedApproverEmail) and walk
 * their own chain, CONTRIBUTION_CHAIN_KEY, instead of the table's '*' chain —
 * see `approvalChainKey`.
 */

import { Prisma } from '../generated/prisma';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

export type ContributionKind = 'BGT' | 'PD';
export const CONTRIBUTION_KINDS: ContributionKind[] = ['BGT', 'PD'];

export const CONTRIBUTION_TABLE_KEY = 'major-category-grid';
/** `expense_approval_stages.table_key` of the contribution chain. */
export const CONTRIBUTION_CHAIN_KEY = 'major-category-grid#contribution';
export const CONT_APPROVER_STAGE = 'CONT_APPROVER';

export const CONTRIBUTION_KIND_META: Record<ContributionKind, { requestKind: string; column: string; label: string }> = {
  BGT: { requestKind: 'BGT_CONT', column: 'bgt_cont_pct', label: 'Bgt Cont%' },
  PD: { requestKind: 'PD_CONT', column: 'pd_cont_pct', label: 'Pd Cont%' },
};

export function isContributionKind(value: unknown): value is ContributionKind {
  return value === 'BGT' || value === 'PD';
}

export function kindFromRequestKind(requestKind: string | null | undefined): ContributionKind | null {
  if (requestKind === 'BGT_CONT') return 'BGT';
  if (requestKind === 'PD_CONT') return 'PD';
  return null;
}

/** The approval chain a request walks: contribution requests have their own,
 * everything else walks its table's chain as before. */
export function approvalChainKey(request: { tableKey: string; requestKind?: string | null }): string {
  return kindFromRequestKind(request.requestKind) ? CONTRIBUTION_CHAIN_KEY : request.tableKey;
}

const BLOCK_SEPARATOR = '||';

export function toBlockKey(majorCategory: string, attributeName: string): string {
  return `${majorCategory}${BLOCK_SEPARATOR}${attributeName}`;
}

export function fromBlockKey(blockKey: string): { majorCategory: string; attributeName: string } {
  const idx = blockKey.indexOf(BLOCK_SEPARATOR);
  return { majorCategory: blockKey.slice(0, idx), attributeName: blockKey.slice(idx + BLOCK_SEPARATOR.length) };
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}

// ── Assignments ─────────────────────────────────────────────────────────────

export type ContributionAssignment = {
  id: number;
  kind: ContributionKind;
  division: string;
  creatorEmail: string;
  approverEmail: string;
};

const CACHE_TTL_MS = 60 * 1000;
let assignmentCache: { rows: ContributionAssignment[]; expiresAt: number } | null = null;

export function invalidateContributionAssignmentCache(): void {
  assignmentCache = null;
}

export async function getActiveContributionAssignments(): Promise<ContributionAssignment[]> {
  if (assignmentCache && assignmentCache.expiresAt > Date.now()) return assignmentCache.rows;
  const rows = await withPrismaRetry(() =>
    prisma.gridContributionAssignment.findMany({ where: { isActive: true }, orderBy: [{ kind: 'asc' }, { division: 'asc' }] })
  );
  const mapped = rows
    .filter((r) => isContributionKind(r.kind))
    .map((r) => ({
      id: r.id,
      kind: r.kind as ContributionKind,
      division: r.division.toUpperCase(),
      creatorEmail: normalizeEmail(r.creatorEmail),
      approverEmail: normalizeEmail(r.approverEmail),
    }));
  assignmentCache = { rows: mapped, expiresAt: Date.now() + CACHE_TTL_MS };
  return mapped;
}

export type ContributionScope = {
  /** (kind, division) pairs this user may FILL, with the approver each routes to. */
  creator: { kind: ContributionKind; division: string; approverEmail: string }[];
  /** (kind, division) pairs this user approves for at least one creator. */
  approver: { kind: ContributionKind; division: string }[];
};

export async function getContributionScope(email: string): Promise<ContributionScope> {
  const me = normalizeEmail(email);
  const all = await getActiveContributionAssignments();
  const creator = all
    .filter((a) => a.creatorEmail === me)
    .map((a) => ({ kind: a.kind, division: a.division, approverEmail: a.approverEmail }));
  const approverKeys = new Set<string>();
  const approver: ContributionScope['approver'] = [];
  for (const a of all) {
    if (a.approverEmail !== me) continue;
    const key = `${a.kind}:${a.division}`;
    if (approverKeys.has(key)) continue;
    approverKeys.add(key);
    approver.push({ kind: a.kind, division: a.division });
  }
  return { creator, approver };
}

export async function isContributionApprover(email: string): Promise<boolean> {
  const me = normalizeEmail(email);
  return (await getActiveContributionAssignments()).some((a) => a.approverEmail === me);
}

// ── Division of a major category ───────────────────────────────────────────

/** Used only when a major category isn't in the hierarchy (33 of them, as of
 * 2026-10-07) — every prefix in the grid maps to exactly one division. */
const PREFIX_DIVISION: Record<string, string> = {
  M: 'MENS', MW: 'MENS',
  L: 'LADIES', LW: 'LADIES',
  IB: 'KIDS', IBW: 'KIDS', IG: 'KIDS', IGW: 'KIDS',
  JB: 'KIDS', JBW: 'KIDS', JG: 'KIDS', JGW: 'KIDS',
  YB: 'KIDS', YBW: 'KIDS', YG: 'KIDS', YGW: 'KIDS',
  KI: 'KIDS', KIW: 'KIDS', KBW: 'KIDS', KGW: 'KIDS',
};
const GRID_DIVISIONS = new Set(['MENS', 'LADIES', 'KIDS']);

let hierarchyCache: { map: Map<string, string>; expiresAt: number } | null = null;

async function getHierarchyDivisionMap(): Promise<Map<string, string>> {
  if (hierarchyCache && hierarchyCache.expiresAt > Date.now()) return hierarchyCache.map;
  const rows = await withPrismaRetry(() =>
    prisma.$queryRaw<{ mc: string; division: string }[]>`
      SELECT UPPER(c.name) AS mc, UPPER(d.name) AS division
      FROM categories c
      JOIN sub_departments sd ON sd.id = c.sub_department_id
      JOIN departments d ON d.id = sd.department_id
    `
  );
  const map = new Map<string, string>();
  for (const r of rows) if (GRID_DIVISIONS.has(r.division)) map.set(r.mc, r.division);
  hierarchyCache = { map, expiresAt: Date.now() + 5 * 60 * 1000 };
  return map;
}

/** MENS / LADIES / KIDS for a grid major category: the hierarchy first, the
 * name prefix as fallback; null if neither knows it. */
export async function resolveMajorCategoryDivision(majorCategory: string): Promise<string | null> {
  const mc = majorCategory.trim().toUpperCase();
  const fromHierarchy = (await getHierarchyDivisionMap()).get(mc);
  if (fromHierarchy) return fromHierarchy;
  return PREFIX_DIVISION[mc.split('_')[0]] ?? null;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export type BlockRow = { id: number; value: string; bgt: number | null; pd: number | null; auto: number | null };

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function loadBlock(majorCategory: string, attributeName: string, client: DbClient = prisma): Promise<BlockRow[]> {
  const rows = await client.$queryRaw<{ id: bigint | number; value: string; bgt: number | null; pd: number | null; auto: number | null }[]>`
    SELECT id, value,
           bgt_cont_pct::float8  AS bgt,
           pd_cont_pct::float8   AS pd,
           auto_cont_pct::float8 AS auto
    FROM maj_cat_grid_values
    WHERE major_category = ${majorCategory} AND attribute_name = ${attributeName}
    ORDER BY value
  `;
  return rows.map((r) => ({ id: Number(r.id), value: r.value, bgt: r.bgt, pd: r.pd, auto: r.auto }));
}

function blockValueFor(row: BlockRow, kind: ContributionKind): number | null {
  return kind === 'BGT' ? row.bgt : row.pd;
}

/** '' / null / undefined -> null (clear); otherwise a number 0..100 with at
 * most 2 decimals. Anything else is an error message. */
export function parsePercent(raw: unknown): { value: number | null } | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  const text = typeof raw === 'string' ? raw.trim().replace(/%$/, '').trim() : raw;
  const n = typeof text === 'number' ? text : Number(text);
  if (!Number.isFinite(n)) return { error: `"${String(raw)}" is not a number` };
  if (n < 0 || n > 100) return { error: `${n} is outside 0–100` };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { error: `${n} has more than 2 decimals` };
  return { value: Math.round(n * 100) / 100 };
}

const samePct = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 0.005;

export type BlockDiff = Record<string, { old: number | null; new: number | null }>;

/**
 * Merge `proposed` (value -> raw %) over the block's current `kind` column,
 * and check the result: every key is an existing value, every % is valid,
 * and — if anything in the block is filled — it sums to exactly 100. Values
 * not mentioned in `proposed` keep their current %.
 */
export function buildBlockDiff(
  block: BlockRow[],
  kind: ContributionKind,
  proposed: Record<string, unknown>
): { diff: BlockDiff; total: number } | { error: string } {
  const byValue = new Map(block.map((r) => [r.value, r]));
  const unknown = Object.keys(proposed).filter((v) => !byValue.has(v));
  if (unknown.length > 0) {
    return { error: `Not values of this attribute: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` (+${unknown.length - 5} more)` : ''}` };
  }

  const diff: BlockDiff = {};
  const final = new Map<string, number | null>(block.map((r) => [r.value, blockValueFor(r, kind)]));
  for (const [value, raw] of Object.entries(proposed)) {
    const parsed = parsePercent(raw);
    if ('error' in parsed) return { error: `${value}: ${parsed.error}` };
    const old = blockValueFor(byValue.get(value)!, kind);
    final.set(value, parsed.value);
    if (!samePct(old, parsed.value)) diff[value] = { old, new: parsed.value };
  }

  const filled = [...final.values()].filter((v): v is number => v !== null);
  const total = Math.round(filled.reduce((s, v) => s + v, 0) * 100) / 100;
  if (filled.length > 0 && Math.abs(total - 100) > 0.005) {
    return { error: `${CONTRIBUTION_KIND_META[kind].label} of this block must add up to 100 — it adds up to ${total}.` };
  }
  if (Object.keys(diff).length === 0) return { error: 'No % changed in this block.' };
  return { diff, total };
}

/** The first value whose live % no longer matches the request's `old` —
 * someone else's request landed in between — or null if nothing drifted. */
export async function findContributionDrift(
  majorCategory: string,
  attributeName: string,
  kind: ContributionKind,
  changes: BlockDiff
): Promise<string | null> {
  const block = await loadBlock(majorCategory, attributeName);
  const byValue = new Map(block.map((r) => [r.value, r]));
  for (const [value, diff] of Object.entries(changes)) {
    const row = byValue.get(value);
    if (!row) return value;
    if (!samePct(blockValueFor(row, kind), diff.old ?? null)) return value;
  }
  return null;
}

/** Writes the approved % — keyed by name, not row id, so a full grid
 * re-upload in between (which renumbers ids) doesn't matter. */
export async function applyContributionChanges(
  tx: Prisma.TransactionClient,
  majorCategory: string,
  attributeName: string,
  kind: ContributionKind,
  changes: BlockDiff
): Promise<number> {
  const column = Prisma.raw(`"${CONTRIBUTION_KIND_META[kind].column}"`);
  let updated = 0;
  for (const [value, diff] of Object.entries(changes)) {
    updated += await tx.$executeRaw`
      UPDATE maj_cat_grid_values SET ${column} = ${diff.new}::numeric
      WHERE major_category = ${majorCategory} AND attribute_name = ${attributeName} AND value = ${value}
    `;
  }
  return updated;
}
