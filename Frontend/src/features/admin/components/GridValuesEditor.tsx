/**
 * GridValuesEditor
 * Admin "Grid Values" tab — three-pane browser (design "Option A"):
 *   1 · Groups + attributes (Construction & Fabric → M_FAB_DIV, …)
 *   2 · Major categories for the picked attribute, with value counts
 *   3 · Allowed values for the picked (attribute, major category): add / remove
 *       as chips, plus a History view.
 * Every add or remove needs a reason, asked inline in pane 3 and saved to the
 * audit log.
 *
 * Data: maj_cat_grid_values, via /api/admin/grid-values/*.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, History, Loader2, Plus, Search, X, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Input } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import {
  getGridValueAttributes,
  getGridValueCategories,
  getGridValues,
  getGridValueAudit,
  addGridValue,
  deleteGridValue,
} from '../../../services/adminApi';

// Pending edit that needs a reason before it commits.
type PendingAction =
  | { kind: 'add'; value: string }
  | { kind: 'delete'; id: number; value: string }
  | null;

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
  } catch { return iso; }
};

const paneSearch = (value: string, onChange: (v: string) => void, placeholder: string) => (
  <label className="flex h-9 items-center gap-2 rounded-[9px] border border-slate-300 bg-white px-2.5 text-slate-500 focus-within:border-slate-800">
    <Search className="h-3.5 w-3.5 shrink-0" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-900 outline-none"
    />
    {value && (
      <button type="button" aria-label="Clear" onClick={() => onChange('')} className="text-slate-400 hover:text-slate-700">
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </label>
);

const rowBtn = (active: boolean) =>
  cn(
    'flex h-[34px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left transition-colors',
    active ? 'bg-slate-800 text-white' : 'text-slate-900 hover:bg-slate-100',
  );

// ─── Main editor ──────────────────────────────────────────────────────────────
export const GridValuesEditor: React.FC = () => {
  const qc = useQueryClient();
  const [attrSearch, setAttrSearch] = useState('');
  const [mcSearch, setMcSearch] = useState('');
  const [attribute, setAttribute] = useState<string | null>(null);
  const [majorCategory, setMajorCategory] = useState<string | null>(null);
  const [tab, setTab] = useState<'values' | 'history'>('values');
  const [newValue, setNewValue] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['grid-attributes'],
    queryFn: getGridValueAttributes,
    staleTime: 5 * 60 * 1000,
  });

  const { data: cats, isLoading: catsLoading } = useQuery({
    queryKey: ['grid-categories', attribute],
    queryFn: () => getGridValueCategories(attribute!),
    enabled: !!attribute,
  });

  const { data: values, isLoading: valuesLoading } = useQuery({
    queryKey: ['grid-values', attribute, majorCategory],
    queryFn: () => getGridValues(attribute!, majorCategory!),
    enabled: !!attribute && !!majorCategory,
  });

  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ['grid-audit', attribute, majorCategory],
    queryFn: () => getGridValueAudit(attribute!, majorCategory!),
    enabled: !!attribute && !!majorCategory && tab === 'history',
  });

  // Open on the first attribute so the screen is never empty.
  useEffect(() => {
    if (!attribute && groups && groups[0]?.attributes[0]) setAttribute(groups[0].attributes[0].gridKey);
  }, [groups, attribute]);

  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    (groups ?? []).forEach((g) => g.attributes.forEach((a) => m.set(a.gridKey, g.label)));
    return m;
  }, [groups]);

  const attrLower = attrSearch.trim().toLowerCase();
  const visibleGroups = (groups ?? [])
    .map((g) => ({
      ...g,
      attributes: g.attributes.filter(
        (a) => !attrLower || a.gridKey.toLowerCase().includes(attrLower) || a.label.toLowerCase().includes(attrLower),
      ),
    }))
    .filter((g) => g.attributes.length > 0);

  const mcLower = mcSearch.trim().toLowerCase();
  const visibleCats = (cats ?? []).filter((c) => !mcLower || c.majorCategory.toLowerCase().includes(mcLower));
  const newMcCandidate = mcSearch.trim().toUpperCase();

  const resetEdit = () => {
    setPending(null);
    setRemarks('');
    setNewValue('');
  };

  const pickAttribute = (key: string) => {
    if (key === attribute) return;
    setAttribute(key);
    setMajorCategory(null);
    setMcSearch('');
    setTab('values');
    resetEdit();
  };

  const pickMajorCategory = (mc: string) => {
    setMajorCategory(mc);
    setTab('values');
    resetEdit();
  };

  const startAdd = () => {
    const v = newValue.trim();
    if (!v) return;
    if ((values ?? []).some((x) => x.value.toUpperCase() === v.toUpperCase())) {
      message.warning(`"${v}" is already allowed`);
      return;
    }
    setRemarks('');
    setPending({ kind: 'add', value: v });
  };

  const confirm = async () => {
    const r = remarks.trim();
    if (!r || !pending || !attribute || !majorCategory) return;
    setBusy(true);
    try {
      if (pending.kind === 'add') {
        await addGridValue(attribute, majorCategory, pending.value, r);
        setNewValue('');
        message.success(`Added "${pending.value}"`);
      } else {
        await deleteGridValue(pending.id, r);
        message.success(`Removed "${pending.value}"`);
      }
      qc.invalidateQueries({ queryKey: ['grid-values', attribute, majorCategory] });
      qc.invalidateQueries({ queryKey: ['grid-categories', attribute] }); // value counts change
      qc.invalidateQueries({ queryKey: ['grid-audit', attribute, majorCategory] });
      setPending(null);
      setRemarks('');
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const valueCount = values?.length ?? 0;

  return (
    <div className="grid h-[70vh] min-h-[520px] grid-cols-1 overflow-hidden rounded-[14px] border border-slate-200 bg-white md:grid-cols-[260px_280px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-950">
      {/* ── Pane 1 · groups + attributes ── */}
      <nav aria-label="Attributes" className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800">
        <div className="border-b border-slate-100 p-3 dark:border-slate-800">{paneSearch(attrSearch, setAttrSearch, 'Find attribute')}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {groupsLoading && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading attributes…
            </div>
          )}
          {visibleGroups.map((g) => (
            <div key={g.group} className="mb-1.5">
              <div className="flex justify-between px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-600">
                <span>{g.label}</span>
                <span>{g.attributes.length}</span>
              </div>
              {g.attributes.map((a) => (
                <button
                  key={a.gridKey}
                  type="button"
                  onClick={() => pickAttribute(a.gridKey)}
                  title={a.label !== a.gridKey ? a.label : undefined}
                  className={rowBtn(a.gridKey === attribute)}
                >
                  <span className="truncate font-mono text-xs">{a.gridKey}</span>
                </button>
              ))}
            </div>
          ))}
          {!groupsLoading && visibleGroups.length === 0 && (
            <div className="px-2 py-4 text-xs text-slate-500">
              {attrLower ? `No attributes match “${attrSearch.trim()}”.` : 'No grouped attributes found.'}
            </div>
          )}
        </div>
      </nav>

      {/* ── Pane 2 · major categories ── */}
      <section aria-label="Major categories" className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/40 md:border-b-0 md:border-r dark:border-slate-800">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <b className="truncate font-mono text-slate-900 dark:text-slate-50">{attribute ?? '—'}</b>
            {attribute && !catsLoading && <span className="shrink-0 text-slate-600">{cats?.length ?? 0} major categories</span>}
          </div>
          {paneSearch(mcSearch, setMcSearch, 'Find major category')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {!attribute ? (
            <div className="px-2 py-4 text-xs text-slate-500">Pick an attribute on the left.</div>
          ) : catsLoading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading major categories…
            </div>
          ) : visibleCats.length === 0 ? (
            <div className="px-2 py-3">
              <div className="text-xs text-slate-500">
                {mcLower ? `No major categories match “${mcSearch.trim()}”.` : 'No major categories with grid data.'}
              </div>
              {mcLower && newMcCandidate && (
                <button
                  type="button"
                  onClick={() => pickMajorCategory(newMcCandidate)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:border-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add values for <span className="font-mono">{newMcCandidate}</span>
                </button>
              )}
            </div>
          ) : (
            visibleCats.map((c) => {
              const active = c.majorCategory === majorCategory;
              return (
                <button key={c.majorCategory} type="button" onClick={() => pickMajorCategory(c.majorCategory)} className={rowBtn(active)}>
                  <span className="truncate font-mono text-xs">{c.majorCategory}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 text-[11px] font-semibold',
                      active ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                    )}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ── Pane 3 · values ── */}
      <section aria-label="Allowed values" className="flex min-h-0 flex-col">
        {!attribute || !majorCategory ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty description={attribute ? 'Pick a major category to see its allowed values.' : 'Pick an attribute to start.'} />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold uppercase tracking-[0.07em] text-slate-600">
                  {attribute} · {groupOf.get(attribute) ?? ''}
                </div>
                <h2 className="m-0 mt-0.5 truncate font-mono text-[19px] font-semibold text-slate-900 dark:text-slate-50">{majorCategory}</h2>
              </div>
              <div role="tablist" aria-label="View" className="flex rounded-[9px] bg-slate-100 p-[3px] dark:bg-slate-800">
                {(['values', 'history'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'flex h-[30px] items-center gap-1 rounded-[7px] px-3 text-xs font-semibold',
                      tab === t ? 'bg-slate-800 text-white' : 'text-slate-700 hover:text-slate-950 dark:text-slate-300',
                    )}
                  >
                    {t === 'values' ? `Values · ${valueCount}` : (<><History className="h-3.5 w-3.5" /> History</>)}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'values' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-5 py-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a value…"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startAdd(); } }}
                    disabled={busy || !!pending}
                    className="h-10 font-mono"
                  />
                  <Button
                    onClick={startAdd}
                    disabled={busy || !!pending || !newValue.trim()}
                    className="h-10 bg-slate-800 px-4 font-semibold text-white hover:bg-slate-900"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {valuesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading values…
                    </div>
                  ) : valueCount === 0 ? (
                    <Empty description="No values yet — add the first one above." className="my-6" />
                  ) : (
                    <div className="flex flex-wrap content-start gap-2">
                      {(values ?? []).map((v) => {
                        const removing = pending?.kind === 'delete' && pending.id === v.id;
                        return (
                          <span
                            key={v.id}
                            className={cn(
                              'flex h-8 items-center gap-1 rounded-lg border pl-3 pr-1 font-mono text-[12.5px]',
                              removing
                                ? 'border-red-300 bg-red-50 text-red-800 line-through'
                                : 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50',
                            )}
                            title={v.value}
                          >
                            <span className="max-w-[240px] truncate">{v.value}</span>
                            <button
                              type="button"
                              onClick={() => { setRemarks(''); setPending({ kind: 'delete', id: v.id, value: v.value }); }}
                              disabled={busy || !!pending}
                              aria-label={`Remove ${v.value}`}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline reason bar — required before any add/remove commits */}
                {pending && (
                  <div className="flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/40">
                    <span className="text-[12.5px] text-slate-900 dark:text-slate-100">
                      <b>{pending.kind === 'add' ? 'Add' : 'Remove'} “{pending.value}”</b>{' '}
                      {pending.kind === 'add' ? 'to' : 'from'} <span className="font-mono">{attribute}</span> /{' '}
                      <span className="font-mono">{majorCategory}</span> — a reason is required and saved to history.
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        autoFocus
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } if (e.key === 'Escape') setPending(null); }}
                        placeholder="Reason (saved to history)"
                        aria-label="Reason"
                        className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[12.5px] outline-none focus:border-slate-800"
                      />
                      <Button variant="outline" onClick={() => { setPending(null); setRemarks(''); }} disabled={busy} className="h-9 border-slate-300">
                        Cancel
                      </Button>
                      <Button
                        onClick={confirm}
                        disabled={busy || !remarks.trim()}
                        className={cn(
                          'h-9 font-semibold text-white',
                          pending.kind === 'delete' ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-900',
                        )}
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {pending.kind === 'delete' ? 'Remove' : 'Add'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* History */
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {auditLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
                  </div>
                ) : (audit?.length ?? 0) === 0 ? (
                  <Empty description="No changes recorded yet for this attribute / category." className="my-6" />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(audit ?? []).map((a) => (
                      <div key={a.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          {a.action === 'ADD'
                            ? <ArrowDownCircle className="h-4 w-4 text-slate-700" />
                            : <XCircle className="h-4 w-4 text-red-700" />}
                          <span className={cn('text-[11px] font-bold', a.action === 'ADD' ? 'text-slate-700' : 'text-red-700')}>
                            {a.action === 'ADD' ? 'ADDED' : 'REMOVED'}
                          </span>
                          <span className="font-mono text-[13px] font-semibold">{a.value}</span>
                        </div>
                        {a.remarks && <div className="mt-1 text-xs text-slate-800 dark:text-slate-200">“{a.remarks}”</div>}
                        <div className="mt-1 text-[11px] text-slate-500">{a.by} · {fmtDate(a.at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
