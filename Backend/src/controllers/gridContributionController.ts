/**
 * Major Category Grid contribution % — raising Bgt Cont% / Pd Cont% requests.
 *
 * A creator proposes the % for every value of one (major_category,
 * attribute_name) block — on screen, or many blocks at once from the Excel
 * template — and each block becomes ONE expense_change_requests row
 * (requestKind BGT_CONT / PD_CONT) that walks the contribution chain:
 * the creator's paired approver, then MDM, who applies it. Approving and
 * rejecting go through the normal /expense/change-requests/:id/act endpoint.
 *
 * Rules and the creator -> approver pairing live in
 * services/gridContributionService.ts.
 */

import { Request, Response } from 'express';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import { getFirstApprovalStage } from '../services/expenseAccessService';
import { logExpenseAuditEvent } from '../services/expenseAuditLogService';
import {
  CONTRIBUTION_CHAIN_KEY,
  CONTRIBUTION_KIND_META,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_TABLE_KEY,
  buildBlockDiff,
  getActiveContributionAssignments,
  getContributionScope,
  isContributionKind,
  loadBlock,
  resolveMajorCategoryDivision,
  toBlockKey,
  type ContributionKind,
} from '../services/gridContributionService';

const MAX_BULK_ROWS = 200_000;

/** Same rule as the rest of Expense Data: a needed-by date, not in the past. */
function parseDueDate(raw: unknown): { dueDate: Date } | { error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { error: 'A date by which you need this done is required.' };
  }
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) return { error: 'The "needed by" date is not a valid date.' };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (parsed < startOfToday) return { error: 'The "needed by" date cannot be in the past.' };
  return { dueDate: parsed };
}

async function findPendingBlockRequest(kind: ContributionKind, blockKey: string) {
  return withPrismaRetry(() =>
    prisma.expenseChangeRequest.findFirst({
      where: { requestKind: CONTRIBUTION_KIND_META[kind].requestKind, blockKey, status: 'PENDING' },
      select: { id: true, requestedByName: true, requestedByEmail: true, currentStageKey: true },
    })
  );
}

type CreateResult =
  | { ok: true; requestId: string; changedValues: number }
  | { ok: false; status: number; error: string; existingRequestId?: string };

/** One block -> one request. Shared by the single-block form and the bulk upload. */
async function createBlockRequest(
  user: NonNullable<Request['user']>,
  input: {
    kind: ContributionKind;
    majorCategory: string;
    attributeName: string;
    proposed: Record<string, unknown>;
    reason: string;
    dueDate: Date;
  }
): Promise<CreateResult> {
  const { kind, majorCategory, attributeName, proposed, reason, dueDate } = input;
  const meta = CONTRIBUTION_KIND_META[kind];

  const division = await resolveMajorCategoryDivision(majorCategory);
  if (!division) return { ok: false, status: 400, error: `Can't tell which division "${majorCategory}" belongs to.` };

  const scope = await getContributionScope(user.email);
  const assignment = scope.creator.find((c) => c.kind === kind && c.division === division);
  if (!assignment) {
    return { ok: false, status: 403, error: `You are not a ${meta.label} creator for ${division}.` };
  }

  const blockKey = toBlockKey(majorCategory, attributeName);
  const pending = await findPendingBlockRequest(kind, blockKey);
  if (pending) {
    return {
      ok: false,
      status: 409,
      error: `A ${meta.label} request for this block is already pending (raised by ${pending.requestedByName}).`,
      existingRequestId: pending.id,
    };
  }

  const block = await loadBlock(majorCategory, attributeName);
  if (block.length === 0) return { ok: false, status: 404, error: `No grid values for ${majorCategory} / ${attributeName}.` };

  const built = buildBlockDiff(block, kind, proposed);
  if ('error' in built) return { ok: false, status: 400, error: built.error };

  const firstStage = await getFirstApprovalStage(CONTRIBUTION_CHAIN_KEY);
  if (!firstStage) return { ok: false, status: 400, error: 'No approval stages are configured for contribution % yet.' };

  const created = await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const row = await tx.expenseChangeRequest.create({
        data: {
          tableKey: CONTRIBUTION_TABLE_KEY,
          operation: 'UPDATE',
          rowId: null,
          rowLabel: `${majorCategory} · ${attributeName} · ${meta.label}`,
          changes: built.diff,
          reason,
          dueDate,
          currentStageKey: firstStage.key,
          requestedById: user.id,
          requestedByName: user.name,
          requestedByEmail: user.email,
          // The grid block's own division (from the hierarchy), not the
          // requester's profile tag — that's what the business sheet scopes by.
          requesterBusinessDivision: division,
          requestKind: meta.requestKind,
          blockKey,
          routedApproverEmail: assignment.approverEmail,
        },
      });
      await logExpenseAuditEvent(
        {
          requestId: row.id,
          tableKey: CONTRIBUTION_TABLE_KEY,
          rowId: null,
          operation: 'UPDATE',
          eventType: 'REQUESTED',
          stageKey: firstStage.key,
          stageLabel: firstStage.label,
          actorId: user.id,
          actorName: user.name,
          actorEmail: user.email,
          comment: reason,
          details: { requestKind: meta.requestKind, blockKey, changes: built.diff, routedApproverEmail: assignment.approverEmail },
        },
        tx
      );
      return row;
    })
  );

  return { ok: true, requestId: created.id, changedValues: Object.keys(built.diff).length };
}

/** GET /expense/grid-contribution/my-scope */
export async function getMyContributionScope(req: Request, res: Response) {
  try {
    const scope = await getContributionScope(req.user!.email);
    return res.json({ success: true, data: scope });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/grid-contribution/assignments — the full creator/approver list (read-only). */
export async function getContributionAssignments(_req: Request, res: Response) {
  try {
    return res.json({ success: true, data: await getActiveContributionAssignments() });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/grid-contribution/attributes?majorCategory= — attribute names of one major category. */
export async function getContributionAttributes(req: Request, res: Response) {
  const majorCategory = String(req.query.majorCategory ?? '').trim();
  if (!majorCategory) return res.status(400).json({ success: false, error: 'majorCategory is required.' });
  try {
    const rows = await withPrismaRetry(() =>
      prisma.$queryRaw<{ attribute_name: string; n: bigint }[]>`
        SELECT attribute_name, COUNT(*)::bigint AS n
        FROM maj_cat_grid_values
        WHERE major_category = ${majorCategory}
        GROUP BY attribute_name
        ORDER BY attribute_name
      `
    );
    const division = await resolveMajorCategoryDivision(majorCategory);
    return res.json({
      success: true,
      data: { division, attributes: rows.map((r) => ({ attributeName: r.attribute_name, values: Number(r.n) })) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /expense/grid-contribution/block?majorCategory=&attributeName= */
export async function getContributionBlock(req: Request, res: Response) {
  const majorCategory = String(req.query.majorCategory ?? '').trim();
  const attributeName = String(req.query.attributeName ?? '').trim();
  if (!majorCategory || !attributeName) {
    return res.status(400).json({ success: false, error: 'majorCategory and attributeName are required.' });
  }
  try {
    const [rows, division] = await Promise.all([loadBlock(majorCategory, attributeName), resolveMajorCategoryDivision(majorCategory)]);
    const blockKey = toBlockKey(majorCategory, attributeName);
    const pending: Record<string, any> = {};
    for (const kind of CONTRIBUTION_KINDS) pending[kind] = await findPendingBlockRequest(kind, blockKey);
    return res.json({ success: true, data: { majorCategory, attributeName, division, rows, pending } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /expense/grid-contribution/requests
 *  { kind: 'BGT'|'PD', majorCategory, attributeName, values: { <value>: <pct|null> }, reason, dueDate } */
export async function createContributionRequest(req: Request, res: Response) {
  const { kind, majorCategory, attributeName, values, reason, dueDate } = req.body ?? {};
  if (!isContributionKind(kind)) return res.status(400).json({ success: false, error: "kind must be 'BGT' or 'PD'." });
  if (!majorCategory || !attributeName) {
    return res.status(400).json({ success: false, error: 'majorCategory and attributeName are required.' });
  }
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
    return res.status(400).json({ success: false, error: 'No % values were submitted.' });
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) return res.status(400).json({ success: false, error: 'A reason is required.' });
  const due = parseDueDate(dueDate);
  if ('error' in due) return res.status(400).json({ success: false, error: due.error });

  try {
    const result = await createBlockRequest(req.user!, {
      kind,
      majorCategory: String(majorCategory).trim(),
      attributeName: String(attributeName).trim(),
      proposed: values,
      reason: trimmedReason,
      dueDate: due.dueDate,
    });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error, existingRequestId: result.existingRequestId });
    }
    return res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    console.error('[GridContribution] create error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** POST /expense/grid-contribution/bulk-requests
 *  { kind, rows: [{ majorCategory, attributeName, value, pct }], reason, dueDate }
 *  Rows are grouped by block; each block becomes its own request (or is
 *  reported back as skipped with the reason). Blank `pct` rows are ignored. */
export async function createContributionBulkRequests(req: Request, res: Response) {
  const { kind, rows, reason, dueDate } = req.body ?? {};
  if (!isContributionKind(kind)) return res.status(400).json({ success: false, error: "kind must be 'BGT' or 'PD'." });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: 'No rows were submitted.' });
  if (rows.length > MAX_BULK_ROWS) {
    return res.status(400).json({ success: false, error: `At most ${MAX_BULK_ROWS.toLocaleString('en-IN')} rows per upload.` });
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) return res.status(400).json({ success: false, error: 'A reason is required.' });
  const due = parseDueDate(dueDate);
  if ('error' in due) return res.status(400).json({ success: false, error: due.error });

  // Group by block, keeping only rows that carry a % (blank = leave as is).
  const blocks = new Map<string, { majorCategory: string; attributeName: string; proposed: Record<string, unknown> }>();
  for (const r of rows) {
    const mc = String(r?.majorCategory ?? '').trim();
    const attr = String(r?.attributeName ?? '').trim();
    const value = String(r?.value ?? '').trim();
    const pct = r?.pct;
    if (!mc || !attr || !value) continue;
    if (pct === null || pct === undefined || String(pct).trim() === '') continue;
    const key = toBlockKey(mc, attr);
    if (!blocks.has(key)) blocks.set(key, { majorCategory: mc, attributeName: attr, proposed: {} });
    blocks.get(key)!.proposed[value] = pct;
  }
  if (blocks.size === 0) {
    return res.status(400).json({ success: false, error: `No ${CONTRIBUTION_KIND_META[kind].label} values were filled in the file.` });
  }

  const results: { majorCategory: string; attributeName: string; status: 'CREATED' | 'SKIPPED'; requestId?: string; error?: string }[] = [];
  try {
    for (const block of blocks.values()) {
      const result = await createBlockRequest(req.user!, {
        kind,
        majorCategory: block.majorCategory,
        attributeName: block.attributeName,
        proposed: block.proposed,
        reason: trimmedReason,
        dueDate: due.dueDate,
      });
      results.push(
        result.ok
          ? { majorCategory: block.majorCategory, attributeName: block.attributeName, status: 'CREATED', requestId: result.requestId }
          : { majorCategory: block.majorCategory, attributeName: block.attributeName, status: 'SKIPPED', error: result.error }
      );
    }
    const created = results.filter((r) => r.status === 'CREATED').length;
    return res.status(created > 0 ? 201 : 200).json({
      success: true,
      data: { blocks: results.length, created, skipped: results.length - created, results },
    });
  } catch (error: any) {
    console.error('[GridContribution] bulk error:', error);
    return res.status(500).json({ success: false, error: error.message, data: { results } });
  }
}

/** GET /expense/grid-contribution/template?kind=BGT[&majorCategory=A,B]
 *  Every grid row of the caller's own divisions for that kind, current %s
 *  and an empty "New" column to fill. Streamed — Kids alone is ~100k rows. */
export async function downloadContributionTemplate(req: Request, res: Response) {
  const kind = req.query.kind;
  if (!isContributionKind(kind)) return res.status(400).json({ success: false, error: "kind must be 'BGT' or 'PD'." });
  const meta = CONTRIBUTION_KIND_META[kind];
  const onlyCategories = String(req.query.majorCategory ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const scope = await getContributionScope(req.user!.email);
    const divisions = new Set(scope.creator.filter((c) => c.kind === kind).map((c) => c.division));
    if (divisions.size === 0) return res.status(403).json({ success: false, error: `You are not a ${meta.label} creator.` });

    const rows = await withPrismaRetry(() =>
      prisma.$queryRaw<{ major_category: string; attribute_name: string; value: string; bgt: number | null; pd: number | null; auto: number | null }[]>`
        SELECT major_category, attribute_name, value,
               bgt_cont_pct::float8 AS bgt, pd_cont_pct::float8 AS pd, auto_cont_pct::float8 AS auto
        FROM maj_cat_grid_values
        ORDER BY major_category, attribute_name, value
      `
    );

    const ExcelJS = (await import('exceljs')).default;
    const filename = `GRID_${kind}_CONTRIBUTION_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
    const ws = wb.addWorksheet(`${kind}_CONT`);
    ws.columns = [
      { header: 'MAJOR CATEGORY', key: 'mc', width: 22 },
      { header: 'ATTRIBUTE NAME', key: 'attr', width: 24 },
      { header: 'VALUE', key: 'value', width: 26 },
      { header: 'DIVISION', key: 'div', width: 10 },
      { header: 'BGT CONT% (CURRENT)', key: 'bgt', width: 18 },
      { header: 'PD CONT% (CURRENT)', key: 'pd', width: 18 },
      { header: 'AUTO CONT% (CURRENT)', key: 'auto', width: 20 },
      { header: `NEW ${kind} CONT%`, key: 'new', width: 16 },
    ];
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6F42' } };
    header.commit();

    const divisionCache = new Map<string, string | null>();
    for (const r of rows) {
      if (onlyCategories.length > 0 && !onlyCategories.includes(r.major_category)) continue;
      if (!divisionCache.has(r.major_category)) divisionCache.set(r.major_category, await resolveMajorCategoryDivision(r.major_category));
      const div = divisionCache.get(r.major_category);
      if (!div || !divisions.has(div)) continue;
      ws.addRow({
        mc: r.major_category,
        attr: r.attribute_name,
        value: r.value,
        div,
        bgt: r.bgt,
        pd: r.pd,
        auto: r.auto,
        new: null,
      }).commit();
    }
    ws.commit();
    await wb.commit();
    return undefined;
  } catch (error: any) {
    console.error('[GridContribution] template error:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, error: error.message });
    res.end();
    return undefined;
  }
}
