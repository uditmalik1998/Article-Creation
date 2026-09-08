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
