import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Search, ArrowUpDown, Pencil, ClipboardList } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { getExpenseTableData } from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS, type ExpenseTableColumnConfig } from '../config/expenseTables';
import { EditRowDialog } from '../components/EditRowDialog';

function getCurrentUser(): { id: number; role: string } | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

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

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>(config?.defaultSortBy ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(config?.defaultSortDir ?? 'desc');
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);

  const currentUser = getCurrentUser();
  const canEdit = currentUser?.role === 'CREATOR' || currentUser?.role === 'ADMIN';
  const hasEditableColumns = !!config?.columns.some((c) => c.editable !== false);

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
    enabled: !!tableKey && !!config,
    placeholderData: keepPreviousData,
  });

  if (!tableKey || !config) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Unknown table: <span className="font-mono">{tableKey}</span>
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
    render: (value: any) => renderCell(value, col.type),
  }));

  if (canEdit && hasEditableColumns) {
    columns.push({
      title: '',
      key: 'action',
      width: 60,
      align: 'center',
      render: (_v, record) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setEditingRow(record)}
          title="Propose an edit"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        <Link
          to="/admin/expense-change-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-4 w-4" /> Change Requests
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{config.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{config.description}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search &amp; Sort</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
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

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="py-10 text-center text-red-500 text-sm">Failed to load data. Please try again.</div>
          ) : (
            <DataTable
              columns={columns}
              dataSource={rows}
              loading={isLoading}
              rowKey={config.rowKey}
              size="small"
              scroll={{ x: 1100 }}
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

      <EditRowDialog
        open={!!editingRow}
        onOpenChange={(open) => { if (!open) setEditingRow(null); }}
        tableKey={tableKey}
        config={config}
        row={editingRow}
        onSubmitted={() => setEditingRow(null)}
      />
    </div>
  );
}
