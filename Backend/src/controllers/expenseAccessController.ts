/**
 * Admin CRUD for the Expense Data workflow's two admin-managed pieces:
 *
 *   - Access grants ("this email is a Sub-Division Editor for this table",
 *     "that email is a Category Head") — expense_access_grants.
 *   - The approval CHAIN itself — expense_approval_stages — an ordered list
 *     an admin can extend at any time (add a stage, reorder it, retire it)
 *     with no code change. Grants reference a stage by its `key`.
 *
 * All the mutating endpoints are mounted under the ADMIN-only /api/admin,
 * so they need no further role check. `getMyExpenseAccess` is the one
 * exception: it is mounted under /api/expense and tells the caller what
 * *they* may do, which is what the frontend uses to decide which buttons to
 * show. It never leaks anyone else's grants.
 */

import { Request, Response } from 'express';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import { EXPENSE_TABLE_REGISTRY } from './adminController';
import {
  ALL_TABLES,
  REQUESTER_LEVEL,
  getAllApprovalStages,
  getExpenseAccess,
  invalidateExpenseAccessCache,
  invalidateExpenseStageCache,
} from '../services/expenseAccessService';

/** Emails are stored and compared lower-cased so a grant can't be dodged by casing. */
function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

// Deliberately permissive — the point is to reject typos like a missing "@",
// not to adjudicate RFC 5322.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type GrantBody = {
  email?: string;
  level?: string;
  tableKey?: string;
  subDivision?: string | null;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  isActive?: boolean;
  note?: string | null;
};

async function validateGrantBody(
  body: GrantBody
): Promise<{ error: string } | { email: string; level: string; tableKey: string }> {
  const email = normalizeEmail(body.email);
  if (!email) return { error: 'An email address is required.' };
  if (!EMAIL_SHAPE.test(email)) return { error: `"${email}" does not look like an email address.` };

  const level = String(body.level ?? '').trim();
  if (!level) return { error: 'A level is required.' };
  if (level !== REQUESTER_LEVEL) {
    // Validated against every stage ever created (active or retired) rather
    // than just the active chain, so an admin editing an older grant that
    // points at a since-retired stage isn't blocked from saving it.
    const stages = await getAllApprovalStages();
    if (!stages.some((s) => s.key === level)) {
      return { error: `Unknown level "${level}". Use "${REQUESTER_LEVEL}" or one of the configured approval stages.` };
    }
  }

  const tableKey = String(body.tableKey ?? ALL_TABLES).trim() || ALL_TABLES;
  if (tableKey !== ALL_TABLES && !EXPENSE_TABLE_REGISTRY[tableKey]) {
    return { error: `Unknown table key: ${tableKey}` };
  }

  return { email, level, tableKey };
}

/** GET /admin/expense-access?email=&level=&tableKey=&includeInactive= */
export async function getExpenseAccessGrants(req: Request, res: Response) {
  const { email, level, tableKey, includeInactive } = req.query as Record<string, string | undefined>;

  const where: Record<string, any> = {};
  if (email) where.email = { contains: normalizeEmail(email), mode: 'insensitive' };
  if (level) where.level = level;
  if (tableKey) where.tableKey = tableKey;
  if (includeInactive !== 'true') where.isActive = true;

  try {
    const rows = await withPrismaRetry(() =>
      prisma.expenseAccessGrant.findMany({
        where,
        orderBy: [{ level: 'asc' }, { email: 'asc' }],
      })
    );
    return res.json({ success: true, data: rows, total: rows.length });
  } catch (error: any) {
    console.error('[ExpenseAccess] list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /admin/expense-access/options — the requester constant, the current
 * approval chain, and the tables a grant can be scoped to. */
export async function getExpenseAccessOptions(_req: Request, res: Response) {
  try {
    const stages = await getAllApprovalStages();
    return res.json({
      success: true,
      data: {
        requesterLevel: REQUESTER_LEVEL,
        stages,
        allTablesKey: ALL_TABLES,
        tables: Object.keys(EXPENSE_TABLE_REGISTRY).map((key) => ({
          key,
          allowCreate: !!EXPENSE_TABLE_REGISTRY[key].allowCreate,
          allowDelete: !!EXPENSE_TABLE_REGISTRY[key].allowDelete,
        })),
      },
    });
  } catch (error: any) {
    console.error('[ExpenseAccess] options error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /admin/expense-access — grant an email one level on one table (or all) */
export async function createExpenseAccessGrant(req: Request, res: Response) {
  const body = req.body as GrantBody;
  const validated = await validateGrantBody(body);
  if ('error' in validated) {
    return res.status(400).json({ success: false, error: validated.error });
  }
  const { email, level, tableKey } = validated;

  try {
    const user = req.user!;
    // Re-granting an existing (email, level, table) reactivates and updates it
    // rather than failing on the unique constraint — that is what an admin
    // re-adding someone they revoked last month actually means.
    const saved = await withPrismaRetry(() =>
      prisma.expenseAccessGrant.upsert({
        where: { email_level_tableKey: { email, level, tableKey } },
        create: {
          email,
          level,
          tableKey,
          subDivision: body.subDivision?.trim() || null,
          canCreate: body.canCreate ?? true,
          canUpdate: body.canUpdate ?? true,
          canDelete: body.canDelete ?? true,
          isActive: body.isActive ?? true,
          note: body.note?.trim() || null,
          grantedById: user.id,
          grantedByName: user.name,
        },
        update: {
          subDivision: body.subDivision?.trim() || null,
          canCreate: body.canCreate ?? true,
          canUpdate: body.canUpdate ?? true,
          canDelete: body.canDelete ?? true,
          isActive: body.isActive ?? true,
          note: body.note?.trim() || null,
          grantedById: user.id,
          grantedByName: user.name,
        },
      })
    );

    invalidateExpenseAccessCache(email);
    return res.status(201).json({ success: true, data: saved });
  } catch (error: any) {
    console.error('[ExpenseAccess] create error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** PUT /admin/expense-access/:id */
export async function updateExpenseAccessGrant(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, error: 'Invalid grant id.' });
  }
  const body = req.body as GrantBody;

  try {
    const existing = await withPrismaRetry(() => prisma.expenseAccessGrant.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Access grant not found.' });

    // Only re-validate the identity fields the caller actually sent.
    const validated = await validateGrantBody({
      email: body.email ?? existing.email,
      level: body.level ?? existing.level,
      tableKey: body.tableKey ?? existing.tableKey,
    });
    if ('error' in validated) {
      return res.status(400).json({ success: false, error: validated.error });
    }

    const user = req.user!;
    const updated = await withPrismaRetry(() =>
      prisma.expenseAccessGrant.update({
        where: { id },
        data: {
          email: validated.email,
          level: validated.level,
          tableKey: validated.tableKey,
          subDivision: body.subDivision === undefined ? existing.subDivision : body.subDivision?.trim() || null,
          canCreate: body.canCreate ?? existing.canCreate,
          canUpdate: body.canUpdate ?? existing.canUpdate,
          canDelete: body.canDelete ?? existing.canDelete,
          isActive: body.isActive ?? existing.isActive,
          note: body.note === undefined ? existing.note : body.note?.trim() || null,
          grantedById: user.id,
          grantedByName: user.name,
        },
      })
    );

    // The email may have been changed, so clear both the old and the new.
    invalidateExpenseAccessCache(existing.email);
    invalidateExpenseAccessCache(validated.email);
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res
        .status(409)
        .json({ success: false, error: 'That email already has this level of access on that table.' });
    }
    console.error(`[ExpenseAccess] update error for "${req.params.id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** DELETE /admin/expense-access/:id — revokes for real (the audit trail of what
 * was approved lives on the change requests themselves, not here). */
export async function deleteExpenseAccessGrant(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, error: 'Invalid grant id.' });
  }

  try {
    const existing = await withPrismaRetry(() => prisma.expenseAccessGrant.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Access grant not found.' });

    await withPrismaRetry(() => prisma.expenseAccessGrant.delete({ where: { id } }));
    invalidateExpenseAccessCache(existing.email);
    return res.json({ success: true, data: { id } });
  } catch (error: any) {
    console.error(`[ExpenseAccess] delete error for "${req.params.id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/my-access?tableKey= — what the CALLER may do, for the UI to
 * decide which buttons to render. Server-side checks are the real gate. */
export async function getMyExpenseAccess(req: Request, res: Response) {
  const { tableKey } = req.query as Record<string, string | undefined>;
  if (tableKey && !EXPENSE_TABLE_REGISTRY[tableKey]) {
    return res.status(404).json({ success: false, error: `Unknown table key: ${tableKey}` });
  }

  try {
    const access = await getExpenseAccess(req.user!, tableKey);
    return res.json({ success: true, data: access });
  } catch (error: any) {
    console.error('[ExpenseAccess] my-access error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════
// APPROVAL STAGES — the editable chain itself
// ═══════════════════════════════════════════════════════

type StageBody = {
  key?: string;
  label?: string;
  description?: string | null;
  /** Insert position: place this stage immediately after the active stage
   * with this key, or at the very start if omitted/null. Only read on
   * create — reordering afterwards goes through the /reorder endpoint. */
  afterKey?: string | null;
  isActive?: boolean;
};

const STAGE_KEY_SHAPE = /^[A-Z][A-Z0-9_]{1,49}$/;

function slugifyStageKey(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

/** GET /admin/expense-approval-stages — the full chain, active and retired, in order. */
export async function getExpenseApprovalStages(_req: Request, res: Response) {
  try {
    const stages = await getAllApprovalStages();
    return res.json({ success: true, data: stages });
  } catch (error: any) {
    console.error('[ExpenseApprovalStage] list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /admin/expense-approval-stages — add a new rung to the chain.
 *
 * This is the extensibility point: a table that today goes Category Head ->
 * MDM can become Category Head -> Regional Head -> MDM by inserting one row
 * here with `afterKey: "CATEGORY_HEAD"` — no code change, and every request
 * created afterwards walks the new three-stage chain automatically. Requests
 * already mid-flight keep walking whatever chain existed when they reached
 * their current stage (see expenseChangeRequestController), so inserting a
 * stage never strands one.
 */
export async function createExpenseApprovalStage(req: Request, res: Response) {
  const body = req.body as StageBody;
  const label = String(body.label ?? '').trim();
  if (!label) {
    return res.status(400).json({ success: false, error: 'A label is required.' });
  }

  let key = String(body.key ?? '').trim().toUpperCase() || slugifyStageKey(label);
  if (!STAGE_KEY_SHAPE.test(key)) {
    return res.status(400).json({
      success: false,
      error: 'The stage key must start with a letter and contain only A-Z, 0-9 and underscore (2-50 characters).',
    });
  }
  if (key === REQUESTER_LEVEL) {
    return res.status(400).json({ success: false, error: `"${REQUESTER_LEVEL}" is reserved for the requester role.` });
  }

  try {
    const existingByKey = await withPrismaRetry(() => prisma.expenseApprovalStage.findUnique({ where: { key } }));
    if (existingByKey) {
      return res.status(409).json({ success: false, error: `A stage with key "${key}" already exists.` });
    }

    // sortOrder is computed to slot the new stage immediately after `afterKey`
    // among ACTIVE stages (retired stages don't count toward chain position).
    // Uses the midpoint between neighbours' sortOrders, renumbering only if
    // two active stages have adjacent integers with no room between them.
    const active = await withPrismaRetry(() =>
      prisma.expenseApprovalStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    );

    const afterKey = body.afterKey?.trim() || null;
    const afterIdx = afterKey ? active.findIndex((s) => s.key === afterKey) : -1;
    if (afterKey && afterIdx === -1) {
      return res.status(400).json({ success: false, error: `Unknown active stage to insert after: "${afterKey}"` });
    }

    const prevOrder = afterIdx === -1 ? null : active[afterIdx].sortOrder;
    const nextOrder = afterIdx === -1 ? (active[0]?.sortOrder ?? null) : (active[afterIdx + 1]?.sortOrder ?? null);

    let sortOrder: number;
    if (prevOrder === null && nextOrder === null) {
      sortOrder = 10; // first stage ever
    } else if (prevOrder === null) {
      sortOrder = nextOrder! - 10; // new first stage
    } else if (nextOrder === null) {
      sortOrder = prevOrder + 10; // new last stage
    } else if (nextOrder - prevOrder > 1) {
      sortOrder = Math.floor((prevOrder + nextOrder) / 2); // fits in the gap
    } else {
      // No integer room left between neighbours — renumber the whole active
      // chain in steps of 10, then insert into the resulting gap.
      await withPrismaRetry(() =>
        prisma.$transaction(
          active.map((s, i) =>
            prisma.expenseApprovalStage.update({ where: { id: s.id }, data: { sortOrder: (i + 1) * 10 } })
          )
        )
      );
      sortOrder = (afterIdx + 1) * 10 + 5;
    }

    const user = req.user!;
    const created = await withPrismaRetry(() =>
      prisma.expenseApprovalStage.create({
        data: {
          key,
          label,
          description: body.description?.trim() || null,
          sortOrder,
          isActive: body.isActive ?? true,
          createdById: user.id,
          createdByName: user.name,
        },
      })
    );

    invalidateExpenseStageCache();
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error('[ExpenseApprovalStage] create error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** PUT /admin/expense-approval-stages/:id — edit label/description, or
 * retire/reactivate a stage. The key and chain position are not editable
 * here (see /reorder) — a stage's key is what old requests' trails and
 * grants reference, so it must never silently change meaning. */
export async function updateExpenseApprovalStage(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, error: 'Invalid stage id.' });
  }
  const body = req.body as StageBody;

  try {
    const existing = await withPrismaRetry(() => prisma.expenseApprovalStage.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Approval stage not found.' });

    if (body.isActive === false && existing.isActive) {
      const stillPending = await withPrismaRetry(() =>
        prisma.expenseChangeRequest.count({ where: { currentStageKey: existing.key, status: 'PENDING' } })
      );
      if (stillPending > 0) {
        return res.status(409).json({
          success: false,
          error: `${stillPending} request(s) are currently waiting at this stage. They must be approved or rejected before it can be retired.`,
        });
      }
    }

    const label = body.label !== undefined ? String(body.label).trim() : existing.label;
    if (!label) return res.status(400).json({ success: false, error: 'The label cannot be empty.' });

    const updated = await withPrismaRetry(() =>
      prisma.expenseApprovalStage.update({
        where: { id },
        data: {
          label,
          description: body.description === undefined ? existing.description : body.description?.trim() || null,
          isActive: body.isActive ?? existing.isActive,
        },
      })
    );

    invalidateExpenseStageCache();
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error(`[ExpenseApprovalStage] update error for "${req.params.id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /admin/expense-approval-stages/reorder — body: { orderedIds: number[] }
 * Renumbers every ACTIVE stage's sortOrder to match the given id order.
 * Retired stages are left where they are (their position no longer matters). */
export async function reorderExpenseApprovalStages(req: Request, res: Response) {
  const { orderedIds } = req.body as { orderedIds?: number[] };
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ success: false, error: 'orderedIds must be a non-empty array of stage ids.' });
  }

  try {
    const active = await withPrismaRetry(() => prisma.expenseApprovalStage.findMany({ where: { isActive: true } }));
    const activeIds = new Set(active.map((s) => s.id));

    const missing = active.filter((s) => !orderedIds.includes(s.id));
    const unknown = orderedIds.filter((id) => !activeIds.has(id));
    if (missing.length > 0 || unknown.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'orderedIds must contain exactly the currently active stages, each exactly once.',
      });
    }

    await withPrismaRetry(() =>
      prisma.$transaction(
        orderedIds.map((id, i) => prisma.expenseApprovalStage.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } }))
      )
    );

    invalidateExpenseStageCache();
    const stages = await getAllApprovalStages();
    return res.json({ success: true, data: stages });
  } catch (error: any) {
    console.error('[ExpenseApprovalStage] reorder error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** DELETE /admin/expense-approval-stages/:id — permanently removes a stage.
 * Only allowed when nothing references it any more (no grants, and no
 * request's trail mentions it) — otherwise retire it instead (PUT isActive:
 * false), which keeps its key resolvable for history. */
export async function deleteExpenseApprovalStage(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, error: 'Invalid stage id.' });
  }

  try {
    const existing = await withPrismaRetry(() => prisma.expenseApprovalStage.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Approval stage not found.' });

    const [grantCount, pendingCount, trailCount] = await withPrismaRetry(() =>
      Promise.all([
        prisma.expenseAccessGrant.count({ where: { level: existing.key } }),
        prisma.expenseChangeRequest.count({ where: { currentStageKey: existing.key } }),
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*)::bigint AS n FROM expense_change_requests
          WHERE approval_trail @> ${JSON.stringify([{ stageKey: existing.key }])}::jsonb
        `,
      ])
    );
    const trailHits = Number(trailCount[0]?.n ?? 0);

    if (grantCount > 0 || pendingCount > 0 || trailHits > 0) {
      return res.status(409).json({
        success: false,
        error:
          `Can't delete "${existing.label}" — it still has ${grantCount} access grant(s), ` +
          `${pendingCount} request(s) currently waiting on it, and appears in ${trailHits} request(s)' history. ` +
          `Retire it instead (turn it off) to keep that history readable.`,
      });
    }

    await withPrismaRetry(() => prisma.expenseApprovalStage.delete({ where: { id } }));
    invalidateExpenseStageCache();
    return res.json({ success: true, data: { id } });
  } catch (error: any) {
    console.error(`[ExpenseApprovalStage] delete error for "${req.params.id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
