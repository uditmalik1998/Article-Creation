/**
 * SizeMasterEditor
 * Admin "Size Master" tab — two-pane browser (design "Option A"):
 *   left  · division chips + major categories grouped by division › sub-division,
 *           each with its size range and count
 *   right · the picked category's sizes as chips in real size order (S → 3XL,
 *           0-3M → 18-24M, 28 → 40), Add box, quick-add suggestions from sibling
 *           categories, and a History view.
 * Every add/remove needs a reason (asked inline) and is written to the
 * maj_cat_sizes_audit log (who / why / when).
 *
 * Data: maj_cat_sizes, via /api/admin/size-master/*.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, History, Loader2, Plus, Search, X, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Input } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import {
  getSizeMasterCategories,
  getSizeMasterSizes,
  getSizeMasterAudit,
  addSizeMasterSize,
  deleteSizeMasterSize,
  type SizeMasterCategory,
} from '../../../services/adminApi';

// Pending edit that needs a reason before it commits.
type PendingAction =
  | { kind: 'add'; size: string }
  | { kind: 'delete'; id: number; size: string }
  | null;

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
  } catch { return iso; }
};

// ─── Real size order ──────────────────────────────────────────────────────────
// Letter sizes by scale, kids ranges by age (months; Y = 12 months), then plain
// numbers (waist 28…40), then anything else alphabetically.
const LETTER_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL', '7XL'];
const LETTER_ALIAS: Record<string, string> = { '2XL': 'XXL', '3XL': 'XXXL' };
const sizeKey = (raw: string): [number, number, string] => {
  const u = raw.trim().toUpperCase();
  const letter = LETTER_ORDER.indexOf(LETTER_ALIAS[u] ?? u);
  if (letter >= 0) return [0, letter, u];
  const age = u.match(/^(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?([MY])/);
  if (age) return [1, parseFloat(age[1]) * (age[2] === 'Y' ? 12 : 1), u];
  if (/^\d+(\.\d+)?$/.test(u)) return [2, parseFloat(u), u];
  return [3, 0, u];
};
const compareSizes = (a: string, b: string) => {
  const [ga, na, sa] = sizeKey(a);
  const [gb, nb, sb] = sizeKey(b);
  return ga - gb || na - nb || sa.localeCompare(sb);
};
const sortSizes = (list: string[]) => [...list].sort(compareSizes);

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

// ─── Main editor ──────────────────────────────────────────────────────────────
export const SizeMasterEditor: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState<string>('ALL');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'sizes' | 'history'>('sizes');
  const [newSize, setNewSize] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: cats, isLoading } = useQuery({
    queryKey: ['size-master-categories', 'v2'],
    queryFn: getSizeMasterCategories,
    staleTime: 30 * 1000,
  });

  const { data: sizes, isLoading: sizesLoading } = useQuery({
    queryKey: ['size-master-sizes', selected],
    queryFn: () => getSizeMasterSizes(selected!),
    enabled: !!selected,
  });

  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ['size-master-audit', selected],
    queryFn: () => getSizeMasterAudit(selected!),
    enabled: !!selected && tab === 'history',
  });

  const all: SizeMasterCategory[] = cats ?? [];
  const divisions = useMemo(
    () => [...new Set(all.map((c) => c.division).filter((d): d is string => !!d))].sort(),
    [all],
  );

  const lower = search.trim().toLowerCase();
  const visible = all.filter(
    (c) =>
      (division === 'ALL' || c.division === division) &&
      (!lower ||
        c.majorCategory.toLowerCase().includes(lower) ||
        (c.sizes ?? []).some((s) => s.toLowerCase() === lower)),
  );

  // Group by division › sub-division for the list headers.
  const groups = useMemo(() => {
    const m = new Map<string, SizeMasterCategory[]>();
    visible.forEach((c) => {
      const key = [c.division || 'Unassigned', c.subDivision].filter(Boolean).join(' · ');
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    });
    return [...m.entries()];
  }, [visible]);

  // Keep something selected so the right pane is never empty.
  useEffect(() => {
    if (!selected && visible[0]) setSelected(visible[0].majorCategory);
  }, [visible, selected]);

  const current = all.find((c) => c.majorCategory === selected) ?? null;
  const sortedSizes = useMemo(() => [...(sizes ?? [])].sort((a, b) => compareSizes(a.size, b.size)), [sizes]);

  // Quick add: sizes sibling categories (same sub-division) use that this one lacks.
  const suggestions = useMemo(() => {
    if (!current?.subDivision) return [];
    const have = new Set((sizes ?? []).map((s) => s.size.trim().toUpperCase()));
    const seen = new Set<string>();
    all
      .filter((c) => c.subDivision === current.subDivision && c.majorCategory !== current.majorCategory)
      .forEach((c) => (c.sizes ?? []).forEach((s) => { if (!have.has(s.trim().toUpperCase())) seen.add(s.trim()); }));
    return sortSizes([...seen]).slice(0, 8);
  }, [all, current, sizes]);

  const newCandidate = search.trim().toUpperCase();

  const pick = (mc: string) => {
    setSelected(mc);
    setTab('sizes');
    setPending(null);
    setRemarks('');
    setNewSize('');
  };

  const startAdd = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if ((sizes ?? []).some((s) => s.size.trim().toUpperCase() === v.toUpperCase())) {
      message.warning(`"${v}" already exists for ${selected}`);
      return;
    }
    setRemarks('');
    setPending({ kind: 'add', size: v });
  };

  const confirm = async () => {
    const r = remarks.trim();
    if (!r || !pending || !selected) return;
    setBusy(true);
    try {
      if (pending.kind === 'add') {
        await addSizeMasterSize(selected, pending.size, r);
        setNewSize('');
        message.success(`Added "${pending.size}"`);
      } else {
        await deleteSizeMasterSize(pending.id, r);
        message.success(`Removed "${pending.size}"`);
      }
      qc.invalidateQueries({ queryKey: ['size-master-sizes', selected] });
      qc.invalidateQueries({ queryKey: ['size-master-categories', 'v2'] }); // counts / previews change
      qc.invalidateQueries({ queryKey: ['size-master-audit', selected] });
      setPending(null);
      setRemarks('');
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) =>
    cn(
      'h-[30px] rounded-full border px-3 text-xs font-semibold transition-colors',
      on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-800',
    );

  return (
    <div className="grid h-[70vh] min-h-[520px] grid-cols-1 overflow-hidden rounded-[14px] border border-slate-200 bg-white md:grid-cols-[380px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-950">
      {/* ── Left · major categories ── */}
      <section aria-label="Major categories" className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          {paneSearch(search, setSearch, 'Find major category or size')}
          <div className="flex flex-wrap gap-1.5">
            {['ALL', ...divisions].map((d) => (
              <button key={d} type="button" aria-pressed={division === d} onClick={() => setDivision(d)} className={chip(division === d)}>
                {d === 'ALL' ? 'All' : d}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {isLoading && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading major categories…
            </div>
          )}
          {groups.map(([label, list]) => (
            <div key={label} className="mb-1.5">
              <div className="flex justify-between px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-600">
                <span>{label}</span>
                <span>{list.length}</span>
              </div>
              {list.map((c) => {
                const on = c.majorCategory === selected;
                const ordered = sortSizes(c.sizes ?? []);
                const range = ordered.length > 1 ? `${ordered[0]} – ${ordered[ordered.length - 1]}` : ordered[0] ?? '—';
                return (
                  <button
                    key={c.majorCategory}
                    type="button"
                    onClick={() => pick(c.majorCategory)}
                    className={cn(
                      'flex min-h-[46px] w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-1 text-left transition-colors',
                      on ? 'bg-slate-800 text-white' : 'text-slate-900 hover:bg-slate-100',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs font-semibold">{c.majorCategory}</span>
                      <span className={cn('text-[11px]', on ? 'text-slate-300' : 'text-slate-600')}>{range}</span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2 text-[11px] font-semibold', on ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-700')}>
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!isLoading && visible.length === 0 && (
            <div className="px-2 py-3">
              <div className="text-xs text-slate-500">
                {lower ? `No major categories match “${search.trim()}”.` : 'No major categories with sizes.'}
              </div>
              {lower && newCandidate && (
                <button
                  type="button"
                  onClick={() => pick(newCandidate)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:border-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add sizes for <span className="font-mono">{newCandidate}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Right · sizes ── */}
      <section aria-label="Sizes" className="flex min-h-0 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty description="Pick a major category to see its sizes." />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-600">
                  {[current?.division, current?.subDivision].filter(Boolean).join(' › ') || 'New major category'}
                </div>
                <h2 className="m-0 mt-0.5 truncate font-mono text-[19px] font-semibold text-slate-900 dark:text-slate-50">{selected}</h2>
              </div>
              <div role="tablist" aria-label="View" className="flex rounded-[9px] bg-slate-100 p-[3px] dark:bg-slate-800">
                {(['sizes', 'history'] as const).map((t) => (
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
                    {t === 'sizes' ? `Sizes · ${sortedSizes.length}` : (<><History className="h-3.5 w-3.5" /> History</>)}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'sizes' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a size, e.g. XL, 32, 7-8Y"
                    value={newSize}
                    onChange={(e) => setNewSize(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startAdd(newSize); } }}
                    disabled={busy || !!pending}
                    className="h-10"
                  />
                  <Button
                    onClick={() => startAdd(newSize)}
                    disabled={busy || !!pending || !newSize.trim()}
                    className="h-10 bg-slate-800 px-4 font-semibold text-white hover:bg-slate-900"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-600">In size order</span>
                  {sizesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sizes…
                    </div>
                  ) : sortedSizes.length === 0 ? (
                    <Empty description="No sizes yet — add the first one above." className="my-4" />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {sortedSizes.map((s) => {
                        const removing = pending?.kind === 'delete' && pending.id === s.id;
                        return (
                          <span
                            key={s.id}
                            className={cn(
                              'flex h-10 items-center gap-1 rounded-[10px] border pl-4 pr-1.5 text-[15px] font-semibold',
                              removing
                                ? 'border-red-300 bg-red-50 text-red-800 line-through'
                                : 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50',
                            )}
                          >
                            {s.size}
                            <button
                              type="button"
                              onClick={() => { setRemarks(''); setPending({ kind: 'delete', id: s.id, size: s.size }); }}
                              disabled={busy || !!pending}
                              aria-label={`Remove ${s.size}`}
                              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {suggestions.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-600">
                      Quick add — sizes other {current?.subDivision} categories use
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => startAdd(s)}
                          disabled={busy || !!pending}
                          className="h-8 rounded-lg border border-dashed border-slate-400 bg-white px-3 text-[13px] font-semibold text-slate-800 hover:border-slate-800 disabled:opacity-40"
                        >
                          + {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline reason bar — required before any add/remove commits */}
                {pending && (
                  <div className="mt-auto flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/40">
                    <span className="text-[12.5px] text-slate-900 dark:text-slate-100">
                      <b>{pending.kind === 'add' ? 'Add' : 'Remove'} “{pending.size}”</b> {pending.kind === 'add' ? 'to' : 'from'}{' '}
                      <span className="font-mono">{selected}</span> — a reason is required and saved with your name.
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        autoFocus
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } if (e.key === 'Escape') setPending(null); }}
                        placeholder="Reason"
                        aria-label="Reason"
                        className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[12.5px] outline-none focus:border-slate-800"
                      />
                      <Button variant="outline" onClick={() => { setPending(null); setRemarks(''); }} disabled={busy} className="h-9 border-slate-300">
                        Cancel
                      </Button>
                      <Button
                        onClick={confirm}
                        disabled={busy || !remarks.trim()}
                        className={cn('h-9 font-semibold text-white', pending.kind === 'delete' ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-900')}
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
                  <Empty description="No changes recorded yet for this major category." className="my-6" />
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
                          <span className="font-mono text-[13px] font-semibold">{a.size}</span>
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
