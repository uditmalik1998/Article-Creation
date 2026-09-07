import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Search, ChevronRight } from 'lucide-react';
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
  DialogFooter,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Textarea,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  getExpenseChangeRequests,
  reviewExpenseChangeRequest,
  finalizeExpenseChangeRequest,
  type ExpenseChangeRequest,
  type ExpenseChangeStatus,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';

const PAGE_SIZE = 50;

function getCurrentUser(): { id: number; role: string } | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

const STATUS_META: Record<ExpenseChangeStatus, { label: string; className: string }> = {
  PENDING_APPROVER: { label: 'Pending Approver', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  PENDING_FINAL: { label: 'Pending Final Approval', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-700 border-green-200' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
};

function StatusBadge({ status }: { status: ExpenseChangeStatus }) {
  const meta = STATUS_META[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

type TabKey = 'pending-approver' | 'pending-final' | 'mine' | 'all';

interface DetailDialogProps {
  request: ExpenseChangeRequest | null;
  currentUserRole?: string;
  onClose: () => void;
  onActed: () => void;
}

function DetailDialog({ request, currentUserRole, onClose, onActed }: DetailDialogProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!request) return null;

  const tableTitle = EXPENSE_TABLE_CONFIGS[request.tableKey]?.title ?? request.tableKey;
  const canReview = request.status === 'PENDING_APPROVER' && (currentUserRole === 'APPROVER' || currentUserRole === 'ADMIN');
  const canFinalize =
    request.status === 'PENDING_FINAL' && (currentUserRole === 'CATEGORY_HEAD' || currentUserRole === 'PD' || currentUserRole === 'ADMIN');
  const canAct = canReview || canFinalize;

  const act = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !comment.trim()) {
      message.warning('A comment is required when rejecting.');
      return;
    }
    setSubmitting(true);
    try {
      if (canReview) await reviewExpenseChangeRequest(request.id, action, comment.trim() || undefined);
      else if (canFinalize) await finalizeExpenseChangeRequest(request.id, action, comment.trim() || undefined);
      message.success(action === 'APPROVE' ? 'Approved.' : 'Rejected.');
      onActed();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tableTitle}
            {request.rowLabel ? ` — ${request.rowLabel}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2 text-sm">
          <StatusBadge status={request.status} />

          <div>
            <div className="font-semibold mb-1.5">Proposed Changes</div>
            <div className="rounded-md border divide-y">
              <div className="grid grid-cols-3 gap-2 p-2 text-xs font-medium text-muted-foreground bg-muted/40">
                <span>Field</span>
                <span>Current</span>
                <span>Proposed</span>
              </div>
              {Object.entries(request.changes).map(([field, diff]) => (
                <div key={field} className="grid grid-cols-3 gap-2 p-2">
                  <span className="text-muted-foreground">{field}</span>
                  <span className="text-red-600 break-all">{formatValue(diff.old)}</span>
                  <span className="text-green-600 break-all">{formatValue(diff.new)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1">Reason</div>
            <p className="text-muted-foreground">{request.reason}</p>
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div>
              Requested by <span className="font-medium text-foreground">{request.requestedByName}</span> ({request.requestedByEmail}) ·{' '}
              {dayjs(request.requestedAt).format('YYYY-MM-DD HH:mm')}
            </div>
            {request.approverAction && (
              <div>
                {request.approverAction === 'APPROVE' ? 'Approved' : 'Rejected'} by approver{' '}
                <span className="font-medium text-foreground">{request.approverName}</span> ·{' '}
                {dayjs(request.approverAt!).format('YYYY-MM-DD HH:mm')}
                {request.approverComment ? ` — "${request.approverComment}"` : ''}
              </div>
            )}
            {request.finalAction && (
              <div>
                {request.finalAction === 'APPROVE' ? 'Finally approved' : 'Finally rejected'} by{' '}
                <span className="font-medium text-foreground">{request.finalByName}</span> ·{' '}
                {dayjs(request.finalAt!).format('YYYY-MM-DD HH:mm')}
                {request.finalComment ? ` — "${request.finalComment}"` : ''}
              </div>
            )}
          </div>

          {canAct && (
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="text-xs">Comment (required to reject)</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            </div>
          )}
        </div>

        {canAct && (
          <DialogFooter>
            <Button variant="outline" onClick={() => act('REJECT')} disabled={submitting}>
              Reject
            </Button>
            <Button onClick={() => act('APPROVE')} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Approve'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseChangeRequestsPage() {
  const user = getCurrentUser();
  const role = user?.role;
  const queryClient = useQueryClient();

  const availableTabs: { key: TabKey; label: string }[] = [];
  if (role === 'APPROVER' || role === 'ADMIN') availableTabs.push({ key: 'pending-approver', label: 'Pending My Review' });
  if (role === 'CATEGORY_HEAD' || role === 'PD' || role === 'ADMIN') availableTabs.push({ key: 'pending-final', label: 'Pending Final Approval' });
  if (role === 'CREATOR' || role === 'ADMIN') availableTabs.push({ key: 'mine', label: 'My Requests' });
  availableTabs.push({ key: 'all', label: 'All Requests' });

  const [activeTab, setActiveTab] = useState<TabKey>(availableTabs[0].key);
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('__ALL__');
  const [selected, setSelected] = useState<ExpenseChangeRequest | null>(null);

  const tabParams: Record<TabKey, { status?: ExpenseChangeStatus; mine?: boolean }> = {
    'pending-approver': { status: 'PENDING_APPROVER' },
    'pending-final': { status: 'PENDING_FINAL' },
    mine: { mine: true },
    all: {},
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-change-requests', activeTab, page, appliedSearch, tableFilter],
    queryFn: () =>
      getExpenseChangeRequests({
        page,
        limit: PAGE_SIZE,
        search: appliedSearch || undefined,
        tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
        ...tabParams[activeTab],
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleApplySearch = () => {
    setPage(1);
    setAppliedSearch(draftSearch);
  };

  const handleActed = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] });
  };

  const columns: DataTableColumn<ExpenseChangeRequest>[] = [
    {
      title: 'Table',
      key: 'tableKey',
      width: 200,
      render: (_v, r) => (EXPENSE_TABLE_CONFIGS[r.tableKey]?.title ?? r.tableKey).split(' (')[0],
    },
    {
      title: 'Row',
      key: 'rowLabel',
      render: (_v, r) => r.rowLabel || <span className="text-muted-foreground italic">—</span>,
    },
    { title: 'Requested By', key: 'requestedByName', width: 160 },
    {
      title: 'Reason',
      key: 'reason',
      render: (_v, r) => <span className="line-clamp-1">{r.reason}</span>,
    },
    { title: 'Status', key: 'status', width: 170, render: (_v, r) => <StatusBadge status={r.status} /> },
    {
      title: 'Requested At',
      key: 'requestedAt',
      width: 150,
      render: (_v, r) => <span className="text-xs whitespace-nowrap">{dayjs(r.requestedAt).format('YYYY-MM-DD HH:mm')}</span>,
    },
    {
      title: '',
      key: 'action',
      width: 48,
      align: 'center',
      render: (_v, r) => (
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelected(r)} title="View details">
          <ChevronRight className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Expense Change Requests</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every edit requested, reviewed, and finally approved or rejected across the Expense Data tables.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as TabKey);
          setPage(1);
        }}
      >
        <TabsList>
          {availableTabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          <Card>
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-end pt-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9"
                  placeholder="Search reason, row, requester…"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplySearch(); }}
                />
              </div>
              <div className="w-full md:w-64">
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
              <Button onClick={handleApplySearch}>Apply</Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {isError ? (
                <div className="py-10 text-center text-red-500 text-sm">Failed to load change requests.</div>
              ) : (
                <DataTable
                  columns={columns}
                  dataSource={rows}
                  loading={isLoading}
                  rowKey="id"
                  size="small"
                  scroll={{ x: 1000 }}
                  pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: (p) => setPage(p) }}
                  locale={{ emptyText: 'No change requests found.' }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DetailDialog request={selected} currentUserRole={role} onClose={() => setSelected(null)} onActed={handleActed} />
    </div>
  );
}
