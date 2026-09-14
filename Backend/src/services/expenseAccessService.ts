/**
 * Access control for the Expense Data change workflow, and the approval
 * CHAIN it walks.
 *
 * MOST tables (National Grid, Major Category Grid, ...) walk the '*'
 * default, 2-stage chain:
 *
 *   requester            ->  CATEGORY_HEAD stage  ->  MDM stage  ->  applied
 *   (CREATOR/APPROVER/       (the Category Head        (whoever's    to the
 *    CATEGORY_HEAD role,      whose OWN Business         own          master
 *    raises add/edit/         Division matches           Business     row, and
 *    delete + reason          the REQUESTER's)            Division    so SAP)
 *    + wanted-by date)                                    is MDM)
 *
 * Segment Master and Size Master instead each have their OWN dedicated
 * chain (an extra rung, Planning, between Category Head and MDM):
 *
 *   requester -> CATEGORY_HEAD stage -> PLANNING stage -> MDM stage -> applied
 *
 * Which chain a table walks is resolved by `getActiveApprovalStages`/
 * `getFirstApprovalStage`/`getNextApprovalStage` from `expense_approval_
 * stages`' own `tableKey` column — a table with any row of its own uses
 * ONLY those, everything else falls through to '*'. See that model's doc
 * comment in schema.prisma. Whichever chain applies, routing itself is by
 * BUSINESS DIVISION (User.businessDivision — MENS/KIDS/LADIES/PD/MDM, see
 * UsersManagement), captured onto the request once at creation
 * (`requesterBusinessDivision`) and never changed afterward:
 *
 *   - The REQUESTER layer (first layer) rides on `UserRole` — anyone with
 *     role CREATOR, APPROVER or CATEGORY_HEAD can raise a request on any
 *     table, no grant needed (`ROLE_BASED_REQUESTERS` below). PLANNING is
 *     an approval-only role — it does not get requester rights.
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
 *   - The PLANNING stage (Segment Master / Size Master only) is scoped to
 *     role PLANNING alone — company-wide, no business-division match
 *     required (unlike Category Head). Not yet assigned to any real user;
 *     assigning it is exactly the `role: PLANNING` mapping this exists for.
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
 *   - A stage with no role/division to bind to (an extra stage an admin adds
 *     to any chain) falls back entirely to `expense_access_grants` (see
 *     /admin/expense-access) — specific email addresses ADMIN maintains.
 *     Grants also still work as an ADDITIONAL override on top of the rules
 *     above (e.g. temporary cover for someone on leave), they just aren't
 *     the primary mechanism.
 *
 * The STAGES themselves — how many there are, their order, their labels, and
 * now which table (or '*' for every table without its own) they belong to —
 * live in `expense_approval_stages`. Everything here and in
 * expenseChangeRequestController resolves each chain from that table rather
 * than hardcoding stage count or names, so a table can be given its own
 * dedicated chain (or an existing one lengthened) with no further code
 * change. (An extra stage's business-division routing, if it needs one, is
 * not yet automatic — see BUSINESS_DIVISION_BASED_APPROVAL_STAGES below.)
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
const VIEW_ROLES = new Set(['ADMIN', 'CREATOR', 'APPROVER', 'CATEGORY_HEAD', 'PD', 'PLANNING']);

/** Roles that automatically get requester rights (raise add/edit/delete) on
 * every expense table — the first layer of the workflow, role-based rather
 * than a per-email grant. See the module doc comment above. */
const ROLE_BASED_REQUESTERS = new Set(['CREATOR', 'APPROVER', 'CATEGORY_HEAD']);

/** Roles confined to a fixed subset of expense tables — everything about
 * `getExpenseAccess`/`canView` for any OTHER table is denied outright for
 * them, regardless of VIEW_ROLES membership. PLANNING only ever approves
 * Segment Master / Size Master requests (the only tables with a PLANNING
 * stage at all), so that's also all they may even browse — the masters
 * list and the Change Requests list both filter down to just these two. A
 * role not listed here has no such restriction. */
const ROLE_TABLE_RESTRICTIONS: Record<string, string[]> = {
  PLANNING: ['segment-master', 'size-master'],
};

/** Approval-stage key -> the UserRole that automatically holds it, no grant
 * needed. Coarse/request-agnostic: it says "this role holds the stage for
 * SOME division" (CATEGORY_HEAD) or "at all" (PLANNING), not which
 * division — the actual per-request check is `canActOnExpenseRequestStage`'s
 * job (CATEGORY_HEAD there additionally requires a division match; PLANNING
 * does not — it's a company-wide stage, not scoped to one Business
 * Division, see Segment Master / Size Master's dedicated chain). A stage key
 * not listed here has no role to bind to and relies on businessDivision
 * (below) or `expense_access_grants`. */
const ROLE_BASED_APPROVAL_STAGES: Record<string, string> = {
  CATEGORY_HEAD: 'CATEGORY_HEAD',
  PLANNING: 'PLANNING',
};

/** Approval-stage key -> the User.businessDivision value that automatically
 * holds it, no grant needed and independent of role — the MDM stage isn't
 * "ADMIN approves", it's "whoever is tagged businessDivision MDM approves",
 * see the module doc comment. */
const BUSINESS_DIVISION_BASED_APPROVAL_STAGES: Record<string, string> = {
  MDM: 'MDM',
};

/** The stage key `role` automatically holds, role-based (Category Head,
 * Planning) — or null if this role isn't bound to any stage this way. Used
 * by the delete-request "skip a stage you'd only be approving yourself"
 * logic in expenseChangeRequestController, so it doesn't need its own copy
 * of this mapping. Deliberately excludes the business-division-based MDM
 * binding — that one has no role attached, see `BUSINESS_DIVISION_BASED_
 * APPROVAL_STAGES` above and the caller's own MDM check. */
export function roleBoundApprovalStageKey(role: string): string | null {
  return ROLE_BASED_APPROVAL_STAGES[role] ?? null;
}

/** Which expense tables `role` is confined to, or null for no restriction.
 * See ROLE_TABLE_RESTRICTIONS' doc comment — used by the Change Requests
 * list so a restricted role's "sees every request" tier is scoped to just
 * its own tables. */
export function roleTableRestriction(role: string): string[] | null {
  return ROLE_TABLE_RESTRICTIONS[role] ?? null;
}

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
  /** This user's own User.businessDivision (MENS/KIDS/LADIES/PD/MDM), or
   * null if unset. Exposed so the caller (e.g. the frontend, before it ever
   * reaches the server-enforced check) can tell whether a CATEGORY_HEAD
   * stage request is actually theirs to act on. */
  businessDivision: string | null;
  /** Which expense tables this role may even browse, or null for no
   * restriction (every table `canView` would otherwise allow). PLANNING is
   * confined to `['segment-master', 'size-master']` — the frontend's
   * masters list and Change Requests view both filter down to just these;
   * the server enforces the same thing per-table via `canView` itself, this
   * is only so the UI doesn't have to ask table-by-table to know what to
   * hide. */
  allowedTableKeys: string[] | null;
};

type AuthLikeUser = { email: string; role: string; businessDivision?: string | null };

const grantCache = new Map<string, { grants: ExpenseAccessGrantRow[]; expiresAt: number }>();
/** Keyed by tableKey — each table's resolved chain (its own rows, or the
 * '*' default it fell back to) is cached separately. */
const stageCache = new Map<string, { stages: ExpenseApprovalStage[]; expiresAt: number }>();

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
  stageCache.clear();
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

/** All approval stages (active and retired) across every table's chain, in
 * no particular per-table grouping beyond sortOrder — used only to resolve a
 * stage KEY to its label for display (a request's own `tableKey` is already
 * known wherever this matters, and every chain that reuses a key like
 * 'CATEGORY_HEAD' or 'MDM' gives it the same label), never to walk a chain.
 * Retired stages are kept so a historical request's `approvalTrail` can
 * still resolve its label. */
export async function getAllApprovalStages(): Promise<ExpenseApprovalStage[]> {
  return withPrismaRetry(() =>
    prisma.expenseApprovalStage.findMany({ orderBy: { sortOrder: 'asc' } })
  );
}

/**
 * The active chain for `tableKey`, in walk order — cached briefly per table
 * since it's read on every change-request action. A table with any row of
 * its own (segment-master, size-master: Category Head -> Planning -> MDM)
 * uses ONLY those; everything else falls through to the '*' default
 * (Category Head -> MDM) — see ExpenseApprovalStage.tableKey's doc comment.
 */
export async function getActiveApprovalStages(tableKey: string): Promise<ExpenseApprovalStage[]> {
  const cached = stageCache.get(tableKey);
  if (cached && cached.expiresAt > Date.now()) return cached.stages;

  const own = await withPrismaRetry(() =>
    prisma.expenseApprovalStage.findMany({ where: { tableKey, isActive: true }, orderBy: { sortOrder: 'asc' } })
  );
  const stages =
    own.length > 0
      ? own
      : await withPrismaRetry(() =>
          prisma.expenseApprovalStage.findMany({ where: { tableKey: ALL_TABLES, isActive: true }, orderBy: { sortOrder: 'asc' } })
        );

  stageCache.set(tableKey, { stages, expiresAt: Date.now() + STAGE_CACHE_TTL_MS });
  return stages;
}

/** The stage a brand-new request on `tableKey` should start at — the first
 * rung of its active chain. Null if no stages are configured at all
 * (creation must be refused). */
export async function getFirstApprovalStage(tableKey: string): Promise<ExpenseApprovalStage | null> {
  const stages = await getActiveApprovalStages(tableKey);
  return stages[0] ?? null;
}

/** The next active stage after `stageKey` on `tableKey`'s chain, or null if
 * `stageKey` is the last one — meaning an approval there applies the change
 * for real. */
export async function getNextApprovalStage(stageKey: string, tableKey: string): Promise<ExpenseApprovalStage | null> {
  const stages = await getActiveApprovalStages(tableKey);
  const idx = stages.findIndex((s) => s.key === stageKey);
  if (idx === -1) return null; // stageKey was retired mid-flight — treated as terminal, see controller
  return stages[idx + 1] ?? null;
}

/** True when approving at `stageKey` on `tableKey`'s chain would apply the
 * change (i.e. it's the last rung of the currently active chain). */
export async function isFinalApprovalStage(stageKey: string, tableKey: string): Promise<boolean> {
  return (await getNextApprovalStage(stageKey, tableKey)) === null;
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
  const allowedTableKeys = ROLE_TABLE_RESTRICTIONS[String(user.role)] ?? null;
  // No restriction, or asking "on any table" (no specific one to check) —
  // otherwise, `tableKey` itself must be in the allowed list.
  const tableAllowed = !allowedTableKeys || !tableKey || allowedTableKeys.includes(tableKey);

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
    canView: isAdmin || (tableAllowed && (VIEW_ROLES.has(String(user.role)) || relevant.length > 0)),
    canCreate: isAdmin || roleIsRequester || editor.some((g) => g.canCreate),
    canUpdate: isAdmin || roleIsRequester || editor.some((g) => g.canUpdate),
    canDelete: isAdmin || roleIsRequester || editor.some((g) => g.canDelete),
    approvableStageKeys: [...approverLevels],
    levels: [...new Set([...(roleIsRequester ? [REQUESTER_LEVEL] : []), ...relevant.map((g) => g.level), ...approverLevels])],
    subDivisions: [...new Set(editor.map((g) => g.subDivision).filter((s): s is string => !!s))],
    businessDivision,
    allowedTableKeys,
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
 *   - PLANNING stage (Segment Master / Size Master's dedicated chain only):
 *     role PLANNING — no division match required, unlike Category Head.
 *     Planning is a single company-wide stage, not one person per division.
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

  if (request.currentStageKey === 'PLANNING' && role === 'PLANNING') {
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
