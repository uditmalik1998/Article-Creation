/**
 * Read side of the Expense Data audit log — see
 * services/expenseAuditLogService.ts for what writes it and why. Admin-only:
 * this is the durable record of every request raised, every stage action,
 * and every real write to a master table, across every user and table —
 * broader than any one person's "My Requests" view, so it's kept alongside
 * the other admin-only audit surfaces (Modification Logs).
 */

import { Request, Response } from 'express';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import { getActiveApprovalStages, getAllApprovalStages } from '../services/expenseAccessService';
import { CONTRIBUTION_CHAIN_KEY } from '../services/gridContributionService';

/** GET /admin/expense-audit-log?requestId=&tableKey=&rowId=&eventType=&operation=&actorEmail=&dateFrom=&dateTo=&search=&page=&limit= */
export async function getExpenseAuditLog(req: Request, res: Response) {
  const {
    requestId,
    tableKey,
    rowId,
    eventType,
    operation,
    actorEmail,
    dateFrom,
    dateTo,
    search,
    page,
    limit,
  } = req.query as Record<string, string | undefined>;

  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit ?? '50', 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const andConditions: object[] = [];
  if (requestId) andConditions.push({ requestId });
  if (tableKey) andConditions.push({ tableKey });
  if (rowId) andConditions.push({ rowId });
  if (eventType) andConditions.push({ eventType });
  if (operation) andConditions.push({ operation });
  if (actorEmail) andConditions.push({ actorEmail: { contains: actorEmail, mode: 'insensitive' as const } });

  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }
    andConditions.push({ occurredAt: dateFilter });
  }

  if (search) {
    andConditions.push({
      OR: [
        { rowId: { contains: search, mode: 'insensitive' as const } },
        { actorName: { contains: search, mode: 'insensitive' as const } },
        { actorEmail: { contains: search, mode: 'insensitive' as const } },
        { comment: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  try {
    const [total, rows] = await withPrismaRetry(() =>
      prisma.$transaction([
        prisma.expenseAuditLog.count({ where }),
        prisma.expenseAuditLog.findMany({ where, orderBy: { occurredAt: 'desc' }, skip, take: limitNum }),
      ])
    );
    return res.json({ data: rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error: any) {
    console.error('[ExpenseAuditLog] list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /admin/expense-audit-log/:requestId — every event for one request, oldest first
 * (chronological reading order, unlike the main list which is newest first). */
export async function getExpenseAuditLogForRequest(req: Request, res: Response) {
  const { requestId } = req.params;
  try {
    const rows = await withPrismaRetry(() =>
      prisma.expenseAuditLog.findMany({ where: { requestId }, orderBy: { occurredAt: 'asc' } })
    );
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error(`[ExpenseAuditLog] get-for-request error for "${requestId}":`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /admin/expense-audit-log/requests — the audit log grouped by change
 * request (newest activity first), for the request-card view. Event filters
 * (table, event type, operation, dates, search) pick which requests appear;
 * each returned request carries ALL of its events, its approval chain and the
 * request record (status, changes, reason). `status` narrows by the
 * request's own status; `counts` are per status for the event filters alone.
 */
export async function getExpenseAuditRequests(req: Request, res: Response) {
  const { tableKey, eventType, operation, dateFrom, dateTo, search, status, page, limit } = req.query as Record<string, string | undefined>;
  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20));

  const and: object[] = [];
  if (tableKey) and.push({ tableKey });
  if (eventType) and.push({ eventType });
  if (operation) and.push({ operation });
  if (dateFrom || dateTo) {
    const f: Record<string, Date> = {};
    if (dateFrom) f.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      f.lte = to;
    }
    and.push({ occurredAt: f });
  }
  if (search) {
    and.push({
      OR: [
        { requestId: { contains: search, mode: 'insensitive' as const } },
        { rowId: { contains: search, mode: 'insensitive' as const } },
        { actorName: { contains: search, mode: 'insensitive' as const } },
        { actorEmail: { contains: search, mode: 'insensitive' as const } },
        { comment: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }
  const where = and.length > 0 ? { AND: and } : {};

  try {
    // Every request with a matching event, latest activity first.
    const groups = await withPrismaRetry(() =>
      prisma.expenseAuditLog.groupBy({ by: ['requestId'], where, _max: { occurredAt: true } })
    );
    groups.sort((a, b) => (b._max.occurredAt?.getTime() ?? 0) - (a._max.occurredAt?.getTime() ?? 0));
    const allIds = groups.map((g) => g.requestId);

    const statusRows = allIds.length
      ? await withPrismaRetry(() =>
          prisma.expenseChangeRequest.findMany({ where: { id: { in: allIds } }, select: { id: true, status: true } })
        )
      : [];
    const statusById = new Map(statusRows.map((r) => [r.id, r.status as string]));
    const counts: Record<string, number> = { ALL: allIds.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const id of allIds) {
      const s = statusById.get(id);
      if (s && counts[s] !== undefined) counts[s] += 1;
    }

    const ids = status ? allIds.filter((id) => statusById.get(id) === status) : allIds;
    const total = ids.length;
    const pageIds = ids.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const [events, requests, stages] = await Promise.all([
      pageIds.length
        ? withPrismaRetry(() => prisma.expenseAuditLog.findMany({ where: { requestId: { in: pageIds } }, orderBy: { occurredAt: 'asc' } }))
        : Promise.resolve([]),
      pageIds.length
        ? withPrismaRetry(() => prisma.expenseChangeRequest.findMany({ where: { id: { in: pageIds } } }))
        : Promise.resolve([]),
      getAllApprovalStages(),
    ]);
    const reqById = new Map(requests.map((r) => [r.id, r]));
    const labelByKey = new Map(stages.map((s) => [s.key, s.label]));

    const data = await Promise.all(
      pageIds.map(async (id) => {
        const evs = events.filter((e) => e.requestId === id);
        const r = reqById.get(id);
        const first = evs[0];
        const tKey = r?.tableKey ?? first?.tableKey ?? '';
        const chainKey = r?.requestKind === 'BGT_CONT' || r?.requestKind === 'PD_CONT' ? CONTRIBUTION_CHAIN_KEY : tKey;
        const chain = (await getActiveApprovalStages(chainKey)).map((s) => ({ key: s.key, label: s.label }));
        return {
          requestId: id,
          tableKey: tKey,
          operation: r?.operation ?? first?.operation ?? 'UPDATE',
          rowId: r?.appliedRowId ?? r?.rowId ?? evs.find((e) => e.rowId)?.rowId ?? null,
          rowLabel: r?.rowLabel ?? null,
          status: r?.status ?? null,
          currentStageKey: r?.currentStageKey ?? null,
          currentStageLabel: r?.currentStageKey ? labelByKey.get(r.currentStageKey) ?? r.currentStageKey : null,
          changes: r?.changes ?? null,
          reason: r?.reason ?? null,
          dueDate: r?.dueDate ?? null,
          requestedByName: r?.requestedByName ?? first?.actorName ?? null,
          requestedAt: r?.requestedAt ?? first?.occurredAt ?? null,
          requestKind: r?.requestKind ?? null,
          lastActivityAt: evs[evs.length - 1]?.occurredAt ?? null,
          chain,
          events: evs,
        };
      })
    );

    return res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum), counts });
  } catch (error: any) {
    console.error('[ExpenseAuditLog] requests error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
