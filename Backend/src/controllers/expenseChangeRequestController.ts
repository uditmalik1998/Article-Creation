/**
 * Expense Data change-request workflow.
 *
 * Creator proposes a field edit + reason -> Approver reviews -> Category Head
 * or PD gives final sign-off, at which point (and only then) the real row's
 * value is applied via `applyExpenseRowUpdate`. One `ExpenseChangeRequest` row
 * is the complete lifecycle + audit trail of a single edit.
 */

import { Request, Response } from 'express';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import {
  EXPENSE_TABLE_REGISTRY,
  fetchExpenseRowById,
  applyExpenseRowUpdate,
  buildExpenseRowLabel,
} from './adminController';

type ReviewAction = 'APPROVE' | 'REJECT';

function isReviewAction(value: any): value is ReviewAction {
  return value === 'APPROVE' || value === 'REJECT';
}

/** POST /admin/expense-table/:tableKey/:rowId/change-requests */
export async function createExpenseChangeRequest(req: Request, res: Response) {
  const { tableKey, rowId } = req.params;
  const config = EXPENSE_TABLE_REGISTRY[tableKey];
  if (!config) {
    return res.status(404).json({ success: false, error: `Unknown table key: ${tableKey}` });
  }

  const { changes, reason } = req.body as { changes?: Record<string, any>; reason?: string };
  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, error: 'A reason for this change is required.' });
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return res.status(400).json({ success: false, error: 'No fields were submitted for change.' });
  }

  const editableKeys = new Set(config.columns.filter((c) => c.editable !== false).map((c) => c.key));
  const invalidKeys = Object.keys(changes).filter((k) => !editableKeys.has(k));
  if (invalidKeys.length > 0) {
    return res.status(400).json({ success: false, error: `These fields are not editable: ${invalidKeys.join(', ')}` });
  }

  try {
    const openExisting = await withPrismaRetry(() =>
      prisma.expenseChangeRequest.findFirst({
        where: { tableKey, rowId, status: { in: ['PENDING_APPROVER', 'PENDING_FINAL'] } },
      })
    );
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
      prisma.expenseChangeRequest.create({
        data: {
          tableKey,
          rowId,
          rowLabel: buildExpenseRowLabel(tableKey, currentRow) ?? null,
          changes: diff,
          reason: reason.trim(),
          requestedById: user.id,
          requestedByName: user.name,
          requestedByEmail: user.email,
        },
      })
    );

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] create error for "${tableKey}"/"${rowId}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /admin/expense-change-requests?tableKey=&status=&mine=&page=&limit=&search=&sortBy=&sortDir= */
export async function getExpenseChangeRequests(req: Request, res: Response) {
  const { tableKey, status, mine, page, limit, search, sortBy, sortDir } = req.query as Record<string, string | undefined>;
  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));
  const skip = (pageNum - 1) * limitNum;
  const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';
  const sortableFields = new Set(['requestedAt', 'updatedAt', 'status', 'tableKey']);
  const sortField = sortBy && sortableFields.has(sortBy) ? sortBy : 'requestedAt';

  const andConditions: object[] = [];
  if (tableKey) andConditions.push({ tableKey });
  if (status) andConditions.push({ status });
  if (mine === 'true' && req.user) andConditions.push({ requestedById: req.user.id });
  if (search) {
    andConditions.push({
      OR: [
        { rowLabel: { contains: search, mode: 'insensitive' as const } },
        { reason: { contains: search, mode: 'insensitive' as const } },
        { requestedByName: { contains: search, mode: 'insensitive' as const } },
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

/** GET /admin/expense-change-requests/:id */
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

/** POST /admin/expense-change-requests/:id/review — Approver stage */
export async function reviewExpenseChangeRequest(req: Request, res: Response) {
  const { id } = req.params;
  const { action, comment } = req.body as { action?: string; comment?: string };

  if (!isReviewAction(action)) {
    return res.status(400).json({ success: false, error: "action must be 'APPROVE' or 'REJECT'." });
  }
  if (action === 'REJECT' && !comment?.trim()) {
    return res.status(400).json({ success: false, error: 'A comment is required when rejecting.' });
  }

  try {
    const existing = await withPrismaRetry(() => prisma.expenseChangeRequest.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Change request not found.' });
    if (existing.status !== 'PENDING_APPROVER') {
      return res.status(409).json({ success: false, error: `This request is no longer pending approver review (current status: ${existing.status}).` });
    }

    const user = req.user!;
    const updated = await withPrismaRetry(() =>
      prisma.expenseChangeRequest.update({
        where: { id },
        data: {
          status: action === 'APPROVE' ? 'PENDING_FINAL' : 'REJECTED',
          approverId: user.id,
          approverName: user.name,
          approverEmail: user.email,
          approverAt: new Date(),
          approverComment: comment?.trim() || null,
          approverAction: action,
        },
      })
    );

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] review error for "${id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /admin/expense-change-requests/:id/finalize — Category Head/PD stage */
export async function finalizeExpenseChangeRequest(req: Request, res: Response) {
  const { id } = req.params;
  const { action, comment } = req.body as { action?: string; comment?: string };

  if (!isReviewAction(action)) {
    return res.status(400).json({ success: false, error: "action must be 'APPROVE' or 'REJECT'." });
  }
  if (action === 'REJECT' && !comment?.trim()) {
    return res.status(400).json({ success: false, error: 'A comment is required when rejecting.' });
  }

  try {
    const existing = await withPrismaRetry(() => prisma.expenseChangeRequest.findUnique({ where: { id } }));
    if (!existing) return res.status(404).json({ success: false, error: 'Change request not found.' });
    if (existing.status !== 'PENDING_FINAL') {
      return res.status(409).json({ success: false, error: `This request is not awaiting final approval (current status: ${existing.status}).` });
    }

    const user = req.user!;

    if (action === 'REJECT') {
      const updated = await withPrismaRetry(() =>
        prisma.expenseChangeRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            finalById: user.id,
            finalByName: user.name,
            finalByEmail: user.email,
            finalAt: new Date(),
            finalComment: comment!.trim(),
            finalAction: 'REJECT',
          },
        })
      );
      return res.json({ success: true, data: updated });
    }

    // APPROVE — re-verify nothing drifted since the request was submitted, then apply.
    const changes = existing.changes as Record<string, { old: any; new: any }>;
    const liveRow = await fetchExpenseRowById(existing.tableKey, existing.rowId);

    const conflictField = liveRow
      ? Object.keys(changes).find((key) => String(liveRow[key] ?? null) !== String(changes[key].old))
      : undefined;

    if (!liveRow || conflictField) {
      const systemComment = !liveRow
        ? 'Row no longer exists — automatically rejected.'
        : `Row changed since this request was submitted (field "${conflictField}") — automatically rejected.`;
      const rejected = await withPrismaRetry(() =>
        prisma.expenseChangeRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            finalById: user.id,
            finalByName: user.name,
            finalByEmail: user.email,
            finalAt: new Date(),
            finalComment: systemComment,
            finalAction: 'REJECT',
          },
        })
      );
      return res.status(409).json({ success: false, error: systemComment, data: rejected });
    }

    const newValues: Record<string, any> = {};
    for (const key of Object.keys(changes)) newValues[key] = changes[key].new;
    await applyExpenseRowUpdate(existing.tableKey, existing.rowId, newValues);

    const approved = await withPrismaRetry(() =>
      prisma.expenseChangeRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          finalById: user.id,
          finalByName: user.name,
          finalByEmail: user.email,
          finalAt: new Date(),
          finalComment: comment?.trim() || null,
          finalAction: 'APPROVE',
        },
      })
    );

    return res.json({ success: true, data: approved });
  } catch (error: any) {
    console.error(`[ExpenseChangeRequest] finalize error for "${id}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
