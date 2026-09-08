/**
 * Access control for the Expense Data change workflow, and the approval
 * CHAIN it walks.
 *
 * The chain a change walks through is:
 *
 *   requester (CREATOR/APPROVER)  ->  stage 1  ->  stage 2  ->  ...  ->  applied
 *   (raises add/edit/                 (e.g.        (e.g.                to the
 *    delete + reason                    Category     MDM)                master
 *    + wanted-by date)                  Head)                            row, and
 *                                                                         so SAP)
 *
 * The REQUESTER layer (first layer) rides on the existing `UserRole` —
 * anyone with role CREATOR, APPROVER or CATEGORY_HEAD can raise a request on
 * any table, no setup needed (`ROLE_BASED_REQUESTERS` below). That is a
 * deliberate choice over per-email grants: this layer maps naturally onto
 * roles the app already has, so there is no separate list to keep in sync
 * as people join, leave, or change teams.
 *
 * The APPROVAL layer (second layer onward — Category Head, MDM, and whatever
 * an admin adds beyond them) is role-based wherever a role lines up
 * naturally (`ROLE_BASED_APPROVAL_STAGES` below):
 *   - CATEGORY_HEAD role  <->  the "CATEGORY_HEAD" stage
 *   - ADMIN role          <->  every stage, MDM included — ADMIN bypasses the
 *                              chain entirely (see the isAdmin branch below),
 *                              so "MDM approves" and "an admin approves" are
 *                              the same thing; there is no separate MDM role.
 * A stage an admin adds beyond those two has no role to bind to, so it falls
 * back to `expense_access_grants` (see /admin/expense-access) — a list of
 * specific email addresses ADMIN maintains, for sign-off authority that
 * doesn't line up with any existing role. Grants also still work for
 * CATEGORY_HEAD and REQUESTER_LEVEL, e.g. to loop in one person on one table
 * without changing their role — they simply aren't the primary mechanism.
 *
 * The STAGES themselves — how many there are, their order, their labels — are
 * admin-managed, in `expense_approval_stages` (see
 * /admin/expense-approval-stages). Today that's two stages (Category Head,
 * MDM); an admin can insert a third stage between or after them at any time
 * with no code change — everything here and in
 * expenseChangeRequestController resolves the chain from this table rather
 * than hardcoding stage count or names.
 */

import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

/** Sentinel `tableKey` meaning "every expense table". */
export const ALL_TABLES = '*';

/** The fixed requester role — not an approval stage, so it's a constant
 * rather than a row in expense_approval_stages. */
export const REQUESTER_LEVEL = 'SUB_DIVISION';

const GRANT_CACHE_TTL_MS = 60 * 1000;
const STAGE_CACHE_TTL_MS = 60 * 1000;

/**
 * Roles that could always browse the Expense Data tables read-only, from
 * before access became per-email. Kept so nobody lost their read view when
 * grants were introduced — grants are what gate *changing* anything.
 */
const VIEW_ROLES = new Set(['ADMIN', 'CREATOR', 'APPROVER', 'CATEGORY_HEAD', 'PD']);

/** Roles that automatically get requester rights (raise add/edit/delete) on
 * every expense table — the first layer of the workflow, role-based rather
 * than a per-email grant. See the module doc comment above. */
const ROLE_BASED_REQUESTERS = new Set(['CREATOR', 'APPROVER', 'CATEGORY_HEAD']);

/** Approval-stage key -> the UserRole that automatically holds it, no grant
 * needed — the second layer onward. ADMIN is deliberately not listed here:
 * it bypasses the whole chain unconditionally (see the isAdmin branch in
 * getExpenseAccess), which already makes ADMIN equivalent to holding every
 * stage, MDM included. A stage key not listed here has no role to bind to
 * and relies entirely on `expense_access_grants`. */
const ROLE_BASED_APPROVAL_STAGES: Record<string, string> = {
  CATEGORY_HEAD: 'CATEGORY_HEAD',
};

export type ExpenseApprovalStage = {
  id: number;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type ExpenseAccessGrantRow = {
  id: number;
  email: string;
  level: string;
  tableKey: string;
  subDivision: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isActive: boolean;
};

export type ExpenseAccess = {
  isAdmin: boolean;
  /** May open the Expense Data tables read-only — a historic view role, or any grant. */
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Stage keys this user may approve, for the table asked about. Empty for a
   * pure requester or for a plain view-role user with no grant. ADMIN gets
   * every currently-active stage key (it bypasses the chain either way, but
   * the UI reads this list to decide what to show). */
  approvableStageKeys: string[];
  /** Levels held for the table asked about — REQUESTER_LEVEL and/or stage
   * keys. Empty for a pure ADMIN bypass. */
  levels: string[];
  /** Sub-divisions this person is registered as editing for, if any. */
  subDivisions: string[];
};

type AuthLikeUser = { email: string; role: string };

const grantCache = new Map<string, { grants: ExpenseAccessGrantRow[]; expiresAt: number }>();
let stageCache: { stages: ExpenseApprovalStage[]; expiresAt: number } | null = null;

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}

/** Called after any grant mutation so a revoked right takes effect at once. */
export function invalidateExpenseAccessCache(email?: string): void {
  if (email) {
    grantCache.delete(normalizeEmail(email));
    return;
  }
  grantCache.clear();
}

/** Called after any stage mutation (add/edit/reorder/retire). */
export function invalidateExpenseStageCache(): void {
  stageCache = null;
}

/** Active grants held by one email, cached briefly. */
export async function getGrantsForEmail(email: string): Promise<ExpenseAccessGrantRow[]> {
  const key = normalizeEmail(email);
  if (!key) return [];

  const cached = grantCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.grants;

  const grants = (await withPrismaRetry(() =>
    prisma.expenseAccessGrant.findMany({
      where: { email: { equals: key, mode: 'insensitive' }, isActive: true },
      select: {
        id: true,
        email: true,
        level: true,
        tableKey: true,
        subDivision: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        isActive: true,
      },
    })
  )) as ExpenseAccessGrantRow[];

  grantCache.set(key, { grants, expiresAt: Date.now() + GRANT_CACHE_TTL_MS });
  return grants;
}

/** All approval stages (active and retired), ordered by sortOrder. Retired
 * stages are kept so a historical request's `approvalTrail` — and any admin
 * screen listing them — can still resolve their key to a label. */
export async function getAllApprovalStages(): Promise<ExpenseApprovalStage[]> {
  return withPrismaRetry(() =>
    prisma.expenseApprovalStage.findMany({ orderBy: { sortOrder: 'asc' } })
  );
}

/** Just the active chain, in walk order — cached briefly since it's read on
 * every change-request action. */
export async function getActiveApprovalStages(): Promise<ExpenseApprovalStage[]> {
  if (stageCache && stageCache.expiresAt > Date.now()) return stageCache.stages;

  const stages = await withPrismaRetry(() =>
    prisma.expenseApprovalStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
  );
  stageCache = { stages, expiresAt: Date.now() + STAGE_CACHE_TTL_MS };
  return stages;
}

/** The stage a brand-new request should start at — the first rung of the
 * active chain. Null if no stages are configured (creation must be refused). */
export async function getFirstApprovalStage(): Promise<ExpenseApprovalStage | null> {
  const stages = await getActiveApprovalStages();
  return stages[0] ?? null;
}

/** The next active stage after `stageKey`, or null if `stageKey` is the last
 * one — meaning an approval there applies the change for real. */
export async function getNextApprovalStage(stageKey: string): Promise<ExpenseApprovalStage | null> {
  const stages = await getActiveApprovalStages();
  const idx = stages.findIndex((s) => s.key === stageKey);
  if (idx === -1) return null; // stageKey was retired mid-flight — treated as terminal, see controller
  return stages[idx + 1] ?? null;
}

/** True when approving at `stageKey` would apply the change (i.e. it's the
 * last rung of the currently active chain). */
export async function isFinalApprovalStage(stageKey: string): Promise<boolean> {
  return (await getNextApprovalStage(stageKey)) === null;
}

/**
 * Resolves what `user` may do on `tableKey` (omit it to ask "on any table",
 * which is what the change-request list page needs).
 */
export async function getExpenseAccess(user: AuthLikeUser, tableKey?: string): Promise<ExpenseAccess> {
  const isAdmin = String(user.role) === 'ADMIN';
  if (isAdmin) {
    const stages = await getActiveApprovalStages();
    return {
      isAdmin: true,
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      approvableStageKeys: stages.map((s) => s.key),
      levels: [],
      subDivisions: [],
    };
  }

  const all = await getGrantsForEmail(user.email);
  const relevant = tableKey
    ? all.filter((g) => g.tableKey === ALL_TABLES || g.tableKey === tableKey)
    : all;

  const editor = relevant.filter((g) => g.level === REQUESTER_LEVEL);
  const approverLevels = new Set(relevant.filter((g) => g.level !== REQUESTER_LEVEL).map((g) => g.level));

  // Second layer onward: fold in whichever stages this role is bound to
  // (e.g. CATEGORY_HEAD role -> the "CATEGORY_HEAD" stage), regardless of
  // `tableKey` — role-based rights are deliberately global, same as the
  // requester layer, so there is nothing per-table to configure for them.
  for (const [stageKey, requiredRole] of Object.entries(ROLE_BASED_APPROVAL_STAGES)) {
    if (String(user.role) === requiredRole) approverLevels.add(stageKey);
  }

  // First layer: CREATOR/APPROVER/CATEGORY_HEAD get requester rights on every
  // table simply by holding that role — no grant needed. A REQUESTER_LEVEL
  // grant still works on top of this (e.g. to hand requester rights to
  // someone with a different role, or to restrict to one table), so the two
  // are unioned rather than one replacing the other.
  const roleIsRequester = ROLE_BASED_REQUESTERS.has(String(user.role));

  return {
    isAdmin: false,
    canView: VIEW_ROLES.has(String(user.role)) || relevant.length > 0,
    canCreate: roleIsRequester || editor.some((g) => g.canCreate),
    canUpdate: roleIsRequester || editor.some((g) => g.canUpdate),
    canDelete: roleIsRequester || editor.some((g) => g.canDelete),
    approvableStageKeys: [...approverLevels],
    levels: [...new Set([...(roleIsRequester ? [REQUESTER_LEVEL] : []), ...relevant.map((g) => g.level), ...approverLevels])],
    subDivisions: [...new Set(editor.map((g) => g.subDivision).filter((s): s is string => !!s))],
  };
}

/** Whether `user` may act at `stageKey` on `tableKey` — ADMIN always can. */
export async function canApproveStage(user: AuthLikeUser, tableKey: string, stageKey: string): Promise<boolean> {
  if (String(user.role) === 'ADMIN') return true;
  const access = await getExpenseAccess(user, tableKey);
  return access.approvableStageKeys.includes(stageKey);
}
