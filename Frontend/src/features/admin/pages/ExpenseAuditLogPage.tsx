import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, ClipboardList, Search, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import {
  getExpenseAuditLog,
  type ExpenseAuditEventType,
  type ExpenseAuditLogEntry,
  type ExpenseChangeOperation,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';

const PAGE_SIZE = 100;

/** Only APPLIED means Supabase data actually changed at that moment — every
 * other event type is bookkeeping on the request itself. The colour is a
 * deliberate visual cue for that distinction when scanning the table. */
const EVENT_META: Record<ExpenseAuditEventType, { label: string; className: string }> = {
  REQUESTED: { label: 'Requested', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  STAGE_APPROVED: { label: 'Stage Approved', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  STAGE_REJECTED: { label: 'Stage Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
  APPLIED: { label: 'Applied to Master', className: 'bg-green-100 text-green-700 border-green-200' },
  APPLY_FAILED: { label: 'Apply Failed', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  AUTO_REJECTED: { label: 'Auto-Rejected (drift)', className: 'bg-amber-100 text-amber-700 border-amber-200' },
};

const OPERATION_META: Record<ExpenseChangeOperation, { label: string; className: string }> = {
  CREATE: { label: 'Add Row', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE: { label: 'Edit', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  DELETE: { label: 'Delete Row', className: 'bg-red-100 text-red-700 border-red-200' },
};

function EventBadge({ eventType }: { eventType: ExpenseAuditEventType }) {
  const meta = EVENT_META[eventType];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function OperationBadge({ operation }: { operation: ExpenseChangeOperation }) {
  const meta = OPERATION_META[operation] ?? OPERATION_META.UPDATE;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function DetailsDialog({ entry, onClose }: { entry: ExpenseAuditLogEntry | null; onClose: () => void }) {
  if (!entry) return null;
  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {EVENT_META[entry.eventType].label} — {(EXPENSE_TABLE_CONFIGS[entry.tableKey]?.title ?? entry.tableKey).split(' (')[0]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Request ID</span>
            <span className="font-mono break-all">{entry.requestId}</span>
            <span className="text-muted-foreground">Row ID</span>
            <span className="font-mono">{entry.rowId ?? '—'}</span>
            <span className="text-muted-foreground">Stage</span>
            <span>{entry.stageLabel ?? '—'}</span>
            <span className="text-muted-foreground">Actor</span>
            <span>{entry.actorName ? `${entry.actorName} (${entry.actorEmail})` : '—'}</span>
            <span className="text-muted-foreground">Occurred</span>
            <span>{dayjs(entry.occurredAt).format('YYYY-MM-DD HH:mm:ss')}</span>
          </div>
          {entry.comment && (
            <div>
              <div className="font-semibold mb-1 text-xs">Comment</div>
              <p className="text-muted-foreground">{entry.comment}</p>
            </div>
          )}
          {entry.details && (
            <div>
              <div className="font-semibold mb-1 text-xs">Details</div>
              <pre className="rounded-md border bg-muted/30 p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseAuditLogPage() {
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tableFilter, setTableFilter] = useState('__ALL__');
  const [eventFilter, setEventFilter] = useState('__ALL__');
  const [operationFilter, setOperationFilter] = useState('__ALL__');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ExpenseAuditLogEntry | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-audit-log', page, appliedSearch, tableFilter, eventFilter, operationFilter, dateFrom, dateTo],
    queryFn: () =>
      getExpenseAuditLog({
        page,
        limit: PAGE_SIZE,
        search: appliedSearch || undefined,
        tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
        eventType: eventFilter === '__ALL__' ? undefined : (eventFilter as ExpenseAuditEventType),
        operation: operationFilter === '__ALL__' ? undefined : (operationFilter as ExpenseChangeOperation),
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleApplySearch = () => {
    setPage(1);
    setAppliedSearch(draftSearch);
  };

  const columns: DataTableColumn<ExpenseAuditLogEntry>[] = [
    {
      title: 'When',
      key: 'occurredAt',
      width: 160,
      render: (_v, r) => <span className="text-xs whitespace-nowrap">{dayjs(r.occurredAt).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    { title: 'Event', key: 'eventType', width: 170, render: (_v, r) => <EventBadge eventType={r.eventType} /> },
    { title: 'Type', key: 'operation', width: 100, render: (_v, r) => <OperationBadge operation={r.operation} /> },
    {
      title: 'Table',
      key: 'tableKey',
      width: 180,
      render: (_v, r) => (EXPENSE_TABLE_CONFIGS[r.tableKey]?.title ?? r.tableKey).split(' (')[0],
    },
    { title: 'Row ID', key: 'rowId', width: 90, render: (_v, r) => <span className="font-mono text-xs">{r.rowId ?? '—'}</span> },
    { title: 'Stage', key: 'stageLabel', width: 140, render: (_v, r) => r.stageLabel ?? <span className="text-muted-foreground italic">—</span> },
    {
      title: 'Actor',
      key: 'actorName',
      width: 170,
      render: (_v, r) => (r.actorName ? <span title={r.actorEmail ?? ''}>{r.actorName}</span> : <span className="text-muted-foreground italic">—</span>),
    },
    {
      title: 'Comment',
      key: 'comment',
      render: (_v, r) => (r.comment ? <span className="line-clamp-1">{r.comment}</span> : <span className="text-muted-foreground italic">—</span>),
    },
    {
      title: '',
      key: 'action',
      width: 90,
      align: 'right',
      render: (_v, r) => (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelected(r)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/admin/expense-access" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ShieldCheck className="h-4 w-4" /> Access Control
          </Link>
          <Link to="/admin/expense-change-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ClipboardList className="h-4 w-4" /> Change Requests
          </Link>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Expense Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">
          The complete, durable record of the Expense Data workflow: every request raised, every stage's approve or
          reject (edits included), and every write to a master table — or failed attempt. <strong>Applied to
          Master</strong> is the only event where Supabase data actually changed; everything else is bookkeeping on
          the request itself, right up until MDM's final approval.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 items-end pt-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search actor, row id, comment…"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApplySearch(); }}
            />
          </div>
          <div className="w-56">
            <Select value={tableFilter} onValueChange={(v) => { setTableFilter(v); setPage(1); }}>
              <SelectTrigger>
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
          </div>
          <div className="w-48">
            <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setPage(1); }}>
              <SelectTrigger>
                <SelectValue placeholder="All events" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All events</SelectItem>
                {(Object.keys(EVENT_META) as ExpenseAuditEventType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {EVENT_META[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={operationFilter} onValueChange={(v) => { setOperationFilter(v); setPage(1); }}>
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All types</SelectItem>
                <SelectItem value="CREATE">Add Row</SelectItem>
                <SelectItem value="UPDATE">Edit</SelectItem>
                <SelectItem value="DELETE">Delete Row</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" className="w-40" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <Button onClick={handleApplySearch}>Apply</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="py-10 text-center text-red-500 text-sm">Failed to load the audit log.</div>
          ) : (
            <DataTable
              columns={columns}
              dataSource={rows}
              loading={isLoading}
              rowKey="id"
              size="small"
              scroll={{ x: 1300 }}
              pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: (p) => setPage(p) }}
              locale={{ emptyText: 'No audit log entries match these filters.' }}
            />
          )}
        </CardContent>
      </Card>

      <DetailsDialog entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
