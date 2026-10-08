import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Search, ArrowUpDown, Pencil, Trash2, Plus, ClipboardList, Download, Info, X, Percent } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
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
import { getExpenseColumnOptions, getExpenseTableData, getMyExpenseAccess } from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS, type ExpenseTableColumnConfig } from '../config/expenseTables';
import { RowChangeRequestDialog, type RowChangeMode } from '../components/RowChangeRequestDialog';
import { GridContributionPanel } from '../components/GridContributionPanel';
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
    return <span className="text-muted-foreground italic text-sm">—</span>;
  }
  if (type === 'date') {
    const d = dayjs(value);
    return <span className="text-xs whitespace-nowrap">{d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value)}</span>;
  }
  if (type === 'percent') {
    return <span className="text-sm tabular-nums">{Number(value)}%</span>;
  }
  if (type === 'boolean') {
    const isTrue = value === true || value === 'true';
    return (
      <Badge className={isTrue ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}>
        {isTrue ? 'Yes' : 'No'}
      </Badge>
    );
  }
  return <span className="text-sm">{String(value)}</span>;
}

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
  const [dialog, setDialog] = useState<{ mode: RowChangeMode; row: Record<string, any> | null } | null>(null);
  // Major Category Grid only: the Bgt / Pd Cont% block panel (replaces the
  // row panel while open — only one side panel at a time).
  const [contribution, setContribution] = useState<{ majorCategory: string; attributeName: string } | null | undefined>(undefined);
  // Excel-style column filters (checkbox multi-select), additive to the
  // search box above — separate state so one never clobbers the other.
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});

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
  const openRowDialog = (next: { mode: RowChangeMode; row: Record<string, any> | null }) => {
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

  const handleApplySearch = () => {
    setPage(1);
    setAppliedSearch(draftSearch);
  };

  // The surrogate primary key (Supabase's own row id) isn't meaningful to a
  // viewer — every table names it 'id' — so it's dropped here, in the table
  // view only; it's still on the underlying row data for actions/rowKey.
  const columns: DataTableColumn<Record<string, any>>[] = config.columns
    .filter((col) => col.dataIndex !== 'id')
    .map((col) => ({
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
    }));

  if (canEdit || canDelete || canFillContribution) {
    columns.push({
      title: '',
      key: 'action',
      width: 12 + 40 * [canEdit, canDelete, canFillContribution].filter(Boolean).length,
      align: 'center',
      fixed: 'right',
      render: (_v, record) => (
        <div className="flex items-center justify-center gap-1">
          {canFillContribution && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => openContribution({ majorCategory: record.major_category, attributeName: record.attribute_name })}
              title="Fill contribution % for this attribute"
              aria-label="Fill contribution % for this row's attribute"
            >
              <Percent className="h-4 w-4" />
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => openRowDialog({ mode: 'update', row: record })}
              title="Propose an edit"
              aria-label="Propose an edit to this row"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={() => openRowDialog({ mode: 'delete', row: record })}
              title="Propose a deletion"
              aria-label="Propose deleting this row"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    });
  }

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

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link to={backHref} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            {access?.isAdmin ? 'Admin Dashboard' : 'Expense Data'}
          </Link>
          <span aria-hidden="true">›</span>
          <span className="font-semibold text-foreground">{config.title}</span>
        </nav>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight">{config.title}</h1>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
            {total > 0 && <span className="font-medium text-foreground">{total.toLocaleString('en-IN')} rows</span>}
            <span>{config.description}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/expense-change-requests">
              <ClipboardList className="h-4 w-4" />
              Change requests
            </Link>
          </Button>
          {canDownloadMaster && downloadMaster?.typeColumn && (
            <Select value={downloadArticleType} onValueChange={setDownloadArticleType}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
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
            <Button size="sm" variant="outline" onClick={handleDownloadMaster} disabled={downloadingMaster}>
              <Download className="h-4 w-4" />
              {downloadingMaster ? 'Downloading…' : 'Download master'}
            </Button>
          )}
          {canFillContribution && (
            <Button size="sm" variant="outline" onClick={() => openContribution(null)}>
              <Percent className="h-4 w-4" />
              Fill contribution %
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
        <div role="note" className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700 dark:border-slate-600 dark:bg-slate-500/10 dark:text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Adds, edits and deletions here are <strong>requests</strong>. Each needs a reason and a “needed by” date, and goes
            through the approval chain before it changes the master.
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-slate-400/25"
                placeholder="Search… (press Enter)"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplySearch();
                }}
                aria-label="Search rows"
              />
            </div>
            <Button size="sm" variant="outline" onClick={handleApplySearch}>
              Search
            </Button>
            {activeFilters.map(([dataIndex, values]) => (
              <span key={dataIndex} className="flex h-8 items-center gap-1 rounded-full bg-slate-100 pl-3 text-[12.5px] dark:bg-slate-500/15">
                <span className="text-muted-foreground">{columnTitle(dataIndex)}</span>
                <strong className="max-w-[220px] truncate font-semibold" title={values.join(', ')}>
                  {values.length > 2 ? `${values.slice(0, 2).join(', ')} +${values.length - 2}` : values.join(', ')}
                </strong>
                <button
                  type="button"
                  onClick={() => removeFilter(dataIndex)}
                  aria-label={`Remove ${columnTitle(dataIndex)} filter`}
                  className="flex h-8 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {activeFilters.length > 1 && (
              <button
                type="button"
                onClick={() => { setPage(1); setColumnFilters({}); }}
                className="px-1 text-[12.5px] font-semibold text-slate-800 underline underline-offset-2 dark:text-slate-200"
              >
                Clear filters
              </button>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">Sort</span>
              <Select
                value={sortBy}
                onValueChange={(v) => {
                  setSortBy(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-48 text-[13px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {config.columns.map((col) => (
                    <SelectItem key={col.dataIndex} value={col.dataIndex}>
                      {col.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  setPage(1);
                }}
                aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'} — click to flip`}
              >
                <ArrowUpDown className="h-4 w-4" />
                {sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            </div>
          </div>

          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {isError ? (
              <div className="py-10 text-center text-sm text-red-600">Failed to load data. Please try again.</div>
            ) : (
              <DataTable
                columns={columns}
                dataSource={rows}
                loading={isLoading}
                rowKey={config.rowKey}
                size="small"
                sticky
                resizableColumns
                scroll={{ x: 1100, y: '100%' }}
                className="min-h-0 flex-1"
                rowClassName={(record) => (dialog?.row && dialog.row[config.rowKey] === record[config.rowKey] ? 'bg-slate-100 dark:bg-slate-500/15' : '')}
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

        {dialog && (
          <RowChangeRequestDialog
            key={`${dialog.mode}:${dialog.row ? String(dialog.row[config.rowKey]) : 'new'}`}
            variant="panel"
            open
            onOpenChange={(open) => { if (!open) setDialog(null); }}
            tableKey={tableKey}
            config={config}
            mode={dialog.mode}
            row={dialog.row}
            onSubmitted={() => {
              setDialog(null);
              queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] });
            }}
          />
        )}
      </div>
    </div>
  );
}
