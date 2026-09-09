/**
 * Access control for the Expense Data change workflow, and the approval
 * CHAIN it walks.
 *
 * The chain a change walks through is:
 *
 *   requester            ->  CATEGORY_HEAD stage  ->  MDM stage  ->  applied
 *   (CREATOR/APPROVER/       (the Category Head        (whoever's    to the
 *    CATEGORY_HEAD role,      whose OWN Business         own          master
 *    raises add/edit/         Division matches           Business     row, and
 *    delete + reason          the REQUESTER's)            Division    so SAP)
 *    + wanted-by date)                                    is MDM)
 *
 * Routing is by BUSINESS DIVISION (User.businessDivision — MENS/KIDS/LADIES/
 * PO/MDM, see UsersManagement), captured onto the request once at creation
 * (`requesterBusinessDivision`) and never changed afterward:
 *
 *   - The REQUESTER layer (first layer) rides on `UserRole` — anyone with
 *     role CREATOR, APPROVER or CATEGORY_HEAD can raise a request on any
 *     table, no grant needed (`ROLE_BASED_REQUESTERS` below).
 *   - The CATEGORY_HEAD stage is scoped to ONE Category Head per division —
 *     role CATEGORY_HEAD *and* that person's own businessDivision must equal
 *     the request's `requesterBusinessDivision`. A Mens-division Creator's
 *     request can only be acted on by the Mens-division Category Head, never
 *     a Kids- or Ladies-division one. This division match can only be
 *     evaluated against a SPECIFIC request, so it lives in
 *     `canActOnExpenseRequestStage` below, not in `getExpenseAccess`
 *     (`approvableStageKeys` there is deliberately the coarser, request-
 *     agnostic "holds this stage at all, for some division" signal, used for
 *     UI affordances like tab visibility).
 *   - The MDM (final) stage is scoped to whoever's own businessDivision is
 *     'MDM' — every division's requests converge here, but on EXACTLY those
 *     specific people, not "any ADMIN". Being ADMIN-role no longer implies
 *     final-approval rights by itself; an ADMIN who also happens to be
 *     tagged businessDivision MDM can act on it — because they're MDM, not
 *     because they're ADMIN. ADMIN still bypasses `canView` and the
 *     requester rights (canCreate/Update/Delete) unconditionally, and still
 *     manages grants/stages/the audit log (those routes require the ADMIN
 *     role directly, unrelated to this file) — only the "approve a specific
 *     request" action lost its automatic ADMIN bypass.
 *   - A stage with no role/division to bind to (a 3rd stage an admin adds
 *     beyond Category Head/MDM) falls back entirely to
 *     `expense_access_grants` (see /admin/expense-access) — specific email
 *     addresses ADMIN maintains. Grants also still work as an ADDITIONAL
 *     override on top of the Category-Head/MDM rules above (e.g. temporary
 *     cover for someone on leave), they just aren't the primary mechanism.
 *
 * The STAGES themselves — how many there are, their order, their labels — are
 * admin-managed, in `expense_approval_stages` (see
 * /admin/expense-approval-stages). Today that's two stages (Category Head,
 * MDM); an admin can insert a third stage between or after them at any time
 * with no code change — everything here and in
 * expenseChangeRequestController resolves the chain from this table rather
 * than hardcoding stage count or names. (A third stage's business-division
 * routing, if it needs one, is not yet automatic — see
 * BUSINESS_DIVISION_BASED_APPROVAL_STAGES below.)
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
 * needed. Coarse/request-agnostic: it says "this role holds the stage for
 * SOME division", not which one — the actual per-request division match is
 * `canActOnExpenseRequestStage`'s job. A stage key not listed here has no
 * role to bind to and relies on businessDivision (below) or
 * `expense_access_grants`. */
const ROLE_BASED_APPROVAL_STAGES: Record<string, string> = {
  CATEGORY_HEAD: 'CATEGORY_HEAD',
};

/** Approval-stage key -> the User.businessDivision value that automatically
 * holds it, no grant needed and independent of role — the MDM stage isn't
 * "ADMIN approves", it's "whoever is tagged businessDivision MDM approves",
 * see the module doc comment. */
const BUSINESS_DIVISION_BASED_APPROVAL_STAGES: Record<string, string> = {
  MDM: 'MDM',
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
  /** Stage keys this user holds AT ALL, for the table asked about — coarse
   * and request-agnostic (a Category Head from any division shows
   * 'CATEGORY_HEAD' here). Used for UI affordances (which tabs to show,
   * whether "sees everyone's requests" applies); NOT the real per-request
   * gate — that's `canActOnExpenseRequestStage`, which also checks the
   * requester's business division against this user's own. */
  approvableStageKeys: string[];
  /** Levels held for the table asked about — REQUESTER_LEVEL and/or stage
   * keys. Empty for a pure ADMIN bypass. */
  levels: string[];
  /** Sub-divisions this person is registered as editing for, if any. */
  subDivisions: string[];
  /** This user's own User.businessDivision (MENS/KIDS/LADIES/PO/MDM), or
   * null if unset. Exposed so the caller (e.g. the frontend, before it ever
   * reaches the server-enforced check) can tell whether a CATEGORY_HEAD
   * stage request is actually theirs to act on. */
  businessDivision: string | null;
};

type AuthLikeUser = { email: string; role: string; businessDivision?: string | null };

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
 * which is what the change-request list page needs). ADMIN bypasses
 * canView/canCreate/canUpdate/canDelete unconditionally, but its
 * `approvableStageKeys` are computed the same role/businessDivision way as
 * everyone else's — being ADMIN no longer implies final-approval rights by
 * itself, see the module doc comment.
 */
export async function getExpenseAccess(user: AuthLikeUser, tableKey?: string): Promise<ExpenseAccess> {
  const isAdmin = String(user.role) === 'ADMIN';
  const businessDivision = user.businessDivision ? String(user.businessDivision) : null;

  const all = await getGrantsForEmail(user.email);
  const relevant = tableKey
    ? all.filter((g) => g.tableKey === ALL_TABLES || g.tableKey === tableKey)
    : all;

  const editor = relevant.filter((g) => g.level === REQUESTER_LEVEL);
  const approverLevels = new Set(relevant.filter((g) => g.level !== REQUESTER_LEVEL).map((g) => g.level));

  // Second layer onward: fold in whichever stages this role or business
  // division is bound to (e.g. CATEGORY_HEAD role -> the "CATEGORY_HEAD"
  // stage, businessDivision MDM -> the "MDM" stage), regardless of
  // `tableKey` — these rights are deliberately global, same as the
  // requester layer, so there is nothing per-table to configure for them.
  // Coarse on purpose: this says a Category Head holds the stage for SOME
  // division, not which one — actually acting on one specific request also
  // requires `canActOnExpenseRequestStage`'s division match.
  for (const [stageKey, requiredRole] of Object.entries(ROLE_BASED_APPROVAL_STAGES)) {
    if (String(user.role) === requiredRole) approverLevels.add(stageKey);
  }
  for (const [stageKey, requiredDivision] of Object.entries(BUSINESS_DIVISION_BASED_APPROVAL_STAGES)) {
    if (businessDivision === requiredDivision) approverLevels.add(stageKey);
  }

  // First layer: CREATOR/APPROVER/CATEGORY_HEAD get requester rights on every
  // table simply by holding that role — no grant needed. A REQUESTER_LEVEL
  // grant still works on top of this (e.g. to hand requester rights to
  // someone with a different role, or to restrict to one table), so the two
  // are unioned rather than one replacing the other.
  const roleIsRequester = ROLE_BASED_REQUESTERS.has(String(user.role));

  return {
    isAdmin,
    canView: isAdmin || VIEW_ROLES.has(String(user.role)) || relevant.length > 0,
    canCreate: isAdmin || roleIsRequester || editor.some((g) => g.canCreate),
    canUpdate: isAdmin || roleIsRequester || editor.some((g) => g.canUpdate),
    canDelete: isAdmin || roleIsRequester || editor.some((g) => g.canDelete),
    approvableStageKeys: [...approverLevels],
    levels: [...new Set([...(roleIsRequester ? [REQUESTER_LEVEL] : []), ...relevant.map((g) => g.level), ...approverLevels])],
    subDivisions: [...new Set(editor.map((g) => g.subDivision).filter((s): s is string => !!s))],
    businessDivision,
  };
}

export type ExpenseRequestStageContext = {
  tableKey: string;
  currentStageKey: string;
  /** The REQUESTER's own businessDivision, captured onto the request at
   * creation — see ExpenseChangeRequest.requesterBusinessDivision. */
  requesterBusinessDivision: string | null;
};

/**
 * The PRECISE per-request gate — used by actOnExpenseChangeRequest, the
 * actual security check. Unlike `ExpenseAccess.approvableStageKeys` (a
 * coarse "holds this stage at all, for some request" signal used only for
 * UI affordances), this honours the business-division routing:
 *
 *   - CATEGORY_HEAD stage: role CATEGORY_HEAD AND `user`'s own
 *     businessDivision equals `request.requesterBusinessDivision` — a
 *     Category Head only acts on their own division's requests.
 *   - MDM stage: `user`'s own businessDivision is 'MDM'. Division-agnostic
 *     on the request side (every division converges here), but exclusive to
 *     specifically-tagged people — NOT a blanket ADMIN-role bypass.
 *   - Anything else: an explicit `expense_access_grants` row for this exact
 *     stage + table (or '*') — the manual-override mechanism, which also
 *     still works as an ADDITION on top of the two rules above (e.g.
 *     temporary cover for someone on leave).
 *
 * ADMIN holds no automatic bypass here — see the module doc comment.
 */
export async function canActOnExpenseRequestStage(
  user: AuthLikeUser,
  request: ExpenseRequestStageContext
): Promise<boolean> {
  const role = String(user.role);
  const businessDivision = user.businessDivision ? String(user.businessDivision) : null;

  if (
    request.currentStageKey === 'CATEGORY_HEAD' &&
    role === 'CATEGORY_HEAD' &&
    businessDivision &&
    businessDivision === request.requesterBusinessDivision
  ) {
    return true;
  }

  if (request.currentStageKey === 'MDM' && businessDivision === 'MDM') {
    return true;
  }

  const grants = await getGrantsForEmail(user.email);
  return grants.some(
    (g) => g.level === request.currentStageKey && (g.tableKey === ALL_TABLES || g.tableKey === request.tableKey)
  );
}
