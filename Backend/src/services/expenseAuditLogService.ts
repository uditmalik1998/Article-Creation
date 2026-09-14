/**
 * Write side of the Expense Data audit log (`expense_audit_log`) — the
 * durable, queryable record of the whole lifecycle: a request being raised,
 * every stage's approve/reject (edits included), and the final apply
 * (success or failure). See ExpenseAuditLog's doc comment in schema.prisma
 * for exactly what each event type means.
 *
 * `logExpenseAuditEvent` takes a Prisma client OR an in-flight transaction
 * client, deliberately — the APPLIED event is written in the SAME
 * transaction as the actual write to the master row (see
 * applyExpenseRow{Update,Insert,Delete}'s `client` param in
 * adminController.ts and actOnExpenseChangeRequest in
 * expenseChangeRequestController.ts), so an APPLIED row existing is durable
 * proof the master data actually changed at that moment — never just a
 * log entry with no matching write, and never a write with no log entry.
 */

import { ExpenseAuditEventType, ExpenseChangeOperation, Prisma } from '../generated/prisma';
import { prismaClient as prisma } from '../utils/prisma';

/** Either the top-level client or an in-flight `prisma.$transaction` callback's client. */
export type PrismaOrTx = typeof prisma | Prisma.TransactionClient;

export type ExpenseAuditEventInput = {
  requestId: string;
  tableKey: string;
  rowId?: string | null;
  operation: ExpenseChangeOperation;
  eventType: ExpenseAuditEventType;
  stageKey?: string | null;
  stageLabel?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
  comment?: string | null;
  details?: Record<string, any> | null;
};

/** Writes one audit-log row. Pass a transaction's client (`tx`) to make the
 * log write part of a larger atomic operation; omit it to log standalone
 * (e.g. APPLY_FAILED, logged in the outer catch after a transaction has
 * already rolled back). */
export async function logExpenseAuditEvent(input: ExpenseAuditEventInput, client: PrismaOrTx = prisma): Promise<void> {
  await client.expenseAuditLog.create({
    data: {
      requestId: input.requestId,
      tableKey: input.tableKey,
      rowId: input.rowId ?? null,
      operation: input.operation,
      eventType: input.eventType,
      stageKey: input.stageKey ?? null,
      stageLabel: input.stageLabel ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      actorEmail: input.actorEmail ?? null,
      comment: input.comment ?? null,
      details: input.details ?? Prisma.JsonNull,
    },
  });
}

/** Best-effort logging for paths that run OUTSIDE (or after) a transaction
 * that may itself have failed — a logging failure must never mask the real
 * error the caller is already handling, so this swallows its own errors. */
export async function logExpenseAuditEventBestEffort(input: ExpenseAuditEventInput): Promise<void> {
  try {
    await logExpenseAuditEvent(input);
  } catch (error) {
    console.error('[ExpenseAuditLog] Failed to write audit log entry (swallowed):', error);
  }
}
