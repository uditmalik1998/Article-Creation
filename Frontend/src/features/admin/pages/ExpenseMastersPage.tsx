import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Clock, Eye, Lock, Pencil, Plus, Search, TableIcon } from 'lucide-react';
import { Card, CardContent } from '@/shared/components/ui-tw';
import { getExpenseTableStats, getMyExpenseAccess, type ExpenseTableStat } from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS, type ExpenseTableConfig } from '../config/expenseTables';
import { SECTIONS, TABLE_META, READ_ONLY_KEYS, HIDDEN_ON_EXPENSE_DATA_PAGE, type SectionKey } from '../config/expenseSections';

/**
 * The non-admin entry point into Expense Data: every master table, grouped by
 * the article type it feeds (FG / Fabric / GM / Body / Others). Summary tiles
 * on top, segmented section tabs, and one card per table with what it is used
 * for, its access, DB table, row count and last change. Add/edit/delete happen
 * on the table detail page each card links to, gated there per the viewer's
 * own access (role-based requester rights, or an explicit grant).
 */

const TAB_KEY = 'expenseDataTab';
type TabKey = 'ALL' | SectionKey;

function readTab(): TabKey {
  // ?section=FG (from a table page's breadcrumb) wins over the remembered tab.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('section');
    if (fromUrl && (fromUrl === 'ALL' || SECTIONS.some((s) => s.key === fromUrl))) {
      try { localStorage.setItem(TAB_KEY, fromUrl); } catch { /* storage blocked */ }
      return fromUrl as TabKey;
    }
  } catch { /* no window */ }
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === 'ALL' || SECTIONS.some((s) => s.key === v)) return v as TabKey;
  } catch { /* storage blocked */ }
  return 'ALL';
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function AccessBadge({ tableKey, cfg }: { tableKey: string; cfg: ExpenseTableConfig }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
  if (READ_ONLY_KEYS.has(tableKey)) {
    return <span className={`${base} bg-slate-100 text-slate-600`}><Lock className="h-3 w-3" />Read-only</span>;
  }
  if (cfg.allowCreate || cfg.allowDelete) {
    return <span className={`${base} bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900`}><Plus className="h-3 w-3" />Add · Edit · Delete</span>;
  }
  return <span className={`${base} bg-slate-100 text-slate-700`}><Pencil className="h-3 w-3" />Edit only</span>;
}

function TableCard({ tableKey, cfg, stat, statsLoading }: { tableKey: string; cfg: ExpenseTableConfig; stat?: ExpenseTableStat; statsLoading: boolean }) {
  const meta = TABLE_META[tableKey];
  const pending = stat?.pending ?? 0;
  return (
    <Link
      to={`/admin/expense/${tableKey}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition dark:bg-slate-900 hover:border-slate-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700"
    >
      <div className="flex flex-1 flex-col gap-1.5 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2">
          <TableIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 font-semibold leading-tight">{cfg.title.split(' (')[0]}</span>
          {pending > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              <Clock className="h-3 w-3" />{pending} pending
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400" title={cfg.description}>
          <span className="text-muted-foreground">Used for:</span> {meta?.usedFor ?? cfg.description}
        </p>
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          <AccessBadge tableKey={tableKey} cfg={cfg} />
          {meta && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {meta.table}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="border-r border-slate-200 px-4 py-2 dark:border-slate-700">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Rows</div>
          <div className="text-sm font-bold tabular-nums">{statsLoading ? '…' : stat ? stat.rows.toLocaleString('en-IN') : '—'}</div>
        </div>
        <div className="px-4 py-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Updated</div>
          <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-300" title={stat?.updatedAt ? new Date(stat.updatedAt).toLocaleString() : undefined}>
            {statsLoading ? '…' : timeAgo(stat?.updatedAt)}
          </div>
        </div>
      </div>
      <div className="border-t border-slate-200 px-4 py-2.5 dark:border-slate-700">
        <span className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-1.5 text-[12.5px] font-semibold text-slate-800 transition group-hover:border-slate-800 group-hover:bg-slate-800 group-hover:text-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          <Eye className="h-3.5 w-3.5" />View data
        </span>
      </div>
    </Link>
  );
}

export default function ExpenseMastersPage() {
  const [tab, setTabState] = useState<TabKey>(readTab);
  const [search, setSearch] = useState('');
  const setTab = (t: TabKey) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage blocked */ }
  };

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['my-expense-access', undefined],
    queryFn: () => getMyExpenseAccess(),
    staleTime: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['expense-table-stats'],
    queryFn: getExpenseTableStats,
    staleTime: 60_000,
    enabled: !accessLoading && !!access?.canView,
  });

  const visible = useMemo(
    () =>
      Object.entries(EXPENSE_TABLE_CONFIGS).filter(
        ([key]) =>
          !HIDDEN_ON_EXPENSE_DATA_PAGE.has(key) && (!access?.allowedTableKeys || access.allowedTableKeys.includes(key))
      ),
    [access]
  );

  const sectionOf = (key: string): SectionKey => TABLE_META[key]?.section ?? 'OTHERS';

  const totals = useMemo(() => {
    let rows = 0;
    let pending = 0;
    for (const [key] of visible) {
      rows += stats?.[key]?.rows ?? 0;
      pending += stats?.[key]?.pending ?? 0;
    }
    return { tables: visible.length, rows, pending, readOnly: visible.filter(([k]) => READ_ONLY_KEYS.has(k)).length };
  }, [visible, stats]);

  const q = search.trim().toLowerCase();
  const matches = (key: string, cfg: ExpenseTableConfig) =>
    !q ||
    cfg.title.toLowerCase().includes(q) ||
    (TABLE_META[key]?.table ?? '').toLowerCase().includes(q) ||
    (TABLE_META[key]?.usedFor ?? '').toLowerCase().includes(q);

  // Big tables first inside a section, so the main masters lead.
  const byRows = (a: [string, ExpenseTableConfig], b: [string, ExpenseTableConfig]) =>
    (stats?.[b[0]]?.rows ?? 0) - (stats?.[a[0]]?.rows ?? 0);

  const sectionsToShow = SECTIONS.filter((s) => tab === 'ALL' || s.key === tab)
    .map((s) => ({ ...s, items: visible.filter(([k, c]) => sectionOf(k) === s.key && matches(k, c)).sort(byRows) }))
    .filter((s) => s.items.length > 0);

  if (!accessLoading && access && !access.canView) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You don't have access to Grid Data. Ask an admin to set your Business Division on the Users page.
          </CardContent>
        </Card>
      </div>
    );
  }

  const kpis = [
    { label: 'Tables', value: String(totals.tables), sub: `across ${SECTIONS.filter((s) => visible.some(([k]) => sectionOf(k) === s.key)).length} sections` },
    { label: 'Pending requests', value: statsLoading ? '…' : String(totals.pending), sub: 'waiting for approval' },
    { label: 'Read-only', value: String(totals.readOnly), sub: 'synced or Excel-uploaded' },
    { label: 'Total rows', value: statsLoading ? '…' : totals.rows.toLocaleString('en-IN'), sub: 'in all these tables' },
  ];

  return (
    <div className="min-h-full space-y-4 bg-slate-50 p-6 dark:bg-slate-950">
      <div className="flex items-center justify-between">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Link
          to="/admin/expense-change-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-4 w-4" /> My Change Requests
          {totals.pending > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{totals.pending}</span>
          )}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Grid Data</h1>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
          Every master table behind the article pages. Open one to browse it, or to propose an add, edit or delete —
          each proposal needs a reason and a date, then goes through approval before it changes anything.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Sections" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {([{ key: 'ALL', label: 'All' }, ...SECTIONS] as { key: TabKey; label: string }[]).map((s) => {
            const count = s.key === 'ALL' ? visible.length : visible.filter(([k]) => sectionOf(k) === s.key).length;
            if (s.key !== 'ALL' && count === 0) return null;
            const on = tab === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(s.key)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  on
                    ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {s.label} <span className="font-medium opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search tables</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus-visible:border-slate-700 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:border-slate-600"
          />
        </label>
      </div>

      {sectionsToShow.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-muted-foreground">
          No tables match “{search}”.
        </div>
      ) : (
        sectionsToShow.map((s) => (
          <section key={s.key} className="space-y-2.5">
            {tab === 'ALL' && (
              <div className="flex items-center gap-2 pt-1">
                <h2 className="text-sm font-bold">{s.label}</h2>
                <span className="text-xs text-muted-foreground">
                  {s.items.length} table{s.items.length === 1 ? '' : 's'}
                </span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {s.items.map(([key, cfg]) => (
                <TableCard key={key} tableKey={key} cfg={cfg} stat={stats?.[key]} statsLoading={statsLoading} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
