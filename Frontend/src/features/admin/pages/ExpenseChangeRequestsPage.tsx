import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, Clock, History, Plus, Search, Undo2, X } from 'lucide-react';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  actOnExpenseChangeRequest,
  getExpenseApprovalStages,
  getExpenseChangeRequests,
  getMyExpenseAccess,
  CONTRIBUTION_KIND_LABEL,
  type AdminUserBusinessDivision,
  type ExpenseApprovalStage,
  type ExpenseChangeOperation,
  type ExpenseChangeRequest,
  type ExpenseChangeStatus,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';
import { BULK_ADD_LAYOUT } from '../config/expenseSections';

const PAGE_SIZE = 50;

function getCurrentUser(): { id: number; role: string; email?: string } | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** The full stage catalog spans every table's chain at once — a same-named
 * key (e.g. 'CATEGORY_HEAD') appears once per chain. This narrows it down
 * to just the one `tableKey` actually walks: its own dedicated rows if it
 * has any, else the shared '*' default every other table falls back to —
 * mirrors the backend's getActiveApprovalStages fallback (see
 * expenseAccessService.ts). */
function chainForTable(stages: ExpenseApprovalStage[], tableKey: string): ExpenseApprovalStage[] {
  const own = stages.filter((s) => s.tableKey === tableKey);
  return own.length > 0 ? own : stages.filter((s) => s.tableKey === '*');
}

/** Contribution % requests walk their own chain (paired approver -> MDM),
 * not their table's — mirrors approvalChainKey in gridContributionService.ts. */
function chainKeyOf(request: ExpenseChangeRequest): string {
  return request.requestKind === 'BGT_CONT' || request.requestKind === 'PD_CONT' ? 'major-category-grid#contribution' : request.tableKey;
}

const CONTRIBUTION_REQUEST_KIND: Record<'BGT_CONT' | 'PD_CONT', 'BGT' | 'PD'> = { BGT_CONT: 'BGT', PD_CONT: 'PD' };

/** Rows of a BULK_ADD request (changes.__bulkRows.new). */
function bulkRowsOf(request: { changes: Record<string, any> | null }): Record<string, any>[] {
  const rows = (request.changes as any)?.__bulkRows?.new;
  return Array.isArray(rows) ? rows : [];
}

/** Shape of the bulk-add editor state kept in DetailDialog. */
interface BulkEdit {
  /** Indexes (into the request's rows) the approver removed. */
  removed: Set<number>;
  /** Rows the approver added. */
  added: Record<string, any>[];
}

const fmtBool = (x: unknown) => (x === true || x === 'true' ? 'Active' : x === false || x === 'false' ? 'Inactive' : String(x ?? '—'));

/** A bulk add, grouped per BULK_ADD_LAYOUT (Major Category Grid:
 * attribute → values; Size Master: one list of sizes). With `edit`, the
 * approver can remove values (× / undo), remove a whole group and add
 * missing values (design option A, 2026-11-24). */
function BulkRowsView({
  request,
  edit,
  onChange,
}: {
  request: ExpenseChangeRequest;
  edit?: BulkEdit;
  onChange?: (next: BulkEdit) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [find, setFind] = useState('');
  const rows = bulkRowsOf(request);
  // BULK_DELETE: chips are rows to delete; "removed" in the edit state means
  // KEPT BACK (not deleted), and nothing can be added.
  const deleting = request.requestKind === 'BULK_DELETE';
  const cols = (EXPENSE_TABLE_CONFIGS[request.tableKey]?.columns ?? []).filter((c) => c.editable !== false && c.dataIndex !== 'id');
  const layout = BULK_ADD_LAYOUT[request.tableKey];
  const keyCol = layout?.key ?? cols[0]?.dataIndex;
  const groupCol = layout ? layout.group : cols[1]?.dataIndex;
  const valueCol = layout?.value ?? cols[2]?.dataIndex;
  const keyTitle = cols.find((c) => c.dataIndex === keyCol)?.title ?? 'Major Category';
  const singleTitle = cols.find((c) => c.dataIndex === valueCol)?.title ?? 'Values';
  const keys = [...new Set(rows.map((r) => String(r[keyCol ?? ''] ?? '')))];
  const groupOf = (r: Record<string, any>) => (groupCol ? String(r[groupCol] ?? '') : singleTitle);
  const label = (r: Record<string, any>) => {
    const detail = layout?.detail ? ` (${layout.detail.map((d) => fmtBool(r[d])).join('–')})` : '';
    return `${String(r[valueCol ?? ''] ?? '')}${detail}`;
  };

  // group → original row indexes, plus added rows per group.
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(i);
  });
  const addedByGroup = new Map<string, number[]>();
  (edit?.added ?? []).forEach((r, i) => {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    if (!addedByGroup.has(g)) addedByGroup.set(g, []);
    addedByGroup.get(g)!.push(i);
  });

  const q = find.trim().toLowerCase();
  const visible = [...groups.entries()].filter(([g, idxs]) => !q || g.toLowerCase().includes(q) || idxs.some((i) => label(rows[i]).toLowerCase().includes(q)));
  const removedCount = edit?.removed.size ?? 0;
  const addedCount = edit?.added.length ?? 0;
  const total = rows.length - removedCount + addedCount;

  const toggle = (i: number) => {
    if (!edit || !onChange) return;
    const removed = new Set(edit.removed);
    if (removed.has(i)) removed.delete(i);
    else removed.add(i);
    onChange({ ...edit, removed });
  };
  const toggleGroup = (idxs: number[]) => {
    if (!edit || !onChange) return;
    const removed = new Set(edit.removed);
    const allOut = idxs.every((i) => removed.has(i));
    for (const i of idxs) {
      if (allOut) removed.delete(i);
      else removed.add(i);
    }
    onChange({ ...edit, removed });
  };
  const addValue = (g: string) => {
    if (!edit || !onChange || !valueCol) return;
    const v = draft.trim().toUpperCase();
    setDraft('');
    setAdding(null);
    if (!v) return;
    const idxs = groups.get(g) ?? [];
    const exists = idxs.some((i) => String(rows[i][valueCol] ?? '').toUpperCase() === v) || (addedByGroup.get(g) ?? []).some((i) => String(edit.added[i][valueCol] ?? '').toUpperCase() === v);
    if (exists) return;
    // New row = a sibling row of the same group with the new value.
    const template = rows[idxs[0]] ?? rows[0] ?? {};
    onChange({ ...edit, added: [...edit.added, { ...template, [valueCol]: v }] });
  };
  const dropAdded = (i: number) => {
    if (!edit || !onChange) return;
    onChange({ ...edit, added: edit.added.filter((_, j) => j !== i) });
  };

  const chipBase = 'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12.5px] font-medium';

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2 text-[13px] dark:bg-slate-800/60">
        <span className="font-semibold">{total} {deleting ? 'rows to delete' : 'new rows'}</span>
        {keyCol && keys.length > 0 && (
          <span className="text-slate-500">
            {keyTitle}: <span className="font-semibold text-slate-800 dark:text-slate-200">{keys.join(', ')}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {groupCol && <span className="text-slate-500">{groups.size} {layout?.groupTitle ?? 'groups'}</span>}
          {edit && groups.size > 6 && (
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find value…"
              aria-label="Find value"
              className="h-7 w-36 rounded-md border border-slate-300 bg-white px-2 text-[12px] outline-none focus:border-slate-700 dark:border-slate-600 dark:bg-slate-900"
            />
          )}
        </span>
      </div>
      <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {visible.map(([g, idxs]) => {
          const out = idxs.filter((i) => edit?.removed.has(i)).length;
          const addIdx = addedByGroup.get(g) ?? [];
          return (
            <div key={g} className="px-3 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">{g}</span>
                <span className="text-[11.5px] text-slate-500">
                  {idxs.length - out + addIdx.length}
                  {out > 0 || addIdx.length > 0 ? ` of ${idxs.length}` : ''}
                </span>
                {edit && idxs.length > 0 && (
                  <button type="button" onClick={() => toggleGroup(idxs)} className="ml-auto text-[11.5px] font-semibold text-slate-500 hover:text-slate-900 hover:underline">
                    {deleting
                      ? idxs.every((i) => edit.removed.has(i)) ? 'Delete all' : 'Keep all'
                      : idxs.every((i) => edit.removed.has(i)) ? 'Keep all' : 'Remove all'}
                  </button>
                )}
              </div>
              {valueCol && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {idxs.map((i) => {
                    const off = !!edit?.removed.has(i);
                    const text = label(rows[i]);
                    if (!edit) {
                      return (
                        <span
                          key={i}
                          className={`${chipBase} ${
                            deleting
                              ? 'border-red-200 bg-red-50 text-red-800 line-through dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                          }`}
                        >
                          {text}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggle(i)}
                        aria-pressed={!off}
                        title={deleting ? (off ? 'Kept — click to delete it too' : 'Will be deleted — click to keep it') : off ? 'Undo — keep this value' : 'Remove this value'}
                        className={`${chipBase} transition ${
                          deleting
                            ? off
                              ? 'border-dashed border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900'
                              : 'border-red-200 bg-red-50 text-red-800 line-through hover:border-red-300 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                            : off
                              ? 'border-dashed border-red-300 bg-red-50 text-red-700 line-through dark:bg-red-500/10 dark:text-red-300'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-800 hover:border-emerald-300 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                        }`}
                      >
                        {text}
                        {off ? <Undo2 className="h-3 w-3 text-slate-500" /> : <X className="h-3 w-3 opacity-50" />}
                      </button>
                    );
                  })}
                  {addIdx.map((i) => (
                    <button
                      key={`a${i}`}
                      type="button"
                      onClick={() => dropAdded(i)}
                      title="Remove this added value"
                      className={`${chipBase} border-blue-200 bg-blue-50 font-semibold text-blue-800 dark:bg-blue-500/10 dark:text-blue-300`}
                    >
                      {label(edit!.added[i])}
                      <span className="rounded bg-blue-100 px-1 text-[10px] font-bold dark:bg-blue-500/20">NEW</span>
                      <X className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                  {edit &&
                    !deleting &&
                    (adding === g ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addValue(g);
                          } else if (e.key === 'Escape') {
                            setAdding(null);
                            setDraft('');
                          }
                        }}
                        onBlur={() => addValue(g)}
                        placeholder="New value, Enter"
                        aria-label={`Add a value to ${g}`}
                        className="h-7 w-36 rounded-md border border-slate-400 bg-white px-2 text-[12.5px] uppercase outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-900/10 dark:bg-slate-900"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(g);
                          setDraft('');
                        }}
                        className={`${chipBase} border-dashed border-slate-300 text-slate-600 hover:border-slate-500 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300`}
                      >
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="p-4 text-center text-[12.5px] text-slate-500">Nothing matches “{find}”.</p>}
      </div>
    </div>
  );
}

const BUSINESS_DIVISION_LABELS: Record<AdminUserBusinessDivision, string> = {
  MENS: 'Mens', KIDS: 'Kids', LADIES: 'Ladies', PD: 'PD', MDM: 'MDM',
};

type TabKey = 'pending-mine' | 'mine' | 'overdue' | 'all';

interface DetailDialogProps {
  request: ExpenseChangeRequest | null;
  stages: ExpenseApprovalStage[];
  onClose: () => void;
  onActed: () => void;
}

/** Mounted fresh per request (see the `key` on its usage below), so all
 * local state — including the edited values — starts clean every time a
 * different request is opened. */
function DetailDialog({ request, stages, onClose, onActed }: DetailDialogProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Rights are per-table, so they are resolved for this request's own table.
  const { data: access } = useQuery({
    queryKey: ['my-expense-access', request?.tableKey],
    queryFn: () => getMyExpenseAccess(request!.tableKey),
    enabled: !!request,
    staleTime: 60_000,
  });

  const config = request ? EXPENSE_TABLE_CONFIGS[request.tableKey] : undefined;
  const columnMeta = (field: string) => config?.columns.find((c) => c.dataIndex === field);

  // `approvableStageKeys` is coarse (a Category Head shows 'CATEGORY_HEAD'
  // regardless of division) — for that stage specifically, also require this
  // user's own Business Division to match the REQUESTER's, mirroring the
  // server's real gate (canActOnExpenseRequestStage). The server enforces
  // this regardless; this just keeps the button from being shown when it
  // would just 403.
  // CONT_APPROVER (contribution %) is narrower still: only the approver the
  // request was routed to, by email.
  const myEmail = (getCurrentUser()?.email ?? '').trim().toLowerCase();
  // ADMIN can act at every stage (2026-11-23) — mirrors the server.
  const canAct =
    !!request &&
    request.status === 'PENDING' &&
    !!request.currentStageKey &&
    (!!access?.isAdmin ||
      (!!access?.approvableStageKeys.includes(request.currentStageKey) &&
        (request.currentStageKey !== 'CATEGORY_HEAD' || access?.businessDivision === request.requesterBusinessDivision) &&
        (request.currentStageKey !== 'CONT_APPROVER' || (request.routedApproverEmail ?? '').toLowerCase() === myEmail)));
  // A deletion has nothing to edit — only a row to remove; a contribution
  // block is approved or rejected as a whole (the server refuses edits).
  const canEditValues = canAct && request?.operation !== 'DELETE' && !request?.requestKind;

  // Seeded once from the proposed values, keyed to string form for the
  // inputs; booleans round-trip through 'true'/'false'.
  const [editedValues, setEditedValues] = useState<Record<string, string>>(() => {
    if (!request) return {};
    const init: Record<string, string> = {};
    for (const [field, diff] of Object.entries(request.changes)) init[field] = diff.new == null ? '' : String(diff.new);
    return init;
  });

  // Bulk add: what the approver removed / added (only used when they can act).
  const [bulkEdit, setBulkEdit] = useState<BulkEdit>({ removed: new Set(), added: [] });

  if (!request) return null;

  const tableTitle = EXPENSE_TABLE_CONFIGS[request.tableKey]?.title ?? request.tableKey;
  const tableStages = chainForTable(stages, chainKeyOf(request));
  const currentStage = tableStages.find((s) => s.key === request.currentStageKey);
  const isLastStage =
    !!currentStage && tableStages.filter((s) => s.isActive).every((s) => s.sortOrder <= currentStage.sortOrder);

  const act = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !comment.trim()) {
      message.warning('A comment is required when rejecting.');
      return;
    }

    let changesOverride: Record<string, any> | undefined;
    if (action === 'APPROVE' && canEditValues) {
      const override: Record<string, any> = {};
      for (const [field, diff] of Object.entries(request.changes)) {
        const col = columnMeta(field);
        const raw = editedValues[field] ?? '';
        const nextValue = col?.type === 'boolean' ? raw === 'true' : raw;
        if (String(diff.new ?? '') !== String(nextValue ?? '')) override[field] = nextValue;
      }
      if (Object.keys(override).length > 0) changesOverride = override;
    }
    // Bulk add edited by the approver: send the whole new row list.
    if (action === 'APPROVE' && canAct && (request.requestKind === 'BULK_ADD' || request.requestKind === 'BULK_DELETE') && (bulkEdit.removed.size > 0 || bulkEdit.added.length > 0)) {
      const kept = bulkRowsOf(request).filter((_, i) => !bulkEdit.removed.has(i));
      const next = [...kept, ...bulkEdit.added];
      if (next.length === 0) {
        message.warning('Every row was removed — reject the request instead.');
        return;
      }
      changesOverride = { __bulkRows: next };
    }

    setSubmitting(true);
    try {
      await actOnExpenseChangeRequest(request.id, action, comment.trim() || undefined, changesOverride);
      message.success(action === 'APPROVE' ? 'Approved.' : 'Rejected.');
      onActed();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // An add has no "current" side and a delete has no "proposed" side, so only
  // an edit earns the three-column before/after layout.
  const isUpdate = request.operation === 'UPDATE';
  const isDelete = request.operation === 'DELETE';
  const isBulk = request.requestKind === 'BULK_ADD' || request.requestKind === 'BULK_DELETE';
  const changeHeading = request.requestKind === 'BULK_DELETE'
    ? canAct
      ? 'Rows to delete · click a value to keep it'
      : 'Rows to delete (approved or rejected together)'
    : isBulk
    ? canAct
      ? 'New rows · remove or add values before approving'
      : 'New rows (approved or rejected together)'
    : request.requestKind
    ? `Proposed ${CONTRIBUTION_KIND_LABEL[CONTRIBUTION_REQUEST_KIND[request.requestKind]]} (by value)`
    : request.operation === 'CREATE' ? 'New row' : isDelete ? 'Row to be deleted' : 'Proposed changes';
  const shortTable = tableTitle.split(' (')[0];
  const changeEntries = Object.entries(request.changes).filter(([f]) => !['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at'].includes(f));

  // Approval path: Requested → this table's active stages → Applied.
  const activeStages = tableStages.filter((s) => s.isActive);
  const rejectedEntry = request.approvalTrail.find((e) => e.action === 'REJECT');
  const path: { label: string; state: 'done' | 'current' | 'rejected' | 'todo'; you?: boolean }[] = [{ label: 'Requested', state: 'done' }];
  for (const s of activeStages) {
    const approved = request.approvalTrail.some((e) => e.action === 'APPROVE' && e.stageKey === s.key);
    const rejected = rejectedEntry?.stageKey === s.key;
    path.push({
      label: s.label,
      state: rejected ? 'rejected' : approved || request.status === 'APPROVED' ? 'done' : request.status === 'PENDING' && request.currentStageKey === s.key ? 'current' : 'todo',
      you: canAct && request.currentStageKey === s.key,
    });
  }
  path.push({ label: 'Applied', state: request.status === 'APPROVED' ? 'done' : 'todo' });

  const sectionLabel = 'mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500';
  const bulkChanges = isBulk && canAct ? bulkEdit.removed.size + bulkEdit.added.length : 0;
  const editedCount = canEditValues
    ? changeEntries.filter(([f, d]) => String(d.new ?? '') !== String(editedValues[f] ?? '')).length
    : bulkChanges;

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="space-y-2 border-b border-slate-200 px-6 pb-4 pt-5 text-left dark:border-slate-700">
          <div className="flex items-center gap-2 pr-8">
            <TypePill request={request} />
            <span className="truncate text-[13px] font-semibold text-slate-600 dark:text-slate-300">{shortTable}</span>
          </div>
          <DialogTitle className="break-words pr-8 text-[17px] font-semibold leading-snug tracking-tight">
            {request.rowLabel || (request.rowId ? `Row ${request.rowId}` : 'New row')}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill request={request} stages={stages} />
            {request.dueDate && (
              <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                Needed by <NeededBy request={request} />
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm">
          {/* Who + why */}
          <div className="flex gap-3 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/50">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[12px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              aria-hidden="true"
            >
              {initialsOf(request.requestedByName)}
            </span>
            <div className="min-w-0">
              <div className="text-[13px]">
                <span className="font-semibold">{request.requestedByName}</span>
                <span className="text-slate-500">
                  {' '}· {request.requesterBusinessDivision ? `${BUSINESS_DIVISION_LABELS[request.requesterBusinessDivision]} division` : 'No division'} ·{' '}
                  {dayjs(request.requestedAt).format('D MMM YYYY, HH:mm')}
                </span>
              </div>
              <div className="truncate text-[11.5px] text-slate-400">{request.requestedByEmail}</div>
              <p className="mt-1.5 break-words text-[14px] text-slate-900 dark:text-slate-100">“{request.reason}”</p>
            </div>
          </div>

          {/* Approval path */}
          <div>
            <div className={sectionLabel}>Approval path</div>
            <ol className="flex flex-wrap items-center gap-y-2" aria-label="Approval path">
              {path.map((p, i) => (
                <li key={`${p.label}-${i}`} className="flex items-center">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-bold ${
                      p.state === 'done'
                        ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                        : p.state === 'current'
                          ? 'border-amber-500 bg-amber-100 text-amber-800'
                          : p.state === 'rejected'
                            ? 'border-red-500 bg-red-100 text-red-700'
                            : 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900'
                    }`}
                  >
                    {p.state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : p.state === 'rejected' ? <X className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span
                    className={`ml-1.5 whitespace-nowrap text-[12px] font-semibold ${
                      p.state === 'todo' ? 'text-slate-400' : p.state === 'rejected' ? 'text-red-700' : p.state === 'current' ? 'text-amber-800' : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {p.label}
                    {p.you ? ' (you)' : ''}
                  </span>
                  {i < path.length - 1 && <span aria-hidden="true" className="mx-2 h-0.5 w-6 rounded bg-slate-200 dark:bg-slate-700" />}
                </li>
              ))}
            </ol>
            {request.routedApproverEmail && (
              <p className="mt-1.5 text-[11.5px] text-slate-500">
                Routed to <span className="font-medium text-slate-700 dark:text-slate-300">{request.routedApproverEmail}</span>, then MDM.
              </p>
            )}
          </div>

          {/* Changes */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{changeHeading}</span>
              {canEditValues && (
                <span className="text-[11.5px] text-slate-500">
                  {editedCount > 0 ? `${editedCount} value${editedCount === 1 ? '' : 's'} adjusted` : 'You can adjust values before approving'}
                </span>
              )}
            </div>
            {isBulk ? <BulkRowsView request={request} edit={canAct ? bulkEdit : undefined} onChange={setBulkEdit} /> : (
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <div
                className={`grid ${isUpdate ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]'} gap-3 bg-slate-50 px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/60`}
              >
                <span>{request.requestKind ? 'Value' : 'Field'}</span>
                {isUpdate && <span>Current</span>}
                <span>{isUpdate ? 'Proposed' : isDelete ? 'Value being removed' : 'Value'}</span>
              </div>
              {changeEntries.map(([field, diff]) => {
                const col = columnMeta(field);
                const adjusted = canEditValues && String(diff.new ?? '') !== String(editedValues[field] ?? '');
                return (
                  <div
                    key={field}
                    className={`grid ${isUpdate ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]'} items-center gap-3 border-t border-slate-100 px-3 py-2 dark:border-slate-800`}
                  >
                    <span className="truncate text-[13px] text-slate-600 dark:text-slate-400" title={field}>{col?.title ?? field}</span>
                    {isUpdate && (
                      <span className="break-all font-mono text-[12.5px] text-red-700 line-through decoration-red-300 dark:text-red-400">{formatValue(diff.old)}</span>
                    )}
                    {canEditValues ? (
                      col?.type === 'boolean' ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={editedValues[field] === 'true'}
                            onCheckedChange={(checked) => setEditedValues((v) => ({ ...v, [field]: checked ? 'true' : 'false' }))}
                          />
                          <span className="text-[12.5px] font-semibold">{editedValues[field] === 'true' ? 'Yes' : 'No'}</span>
                          {adjusted && <span className="text-[11px] font-semibold text-amber-700">adjusted</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Input
                            aria-label={col?.title ?? field}
                            className={`h-8 bg-white font-mono text-[12.5px] focus-visible:border-slate-600 focus-visible:ring-slate-900/10 dark:bg-slate-900 ${adjusted ? 'border-amber-400' : ''}`}
                            value={editedValues[field] ?? ''}
                            onChange={(e) => setEditedValues((v) => ({ ...v, [field]: e.target.value }))}
                          />
                          {adjusted && (
                            <button
                              type="button"
                              onClick={() => setEditedValues((v) => ({ ...v, [field]: diff.new == null ? '' : String(diff.new) }))}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              title={`Back to the requested value: ${formatValue(diff.new)}`}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <span
                        className={`break-all font-mono text-[12.5px] font-semibold ${
                          isDelete ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {formatValue(isDelete ? diff.old : diff.new)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            )}
            {isDelete && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-red-700">
                <AlertTriangle className="h-3 w-3" /> This row is removed from the master once the last stage approves.
              </p>
            )}
          </div>

          {/* History */}
          {(request.approvalTrail.length > 0 || (request.operation === 'CREATE' && request.appliedRowId)) && (
            <div>
              <div className={sectionLabel}>History</div>
              <ul className="space-y-2">
                {request.approvalTrail.map((entry, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        entry.action === 'APPROVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {entry.action === 'APPROVE' ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 text-[12.5px]">
                      <div>
                        <span className="font-semibold">{entry.byName}</span>{' '}
                        <span className="text-slate-500">
                          {entry.action === 'APPROVE' ? 'approved' : 'rejected'} at {entry.stageLabel} · {dayjs(entry.at).format('D MMM YYYY, HH:mm')}
                        </span>
                      </div>
                      {entry.comment && <p className="break-words text-slate-700 dark:text-slate-300">“{entry.comment}”</p>}
                      {entry.editedFields && entry.editedFields.length > 0 && (
                        <p className="text-[11.5px] text-amber-700">
                          Adjusted: {entry.editedFields.map((f) => columnMeta(f)?.title ?? f).join(', ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {request.operation === 'CREATE' && request.appliedRowId && (
                  <li className="text-[12px] text-slate-500">
                    Created as row <span className="font-mono text-slate-800 dark:text-slate-200">{request.appliedRowId}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-slate-700 dark:bg-slate-900/60">
          {canAct ? (
            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
                  Comment <span className="font-normal text-slate-400">(needed to reject)</span>
                </span>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="A note for the requester…"
                  className="resize-none bg-white text-[13px] focus-visible:border-slate-600 focus-visible:ring-slate-900/10 dark:bg-slate-900"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[11.5px] text-slate-500">
                  {isBulk && bulkChanges > 0
                    ? `${bulkRowsOf(request).length} → ${bulkRowsOf(request).length - bulkEdit.removed.size + bulkEdit.added.length} rows · ${request.requestKind === 'BULK_DELETE' ? `${bulkEdit.removed.size} kept back` : `${bulkEdit.removed.size} removed · ${bulkEdit.added.length} added`}. `
                    : ''}
                  {isLastStage ? 'Approving applies this change to the master straight away.' : 'Approving passes it to the next stage.'}
                </span>
                <Button
                  variant="outline"
                  onClick={() => act('REJECT')}
                  disabled={submitting}
                  className="border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button
                  onClick={() => act('APPROVE')}
                  disabled={submitting}
                  className="bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <Check className="h-4 w-4" />
                  {submitting ? 'Submitting…' : isLastStage ? 'Approve & apply' : 'Approve'}
                  {!submitting && editedCount > 0 ? (isBulk ? ` (${editedCount} change${editedCount === 1 ? '' : 's'})` : ` (${editedCount} adjusted)`) : ''}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-slate-500">
                {request.status === 'PENDING' ? 'You can’t act on this stage — it’s waiting for someone else.' : 'This request is closed.'}
              </span>
              <Button variant="outline" onClick={onClose} className="bg-white dark:bg-slate-900">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Option A (picked 2026-11-23) cell helpers — table view only; the detail
 * dialog keeps its own badges above. */
const TYPE_PILL: Record<ExpenseChangeOperation, string> = {
  CREATE: 'border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400',
  UPDATE: 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300',
  DELETE: 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-400',
};
const TYPE_LABEL: Record<ExpenseChangeOperation, string> = { CREATE: 'Add row', UPDATE: 'Edit', DELETE: 'Delete row' };

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function TypePill({ request }: { request: ExpenseChangeRequest }) {
  const isBulk = request.requestKind === 'BULK_ADD';
  if (request.requestKind === 'BULK_DELETE') {
    return <span className="inline-flex shrink-0 whitespace-nowrap rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-red-700 dark:bg-transparent">Bulk delete</span>;
  }
  const label = isBulk
    ? 'Bulk add'
    : request.requestKind
    ? CONTRIBUTION_KIND_LABEL[CONTRIBUTION_REQUEST_KIND[request.requestKind]]
    : TYPE_LABEL[request.operation] ?? 'Edit';
  const cls = isBulk ? 'border-emerald-300 text-emerald-800' : request.requestKind ? 'border-sky-200 text-sky-700' : TYPE_PILL[request.operation] ?? TYPE_PILL.UPDATE;
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-md border bg-white px-2 py-0.5 text-[11.5px] font-semibold dark:bg-transparent ${cls}`}>{label}</span>;
}

/** One changed field shows old → new; more show a count (DELETE: the row removed). */
function ChangeSummary({ request }: { request: ExpenseChangeRequest }) {
  const entries = Object.entries(request.changes ?? {}).filter(([k]) => !['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at'].includes(k));
  const colTitle = (f: string) => EXPENSE_TABLE_CONFIGS[request.tableKey]?.columns.find((c) => c.dataIndex === f)?.title ?? f;
  if (request.requestKind === 'BULK_DELETE') return <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-400">−{bulkRowsOf(request).length} rows</span>;
  if (request.operation === 'DELETE') return <span className="text-[12.5px] text-slate-600 dark:text-slate-400">Removes the row</span>;
  if (request.requestKind === 'BULK_ADD') return <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">+{bulkRowsOf(request).length} rows</span>;
  if (entries.length === 1) {
    const [f, d] = entries[0];
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px]">
        <span className="text-slate-500">{colTitle(f)}:</span>
        {d?.old !== null && d?.old !== undefined && d?.old !== '' && (
          <span className="truncate font-mono text-red-700 line-through dark:text-red-400">{formatValue(d.old)}</span>
        )}
        <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="truncate font-mono font-semibold text-emerald-700 dark:text-emerald-400">{formatValue(d?.new)}</span>
      </span>
    );
  }
  return <span className="text-[12.5px] text-slate-600 dark:text-slate-400">{entries.length} fields</span>;
}

function StatusPill({ request, stages }: { request: ExpenseChangeRequest; stages: ExpenseApprovalStage[] }) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold';
  if (request.status === 'APPROVED')
    return <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`}><Check className="h-3 w-3" strokeWidth={3} />Applied</span>;
  if (request.status === 'REJECTED')
    return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300`}><X className="h-3 w-3" strokeWidth={3} />Rejected</span>;
  const stageLabel =
    chainForTable(stages, chainKeyOf(request)).find((s) => s.key === request.currentStageKey)?.label ?? request.currentStageKey ?? '—';
  return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`}><Clock className="h-3 w-3" />Waiting · {stageLabel}</span>;
}

/** Needed-by date: red "Nd late" when an open request is past it, amber
 * "today / in N days" when it is within 3 days. */
function NeededBy({ request }: { request: ExpenseChangeRequest }) {
  if (!request.dueDate) return <span className="text-sm text-slate-300">—</span>;
  const due = dayjs(request.dueDate).startOf('day');
  const label = due.format('D MMM YYYY');
  if (request.status !== 'PENDING') return <span className="whitespace-nowrap text-[12.5px] text-slate-500">{label}</span>;
  const days = due.diff(dayjs().startOf('day'), 'day');
  if (days < 0)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-red-700 dark:text-red-400" title={label}>
        <AlertTriangle className="h-3 w-3" />{label} · {-days}d late
      </span>
    );
  if (days <= 3)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-amber-800 dark:text-amber-300">
        <CalendarDays className="h-3 w-3" />{label} · {days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}
      </span>
    );
  return <span className="whitespace-nowrap text-[12.5px] text-slate-600 dark:text-slate-400">{label}</span>;
}

export default function ExpenseChangeRequestsPage() {
  const queryClient = useQueryClient();

  const { data: stages = [] } = useQuery({
    queryKey: ['expense-approval-stages'],
    queryFn: () => getExpenseApprovalStages(),
    staleTime: 60_000,
  });

  // Access across all expense tables — decides which tabs are worth showing.
  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['my-expense-access', undefined],
    queryFn: () => getMyExpenseAccess(),
    staleTime: 60_000,
  });

  // Four visibility tiers, matching the server exactly (getExpenseChangeRequests):
  //   1. ADMIN, or anyone tagged Business Division MDM — sees everything,
  //      unrestricted (MDM is the division-agnostic convergence point).
  //   2. A role confined to a fixed subset of tables (PLANNING: Segment
  //      Master / Size Master only) — sees every request, but only for
  //      those tables.
  //   3. A Category Head with a division set — sees only THEIR OWN
  //      division's requests, never another's ("segregated to their
  //      Category Head"). Same 'all' tab, just automatically narrower — the
  //      server does the actual filtering, this only adjusts the tab label
  //      and keeps it from being hidden.
  //   4. Everyone else — sees only requests they themselves raised, so
  //      there is no "all" tab at all for them.
  const canSeeEveryonesRequests = !!access?.isAdmin || access?.businessDivision === 'MDM';
  const restrictedTableLabels = useMemo(
    () => access?.allowedTableKeys?.map((k) => EXPENSE_TABLE_CONFIGS[k]?.title.split(' (')[0] ?? k).join(' & ') ?? '',
    [access?.allowedTableKeys]
  );
  const isTableRestrictedApprover = !canSeeEveryonesRequests && !!access?.allowedTableKeys;
  const canSeeOwnDivisionRequests =
    !canSeeEveryonesRequests &&
    !isTableRestrictedApprover &&
    !!access?.businessDivision &&
    access.approvableStageKeys.includes('CATEGORY_HEAD');
  const canSeeBroaderThanOwnRequests = canSeeEveryonesRequests || isTableRestrictedApprover || canSeeOwnDivisionRequests;

  const availableTabs = useMemo(() => {
    const tabs: { key: TabKey; label: string }[] = [];
    if ((access?.approvableStageKeys.length ?? 0) > 0) tabs.push({ key: 'pending-mine', label: 'Pending my action' });
    if (access?.canCreate || access?.canUpdate || access?.canDelete) tabs.push({ key: 'mine', label: 'My requests' });
    tabs.push({ key: 'overdue', label: 'Overdue' });
    if (canSeeBroaderThanOwnRequests) {
      tabs.push({
        key: 'all',
        label: canSeeEveryonesRequests
          ? 'All requests'
          : isTableRestrictedApprover
          ? `${restrictedTableLabels} requests`
          : `${BUSINESS_DIVISION_LABELS[access!.businessDivision!]} requests`,
      });
    }
    return tabs;
  }, [access, canSeeEveryonesRequests, isTableRestrictedApprover, restrictedTableLabels, canSeeBroaderThanOwnRequests]);

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('__ALL__');
  const [operationFilter, setOperationFilter] = useState<string>('__ALL__');
  const [divisionFilter, setDivisionFilter] = useState<string>('__ALL__');
  const [selected, setSelected] = useState<ExpenseChangeRequest | null>(null);

  const tabParams: Record<TabKey, { status?: ExpenseChangeStatus; mine?: boolean; mineToApprove?: boolean; overdue?: boolean }> = {
    'pending-mine': { status: 'PENDING', mineToApprove: true },
    mine: { mine: true },
    overdue: { overdue: true },
    all: {},
  };

  // Land on the tab the user can actually act on once access is known, without
  // fighting a tab they have since picked themselves. "Overdue" and "All" are
  // always present, so they are never the automatic choice.
  const [defaultedTab, setDefaultedTab] = useState(false);
  if (!defaultedTab && !accessLoading) {
    const actionable = availableTabs.find((t) => t.key !== 'overdue' && t.key !== 'all');
    if (actionable) setActiveTab(actionable.key);
    setDefaultedTab(true);
  }

  const filterParams = {
    search: appliedSearch || undefined,
    tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
    operation: operationFilter === '__ALL__' ? undefined : (operationFilter as ExpenseChangeOperation),
    requesterBusinessDivision: divisionFilter === '__ALL__' ? undefined : (divisionFilter as AdminUserBusinessDivision),
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-change-requests', activeTab, page, appliedSearch, tableFilter, operationFilter, divisionFilter],
    queryFn: () => getExpenseChangeRequests({ page, limit: PAGE_SIZE, ...filterParams, ...tabParams[activeTab] }),
    placeholderData: keepPreviousData,
  });

  // A count per tab (same filters) — one row each, just for `total`.
  const countQueries = useQueries({
    queries: availableTabs.map((t) => ({
      queryKey: ['expense-change-requests', 'count', t.key, appliedSearch, tableFilter, operationFilter, divisionFilter],
      queryFn: () => getExpenseChangeRequests({ page: 1, limit: 1, ...filterParams, ...tabParams[t.key] }),
      staleTime: 30_000,
      enabled: !accessLoading,
    })),
  });
  const tabCount = (key: TabKey) => countQueries[availableTabs.findIndex((t) => t.key === key)]?.data?.total;

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleActed = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] });
    queryClient.invalidateQueries({ queryKey: ['expense-table'] });
  };

  const columns: DataTableColumn<ExpenseChangeRequest>[] = [
    {
      title: 'Request',
      key: 'request',
      width: 300,
      render: (_v, r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TypePill request={r} />
            <span className="truncate text-[13px] font-bold">{(EXPENSE_TABLE_CONFIGS[r.tableKey]?.title ?? r.tableKey).split(' (')[0]}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-slate-500" title={r.rowLabel ?? undefined}>
            {r.rowLabel || (r.rowId ? `row ${r.rowId}` : 'new row')}
          </div>
        </div>
      ),
    },
    { title: 'Change', key: 'changes', width: 210, render: (_v, r) => <ChangeSummary request={r} /> },
    {
      title: 'Requested by',
      key: 'requestedByName',
      width: 220,
      render: (_v, r) => (
        <div className="flex min-w-0 items-center gap-2" title={r.requestedByEmail}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10.5px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {initialsOf(r.requestedByName)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{r.requestedByName}</div>
            <div className="truncate text-[11.5px] text-slate-500">
              {r.requesterBusinessDivision ? BUSINESS_DIVISION_LABELS[r.requesterBusinessDivision] : 'No division'} · {dayjs(r.requestedAt).format('D MMM, HH:mm')}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Reason',
      key: 'reason',
      render: (_v, r) => <span className="line-clamp-1 text-[13px] text-slate-700 dark:text-slate-300" title={r.reason}>{r.reason}</span>,
    },
    { title: 'Status', key: 'status', width: 190, render: (_v, r) => <StatusPill request={r} stages={stages} /> },
    { title: 'Needed by', key: 'dueDate', width: 170, render: (_v, r) => <NeededBy request={r} /> },
    {
      title: '',
      key: 'action',
      width: 44,
      align: 'center',
      render: (_v, r) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-slate-400 hover:text-slate-800"
          onClick={(e) => {
            e.stopPropagation();
            setSelected(r);
          }}
          aria-label="Open request"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const trigger = 'h-9 bg-white text-[13px] dark:bg-slate-900';

  return (
    <div className="min-h-full space-y-4 bg-slate-50 p-6 dark:bg-slate-950">
      <div className="flex items-center justify-between">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        {access?.isAdmin && (
          <Link to="/admin/expense-audit-log" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <History className="h-4 w-4" /> Audit log
          </Link>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">Grid Change Requests</h1>
        <p className="mt-0.5 max-w-4xl text-sm text-muted-foreground">
          {canSeeEveryonesRequests
            ? 'Adds, edits and deletes on Grid Data tables. Each goes to the requester’s division Category Head (Segment Master and Size Master also to Planning), then MDM, before it changes the master.'
            : isTableRestrictedApprover
            ? `Every add, edit and deletion requested on ${restrictedTableLabels}, and where each one stands before it reaches the master.`
            : canSeeOwnDivisionRequests
            ? `Every add, edit and deletion requested by ${BUSINESS_DIVISION_LABELS[access!.businessDivision!]} division, and where each one stands before it reaches the master.`
            : 'Every add, edit and deletion you have requested, and where each one stands in the approval chain before it reaches the master.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Request lists" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {availableTabs.map((t) => {
            const on = activeTab === t.key;
            const count = tabCount(t.key);
            const overdue = t.key === 'overdue';
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setActiveTab(t.key);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition ${
                  on ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900' : 'text-slate-700 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {t.label}
                {count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] font-bold ${
                      on ? 'bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900'
                      : overdue && count > 0 ? 'bg-red-100 text-red-800'
                      : 'bg-white text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search requests</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 bg-white pl-9 text-[13px] focus-visible:border-slate-600 focus-visible:ring-slate-900/10 dark:bg-slate-900"
              placeholder="Search reason, row, requester… (Enter)"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1);
                  setAppliedSearch(draftSearch.trim());
                }
              }}
            />
          </label>
          <Select value={tableFilter} onValueChange={(v) => { setTableFilter(v); setPage(1); }}>
            <SelectTrigger className={`${trigger} w-48`} aria-label="Table">
              <SelectValue placeholder="All tables" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All tables</SelectItem>
              {Object.entries(EXPENSE_TABLE_CONFIGS)
                .filter(([key]) => !access?.allowedTableKeys || access.allowedTableKeys.includes(key))
                .map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    {cfg.title.split(' (')[0]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={operationFilter} onValueChange={(v) => { setOperationFilter(v); setPage(1); }}>
            <SelectTrigger className={`${trigger} w-32`} aria-label="Type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All types</SelectItem>
              <SelectItem value="CREATE">Add row</SelectItem>
              <SelectItem value="UPDATE">Edit</SelectItem>
              <SelectItem value="DELETE">Delete row</SelectItem>
            </SelectContent>
          </Select>
          {canSeeEveryonesRequests && (
            <Select value={divisionFilter} onValueChange={(v) => { setDivisionFilter(v); setPage(1); }}>
              <SelectTrigger className={`${trigger} w-36`} aria-label="Division">
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All divisions</SelectItem>
                {(Object.keys(BUSINESS_DIVISION_LABELS) as AdminUserBusinessDivision[]).map((d) => (
                  <SelectItem key={d} value={d}>
                    {BUSINESS_DIVISION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* White table: the shared DataTable's beige theme tokens are re-pointed
          to white / slate here (same trick as the Expense table page). */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [--color-background:#ffffff] [--color-border:#e2e8f0] [--color-muted:#f1f5f9] [&_thead]:bg-white dark:border-slate-700 dark:bg-slate-900 dark:[--color-background:hsl(220_14%_12%)] dark:[--color-border:hsl(220_10%_22%)] dark:[--color-muted:hsl(220_10%_18%)] dark:[&_thead]:bg-[hsl(220_14%_12%)]">
        {isError ? (
          <div className="py-10 text-center text-sm text-red-600">Failed to load change requests.</div>
        ) : (
          <DataTable
            columns={columns}
            dataSource={rows}
            loading={isLoading}
            rowKey="id"
            size="middle"
            scroll={{ x: 1250 }}
            onRow={(r) => ({ onClick: () => setSelected(r), className: 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' })}
            pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: (p) => setPage(p) }}
            locale={{ emptyText: 'No change requests here.' }}
          />
        )}
      </div>

      <DetailDialog key={selected?.id ?? 'none'} request={selected} stages={stages} onClose={() => setSelected(null)} onActed={handleActed} />
    </div>
  );
}
