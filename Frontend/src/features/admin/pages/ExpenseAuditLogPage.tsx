import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ClipboardList, Clock, Search, X, AlertTriangle } from 'lucide-react';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui-tw';
import {
  getExpenseAuditRequests,
  type ExpenseAuditEventType,
  type ExpenseAuditLogEntry,
  type ExpenseAuditRequest,
  type ExpenseChangeOperation,
  type ExpenseRequestStatus,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';
import { BULK_ADD_LAYOUT } from '../config/expenseSections';

/**
 * Expense Audit Log — one card per change request (design option B, picked
 * 2026-11-23). Each card shows where the request is in its approval chain,
 * every event on it (who, what, when, comment) and the field changes.
 * Only "Applied to master" changes Supabase data; everything else is
 * bookkeeping on the request.
 */

const PAGE_SIZE = 20;

const EVENT_LABEL: Record<ExpenseAuditEventType, string> = {
  REQUESTED: 'requested',
  STAGE_APPROVED: 'approved',
  STAGE_REJECTED: 'rejected',
  APPLIED: 'applied to master',
  APPLY_FAILED: 'apply failed',
  AUTO_REJECTED: 'auto-rejected (data changed meanwhile)',
};

const EVENT_FILTER_LABEL: Record<ExpenseAuditEventType, string> = {
  REQUESTED: 'Requested',
  STAGE_APPROVED: 'Stage approved',
  STAGE_REJECTED: 'Stage rejected',
  APPLIED: 'Applied to master',
  APPLY_FAILED: 'Apply failed',
  AUTO_REJECTED: 'Auto-rejected',
};

const OP_META: Record<ExpenseChangeOperation, { label: string; className: string }> = {
  CREATE: { label: 'Add row', className: 'border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400' },
  UPDATE: { label: 'Edit', className: 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300' },
  DELETE: { label: 'Delete row', className: 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-400' },
};

const tableTitle = (key: string) => (EXPENSE_TABLE_CONFIGS[key]?.title ?? key).split(' (')[0];
const columnTitle = (tableKey: string, field: string) =>
  EXPENSE_TABLE_CONFIGS[tableKey]?.columns.find((c) => c.dataIndex === field)?.title ?? field;

function initials(name: string | null) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Field changes for the card: the request's own record, else what the
 * REQUESTED / APPLIED events captured (older requests, deleted rows). */
function changesOf(r: ExpenseAuditRequest): { field: string; old: string; next: string }[] {
  // Bulk add: one line per group (2nd column) with its value count.
  const bulk = (r.changes as any)?.__bulkRows?.new;
  if ((r.requestKind === 'BULK_ADD' || r.requestKind === 'BULK_DELETE') && Array.isArray(bulk)) {
    const cols = (EXPENSE_TABLE_CONFIGS[r.tableKey]?.columns ?? []).filter((c) => c.editable !== false && c.dataIndex !== 'id');
    const layout = BULK_ADD_LAYOUT[r.tableKey];
    const g = layout ? layout.group ?? layout.value : cols[1]?.dataIndex ?? '';
    if (layout && !layout.group) return [{ field: cols.find((c) => c.dataIndex === layout.value)?.title ?? 'Values', old: '', next: `${bulk.length} values` }];
    const counts = new Map<string, number>();
    for (const row of bulk) counts.set(String(row[g] ?? ''), (counts.get(String(row[g] ?? '')) ?? 0) + 1);
    return [...counts.entries()].map(([field, n]) => ({ field, old: '', next: `${n} value${n === 1 ? '' : 's'}` }));
  }
  let src: Record<string, any> | null = r.changes && Object.keys(r.changes).length ? r.changes : null;
  if (!src) {
    for (const e of r.events) {
      const d = e.details ?? {};
      if (d.changes) { src = d.changes; break; }
      if (d.deletedSnapshot) { src = d.deletedSnapshot; break; }
      if (d.values) {
        src = Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, { old: null, new: v }]));
        break;
      }
    }
  }
  if (!src) return [];
  return Object.entries(src)
    .filter(([field]) => !['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at'].includes(field))
    .map(([field, v]) => {
      const pair = v && typeof v === 'object' && ('old' in v || 'new' in v) ? v : { old: null, new: v };
      return { field, old: fmtVal(pair.old), next: fmtVal(pair.new) };
    });
}

type StepState = 'done' | 'current' | 'rejected' | 'todo';

function stepsOf(r: ExpenseAuditRequest): { label: string; state: StepState }[] {
  const steps: { label: string; state: StepState }[] = [{ label: 'Requested', state: 'done' }];
  const rejectedAt = r.events.find((e) => e.eventType === 'STAGE_REJECTED' || e.eventType === 'AUTO_REJECTED');
  const applied = r.events.some((e) => e.eventType === 'APPLIED');
  for (const s of r.chain) {
    const passed = r.events.some((e) => e.stageKey === s.key && (e.eventType === 'STAGE_APPROVED' || e.eventType === 'APPLIED' || e.eventType === 'APPLY_FAILED'));
    let state: StepState = 'todo';
    if (rejectedAt && rejectedAt.stageKey === s.key) state = 'rejected';
    else if (passed || applied) state = 'done';
    else if (r.status === 'PENDING' && r.currentStageKey === s.key) state = 'current';
    steps.push({ label: s.label, state });
  }
  steps.push({ label: 'Applied', state: applied ? 'done' : r.status === 'REJECTED' ? 'todo' : 'todo' });
  return steps;
}

function StatusBadge({ r }: { r: ExpenseAuditRequest }) {
  const failed = r.events[r.events.length - 1]?.eventType === 'APPLY_FAILED';
  if (r.status === 'APPROVED')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11.5px] font-bold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        <Check className="h-3 w-3" strokeWidth={3} /> Applied
      </span>
    );
  if (r.status === 'REJECTED')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11.5px] font-bold text-red-800 dark:bg-red-500/15 dark:text-red-300">
        <X className="h-3 w-3" strokeWidth={3} /> Rejected
      </span>
    );
  if (failed)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11.5px] font-bold text-orange-800">
        <AlertTriangle className="h-3 w-3" /> Apply failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      <Clock className="h-3 w-3" /> Waiting{r.currentStageLabel ? ` · ${r.currentStageLabel}` : ''}
    </span>
  );
}

function Stepper({ r }: { r: ExpenseAuditRequest }) {
  const steps = stepsOf(r);
  return (
    <ol className="flex flex-wrap items-center gap-y-2" aria-label="Approval progress">
      {steps.map((s, i) => {
        const circle =
          s.state === 'done'
            ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
            : s.state === 'current'
              ? 'border-amber-500 bg-amber-100 text-amber-800'
              : s.state === 'rejected'
                ? 'border-red-500 bg-red-100 text-red-700'
                : 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900';
        const nextDone = steps[i + 1] && (steps[i + 1].state === 'done' || steps[i + 1].state === 'current' || steps[i + 1].state === 'rejected');
        return (
          <li key={`${s.label}-${i}`} className="flex items-center">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-bold ${circle}`}>
              {s.state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : s.state === 'rejected' ? <X className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={`ml-1.5 whitespace-nowrap text-[12px] font-semibold ${
                s.state === 'todo' ? 'text-slate-400' : s.state === 'rejected' ? 'text-red-700' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className={`mx-2 h-0.5 w-8 rounded sm:w-12 ${nextDone ? 'bg-slate-800 dark:bg-slate-300' : 'bg-slate-200 dark:bg-slate-700'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function EventLine({ e }: { e: ExpenseAuditLogEntry }) {
  const edited: string[] = Array.isArray(e.details?.editedFields) ? e.details!.editedFields : [];
  const tone =
    e.eventType === 'APPLIED' ? 'text-emerald-700 dark:text-emerald-400'
    : e.eventType === 'STAGE_REJECTED' || e.eventType === 'AUTO_REJECTED' || e.eventType === 'APPLY_FAILED' ? 'text-red-700 dark:text-red-400'
    : 'text-slate-500 dark:text-slate-400';
  return (
    <li className="flex gap-2.5 border-t border-slate-100 py-2 first:border-t-0 dark:border-slate-800">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        title={e.actorEmail ?? undefined}
      >
        {initials(e.actorName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px]">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{e.actorName ?? 'System'}</span>{' '}
          <span className={tone}>{EVENT_LABEL[e.eventType]}</span>
          {e.stageLabel && <span className="text-slate-500"> · {e.stageLabel}</span>}
          <span className="text-slate-400"> · {dayjs(e.occurredAt).format('D MMM YYYY, HH:mm')}</span>
        </div>
        {e.comment && <p className="mt-0.5 break-words text-[12.5px] text-slate-600 dark:text-slate-300">“{e.comment}”</p>}
        {edited.length > 0 && (
          <p className="mt-0.5 text-[11.5px] text-slate-500">Edited while approving: {edited.join(', ')}</p>
        )}
        {e.eventType === 'APPLY_FAILED' && e.details?.error && (
          <p className="mt-0.5 text-[11.5px] text-red-700">{String(e.details.error)}</p>
        )}
      </div>
    </li>
  );
}

/** Collapsed-row summary of what the request changes. */
function changeSummary(r: ExpenseAuditRequest, changes: { field: string; old: string; next: string }[]): string {
  if (r.requestKind === 'BULK_ADD' || r.requestKind === 'BULK_DELETE') {
    const n = ((r.changes as any)?.__bulkRows?.new ?? []).length;
    if (r.requestKind === 'BULK_DELETE') return `${n} rows deleted`;
    const layout = BULK_ADD_LAYOUT[r.tableKey];
    return layout && !layout.group ? `${n} ${layout.groupTitle}` : `${changes.length} ${layout?.groupTitle ?? 'attributes'} · ${n} rows`;
  }
  if (r.operation === 'DELETE') return 'Removes the row';
  if (changes.length === 1) {
    const c = changes[0];
    return `${columnTitle(r.tableKey, c.field)}: ${c.old ? `${c.old} → ` : ''}${c.next || '—'}`;
  }
  return `${changes.length} fields`;
}

/** Mini progress bar for the collapsed row — one segment per step. */
function MiniProgress({ r }: { r: ExpenseAuditRequest }) {
  const steps = stepsOf(r);
  return (
    <span className="hidden items-center gap-[3px] sm:inline-flex" aria-label={steps.map((s) => `${s.label}: ${s.state}`).join(', ')}>
      {steps.map((s, i) => (
        <span
          key={i}
          className={`h-[5px] w-[18px] rounded-full ${
            s.state === 'done' ? 'bg-slate-800 dark:bg-slate-200' : s.state === 'current' ? 'bg-amber-500' : s.state === 'rejected' ? 'bg-red-600' : 'bg-slate-200 dark:bg-slate-700'
          }`}
        />
      ))}
    </span>
  );
}

const BULK_PREVIEW = 12;

/** Accordion card (design option A, 2026-11-23): one line when closed, full
 * trail + changes when open. A bulk add shows its attributes as a compact
 * grid of "+N" counts with "Show all". */
function RequestCard({ r, open, onToggle }: { r: ExpenseAuditRequest; open: boolean; onToggle: () => void }) {
  const [showAllBulk, setShowAllBulk] = useState(false);
  const op = OP_META[r.operation] ?? OP_META.UPDATE;
  const changes = changesOf(r);
  const isBulkDelete = r.requestKind === 'BULK_DELETE';
  const isBulk = r.requestKind === 'BULK_ADD' || isBulkDelete;
  const rowText = r.rowLabel || (r.rowId ? `row ${r.rowId}` : 'new row');
  const last = r.events[r.events.length - 1];
  const lastText = last ? `${last.actorName ?? 'System'} ${EVENT_LABEL[last.eventType]} · ${dayjs(last.occurredAt).format('D MMM')}` : '';
  const panelId = `req-${r.requestId}`;

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-white transition dark:bg-slate-900 ${
        open ? 'border-slate-400 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.25)] dark:border-slate-500' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left ${open ? 'border-b border-slate-200 dark:border-slate-700' : ''}`}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90 text-slate-800 dark:text-slate-200' : 'text-slate-400'}`} />
        <span className={`rounded-md border bg-white px-2 py-0.5 text-[11.5px] font-semibold dark:bg-transparent ${isBulkDelete ? 'border-red-300 text-red-700' : isBulk ? 'border-emerald-300 text-emerald-800' : op.className}`}>
          {isBulkDelete ? 'Bulk delete' : isBulk ? 'Bulk add' : r.requestKind ? 'Contribution %' : op.label}
        </span>
        <span className="text-[14px] font-bold">{tableTitle(r.tableKey)}</span>
        <span className="min-w-0 max-w-[340px] truncate font-mono text-[12px] text-slate-500" title={rowText}>
          {rowText}
        </span>
        {!open && <span className="min-w-0 max-w-[260px] truncate text-[12.5px] text-slate-600 dark:text-slate-400">{changeSummary(r, changes)}</span>}
        <span className="ml-auto flex items-center gap-3">
          {!open && <MiniProgress r={r} />}
          {!open && lastText && <span className="hidden text-[12px] text-slate-500 lg:inline">{lastText}</span>}
          {open && (
            <span className="hidden font-mono text-[11px] text-slate-400 sm:inline" title={r.requestId}>
              #{r.requestId.slice(0, 8)}
            </span>
          )}
          <StatusBadge r={r} />
        </span>
      </button>

      {open && (
        <div id={panelId}>
          <div className="px-4 py-3">
            <Stepper r={r} />
          </div>

          <div className="grid gap-6 px-4 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Activity</div>
              <ul>
                {r.events.map((e) => (
                  <EventLine key={e.id} e={e} />
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  {isBulk ? `Changes · ${changeSummary(r, changes)}` : r.operation === 'DELETE' ? 'Row being removed' : 'Changes'}
                </span>
                {r.dueDate && <span className="text-[11.5px] text-slate-500">Needed by {dayjs(r.dueDate).format('D MMM YYYY')}</span>}
              </div>
              {changes.length === 0 ? (
                <p className="py-2 text-[12px] text-slate-500">No field changes recorded.</p>
              ) : isBulk ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                    {(showAllBulk ? changes : changes.slice(0, BULK_PREVIEW)).map((c) => (
                      <div key={c.field} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                        <span className="truncate font-mono text-[12px] font-semibold" title={c.field}>{c.field}</span>
                        <span className={`shrink-0 text-[12px] font-bold ${isBulkDelete ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{isBulkDelete ? '−' : '+'}{parseInt(c.next, 10) || 0}</span>
                      </div>
                    ))}
                  </div>
                  {changes.length > BULK_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllBulk((v) => !v)}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-800 hover:underline dark:text-slate-200"
                    >
                      {showAllBulk ? 'Show fewer' : `Show all ${changes.length} attributes`}
                      <ChevronRight className={`h-3 w-3 transition-transform ${showAllBulk ? '-rotate-90' : 'rotate-90'}`} />
                    </button>
                  )}
                </>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {changes.map((c) => (
                    <li key={c.field} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-2 py-1.5">
                      <span className="truncate text-[12px] text-slate-500" title={c.field}>{columnTitle(r.tableKey, c.field)}</span>
                      {c.old ? (
                        <span className="truncate rounded bg-red-50 px-1.5 font-mono text-[12px] text-red-800 line-through dark:bg-red-500/10 dark:text-red-300" title={c.old}>{c.old}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                      <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
                      {c.next ? (
                        <span className="truncate rounded bg-emerald-50 px-1.5 font-mono text-[12px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" title={c.next}>{c.next}</span>
                      ) : (
                        <span className="text-[12px] text-red-700">removed</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function ExpenseAuditLogPage() {
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<ExpenseRequestStatus | 'ALL'>('ALL');
  const [tableFilter, setTableFilter] = useState('__ALL__');
  const [eventFilter, setEventFilter] = useState('__ALL__');
  const [operationFilter, setOperationFilter] = useState('__ALL__');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  // Which request cards are open (accordion). All start closed.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['expense-audit-requests', page, appliedSearch, status, tableFilter, eventFilter, operationFilter, dateFrom, dateTo],
    queryFn: () =>
      getExpenseAuditRequests({
        page,
        limit: PAGE_SIZE,
        search: appliedSearch || undefined,
        status: status === 'ALL' ? undefined : status,
        tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
        eventType: eventFilter === '__ALL__' ? undefined : (eventFilter as ExpenseAuditEventType),
        operation: operationFilter === '__ALL__' ? undefined : (operationFilter as ExpenseChangeOperation),
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const requests = data?.data ?? [];
  const counts = data?.counts;
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const statusChips: { key: ExpenseRequestStatus | 'ALL'; label: string; count?: number }[] = [
    { key: 'ALL', label: 'All requests', count: counts?.ALL },
    { key: 'PENDING', label: 'Waiting', count: counts?.PENDING },
    { key: 'APPROVED', label: 'Applied', count: counts?.APPROVED },
    { key: 'REJECTED', label: 'Rejected', count: counts?.REJECTED },
  ];
  const hasFilters = !!appliedSearch || tableFilter !== '__ALL__' || eventFilter !== '__ALL__' || operationFilter !== '__ALL__' || !!dateFrom || !!dateTo;
  const trigger = 'h-9 bg-white text-[13px] dark:bg-slate-900';

  return (
    <div className="min-h-full space-y-4 bg-slate-50 p-6 dark:bg-slate-950">
      <div className="flex items-center justify-between">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        <Link to="/admin/expense-change-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ClipboardList className="h-4 w-4" /> Change Requests
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Grid Change Request</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          Every change request with its full trail: who raised it, each stage&rsquo;s approve or reject, and the write to the
          master. Only <strong className="text-foreground">Applied</strong> changes Supabase data.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 bg-white pl-9 text-[13px] focus-visible:border-slate-600 focus-visible:ring-slate-900/10 dark:bg-slate-900"
              placeholder="Search actor, row id, request id, comment… (Enter)"
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
          <Select value={tableFilter} onValueChange={resetPage(setTableFilter)}>
            <SelectTrigger className={`${trigger} w-52`} aria-label="Table">
              <SelectValue placeholder="All tables" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All tables</SelectItem>
              {Object.entries(EXPENSE_TABLE_CONFIGS).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.title.split(' (')[0]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={operationFilter} onValueChange={resetPage(setOperationFilter)}>
            <SelectTrigger className={`${trigger} w-36`} aria-label="Type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All types</SelectItem>
              <SelectItem value="CREATE">Add row</SelectItem>
              <SelectItem value="UPDATE">Edit</SelectItem>
              <SelectItem value="DELETE">Delete row</SelectItem>
            </SelectContent>
          </Select>
          <Select value={eventFilter} onValueChange={resetPage(setEventFilter)}>
            <SelectTrigger className={`${trigger} w-44`} aria-label="Has event">
              <SelectValue placeholder="Any event" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">Any event</SelectItem>
              {(Object.keys(EVENT_FILTER_LABEL) as ExpenseAuditEventType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  Has: {EVENT_FILTER_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="From date" className={`${trigger} w-36`} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" className={`${trigger} w-36`} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {statusChips.map((c) => {
            const on = status === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setStatus(c.key);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
                  on
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {c.label}
                {c.count !== undefined && <span className="ml-1.5 opacity-60">{c.count}</span>}
              </button>
            );
          })}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setDraftSearch('');
                setAppliedSearch('');
                setTableFilter('__ALL__');
                setEventFilter('__ALL__');
                setOperationFilter('__ALL__');
                setDateFrom('');
                setDateTo('');
                setPage(1);
              }}
              className="ml-auto text-[12.5px] font-semibold text-slate-700 underline underline-offset-2 dark:text-slate-300"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-200 bg-white py-10 text-center text-sm text-red-600">Failed to load the audit log.</div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-muted-foreground dark:bg-slate-900">
          No requests match these filters.
        </div>
      ) : (
        <div className={`space-y-2.5 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2 px-1 text-[12.5px]">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {data?.total ?? requests.length} request{(data?.total ?? requests.length) === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => setOpenIds(new Set(requests.map((r) => r.requestId)))} className="ml-auto font-semibold text-slate-800 hover:underline dark:text-slate-200">
              Expand all
            </button>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <button type="button" onClick={() => setOpenIds(new Set())} className="font-semibold text-slate-500 hover:underline">
              Collapse all
            </button>
          </div>
          {requests.map((r) => (
            <RequestCard
              key={r.requestId}
              r={r}
              open={openIds.has(r.requestId)}
              onToggle={() =>
                setOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.requestId)) next.delete(r.requestId);
                  else next.add(r.requestId);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}

      {(data?.total ?? 0) > 0 && (
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>
            {data!.total} request{data!.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
