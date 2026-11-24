import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle, ArrowRight, Check, Copy, Info, Search } from 'lucide-react';
import { Button, DatePicker, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Textarea } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { createExpenseBulkAddRequest, getExpenseColumnOptions, getExpenseRowsByColumn } from '../../../services/adminApi';
import { ExistingValuePicker } from './RowChangeRequestDialog';

/**
 * "Copy major category" (2026-11-23, design option B: list + values pane).
 * Pick a source major category, name the new (or an existing) one; every
 * value starts ticked — untick what the new one shouldn't have — then submit
 * ONE bulk-add change request. Rows that already exist are skipped by the
 * server. Works for any table in COPY_CONFIGS:
 *   - Major Category Grid: attribute list (left) + its values (right).
 *   - Size Master: no grouping, just the sizes; Division / Sub Division /
 *     MC Code are carried from the source and can be changed for the new one.
 */

interface CopyConfig {
  /** Column holding the major category. */
  key: string;
  /** Column to group by (left pane), or null for a single list. */
  group: string | null;
  /** Column shown as the tickable value. */
  value: string;
  /** Heading for the list ("attributes") or the single group ("Sizes"). */
  groupLabel: string;
  /** Plural noun for values ("values", "sizes"). */
  valueNoun: string;
  /** Columns copied from the source rows that the user may change for the new major category. */
  carry: { column: string; label: string }[];
  /** Extra columns shown next to each value (e.g. Segment Master Min – Max). */
  detail?: string[];
}

const COPY_CONFIGS: Record<string, CopyConfig> = {
  'major-category-grid': { key: 'major_category', group: 'attribute_name', value: 'value', groupLabel: 'attributes', valueNoun: 'values', carry: [] },
  'size-master': {
    key: 'major_category',
    group: null,
    value: 'size',
    groupLabel: 'Sizes',
    valueNoun: 'sizes',
    carry: [
      { column: 'division', label: 'Division' },
      { column: 'sub_division', label: 'Sub Division' },
      { column: 'mc_code', label: 'MC Code' },
    ],
  },
  'mandatory-grid': {
    key: 'major_category',
    group: null,
    value: 'sap_key',
    groupLabel: 'Fields',
    valueNoun: 'fields',
    carry: [
      { column: 'div', label: 'Division' },
      { column: 'sub_div', label: 'Sub Division' },
    ],
    detail: ['is_active'],
  },
  'segment-master': {
    key: 'major_category',
    group: null,
    value: 'segment_type',
    groupLabel: 'Segments',
    valueNoun: 'segments',
    carry: [{ column: 'sub_division', label: 'Sub Division' }],
    detail: ['min', 'max'],
  },
};

/** Tables that get the "Copy major category" button. */
export const COPYABLE_TABLES = new Set(Object.keys(COPY_CONFIGS));

/** Detail cell text — booleans read as Active / Inactive (Mandatory Grid). */
const fmtDetail = (v: unknown) => (v === true || v === 'true' ? 'Active' : v === false || v === 'false' ? 'Inactive' : v == null || v === '' ? '—' : String(v));

const rowId = (attr: string, value: string) => `${attr}\u0001${value}`;

interface Props {
  tableKey: string;
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

function Box({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        state === 'off'
          ? 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'
          : 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
      }`}
    >
      {state === 'on' && <Check className="h-3 w-3" strokeWidth={3} />}
      {state === 'some' && <span className="h-0.5 w-2 rounded bg-current" />}
    </span>
  );
}

export function CopyMajorCategoryDialog({ tableKey, open, onClose, onSubmitted }: Props) {
  const cfg = COPY_CONFIGS[tableKey] ?? COPY_CONFIGS['major-category-grid'];
  const TABLE_KEY = tableKey;
  const KEY = cfg.key;
  const VALUE = cfg.value;
  const single = !cfg.group;
  const [carry, setCarry] = useState<Record<string, string>>({});
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: mcOptions = [], isLoading: mcLoading } = useQuery({
    queryKey: ['expense-column-options', TABLE_KEY, KEY],
    queryFn: () => getExpenseColumnOptions(TABLE_KEY, KEY),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const sourceValid = !!source && mcOptions.includes(source);
  const { data: sourceRows = [], isFetching: rowsLoading } = useQuery({
    queryKey: ['expense-rows-by', TABLE_KEY, KEY, source],
    queryFn: () => getExpenseRowsByColumn(TABLE_KEY, KEY, source),
    enabled: open && sourceValid,
    staleTime: 60_000,
  });

  // group → values (in server order), plus the source row behind each value.
  const { groups, sourceById } = useMemo(() => {
    const map = new Map<string, string[]>();
    const byId = new Map<string, Record<string, any>>();
    for (const r of sourceRows) {
      const a = cfg.group ? String(r[cfg.group] ?? '') : cfg.groupLabel;
      const v = String(r[VALUE] ?? '');
      if (!a || !v) continue;
      if (!map.has(a)) map.set(a, []);
      const list = map.get(a)!;
      if (!list.includes(v)) {
        list.push(v);
        byId.set(rowId(a, v), r);
      }
    }
    return { groups: [...map.entries()], sourceById: byId };
  }, [sourceRows, cfg, VALUE]);

  // Pre-fill the carried columns (e.g. Division / Sub Division / MC Code)
  // from the source major category; the user can change them.
  useEffect(() => {
    if (!cfg.carry.length || !sourceRows.length) return;
    const first = sourceRows[0];
    setCarry(Object.fromEntries(cfg.carry.map((c) => [c.column, first[c.column] == null ? '' : String(first[c.column])])));
  }, [sourceRows, cfg]);

  // Attribute list filter: matches the attribute name or any of its values.
  const q = search.trim().toLowerCase();
  const visibleGroups = useMemo(
    () => (q ? groups.filter(([a, vals]) => a.toLowerCase().includes(q) || vals.some((v) => v.toLowerCase().includes(q))) : groups),
    [groups, q]
  );

  // Keep a valid attribute open on the right.
  useEffect(() => {
    if (!visibleGroups.length) return;
    if (!active || !visibleGroups.some(([a]) => a === active)) setActive(visibleGroups[0][0]);
  }, [visibleGroups, active]);

  const selectedOf = (a: string, vals: string[]) => vals.filter((v) => !excluded.has(rowId(a, v))).length;
  const totalValues = groups.reduce((n, [, v]) => n + v.length, 0);
  const selectedCount = groups.reduce((n, [a, vals]) => n + selectedOf(a, vals), 0);
  const leftOut = totalValues - selectedCount;
  const targetName = target.trim().toUpperCase();
  const targetExists = !!targetName && mcOptions.includes(targetName);
  const sameAsSource = !!targetName && targetName === source;
  const activeGroup = groups.find(([a]) => a === active);

  const toggleValue = (a: string, v: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      const id = rowId(a, v);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setGroup = (a: string, vals: string[], include: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const v of vals) {
        if (include) next.delete(rowId(a, v));
        else next.add(rowId(a, v));
      }
      return next;
    });

  const reset = () => {
    setSource('');
    setTarget('');
    setCarry({});
    setExcluded(new Set());
    setActive(null);
    setSearch('');
    setReason('');
    setDueDate(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!sourceValid) return message.warning('Pick the major category to copy from.');
    if (!targetName) return message.warning('Type the new major category name.');
    if (sameAsSource) return message.warning('The new major category must be different from the one you copy.');
    if (selectedCount === 0) return message.warning(`Tick at least one ${cfg.valueNoun.replace(/s$/, '')} — nothing is selected.`);
    if (!reason.trim()) return message.warning('Please explain why you are adding these rows.');
    if (!dueDate) return message.warning('Please pick the date you need this done by.');
    if (dueDate.isBefore(dayjs().startOf('day'))) return message.warning('The "needed by" date cannot be in the past.');

    // Each new row = its source row with the new major category and any
    // changed carried columns (blank carried fields keep the source value).
    const overrides = Object.fromEntries(Object.entries(carry).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    const rows: Record<string, any>[] = [];
    for (const [a, vals] of groups)
      for (const v of vals) {
        const id = rowId(a, v);
        if (excluded.has(id)) continue;
        rows.push({ ...(sourceById.get(id) ?? {}), [KEY]: targetName, ...overrides });
      }

    setSubmitting(true);
    try {
      const res = await createExpenseBulkAddRequest(TABLE_KEY, {
        rows,
        reason: reason.trim(),
        dueDate: dueDate.format('YYYY-MM-DD'),
        label: `${targetName} — copied from ${source} (${rows.length} rows)`,
      });
      const skipped = res.skipped.alreadyInTable + res.skipped.duplicatesInBatch;
      message.success(`Request submitted for ${res.rowCount} rows${skipped ? ` (${skipped} already existed and were left out)` : ''} — now pending approval.`);
      reset();
      onSubmitted();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const label = 'text-[12px] font-semibold text-slate-700 dark:text-slate-300';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex max-h-[92vh] max-w-[920px] flex-col gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-slate-200 px-6 py-4 text-left dark:border-slate-700">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            <Copy className="h-4 w-4" />
          </span>
          <div className="min-w-0 pr-8">
            <DialogTitle className="text-[16px] font-bold">Copy a major category</DialogTitle>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {single ? `All ${cfg.valueNoun} of one major category` : `All ${cfg.groupLabel} and ${cfg.valueNoun} of one major category`}, sent for approval as one request.
            </p>
          </div>
        </DialogHeader>

        {/* Source → target */}
        <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-6 py-3.5 dark:border-slate-700">
          <div className="min-w-[220px] flex-1 space-y-1">
            <span className={label}>Copy from</span>
            <ExistingValuePicker
              value={source}
              onChange={(v) => {
                setSource(v);
                setExcluded(new Set());
                setActive(null);
                setSearch('');
              }}
              options={mcOptions}
              loading={mcLoading}
              placeholder="Search a major category…"
            />
          </div>
          <ArrowRight className="mt-8 hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
          <label className="min-w-[220px] flex-1 space-y-1">
            <span className={label}>New major category</span>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value.toUpperCase())}
              placeholder="e.g. YB_T_SHIRT_PN_FS"
              className="font-mono font-semibold focus-visible:border-slate-600 focus-visible:ring-slate-900/10"
            />
            {sameAsSource ? (
              <span className="flex items-center gap-1 text-[11.5px] text-red-700"><AlertTriangle className="h-3 w-3" /> Same as the one you copy from.</span>
            ) : targetExists ? (
              <span className="flex items-center gap-1 text-[11.5px] text-amber-700"><AlertTriangle className="h-3 w-3" /> Already exists — only values it doesn’t have yet are added.</span>
            ) : targetName ? (
              <span className="text-[11.5px] text-emerald-700">New — not in the grid yet.</span>
            ) : null}
          </label>
        </div>

        {/* Carried columns (Size Master: Division / Sub Division / MC Code) */}
        {cfg.carry.length > 0 && sourceValid && (
          <div className="grid gap-3 border-b border-slate-200 bg-slate-50/60 px-6 py-3 dark:border-slate-700 dark:bg-slate-800/30 sm:grid-cols-3">
            {cfg.carry.map((c) => (
              <label key={c.column} className="space-y-1">
                <span className={label}>{c.label} <span className="font-normal text-slate-400">(for the new one)</span></span>
                <Input
                  value={carry[c.column] ?? ''}
                  onChange={(e) => setCarry((prev) => ({ ...prev, [c.column]: e.target.value }))}
                  className="bg-white font-mono focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:bg-slate-900"
                />
              </label>
            ))}
          </div>
        )}

        {/* Two panes */}
        <div className="flex min-h-0 flex-1">
          {!sourceValid ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <Copy className="h-6 w-6 text-slate-300" />
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">Pick a major category to copy from</p>
              <p className="max-w-sm text-[12.5px] text-slate-500">Its {single ? cfg.valueNoun : `${cfg.groupLabel} and ${cfg.valueNoun}`} load here, all ticked. Untick what the new one shouldn’t have.</p>
            </div>
          ) : (
            <>
              {/* Attribute list (hidden for single-list tables like Size Master) */}
              <aside className={`${single ? 'hidden' : 'flex'} w-[280px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-700`}>
                <div className="space-y-2 p-3 pb-1.5">
                  <label className="relative block">
                    <span className="sr-only">Find attribute or value</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Find attribute or value…"
                      className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900"
                    />
                  </label>
                  <div className="flex items-center justify-between px-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                    <span>{rowsLoading ? 'Loading…' : `${groups.length} attributes`}</span>
                    <span className={leftOut ? 'text-amber-700' : ''}>{selectedCount}/{totalValues}</span>
                  </div>
                </div>
                <div className="min-h-[300px] flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-label="Attributes">
                  {rowsLoading
                    ? [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="m-1 h-7 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />)
                    : visibleGroups.length === 0
                      ? <p className="p-4 text-center text-[12px] text-slate-500">{groups.length === 0 ? 'No rows in this major category.' : 'Nothing matches.'}</p>
                      : visibleGroups.map(([a, vals]) => {
                          const sel = selectedOf(a, vals);
                          const state = sel === vals.length ? 'on' : sel === 0 ? 'off' : 'some';
                          const on = a === active;
                          return (
                            <div
                              key={a}
                              role="option"
                              aria-selected={on}
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${on ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                            >
                              <button
                                type="button"
                                onClick={() => setGroup(a, vals, state !== 'on')}
                                aria-label={state === 'on' ? `Leave out all of ${a}` : `Include all of ${a}`}
                                className={on ? 'rounded ring-1 ring-white/40' : ''}
                              >
                                <Box state={state} />
                              </button>
                              <button type="button" onClick={() => setActive(a)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                <span className="truncate font-mono text-[12px] font-semibold" title={a}>{a}</span>
                                <span className={`ml-auto shrink-0 text-[11px] font-semibold tabular-nums ${on ? 'text-slate-300 dark:text-slate-600' : sel < vals.length ? 'text-amber-700' : 'text-slate-500'}`}>
                                  {sel}/{vals.length}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                </div>
                <div className="flex gap-3 border-t border-slate-200 px-3 py-2 text-[12px] font-semibold dark:border-slate-700">
                  <button type="button" onClick={() => setExcluded(new Set())} className="text-slate-700 hover:underline dark:text-slate-300">Include everything</button>
                  <button
                    type="button"
                    onClick={() => setExcluded(new Set(groups.flatMap(([a, vals]) => vals.map((v) => rowId(a, v)))))}
                    className="text-slate-500 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              </aside>

              {/* Values of the open attribute */}
              <section className="flex min-w-0 flex-1 flex-col">
                {activeGroup ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-2 pt-4">
                      <span className="font-mono text-[15px] font-bold">{activeGroup[0]}</span>
                      <span className={`text-[12px] font-semibold ${selectedOf(activeGroup[0], activeGroup[1]) < activeGroup[1].length ? 'text-amber-700' : 'text-slate-500'}`}>
                        {selectedOf(activeGroup[0], activeGroup[1])} of {activeGroup[1].length} selected
                      </span>
                      <span className="ml-auto flex gap-3 text-[12px] font-semibold">
                        <button type="button" onClick={() => setGroup(activeGroup[0], activeGroup[1], true)} className="text-slate-700 hover:underline dark:text-slate-300">Select all</button>
                        <button type="button" onClick={() => setGroup(activeGroup[0], activeGroup[1], false)} className="text-slate-500 hover:underline">None</button>
                      </span>
                    </div>
                    <div className="min-h-[300px] flex-1 overflow-y-auto px-5 pb-3">
                      <div className="flex flex-wrap gap-2">
                        {activeGroup[1].map((v) => {
                          const sel = !excluded.has(rowId(activeGroup[0], v));
                          const hit = !!q && v.toLowerCase().includes(q);
                          return (
                            <button
                              key={v}
                              type="button"
                              aria-pressed={sel}
                              onClick={() => toggleValue(activeGroup[0], v)}
                              className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[12px] font-semibold transition ${
                                sel
                                  ? 'border-slate-300 bg-white text-slate-900 hover:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
                                  : 'border-slate-200 bg-slate-50 text-slate-400 line-through hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800/50'
                              } ${hit ? 'ring-2 ring-amber-300' : ''}`}
                            >
                              <Box state={sel ? 'on' : 'off'} />
                              {v}
                              {cfg.detail && (
                                <span className="font-sans text-[11.5px] font-medium text-slate-500">
                                  {cfg.detail.map((d) => fmtDetail(sourceById.get(rowId(activeGroup[0], v))?.[d])).join(' – ')}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="mx-5 mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
                      <Info className="h-3.5 w-3.5 shrink-0" /> Untick {cfg.valueNoun} the new major category should not have. Everything else is copied.
                    </p>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-8 text-[12.5px] text-slate-500">{rowsLoading ? 'Loading values…' : 'Pick an attribute on the left.'}</div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Reason + date */}
        <div className="grid gap-3 border-t border-slate-200 px-6 py-3 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_210px]">
          <label className="space-y-1">
            <span className={label}>Reason (required)</span>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={1} placeholder="Why is this major category needed?" className="min-h-[38px] resize-none bg-white focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:bg-slate-900" />
          </label>
          <div className="space-y-1">
            <span className={label}>Needed by (required)</span>
            <DatePicker value={dueDate} onChange={setDueDate} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <span className="mr-auto text-[12.5px] text-slate-600 dark:text-slate-400">
            {targetName && selectedCount > 0 ? (
              <>
                Adds <b className="text-slate-900 dark:text-slate-100">{selectedCount} rows</b> to <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{targetName}</span> after approval
                {leftOut > 0 && <span className="text-amber-700"> · {leftOut} left out</span>}
              </>
            ) : (
              'Nothing changes until every approval stage signs off.'
            )}
          </span>
          <Button variant="outline" onClick={close} disabled={submitting} className="bg-white dark:bg-slate-900">
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900">
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
