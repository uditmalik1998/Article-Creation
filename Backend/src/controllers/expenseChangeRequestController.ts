/**
 * Expense Data change-request workflow.
 *
 * A sub-division editor proposes an ADD, EDIT or DELETE together with a reason
 * and the date they need it done by -> the request walks an admin-configured
 * CHAIN of approval stages (today: Category Head, then MDM) -> approving the
 * chain's last stage applies the change to the real master row via
 * `applyExpenseRow{Update,Insert,Delete}`, and so makes it visible to SAP.
 * One `ExpenseChangeRequest` row is the complete lifecycle + audit trail of a
 * single change.
 *
 * The chain itself lives in `expense_approval_stages` (see
 * services/expenseAccessService.ts) and is fully admin-editable — adding a
 * stage there lengthens the chain for every table with no code change here.
 * A request only ever knows "what stage am I at" (`currentStageKey`) and
 * consults the CURRENT active chain to find the next one; the stages it has
 * already passed stay recorded in `approvalTrail` regardless of what happens
 * to the chain afterwards, so a mid-flight stage insertion or retirement
 * never corrupts history.
 *
 * Who may raise and who may sign off is resolved per-request from the
 * caller's role (Creator/Approver/Category Head raise; Category Head/Admin
 * sign off) plus, for anything a role doesn't cover, a per-email grant — see
 * services/expenseAccessService.ts. ADMIN bypasses every check.
 */

import { Request, Response } from 'express';
import { ExpenseChangeOperation } from '../generated/prisma';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import {
  ALL_TABLES,
  getExpenseAccess,
  getFirstApprovalStage,
  getNextApprovalStage,
  getAllApprovalStages,
  getGrantsForEmail,
} from '../services/expenseAccessService';
import { logExpenseAuditEvent, logExpenseAuditEventBestEffort } from '../services/expenseAuditLogService';
import {
  EXPENSE_TABLE_REGISTRY,
  fetchExpenseRowById,
  applyExpenseRowUpdate,
  applyExpenseRowInsert,
  applyExpenseRowDelete,
  buildExpenseRowLabel,
} from './adminController';

type ReviewAction = 'APPROVE' | 'REJECT';

/** One entry of `approvalTrail` — the audit record of a single stage action.
 * Stored as plain JSON, so a chain of any length produces a trail of that
 * many entries rather than needing a fixed column pair per stage. */
type ApprovalTrailEntry = {
  stageKey: string;
  stageLabel: string;
  action: ReviewAction;
  byId: number;
  byName: string;
  byEmail: string;
  at: string;
  comment: string | null;
  /** Field(s) this stage's approver adjusted before passing the request on —
   * present only when they actually changed something. */
  editedFields?: string[];
};

function isReviewAction(value: any): value is ReviewAction {
  return value === 'APPROVE' || value === 'REJECT';
}

/**
 * Every request must carry the date the requester needs the change done by —
 * it is what every stage is shown to prioritise against.
 * Accepts YYYY-MM-DD or a full ISO timestamp; rejects anything unparseable or
 * already in the past (compared by calendar day, so "today" is fine).
 */
function parseDueDate(raw: unknown): { dueDate: Date } | { error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { error: 'A date by which you need this done is required.' };
  }
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'The "needed by" date is not a valid date.' };
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (parsed < startOfToday) {
    return { error: 'The "needed by" date cannot be in the past.' };
  }
  return { dueDate: parsed };
}

function requireReason(reason: unknown): string | null {
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

async function findOpenRequestForRow(tableKey: string, rowId: string) {
  return withPrismaRetry(() =>
    prisma.expenseChangeRequest.findFirst({ where: { tableKey, rowId, status: 'PENDING' } })
  );
}

/** The stage every new request starts at. Creation is refused (400, not a
 * crash) if an admin hasn't configured any active stage yet. */
async function requireFirstStage(): Promise<{ key: string; label: string } | { error: string }> {
  const stage = await getFirstApprovalStage();
  if (!stage) {
    return {
      error:
        'No approval stages are configured for Expense Data changes yet. Ask an admin to add one on Admin → Expense Access Control.',
    };
  }
  return { key: stage.key, label: stage.label };
}

/** POST /expense/table/:tableKey/:rowId/change-requests — propose a field EDIT */
export async function createExpenseChangeRequest(req: Request, res: Response) {
  const { tableKey, rowId } = req.params;
  const config = EXPENSE_TABLE_REGISTRY[tableKey];
  if (!config) {
    return res.status(404).json({ success: false, error: `Unknown table key: ${tableKey}` });
  }

  const { changes, reason, dueDate: rawDueDate } = req.body as {
    changes?: Record<string, any>;
    reason?: string;
    dueDate?: string;
  };

  const trimmedReason = requireReason(reason);
  if (!trimmedReason) {
    return res.status(400).json({ success: false, error: 'A reason for this change is required.' });
  }
  const due = parseDueDate(rawDueDate);
  if ('error' in due) {
    return res.status(400).json({ success: false, error: due.error });
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return res.status(400).json({ success: false, error: 'No fields were submitted for change.' });
  }

  const editableKeys = new Set(config.columns.filter((c) => c.editable !== false).map((c) => c.key));
  const invalidKeys = Object.keys(changes).filter((k) => !editableKeys.has(k));
  if (invalidKeys.length > 0) {
    return res.status(400).json({ success: false, error: `These fields are not editable: ${invalidKeys.join(', ')}` });
  }

  const firstStage = await requireFirstStage();
  if ('error' in firstStage) {
    return res.status(400).json({ success: false, error: firstStage.error });
  }

  try {
    const openExisting = await findOpenRequestForRow(tableKey, rowId);
    if (openExisting) {
      return res.status(409).json({
        success: false,
        error: 'There is already a pending change request for this row.',
        existingRequestId: openExisting.id,
      });
    }

    const currentRow = await fetchExpenseRowById(tableKey, rowId);
    if (!currentRow) {
      return res.status(404).json({ success: false, error: 'Row not found.' });
    }

    const diff: Record<string, { old: any; new: any }> = {};
    for (const key of Object.keys(changes)) {
      const oldValue = currentRow[key] ?? null;
      const newValue = changes[key] ?? null;
      if (String(oldValue) === String(newValue)) continue; // skip no-op edits
      diff[key] = { old: oldValue, new: newValue };
    }
    if (Object.keys(diff).length === 0) {
      return res.status(400).json({ success: false, error: 'No actual changes were made to any field.' });
    }

    const user = req.user!;
    const created = await withPrismaRetry(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.expenseChangeRequest.create({
          data: {
            tableKey,
            operation: 'UPDATE',
            rowId,
            rowLabel: buildExpenseRowLabel(tableKey, currentRow) ?? null,
            changes: diff,
            reason: trimmedReason,
            dueDate: due.dueDate,
            currentStageKey: firstStage.key,
            requestedById: user.id,
            requestedByName: user.name,
            requestedByEmail: user.email,
          },
        });
        await logExpenseAuditEvent(
          {
            requestId: row.id,
            tableKey,
            rowId,
            operation: 'UPDATE',
            eventType: 'REQUESTED',
            stageKey: firstStage.key,
            stageLabel: firstStage.label,
            actorId: user.id,
            actorName: user.name,
            actorEmail: user.email,
            comment: trimmedReason,
            details: { changes: diff },
          },
          tx
        );
        return row;
      })
    );

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] create error for "${tableKey}"/"${rowId}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /expense/table/:tableKey/add-requests — propose a brand-new ROW */
export async function createExpenseAddRequest(req: Request, res: Response) {
  const { tableKey } = req.params;
  const config = EXPENSE_TABLE_REGISTRY[tableKey];
  if (!config) {
    return res.status(404).json({ success: false, error: `Unknown table key: ${tableKey}` });
  }
  if (!config.allowCreate) {
    return res.status(400).json({ success: false, error: 'Adding rows is not supported for this table.' });
  }

  const { values, reason, dueDate: rawDueDate } = req.body as {
    values?: Record<string, any>;
    reason?: string;
    dueDate?: string;
  };

  const trimmedReason = requireReason(reason);
  if (!trimmedReason) {
    return res.status(400).json({ success: false, error: 'A reason for adding this row is required.' });
  }
  const due = parseDueDate(rawDueDate);
  if ('error' in due) {
    return res.status(400).json({ success: false, error: due.error });
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ success: false, error: 'No values were submitted for the new row.' });
  }

  const editableColumns = config.columns.filter((c) => c.editable !== false);
  const editableKeys = new Set(editableColumns.map((c) => c.key));
  const invalidKeys = Object.keys(values).filter((k) => !editableKeys.has(k));
  if (invalidKeys.length > 0) {
    return res
      .status(400)
      .json({ success: false, error: `These fields cannot be set on a new row: ${invalidKeys.join(', ')}` });
  }

  // Drop blanks so the row is created with its own column defaults rather than
  // empty strings, then check whatever the table insists on is still present.
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) continue;
    cleaned[key] = typeof value === 'string' ? value.trim() : value;
  }

  const missing = (config.requiredOnCreate ?? []).filter((k) => cleaned[k] === undefined);
  if (missing.length > 0) {
    const labels = missing.map((k) => editableColumns.find((c) => c.key === k)?.label ?? k);
    return res.status(400).json({ success: false, error: `These fields are required: ${labels.join(', ')}` });
  }
  if (Object.keys(cleaned).length === 0) {
    return res.status(400).json({ success: false, error: 'No values were submitted for the new row.' });
  }

  const firstStage = await requireFirstStage();
  if ('error' in firstStage) {
    return res.status(400).json({ success: false, error: firstStage.error });
  }

  try {
    const user = req.user!;
    // CREATE requests carry no rowId — there is no row until the chain finishes.
    const diff: Record<string, { old: any; new: any }> = {};
    for (const [key, value] of Object.entries(cleaned)) diff[key] = { old: null, new: value };

    const created = await withPrismaRetry(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.expenseChangeRequest.create({
          data: {
            tableKey,
            operation: 'CREATE',
            rowId: null,
            rowLabel: buildExpenseRowLabel(tableKey, cleaned) ?? null,
            changes: diff,
            reason: trimmedReason,
            dueDate: due.dueDate,
            currentStageKey: firstStage.key,
            requestedById: user.id,
            requestedByName: user.name,
            requestedByEmail: user.email,
          },
        });
        await logExpenseAuditEvent(
          {
            requestId: row.id,
            tableKey,
            rowId: null,
            operation: 'CREATE',
            eventType: 'REQUESTED',
            stageKey: firstStage.key,
            stageLabel: firstStage.label,
            actorId: user.id,
            actorName: user.name,
            actorEmail: user.email,
            comment: trimmedReason,
            details: { changes: diff },
          },
          tx
        );
        return row;
      })
    );

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] add-request error for "${tableKey}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /expense/table/:tableKey/:rowId/delete-requests — propose a row DELETION */
export async function createExpenseDeleteRequest(req: Request, res: Response) {
  const { tableKey, rowId } = req.params;
  const config = EXPENSE_TABLE_REGISTRY[tableKey];
  if (!config) {
    return res.status(404).json({ success: false, error: `Unknown table key: ${tableKey}` });
  }
  if (!config.allowDelete) {
    return res.status(400).json({ success: false, error: 'Deleting rows is not supported for this table.' });
  }

  const { reason, dueDate: rawDueDate } = req.body as { reason?: string; dueDate?: string };

  const trimmedReason = requireReason(reason);
  if (!trimmedReason) {
    return res.status(400).json({ success: false, error: 'A reason for deleting this row is required.' });
  }
  const due = parseDueDate(rawDueDate);
  if ('error' in due) {
    return res.status(400).json({ success: false, error: due.error });
  }

  const firstStage = await requireFirstStage();
  if ('error' in firstStage) {
    return res.status(400).json({ success: false, error: firstStage.error });
  }

  try {
    const openExisting = await findOpenRequestForRow(tableKey, rowId);
    if (openExisting) {
      return res.status(409).json({
        success: false,
        error: 'There is already a pending change request for this row.',
        existingRequestId: openExisting.id,
      });
    }

    const currentRow = await fetchExpenseRowById(tableKey, rowId);
    if (!currentRow) {
      return res.status(404).json({ success: false, error: 'Row not found.' });
    }

    // Snapshot every known column, not just the editable ones — once the row is
    // gone this blob is the only record of what it held.
    const diff: Record<string, { old: any; new: any }> = {};
    for (const col of config.columns) diff[col.key] = { old: currentRow[col.key] ?? null, new: null };

    const user = req.user!;
    const created = await withPrismaRetry(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.expenseChangeRequest.create({
          data: {
            tableKey,
            operation: 'DELETE',
            rowId,
            rowLabel: buildExpenseRowLabel(tableKey, currentRow) ?? null,
            changes: diff,
            reason: trimmedReason,
            dueDate: due.dueDate,
            currentStageKey: firstStage.key,
            requestedById: user.id,
            requestedByName: user.name,
            requestedByEmail: user.email,
          },
        });
        await logExpenseAuditEvent(
          {
            requestId: row.id,
            tableKey,
            rowId,
            operation: 'DELETE',
            eventType: 'REQUESTED',
            stageKey: firstStage.key,
            stageLabel: firstStage.label,
            actorId: user.id,
            actorName: user.name,
            actorEmail: user.email,
            comment: trimmedReason,
            // Only the fact that a deletion was requested, not the full
            // column snapshot (already on the request row itself) — keeps
            // this log entry small; the request row is the source of truth
            // for "what exactly was on the row" until it's actually removed.
            details: null,
          },
          tx
        );
        return row;
      })
    );

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] delete-request error for "${tableKey}"/"${rowId}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/change-requests?tableKey=&status=&operation=&stageKey=&mine=&mineToApprove=&overdue=&page=&limit=&search=&sortBy=&sortDir=
 *
 * `mineToApprove=true` lists requests currently sitting at any stage the
 * caller may act on — the dynamic replacement for a fixed "pending my
 * review" tab per stage. ADMIN sees every PENDING request under it.
 */
export async function getExpenseChangeRequests(req: Request, res: Response) {
  const { tableKey, status, operation, stageKey, mine, mineToApprove, overdue, page, limit, search, sortBy, sortDir } =
    req.query as Record<string, string | undefined>;
  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
  const skip = (pageNum - 1) * limitNum;
  const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';
  const sortableFields = new Set(['requestedAt', 'updatedAt', 'status', 'tableKey', 'dueDate']);
  const sortField = sortBy && sortableFields.has(sortBy) ? sortBy : 'requestedAt';

  const andConditions: object[] = [];
  if (tableKey) andConditions.push({ tableKey });
  if (status) andConditions.push({ status });
  if (operation) andConditions.push({ operation });
  if (stageKey) andConditions.push({ currentStageKey: stageKey });

  // A user with no approval-stage grant on ANY table (and who isn't ADMIN)
  // never gets to see anyone else's requests, regardless of what `mine`/
  // `mineToApprove` say — someone who only ever raises requests has no
  // business browsing the audit trail of everyone else's. This is enforced
  // here, not just by hiding the "All Requests" tab client-side.
  const globalAccess = req.user ? await getExpenseAccess(req.user) : null;
  const canSeeEveryonesRequests = String(req.user?.role) === 'ADMIN' || (globalAccess?.approvableStageKeys.length ?? 0) > 0;

  if (!canSeeEveryonesRequests && req.user) {
    andConditions.push({ requestedById: req.user.id });
  } else if (mine === 'true' && req.user) {
    andConditions.push({ requestedById: req.user.id });
  }
  // Still open and already past the date the requester asked for.
  if (overdue === 'true') {
    andConditions.push({ status: 'PENDING' }, { dueDate: { lt: new Date() } });
  }

  if (mineToApprove === 'true' && req.user) {
    if (String(req.user.role) === 'ADMIN') {
      andConditions.push({ status: 'PENDING' });
    } else {
      const all = await getGrantsForEmail(req.user.email);
      const approverGrants = all.filter((g) => g.level !== 'SUB_DIVISION');

      const globalStageKeys = [...new Set(approverGrants.filter((g) => g.tableKey === ALL_TABLES).map((g) => g.level))];
      const perTable = new Map<string, Set<string>>();
      for (const g of approverGrants) {
        if (g.tableKey === ALL_TABLES) continue;
        if (!perTable.has(g.tableKey)) perTable.set(g.tableKey, new Set());
        perTable.get(g.tableKey)!.add(g.level);
      }

      const or: object[] = [];
      if (globalStageKeys.length > 0) or.push({ currentStageKey: { in: globalStageKeys } });
      for (const [t, keys] of perTable) or.push({ tableKey: t, currentStageKey: { in: [...keys] } });

      // No approval grants at all -> a condition that matches nothing, rather
      // than accidentally falling through to "no filter" (which would leak
      // every pending request to a requester-only user).
      andConditions.push({ status: 'PENDING' }, or.length > 0 ? { OR: or } : { id: '__none__' });
    }
  }

  if (search) {
    andConditions.push({
      OR: [
        { rowLabel: { contains: search, mode: 'insensitive' as const } },
        { reason: { contains: search, mode: 'insensitive' as const } },
        { requestedByName: { contains: search, mode: 'insensitive' as const } },
        { requestedByEmail: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }
  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  try {
    const [total, rows] = await withPrismaRetry(() =>
      prisma.$transaction([
        prisma.expenseChangeRequest.count({ where }),
        prisma.expenseChangeRequest.findMany({ where, orderBy: { [sortField]: dir }, skip, take: limitNum }),
      ])
    );
    return res.json({ data: rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error: any) {
    console.error('[ExpenseChangeRequest] list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/change-requests/:id */
export async function getExpenseChangeRequestById(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const row = await withPrismaRetry(() => prisma.expenseChangeRequest.findUnique({ where: { id } }));
    if (!row) return res.status(404).json({ success: false, error: 'Change request not found.' });
    return res.json({ success: true, data: row });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] get error for "${id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /expense/change-requests/:id/act — act at whichever stage the request
 * currently sits at.
 *
 * Replaces the old fixed review (stage 1) / finalize (stage 2) pair: with a
 * chain of admin-configurable length there's no fixed "stage 2 is final" to
 * hang a separate endpoint off. Instead this looks at `currentStageKey`,
 * checks the caller against that specific stage, and on APPROVE either
 * advances to the next active stage or — if there isn't one — applies the
 * change. On REJECT the request always terminates, regardless of which stage
 * rejected it.
 *
 * An approving stage may also adjust the proposed values before passing the
 * request on (`changes` in the body — field -> new value, a subset of the
 * request's own proposed fields). The edit is folded into the request's
 * `changes` immediately, so every later stage — and the final apply — sees
 * the corrected values, and it's the CURRENT stage's edit; a DELETE request
 * has nothing to edit (there is no proposed value, only a row to remove) so
 * an edit there is rejected outright rather than silently ignored.
 */
export async function actOnExpenseChangeRequest(req: Request, res: Response) {
  const { id } = req.params;
  const { action, comment, changes: editedValues } = req.body as {
    action?: string;
    comment?: string;
    changes?: Record<string, any>;
  };

  if (!isReviewAction(action)) {
    return res.status(400).json({ success: false, error: "action must be 'APPROVE' or 'REJECT'." });
  }
  if (action === 'REJECT' && !comment?.trim()) {
    return res.status(400).json({ success: false, error: 'A comment is required when rejecting.' });
  }

  // Captured from inside the try block purely so the catch handler below can
  // still log an APPLY_FAILED event with the right context — a `const`
  // declared inside `try` is out of scope in `catch`. Everything inside the
  // try block itself uses the properly-narrowed locals (`existingRequest`,
  // `actingUser`, `entry`), never these.
  let logContext: { tableKey: string; rowId: string | null; operation: ExpenseChangeOperation; stageKey: string; stageLabel: string; actorId: number; actorName: string; actorEmail: string } | undefined;

  try {
    const existingRequest = await withPrismaRetry(() => prisma.expenseChangeRequest.findUnique({ where: { id } }));
    if (!existingRequest) return res.status(404).json({ success: false, error: 'Change request not found.' });
    if (existingRequest.status !== 'PENDING' || !existingRequest.currentStageKey) {
      return res.status(409).json({
        success: false,
        error: `This request is no longer pending approval (current status: ${existingRequest.status}).`,
      });
    }

    const access = await getExpenseAccess(req.user!, existingRequest.tableKey);
    if (!access.approvableStageKeys.includes(existingRequest.currentStageKey)) {
      const allStages = await getAllApprovalStages();
      const deniedStageLabel = allStages.find((s) => s.key === existingRequest.currentStageKey)?.label ?? existingRequest.currentStageKey;
      return res.status(403).json({
        success: false,
        error: `Only users granted "${deniedStageLabel}" access to this table can act on this request right now.`,
        code: 'NO_EXPENSE_ACCESS',
      });
    }

    // Fold in any edits this stage's approver made to the proposed values.
    // Only on APPROVE — an edit alongside a REJECT would never be seen by
    // anyone, so it's silently ignored rather than erroring.
    let effectiveChanges = existingRequest.changes as Record<string, { old: any; new: any }>;
    let editedFields: string[] | undefined;
    if (action === 'APPROVE' && editedValues && Object.keys(editedValues).length > 0) {
      if (existingRequest.operation === 'DELETE') {
        return res.status(400).json({ success: false, error: "A deletion request has no proposed values to edit — approve or reject it as-is." });
      }
      const config = EXPENSE_TABLE_REGISTRY[existingRequest.tableKey];
      const editableKeys = new Set(config.columns.filter((c) => c.editable !== false).map((c) => c.key));
      const invalidKeys = Object.keys(editedValues).filter((k) => !(k in effectiveChanges) || !editableKeys.has(k));
      if (invalidKeys.length > 0) {
        return res.status(400).json({
          success: false,
          error: `These fields aren't part of this request and can't be edited here: ${invalidKeys.join(', ')}`,
        });
      }

      const merged = { ...effectiveChanges };
      const changed: string[] = [];
      for (const [key, value] of Object.entries(editedValues)) {
        const newValue = value ?? null;
        if (String(merged[key].new ?? '') === String(newValue ?? '')) continue; // no-op edit
        merged[key] = { ...merged[key], new: newValue };
        changed.push(key);
      }
      if (changed.length > 0) {
        effectiveChanges = merged;
        editedFields = changed;
      }
    }

    const allStages = await getAllApprovalStages();
    const currentStage = allStages.find((s) => s.key === existingRequest.currentStageKey);
    const stageLabel = currentStage?.label ?? existingRequest.currentStageKey;

    const actingUser = req.user!;
    const entry: ApprovalTrailEntry = {
      stageKey: existingRequest.currentStageKey,
      stageLabel,
      action,
      byId: actingUser.id,
      byName: actingUser.name,
      byEmail: actingUser.email,
      at: new Date().toISOString(),
      comment: comment?.trim() || null,
      ...(editedFields ? { editedFields } : {}),
    };
    const appendTrail = (extra?: ApprovalTrailEntry) => [
      ...(existingRequest.approvalTrail as unknown as ApprovalTrailEntry[]),
      entry,
      ...(extra ? [extra] : []),
    ];

    // From here on, any thrown error is attributable — the catch handler logs
    // APPLY_FAILED using exactly this context.
    logContext = {
      tableKey: existingRequest.tableKey,
      rowId: existingRequest.rowId,
      operation: existingRequest.operation,
      stageKey: entry.stageKey,
      stageLabel: entry.stageLabel,
      actorId: actingUser.id,
      actorName: actingUser.name,
      actorEmail: actingUser.email,
    };

    if (action === 'REJECT') {
      const updated = await withPrismaRetry(() =>
        prisma.$transaction(async (tx) => {
          const row = await tx.expenseChangeRequest.update({
            where: { id },
            data: { status: 'REJECTED', currentStageKey: null, approvalTrail: appendTrail() },
          });
          await logExpenseAuditEvent(
            {
              requestId: id,
              tableKey: existingRequest.tableKey,
              rowId: existingRequest.rowId,
              operation: existingRequest.operation,
              eventType: 'STAGE_REJECTED',
              stageKey: entry.stageKey,
              stageLabel: entry.stageLabel,
              actorId: actingUser.id,
              actorName: actingUser.name,
              actorEmail: actingUser.email,
              comment: entry.comment,
            },
            tx
          );
          return row;
        })
      );
      return res.json({ success: true, data: updated });
    }

    // APPROVE — advance to the next active stage, or apply if this was the last one.
    const nextStage = await getNextApprovalStage(existingRequest.currentStageKey);

    if (nextStage) {
      const updated = await withPrismaRetry(() =>
        prisma.$transaction(async (tx) => {
          const row = await tx.expenseChangeRequest.update({
            where: { id },
            data: { currentStageKey: nextStage.key, changes: effectiveChanges, approvalTrail: appendTrail() },
          });
          await logExpenseAuditEvent(
            {
              requestId: id,
              tableKey: existingRequest.tableKey,
              rowId: existingRequest.rowId,
              operation: existingRequest.operation,
              eventType: 'STAGE_APPROVED',
              stageKey: entry.stageKey,
              stageLabel: entry.stageLabel,
              actorId: actingUser.id,
              actorName: actingUser.name,
              actorEmail: actingUser.email,
              comment: entry.comment,
              details: editedFields ? { editedFields } : null,
            },
            tx
          );
          return row;
        })
      );
      return res.json({ success: true, data: updated });
    }

    // Last stage of the chain — re-verify nothing drifted since the request
    // was submitted, then apply for real (using this stage's edits, if any).
    // This is the ONLY branch that ever touches the real master row — every
    // branch above only ever updates the request's own bookkeeping — so an
    // APPLIED log entry existing is durable proof Supabase data actually
    // changed at that moment (see the AUTO_REJECTED/APPLY_FAILED events for
    // the two ways this branch can end WITHOUT a master-table write).
    const changes = effectiveChanges;
    const autoReject = async (systemComment: string) => {
      const systemEntry: ApprovalTrailEntry = {
        stageKey: 'SYSTEM',
        stageLabel: 'System',
        action: 'REJECT',
        byId: actingUser.id,
        byName: actingUser.name,
        byEmail: actingUser.email,
        at: new Date().toISOString(),
        comment: systemComment,
      };
      const rejected = await withPrismaRetry(() =>
        prisma.$transaction(async (tx) => {
          const row = await tx.expenseChangeRequest.update({
            where: { id },
            data: { status: 'REJECTED', currentStageKey: null, approvalTrail: appendTrail(systemEntry) },
          });
          await logExpenseAuditEvent(
            {
              requestId: id,
              tableKey: existingRequest.tableKey,
              rowId: existingRequest.rowId,
              operation: existingRequest.operation,
              eventType: 'AUTO_REJECTED',
              stageKey: entry.stageKey,
              stageLabel: entry.stageLabel,
              actorId: actingUser.id,
              actorName: actingUser.name,
              actorEmail: actingUser.email,
              comment: entry.comment,
              details: { reason: systemComment },
            },
            tx
          );
          return row;
        })
      );
      return res.status(409).json({ success: false, error: systemComment, data: rejected });
    };

    if (existingRequest.operation === 'CREATE') {
      const values: Record<string, any> = {};
      for (const key of Object.keys(changes)) values[key] = changes[key].new;

      let newRowId = '';
      const approved = await withPrismaRetry(() =>
        prisma.$transaction(async (tx) => {
          newRowId = await applyExpenseRowInsert(existingRequest.tableKey, values, tx);
          await logExpenseAuditEvent(
            {
              requestId: id,
              tableKey: existingRequest.tableKey,
              rowId: newRowId,
              operation: 'CREATE',
              eventType: 'APPLIED',
              stageKey: entry.stageKey,
              stageLabel: entry.stageLabel,
              actorId: actingUser.id,
              actorName: actingUser.name,
              actorEmail: actingUser.email,
              comment: entry.comment,
              details: { values },
            },
            tx
          );
          return tx.expenseChangeRequest.update({
            where: { id },
            data: {
              status: 'APPROVED',
              currentStageKey: null,
              appliedRowId: newRowId,
              changes: effectiveChanges,
              approvalTrail: appendTrail(),
            },
          });
        })
      );
      return res.json({ success: true, data: approved });
    }

    const liveRow = existingRequest.rowId ? await fetchExpenseRowById(existingRequest.tableKey, existingRequest.rowId) : null;

    if (existingRequest.operation === 'DELETE') {
      // Only existence is re-checked: the snapshot deliberately covers every
      // column (timestamps included), so a field-level drift check here would
      // reject on noise.
      if (!liveRow) return autoReject('Row has already been deleted — nothing left to remove.');
    } else {
      const conflictField = liveRow
        ? Object.keys(changes).find((key) => String(liveRow[key] ?? null) !== String(changes[key].old))
        : undefined;

      if (!liveRow) return autoReject('Row no longer exists — automatically rejected.');
      if (conflictField) {
        return autoReject(
          `Row changed since this request was submitted (field "${conflictField}") — automatically rejected.`
        );
      }
    }

    const approved = await withPrismaRetry(() =>
      prisma.$transaction(async (tx) => {
        let appliedDetails: Record<string, any>;
        if (existingRequest.operation === 'DELETE') {
          await applyExpenseRowDelete(existingRequest.tableKey, existingRequest.rowId!, tx);
          appliedDetails = { deletedSnapshot: changes };
        } else {
          const newValues: Record<string, any> = {};
          for (const key of Object.keys(changes)) newValues[key] = changes[key].new;
          await applyExpenseRowUpdate(existingRequest.tableKey, existingRequest.rowId!, newValues, tx);
          appliedDetails = { values: newValues };
        }
        await logExpenseAuditEvent(
          {
            requestId: id,
            tableKey: existingRequest.tableKey,
            rowId: existingRequest.rowId,
            operation: existingRequest.operation,
            eventType: 'APPLIED',
            stageKey: entry.stageKey,
            stageLabel: entry.stageLabel,
            actorId: actingUser.id,
            actorName: actingUser.name,
            actorEmail: actingUser.email,
            comment: entry.comment,
            details: appliedDetails,
          },
          tx
        );
        return tx.expenseChangeRequest.update({
          where: { id },
          data: { status: 'APPROVED', currentStageKey: null, changes: effectiveChanges, approvalTrail: appendTrail() },
        });
      })
    );

    return res.json({ success: true, data: approved });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] act error for "${id}":`, error);

    // Best-effort, OUTSIDE any transaction (the one that failed has already
    // rolled back, so the master row is untouched — this just records that
    // an apply attempt was made and did not succeed). Only logged once we
    // know enough about the request to attribute it — `logContext` is set
    // right before the first place this function could touch the master
    // table, so an earlier error (validation, access denied, ...) has
    // nothing meaningful to log, same as before this logging existed.
    if (logContext) {
      await logExpenseAuditEventBestEffort({
        requestId: id,
        ...logContext,
        eventType: 'APPLY_FAILED',
        details: { error: error.message },
      });
    }

    // The request is deliberately left exactly where it was — at its current
    // stage — so it can be retried once whatever blocked the write (a unique
    // clash, a FK, the DB being down) is sorted out. A failed apply must
    // never read as an approved change.
    return res.status(500).json({
      success: false,
      error: `Could not process this action: ${error.message}. The request is unchanged — try again.`,
    });
  }
}
