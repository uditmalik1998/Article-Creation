import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  ArrowLeft,
  Search,
  ArrowUpDown,
  Pencil,
  Trash2,
  Plus,
  ClipboardList,
  Download,
  Info,
  X,
  Percent,
  Clock,
  Columns3,
  MoreHorizontal,
  FileDown,
  Copy,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import {
  getExpenseColumnOptions,
  getExpenseTableData,
  getExpenseTablePendingRows,
  getExpenseTableStats,
  getMyExpenseAccess,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS, type ExpenseTableColumnConfig } from '../config/expenseTables';
import { TABLE_META, sectionLabel } from '../config/expenseSections';
import { RowChangeRequestDialog, type RowChangeMode } from '../components/RowChangeRequestDialog';
import { GridContributionPanel } from '../components/GridContributionPanel';
import { CopyMajorCategoryDialog } from '../components/CopyMajorCategoryDialog';
import { ColumnCheckboxFilter } from '../components/ColumnCheckboxFilter';
import { SLATE_PRIMARY_BTN } from '../components/DashboardParts';

/** Tables with a full "download master" export — admin-only, wired up ad hoc
 * per table on the backend (e.g. GET /admin/fabric-article-data/export)
 * rather than through the generic paginated read used for the on-page table.
 * `typeColumn`, when set, names the filterable column (e.g. Fabric/Body
 * Article Type — "uploader" vs "FG") whose distinct values populate an
 * "Article Type" dropdown next to the button, sent through as ?articleType=
 * so the download can be scoped instead of always exporting every row. */
const DOWNLOAD_MASTER_TABLE_KEYS: Record<string, { endpoint: string; filenamePrefix: string; typeColumn?: string }> = {
  'fabric-article-data': { endpoint: '/admin/fabric-article-data/export', filenamePrefix: 'FABRIC_ARTICLE_DATA_MASTER', typeColumn: 'fabricArticleType' },
  'body-article-data': { endpoint: '/admin/body-article-data/export', filenamePrefix: 'BODY_ARTICLE_DATA_MASTER', typeColumn: 'bodyArticleType' },
};

const PAGE_SIZE = 50;

function renderCell(value: any, type?: ExpenseTableColumnConfig['type']) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-slate-300 dark:text-slate-600">—</span>;
  }
  if (type === 'date') {
    const d = dayjs(value);
    return <span className="whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-400">{d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value)}</span>;
  }
  if (type === 'percent') {
    return <span className="text-sm tabular-nums">{Number(value)}%</span>;
  }
  if (type === 'boolean') {
    const isTrue = value === true || value === 'true';
    return (
      <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${isTrue ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isTrue ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {isTrue ? 'Yes' : 'No'}
      </span>
    );
  }
  return <span className="text-sm">{String(value)}</span>;
}

const DENSITY_KEY = 'expenseTableDensity';
const hiddenColsKey = (tableKey: string) => `expenseTableHiddenCols:${tableKey}`;

function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;
  const min = dayjs().diff(d, 'minute');
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  if (min < 30 * 24 * 60) return `${Math.floor(min / 1440)}d ago`;
  return d.format('D MMM YYYY');
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CHECKBOX_CLASS = 'border-slate-400 data-[state=checked]:border-slate-800 data-[state=checked]:bg-slate-800 data-[state=checked]:text-white';

type RowDialog = { mode: RowChangeMode; row: Record<string, any> | null; bulkRows?: Record<string, any>[] };

export default function ExpenseTableDetailPage() {
  const { tableKey } = useParams<{ tableKey: string }>();
  const config = tableKey ? EXPENSE_TABLE_CONFIGS[tableKey] : undefined;
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>(config?.defaultSortBy ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(config?.defaultSortDir ?? 'desc');
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  // Major Category Grid: copy a whole major category as one bulk-add request.
  const [copyOpen, setCopyOpen] = useState(false);
  // Major Category Grid only: the Bgt / Pd Cont% block panel (replaces the
  // row panel while open — only one side panel at a time).
  const [contribution, setContribution] = useState<{ majorCategory: string; attributeName: string } | null | undefined>(undefined);
  // Excel-style column filters (checkbox multi-select), additive to the
  // search box above — separate state so one never clobbers the other.
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});

  // Table look — Compact / Comfortable rows and hidden columns — remembered
  // per viewer (hidden columns per table).
  const [density, setDensityState] = useState<'compact' | 'comfortable'>(() => readStored(DENSITY_KEY, 'compact'));
  const setDensity = (d: 'compact' | 'comfortable') => {
    setDensityState(d);
    writeStored(DENSITY_KEY, d);
  };
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => (tableKey ? readStored(hiddenColsKey(tableKey), []) : []));
  useEffect(() => {
    if (tableKey) setHiddenCols(readStored(hiddenColsKey(tableKey), []));
  }, [tableKey]);
  const toggleColumn = (dataIndex: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(dataIndex) ? prev.filter((c) => c !== dataIndex) : [...prev, dataIndex];
      if (tableKey) writeStored(hiddenColsKey(tableKey), next);
      return next;
    });
  };

  // Rows ticked for a bulk "propose delete" — current page only, cleared on
  // any page / search / filter / sort change.
  const [selected, setSelected] = useState<Record<string, Record<string, any>>>({});
  useEffect(() => {
    setSelected({});
  }, [tableKey, page, pageSize, appliedSearch, sortBy, sortDir, columnFilters]);

  // Which buttons to show. The server re-checks every action, so a stale or
  // over-generous answer here can't actually grant anything.
  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['my-expense-access', tableKey],
    queryFn: () => getMyExpenseAccess(tableKey!),
    enabled: !!tableKey && !!config,
    staleTime: 60_000,
  });

  // Admin has its own full Expenses dashboard; everyone else (Creator,
  // Approver, Category Head, ...) enters through the simplified masters
  // cards page — the back arrow must return to whichever one they came from,
  // not unconditionally to the admin-only route (which just bounces a
  // non-admin straight back out to the app's home page).
  const backHref = access?.isAdmin ? '/admin/expenses' : '/admin/expense-masters';

  const hasEditableColumns = !!config?.columns.some((c) => c.editable !== false);
  const canAdd = !!config?.allowCreate && !!access?.canCreate;
  const canEdit = hasEditableColumns && !!access?.canUpdate;
  const canDelete = !!config?.allowDelete && !!access?.canDelete;
  const canFillContribution = tableKey === 'major-category-grid' && (access?.contribution?.creator.length ?? 0) > 0;
  const openContribution = (block: { majorCategory: string; attributeName: string } | null) => {
    setDialog(null);
    setContribution(block);
  };
  const openRowDialog = (next: RowDialog) => {
    setContribution(undefined);
    setDialog(next);
  };

  const downloadMaster = tableKey ? DOWNLOAD_MASTER_TABLE_KEYS[tableKey] : undefined;
  const canDownloadMaster = !!downloadMaster && !!access?.isAdmin;
  const [downloadingMaster, setDownloadingMaster] = useState(false);
  // 'all' or one of the article-type column's distinct values (e.g.
  // "uploader" / "FG") — scopes the export, reset whenever the table changes.
  const [downloadArticleType, setDownloadArticleType] = useState<string>('all');

  const handleDownloadMaster = async () => {
    if (!downloadMaster) return;
    setDownloadingMaster(true);
    try {
      const token = localStorage.getItem('authToken');
      // `baseURL` may be a relative path (e.g. "/api" in production), so the
      // URL is resolved against the current origin rather than parsed bare.
      const url = new URL(`${APP_CONFIG.api.baseURL}${downloadMaster.endpoint}`, window.location.origin);
      if (downloadMaster.typeColumn && downloadArticleType !== 'all') {
        url.searchParams.set('articleType', downloadArticleType);
      }
      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download master file');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const suffix = downloadMaster.typeColumn && downloadArticleType !== 'all' ? `_${downloadArticleType.toUpperCase()}` : '';
      a.download = `${downloadMaster.filenamePrefix}${suffix}_${dayjs().format('YYYY-MM-DD')}.xlsx`;
      a.click();
    } catch (err: any) {
      message.error(err?.message || 'Failed to download master file');
    } finally {
      setDownloadingMaster(false);
    }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-table', tableKey, page, pageSize, appliedSearch, sortBy, sortDir, columnFilters],
    queryFn: () =>
      getExpenseTableData(tableKey!, {
        page,
        limit: pageSize,
        search: appliedSearch || undefined,
        sortBy: sortBy || undefined,
        sortDir,
        filters: columnFilters,
      }),
    // Don't fire the table read until access is known — a user with none
    // would just get a 403 back.
    enabled: !!tableKey && !!config && access?.canView === true,
    placeholderData: keepPreviousData,
  });

  // Header facts (rows / last change / open requests) — the same query as
  // the Expense Data cards page, so it is usually already cached.
  const { data: stats } = useQuery({
    queryKey: ['expense-table-stats'],
    queryFn: getExpenseTableStats,
    staleTime: 60_000,
    enabled: !!config && access?.canView === true,
  });

  // rowId → open request kind, for the Request column and to stop a second
  // request being raised on the same row.
  const { data: pendingRows = {} } = useQuery({
    queryKey: ['expense-table-pending-rows', tableKey],
    queryFn: () => getExpenseTablePendingRows(tableKey!),
    enabled: !!tableKey && !!config && access?.canView === true,
    staleTime: 30_000,
  });

  // One options query per filterable column, feeding its header checkbox
  // dropdown — cheap and cached, same pattern as the add/edit form's
  // pick-from-existing dropdowns.
  const filterableColumns = (config?.columns ?? []).filter((c) => c.filterable);
  const filterOptionQueries = useQueries({
    queries: filterableColumns.map((col) => ({
      queryKey: ['expense-column-options', tableKey, col.dataIndex],
      queryFn: () => getExpenseColumnOptions(tableKey!, col.dataIndex),
      enabled: !!tableKey && !!config,
      staleTime: 5 * 60_000,
    })),
  });
  const filterOptionsByColumn: Record<string, { options: string[]; loading: boolean }> = {};
  filterableColumns.forEach((col, i) => {
    filterOptionsByColumn[col.dataIndex] = {
      options: filterOptionQueries[i]?.data ?? [],
      loading: filterOptionQueries[i]?.isLoading ?? false,
    };
  });

  if (!tableKey || !config) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/admin/expense-masters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Data
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Unknown table: <span className="font-mono">{tableKey}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!accessLoading && access && !access.canView) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You don't have access to Expense Data. Ask an admin to set your Business Division on the Users page.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const stat = stats?.[tableKey];
  const meta = TABLE_META[tableKey];
  const shortTitle = config.title.split(' (')[0];
  const updated = timeAgo(stat?.updatedAt);

  const handleApplySearch = () => {
    setPage(1);
    setAppliedSearch(draftSearch);
  };

  const keyOf = (record: Record<string, any>) => String(record[config.rowKey]);
  const pendingOf = (record: Record<string, any>) => pendingRows[keyOf(record)];
  const selectableRows = rows.filter((r) => !pendingOf(r));
  const selectedRows = Object.values(selected);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected[keyOf(r)]);
  const someSelected = selectedRows.length > 0 && !allSelected;
  const toggleRow = (record: Record<string, any>) =>
    setSelected((prev) => {
      const next = { ...prev };
      const k = keyOf(record);
      if (next[k]) delete next[k];
      else next[k] = record;
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? {} : Object.fromEntries(selectableRows.map((r) => [keyOf(r), r])));

  // The surrogate primary key (Supabase's own row id) isn't meaningful to a
  // viewer — every table names it 'id' — so it's dropped here, in the table
  // view only; it's still on the underlying row data for actions/rowKey.
  const dataColumnsAll = config.columns.filter((col) => col.dataIndex !== 'id');
  const dataColumns = dataColumnsAll.filter((col) => !hiddenCols.includes(col.dataIndex));

  const columns: DataTableColumn<Record<string, any>>[] = [];

  if (canDelete) {
    columns.push({
      title: (
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={toggleAll}
          aria-label="Select all rows on this page"
          className={CHECKBOX_CLASS}
        />
      ),
      key: '__select',
      width: 44,
      align: 'center',
      render: (_v, record) => (
        <Checkbox
          checked={!!selected[keyOf(record)]}
          disabled={!!pendingOf(record)}
          onCheckedChange={() => toggleRow(record)}
          aria-label="Select row"
          className={CHECKBOX_CLASS}
        />
      ),
    });
  }

  columns.push({
    title: '#',
    key: '__index',
    width: 60,
    align: 'right',
    render: (_v, _r, index) => <span className="text-xs tabular-nums text-muted-foreground">{(page - 1) * pageSize + index + 1}</span>,
  });

  for (const col of dataColumns) {
    columns.push({
      title: col.filterable ? (
        <span className="flex min-w-0 items-center justify-between gap-1">
          <span className="truncate">{col.title}</span>
          <ColumnCheckboxFilter
            label={col.title}
            options={filterOptionsByColumn[col.dataIndex]?.options ?? []}
            loading={filterOptionsByColumn[col.dataIndex]?.loading ?? false}
            selected={columnFilters[col.dataIndex] ?? []}
            onApply={(values) => {
              setPage(1);
              setColumnFilters((prev) => {
                const next = { ...prev };
                if (values.length > 0) next[col.dataIndex] = values;
                else delete next[col.dataIndex];
                return next;
              });
            }}
          />
        </span>
      ) : (
        col.title
      ),
      key: col.dataIndex,
      dataIndex: col.dataIndex,
      width: col.width,
      align: col.align,
      render: (value: any) => renderCell(value, col.type),
    });
  }

  columns.push({
    title: 'Request',
    key: '__request',
    width: 132,
    render: (_v, record) => {
      const p = pendingOf(record);
      if (!p) return <span className="text-sm text-slate-300 dark:text-slate-600">—</span>;
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          <Clock className="h-3 w-3" />
          {p === 'DELETE' ? 'Delete pending' : 'Edit pending'}
        </span>
      );
    },
  });

  if (canEdit || canDelete || canFillContribution) {
    columns.push({
      title: '',
      key: 'action',
      width: 52,
      align: 'center',
      fixed: 'right',
      render: (_v, record) => {
        const pending = !!pendingOf(record);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {pending && (
                <>
                  <DropdownMenuLabel className="text-[11.5px] font-medium text-amber-800">
                    A request is already waiting on this row.
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              {canFillContribution && (
                <DropdownMenuItem onSelect={() => openContribution({ majorCategory: record.major_category, attributeName: record.attribute_name })}>
                  <Percent className="h-4 w-4" /> Fill contribution %
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem disabled={pending} onSelect={() => openRowDialog({ mode: 'update', row: record })}>
                  <Pencil className="h-4 w-4" /> Propose edit
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  disabled={pending}
                  className="text-red-700 focus:text-red-800 dark:text-red-400"
                  onSelect={() => openRowDialog({ mode: 'delete', row: record })}
                >
                  <Trash2 className="h-4 w-4" /> Propose delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  // The current page's visible columns as CSV — a quick copy of what's on
  // screen (the admin "Download master" export stays for whole tables).
  const exportPageCsv = () => {
    const header = dataColumns.map((c) => csvCell(c.title)).join(',');
    const lines = rows.map((r) => dataColumns.map((c) => csvCell(r[c.dataIndex])).join(','));
    const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tableKey}_page${page}_${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const activeFilters = Object.entries(columnFilters).filter(([, values]) => values.length > 0);
  const columnTitle = (dataIndex: string) => config.columns.find((c) => c.dataIndex === dataIndex)?.title ?? dataIndex;
  const removeFilter = (dataIndex: string) => {
    setPage(1);
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[dataIndex];
      return next;
    });
  };

  const onRequestSubmitted = () => {
    setDialog(null);
    setSelected({});
    queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] });
    queryClient.invalidateQueries({ queryKey: ['expense-table-pending-rows', tableKey] });
    queryClient.invalidateQueries({ queryKey: ['expense-table-stats'] });
  };

  const toolBtn = 'h-8 border-slate-300 bg-white text-[12.5px] dark:border-slate-600 dark:bg-slate-900';

  return (
    <div className="flex min-h-full flex-col gap-3 bg-slate-50 p-4 dark:bg-slate-950">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link to={backHref} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {access?.isAdmin ? 'Admin Dashboard' : 'Expense Data'}
        </Link>
        <span aria-hidden="true" className="text-slate-300">/</span>
        <span className="text-slate-700 dark:text-slate-300">{sectionLabel(tableKey)}</span>
        <span aria-hidden="true" className="text-slate-300">/</span>
        <span className="font-semibold text-foreground">{shortTitle}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight">{shortTitle}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
            <span className="font-bold text-foreground">{(stat?.rows ?? total).toLocaleString('en-IN')} rows</span>
            {meta && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{meta.table}</span>
              </>
            )}
            {updated && (
              <>
                <span aria-hidden="true">·</span>
                <span title={stat?.updatedAt ? dayjs(stat.updatedAt).format('D MMM YYYY, HH:mm') : undefined}>Updated {updated}</span>
              </>
            )}
            {(stat?.pending ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                <Clock className="h-3 w-3" />
                {stat!.pending} pending
              </span>
            )}
          </div>
          {meta?.usedFor && <p className="mt-0.5 text-[12.5px] text-slate-600 dark:text-slate-400">Used for: {meta.usedFor}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline" className="bg-white dark:bg-slate-900">
            <Link to="/admin/expense-change-requests">
              <ClipboardList className="h-4 w-4" />
              Change requests
            </Link>
          </Button>
          {canDownloadMaster && downloadMaster?.typeColumn && (
            <Select value={downloadArticleType} onValueChange={setDownloadArticleType}>
              <SelectTrigger className="h-8 w-40 bg-white text-[13px] dark:bg-slate-900">
                <SelectValue placeholder="Article Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Article Types</SelectItem>
                {(filterOptionsByColumn[downloadMaster.typeColumn]?.options ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canDownloadMaster && (
            <Button size="sm" variant="outline" className="bg-white dark:bg-slate-900" onClick={handleDownloadMaster} disabled={downloadingMaster}>
              <Download className="h-4 w-4" />
              {downloadingMaster ? 'Downloading…' : 'Download master'}
            </Button>
          )}
          {canFillContribution && (
            <Button size="sm" variant="outline" className="bg-white dark:bg-slate-900" onClick={() => openContribution(null)}>
              <Percent className="h-4 w-4" />
              Fill contribution %
            </Button>
          )}
          {canAdd && tableKey === 'major-category-grid' && (
            <Button size="sm" variant="outline" className="bg-white dark:bg-slate-900" onClick={() => setCopyOpen(true)}>
              <Copy className="h-4 w-4" />
              Copy major category
            </Button>
          )}
          {canAdd && (
            <Button size="sm" className={SLATE_PRIMARY_BTN} onClick={() => openRowDialog({ mode: 'create', row: null })}>
              <Plus className="h-4 w-4" />
              Propose new row
            </Button>
          )}
        </div>
      </div>

      {(canAdd || canEdit || canDelete) && (
        <div role="note" className="flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[12.5px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Changes here are <strong className="text-slate-900 dark:text-slate-100">requests</strong> — each needs a reason and a
            needed-by date, then goes through approval before it changes the master.
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
        {/* The shared DataTable paints its header, sticky columns and borders
            with the theme's warm beige tokens — re-pointed here to white /
            slate so the whole table reads white, as in the design. */}
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white [--color-background:#ffffff] [--color-border:#e2e8f0] [--color-muted:#f1f5f9] [&_thead]:bg-white dark:border-slate-700 dark:bg-slate-900 dark:[--color-background:hsl(220_14%_12%)] dark:[--color-border:hsl(220_10%_22%)] dark:[--color-muted:hsl(220_10%_18%)] dark:[&_thead]:bg-[hsl(220_14%_12%)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="relative w-full sm:w-[280px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 bg-white pl-9 text-[13px] hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-slate-400/25 dark:bg-slate-900"
                placeholder="Search… (press Enter)"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplySearch();
                }}
                aria-label="Search rows"
              />
            </div>
            <Button size="sm" variant="outline" className={toolBtn} onClick={handleApplySearch}>
              Search
            </Button>
            {activeFilters.map(([dataIndex, values]) => (
              <span key={dataIndex} className="flex h-8 items-center gap-1 rounded-full bg-slate-800 pl-3 text-[12px] text-white dark:bg-slate-200 dark:text-slate-900">
                <span className="opacity-70">{columnTitle(dataIndex)}:</span>
                <strong className="max-w-[220px] truncate font-semibold" title={values.join(', ')}>
                  {values.length > 2 ? `${values.slice(0, 2).join(', ')} +${values.length - 2}` : values.join(', ')}
                </strong>
                <button
                  type="button"
                  onClick={() => removeFilter(dataIndex)}
                  aria-label={`Remove ${columnTitle(dataIndex)} filter`}
                  className="flex h-8 w-7 items-center justify-center rounded-full opacity-80 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {activeFilters.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  setColumnFilters({});
                }}
                className="px-1 text-[12.5px] font-semibold text-slate-800 underline underline-offset-2 dark:text-slate-200"
              >
                Clear filters
              </button>
            )}

            <div className="flex-1" />

            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                value={sortBy}
                onValueChange={(v) => {
                  setSortBy(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-44 bg-white text-[12.5px] dark:bg-slate-900" aria-label="Sort by">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {config.columns.map((col) => (
                    <SelectItem key={col.dataIndex} value={col.dataIndex}>
                      Sort: {col.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className={toolBtn}
                onClick={() => {
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  setPage(1);
                }}
                aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'} — click to flip`}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortDir === 'asc' ? 'Asc' : 'Desc'}
              </Button>

              <div role="radiogroup" aria-label="Row density" className="inline-flex rounded-lg bg-slate-200 p-0.5 dark:bg-slate-800">
                {(['compact', 'comfortable'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={density === d}
                    onClick={() => setDensity(d)}
                    className={`rounded-md px-2.5 py-1 text-[12px] font-semibold capitalize transition ${
                      density === d ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className={toolBtn}>
                    <Columns3 className="h-3.5 w-3.5" />
                    Columns
                    {hiddenCols.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-bold dark:bg-slate-700">{dataColumnsAll.length - dataColumns.length} hidden</span>}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Show columns</DropdownMenuLabel>
                  {dataColumnsAll.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.dataIndex}
                      checked={!hiddenCols.includes(col.dataIndex)}
                      // Keep at least one column on screen.
                      disabled={!hiddenCols.includes(col.dataIndex) && dataColumns.length === 1}
                      onCheckedChange={() => toggleColumn(col.dataIndex)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {col.title}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {hiddenCols.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          setHiddenCols([]);
                          writeStored(hiddenColsKey(tableKey), []);
                        }}
                      >
                        Show all columns
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button size="sm" variant="outline" className={toolBtn} onClick={exportPageCsv} disabled={rows.length === 0} title="Download the rows on this page as CSV">
                <FileDown className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>

          {canDelete && selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-slate-800 px-4 py-2 text-[12.5px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900">
              <span>
                {selectedRows.length} row{selectedRows.length === 1 ? '' : 's'} selected
              </span>
              <span aria-hidden="true" className="opacity-40">|</span>
              <button
                type="button"
                onClick={() => openRowDialog({ mode: 'delete', row: null, bulkRows: selectedRows })}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-white/10 dark:hover:bg-black/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Propose delete for {selectedRows.length}
              </button>
              <button
                type="button"
                onClick={() => setSelected({})}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 opacity-80 hover:bg-white/10 hover:opacity-100 dark:hover:bg-black/10"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          )}

          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {isError ? (
              <div className="py-10 text-center text-sm text-red-600">Failed to load data. Please try again.</div>
            ) : (
              <DataTable
                columns={columns}
                dataSource={rows}
                loading={isLoading}
                rowKey={config.rowKey}
                size={density === 'compact' ? 'small' : 'middle'}
                sticky
                resizableColumns
                scroll={{ x: 1100, y: '100%' }}
                className="min-h-0 flex-1"
                rowClassName={(record) =>
                  selected[keyOf(record)] || (dialog?.row && dialog.row[config.rowKey] === record[config.rowKey])
                    ? 'bg-slate-100 dark:bg-slate-500/15'
                    : ''
                }
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  pageSizeOptions: ['25', '50', '100', '200'],
                  onChange: (p, ps) => {
                    setPage(p);
                    if (ps !== pageSize) setPageSize(ps);
                  },
                }}
                locale={{ emptyText: 'No records found.' }}
              />
            )}
          </CardContent>
        </Card>

        {contribution !== undefined && access?.contribution && (
          <GridContributionPanel
            key={contribution ? `${contribution.majorCategory}||${contribution.attributeName}` : 'new'}
            scope={access.contribution}
            initial={contribution}
            onClose={() => setContribution(undefined)}
            onSubmitted={() => queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] })}
          />
        )}

        {tableKey === 'major-category-grid' && (
          <CopyMajorCategoryDialog
            open={copyOpen}
            onClose={() => setCopyOpen(false)}
            onSubmitted={() => {
              setCopyOpen(false);
              onRequestSubmitted();
            }}
          />
        )}

        {dialog && (
          <RowChangeRequestDialog
            key={`${dialog.mode}:${dialog.bulkRows ? `bulk-${dialog.bulkRows.length}` : dialog.row ? String(dialog.row[config.rowKey]) : 'new'}`}
            variant="dialog"
            open
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            tableKey={tableKey}
            config={config}
            mode={dialog.mode}
            row={dialog.row}
            bulkRows={dialog.bulkRows}
            onSubmitted={onRequestSubmitted}
          />
        )}
      </div>
    </div>
  );
}
