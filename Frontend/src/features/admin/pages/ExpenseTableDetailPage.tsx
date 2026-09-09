import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Search, ArrowUpDown, Pencil, Trash2, Plus, ClipboardList } from 'lucide-react';
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
import { getExpenseTableData, getMyExpenseAccess } from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS, type ExpenseTableColumnConfig } from '../config/expenseTables';
import { RowChangeRequestDialog, type RowChangeMode } from '../components/RowChangeRequestDialog';

const PAGE_SIZE = 50;

function renderCell(value: any, type?: ExpenseTableColumnConfig['type']) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground italic text-sm">—</span>;
  }
  if (type === 'date') {
    const d = dayjs(value);
    return <span className="text-xs whitespace-nowrap">{d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value)}</span>;
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-table', tableKey, page, pageSize, appliedSearch, sortBy, sortDir],
    queryFn: () =>
      getExpenseTableData(tableKey!, {
        page,
        limit: pageSize,
        search: appliedSearch || undefined,
        sortBy: sortBy || undefined,
        sortDir,
      }),
    // Don't fire the table read until access is known — a user with none
    // would just get a 403 back.
    enabled: !!tableKey && !!config && access?.canView === true,
    placeholderData: keepPreviousData,
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

  const columns: DataTableColumn<Record<string, any>>[] = config.columns.map((col) => ({
    title: col.title,
    key: col.dataIndex,
    dataIndex: col.dataIndex,
    width: col.width,
    align: col.align,
    render: (value: any) => renderCell(value, col.type),
  }));

  if (canEdit || canDelete) {
    columns.push({
      title: '',
      key: 'action',
      width: canEdit && canDelete ? 92 : 52,
      align: 'center',
      fixed: 'right',
      render: (_v, record) => (
        <div className="flex items-center justify-center gap-0.5">
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setDialog({ mode: 'update', row: record })}
              title="Propose an edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setDialog({ mode: 'delete', row: record })}
              title="Propose a deletion"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <div className="flex h-full flex-col p-4 space-y-2">
      <div className="flex items-center justify-between">
        <Link to={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Data
        </Link>
        <Link
          to="/admin/expense-change-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-4 w-4" /> Change Requests
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold leading-tight">{config.title}</h1>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
        {canAdd && (
          <Button size="sm" onClick={() => setDialog({ mode: 'create', row: null })}>
            <Plus className="h-4 w-4" />
            Add Row
          </Button>
        )}
      </div>

      {(canAdd || canEdit || canDelete) && (
        <p className="text-xs text-muted-foreground">
          Adds, edits and deletions are requests, not direct changes: each one needs a reason and a “needed by” date,
          then Category Head review followed by MDM approval before it touches the master.
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 p-3 md:flex-row md:items-end">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search…"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApplySearch();
              }}
            />
          </div>

          <div className="w-full md:w-56">
            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
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
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
            title="Toggle sort direction"
          >
            <ArrowUpDown className="h-4 w-4" />
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </Button>

          <Button onClick={handleApplySearch}>Apply</Button>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {isError ? (
            <div className="py-10 text-center text-red-500 text-sm">Failed to load data. Please try again.</div>
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

      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString()} total record{total !== 1 ? 's' : ''}
        </p>
      )}

      {dialog && (
        <RowChangeRequestDialog
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
  );
}
