import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Search, ChevronRight, ShieldCheck } from 'lucide-react';
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
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Textarea,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  actOnExpenseChangeRequest,
  getExpenseApprovalStages,
  getExpenseChangeRequests,
  getMyExpenseAccess,
  type AdminUserBusinessDivision,
  type ExpenseApprovalStage,
  type ExpenseChangeOperation,
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

const TERMINAL_STATUS_META: Record<'APPROVED' | 'REJECTED', { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-700 border-green-200' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
};

const OPERATION_META: Record<ExpenseChangeOperation, { label: string; className: string }> = {
  CREATE: { label: 'Add Row', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE: { label: 'Edit', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  DELETE: { label: 'Delete Row', className: 'bg-red-100 text-red-700 border-red-200' },
};

/** PENDING has no fixed label — it shows the CURRENT stage's own name, which
 * only exists once the stage catalog has loaded. */
function StatusBadge({ request, stages }: { request: ExpenseChangeRequest; stages: ExpenseApprovalStage[] }) {
  if (request.status === 'APPROVED' || request.status === 'REJECTED') {
    const meta = TERMINAL_STATUS_META[request.status];
    return <Badge className={meta.className}>{meta.label}</Badge>;
  }
  const stageLabel = stages.find((s) => s.key === request.currentStageKey)?.label ?? request.currentStageKey ?? '—';
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Pending: {stageLabel}</Badge>;
}

function OperationBadge({ operation }: { operation: ExpenseChangeOperation }) {
  const meta = OPERATION_META[operation] ?? OPERATION_META.UPDATE;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

const BUSINESS_DIVISION_LABELS: Record<AdminUserBusinessDivision, string> = {
  MENS: 'Mens', KIDS: 'Kids', LADIES: 'Ladies', PO: 'PO', MDM: 'MDM',
};

/** Which Category Head this request is routed to — the whole point of the
 * business-division segregation. Absent for requesters with no division set
 * (their request has no automatic Category Head match, see the backend). */
function BusinessDivisionBadge({ division }: { division: AdminUserBusinessDivision | null }) {
  if (!division) return <span className="text-muted-foreground italic text-xs">No division</span>;
  return <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">{BUSINESS_DIVISION_LABELS[division]}</Badge>;
}

/** The requester's deadline, flagged red once it has passed on a still-open request. */
function DueDate({ request, className }: { request: ExpenseChangeRequest; className?: string }) {
  if (!request.dueDate) return <span className="text-muted-foreground italic text-xs">—</span>;
  const due = dayjs(request.dueDate);
  const overdue = request.status === 'PENDING' && due.endOf('day').isBefore(dayjs());
  return (
    <span className={`text-xs whitespace-nowrap ${overdue ? 'font-semibold text-red-600' : ''} ${className ?? ''}`}>
      {due.format('YYYY-MM-DD')}
      {overdue ? ' · overdue' : ''}
    </span>
  );
}

type TabKey = 'pending-mine' | 'mine' | 'overdue' | 'all';

interface DetailDialogProps {
  request: ExpenseChangeRequest | null;
  stages: ExpenseApprovalStage[];
  onClose: () => void;
  onActed: () => void;
}

/** Mounted fresh per request (see the `key` on its usage below), so all
 * local state — including the edited values — starts clean every time a
 * different request is opened. */
function DetailDialog({ request, stages, onClose, onActed }: DetailDialogProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Rights are per-table, so they are resolved for this request's own table.
  const { data: access } = useQuery({
    queryKey: ['my-expense-access', request?.tableKey],
    queryFn: () => getMyExpenseAccess(request!.tableKey),
    enabled: !!request,
    staleTime: 60_000,
  });

  const config = request ? EXPENSE_TABLE_CONFIGS[request.tableKey] : undefined;
  const columnMeta = (field: string) => config?.columns.find((c) => c.dataIndex === field);

  // `approvableStageKeys` is coarse (a Category Head shows 'CATEGORY_HEAD'
  // regardless of division) — for that stage specifically, also require this
  // user's own Business Division to match the REQUESTER's, mirroring the
  // server's real gate (canActOnExpenseRequestStage). The server enforces
  // this regardless; this just keeps the button from being shown when it
  // would just 403.
  const canAct =
    !!request &&
    request.status === 'PENDING' &&
    !!request.currentStageKey &&
    !!access?.approvableStageKeys.includes(request.currentStageKey) &&
    (request.currentStageKey !== 'CATEGORY_HEAD' || access?.businessDivision === request.requesterBusinessDivision);
  // A deletion has nothing to edit — only a row to remove.
  const canEditValues = canAct && request?.operation !== 'DELETE';

  // Seeded once from the proposed values, keyed to string form for the
  // inputs; booleans round-trip through 'true'/'false'.
  const [editedValues, setEditedValues] = useState<Record<string, string>>(() => {
    if (!request) return {};
    const init: Record<string, string> = {};
    for (const [field, diff] of Object.entries(request.changes)) init[field] = diff.new == null ? '' : String(diff.new);
    return init;
  });

  if (!request) return null;

  const tableTitle = EXPENSE_TABLE_CONFIGS[request.tableKey]?.title ?? request.tableKey;
  const currentStage = stages.find((s) => s.key === request.currentStageKey);
  const isLastStage =
    !!currentStage && stages.filter((s) => s.isActive).every((s) => s.sortOrder <= currentStage.sortOrder);

  const act = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !comment.trim()) {
      message.warning('A comment is required when rejecting.');
      return;
    }

    let changesOverride: Record<string, any> | undefined;
    if (action === 'APPROVE' && canEditValues) {
      const override: Record<string, any> = {};
      for (const [field, diff] of Object.entries(request.changes)) {
        const col = columnMeta(field);
        const raw = editedValues[field] ?? '';
        const nextValue = col?.type === 'boolean' ? raw === 'true' : raw;
        if (String(diff.new ?? '') !== String(nextValue ?? '')) override[field] = nextValue;
      }
      if (Object.keys(override).length > 0) changesOverride = override;
    }

    setSubmitting(true);
    try {
      await actOnExpenseChangeRequest(request.id, action, comment.trim() || undefined, changesOverride);
      message.success(action === 'APPROVE' ? 'Approved.' : 'Rejected.');
      onActed();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // An add has no "current" side and a delete has no "proposed" side, so only
  // an edit earns the three-column before/after layout.
  const isUpdate = request.operation === 'UPDATE';
  const changeHeading =
    request.operation === 'CREATE' ? 'New Row' : request.operation === 'DELETE' ? 'Row To Be Deleted' : 'Proposed Changes';

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
          <div className="flex flex-wrap items-center gap-2">
            <OperationBadge operation={request.operation} />
            <StatusBadge request={request} stages={stages} />
            <BusinessDivisionBadge division={request.requesterBusinessDivision} />
            {request.dueDate && (
              <span className="text-xs text-muted-foreground">
                Needed by <DueDate request={request} />
              </span>
            )}
          </div>

          <div>
            <div className="font-semibold mb-1.5">{changeHeading}</div>
            {canEditValues && (
              <p className="mb-1.5 text-xs text-muted-foreground">
                You can adjust the proposed values below before approving.
              </p>
            )}
            <div className="rounded-md border divide-y">
              <div
                className={`grid ${isUpdate ? 'grid-cols-3' : 'grid-cols-2'} gap-2 p-2 text-xs font-medium text-muted-foreground bg-muted/40`}
              >
                <span>Field</span>
                {isUpdate ? (
                  <>
                    <span>Current</span>
                    <span>Proposed</span>
                  </>
                ) : (
                  <span>Value</span>
                )}
              </div>
              {Object.entries(request.changes).map(([field, diff]) => {
                const col = columnMeta(field);
                return (
                  <div key={field} className={`grid ${isUpdate ? 'grid-cols-3' : 'grid-cols-2'} gap-2 p-2 items-center`}>
                    <span className="text-muted-foreground">{col?.title ?? field}</span>
                    {isUpdate && <span className="text-red-600 break-all">{formatValue(diff.old)}</span>}
                    {canEditValues ? (
                      col?.type === 'boolean' ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={editedValues[field] === 'true'}
                            onCheckedChange={(checked) => setEditedValues((v) => ({ ...v, [field]: checked ? 'true' : 'false' }))}
                          />
                          <span className="text-xs text-muted-foreground">{editedValues[field] === 'true' ? 'Yes' : 'No'}</span>
                        </div>
                      ) : (
                        <Input
                          className="h-8"
                          value={editedValues[field] ?? ''}
                          onChange={(e) => setEditedValues((v) => ({ ...v, [field]: e.target.value }))}
                        />
                      )
                    ) : (
                      <span className={`break-all ${request.operation === 'DELETE' ? 'text-red-600' : 'text-green-600'}`}>
                        {formatValue(request.operation === 'DELETE' ? diff.old : diff.new)}
                      </span>
                    )}
                  </div>
                );
              })}
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
            {request.approvalTrail.map((entry, i) => (
              <div key={i}>
                {entry.action === 'APPROVE' ? 'Approved' : 'Rejected'} at{' '}
                <span className="font-medium text-foreground">{entry.stageLabel}</span> by{' '}
                <span className="font-medium text-foreground">{entry.byName}</span> · {dayjs(entry.at).format('YYYY-MM-DD HH:mm')}
                {entry.comment ? ` — "${entry.comment}"` : ''}
                {entry.editedFields && entry.editedFields.length > 0
                  ? ` (adjusted: ${entry.editedFields.map((f) => columnMeta(f)?.title ?? f).join(', ')})`
                  : ''}
              </div>
            ))}
            {request.operation === 'CREATE' && request.appliedRowId && (
              <div>
                Created as row <span className="font-mono text-foreground">{request.appliedRowId}</span>
              </div>
            )}
          </div>

          {canAct && (
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="text-xs">Review comment (required to reject)</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
              <p className="text-xs text-muted-foreground">
                {isLastStage
                  ? 'Approving here applies this change to the master straight away.'
                  : 'Approving passes this on to the next stage of the chain.'}
              </p>
            </div>
          )}
        </div>

        {canAct && (
          <DialogFooter>
            <Button variant="outline" onClick={() => act('REJECT')} disabled={submitting}>
              Reject
            </Button>
            <Button onClick={() => act('APPROVE')} disabled={submitting}>
              {submitting ? 'Submitting…' : isLastStage ? 'Approve & Apply' : 'Approve'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseChangeRequestsPage() {
  const user = getCurrentUser();
  const queryClient = useQueryClient();

  const { data: stages = [] } = useQuery({
    queryKey: ['expense-approval-stages'],
    queryFn: () => getExpenseApprovalStages(),
    staleTime: 60_000,
  });

  // Access across all expense tables — decides which tabs are worth showing.
  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['my-expense-access', undefined],
    queryFn: () => getMyExpenseAccess(),
    staleTime: 60_000,
  });

  // Three visibility tiers, matching the server exactly (getExpenseChangeRequests):
  //   1. ADMIN, or anyone tagged Business Division MDM — sees everything,
  //      unrestricted (MDM is the division-agnostic convergence point).
  //   2. A Category Head with a division set — sees only THEIR OWN
  //      division's requests, never another's ("segregated to their
  //      Category Head"). Same 'all' tab, just automatically narrower — the
  //      server does the actual filtering, this only adjusts the tab label
  //      and keeps it from being hidden.
  //   3. Everyone else — sees only requests they themselves raised, so
  //      there is no "all" tab at all for them.
  const canSeeEveryonesRequests = !!access?.isAdmin || access?.businessDivision === 'MDM';
  const canSeeOwnDivisionRequests =
    !canSeeEveryonesRequests && !!access?.businessDivision && access.approvableStageKeys.includes('CATEGORY_HEAD');
  const canSeeBroaderThanOwnRequests = canSeeEveryonesRequests || canSeeOwnDivisionRequests;

  const availableTabs = useMemo(() => {
    const tabs: { key: TabKey; label: string }[] = [];
    if ((access?.approvableStageKeys.length ?? 0) > 0) tabs.push({ key: 'pending-mine', label: 'Pending My Action' });
    if (access?.canCreate || access?.canUpdate || access?.canDelete) tabs.push({ key: 'mine', label: 'My Requests' });
    tabs.push({ key: 'overdue', label: 'Overdue' });
    if (canSeeBroaderThanOwnRequests) {
      tabs.push({
        key: 'all',
        label: canSeeEveryonesRequests ? 'All Requests' : `${BUSINESS_DIVISION_LABELS[access!.businessDivision!]} Requests`,
      });
    }
    return tabs;
  }, [access, canSeeEveryonesRequests, canSeeBroaderThanOwnRequests]);

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('__ALL__');
  const [operationFilter, setOperationFilter] = useState<string>('__ALL__');
  const [divisionFilter, setDivisionFilter] = useState<string>('__ALL__');
  const [selected, setSelected] = useState<ExpenseChangeRequest | null>(null);

  const tabParams: Record<TabKey, { status?: ExpenseChangeStatus; mine?: boolean; mineToApprove?: boolean; overdue?: boolean }> = {
    'pending-mine': { status: 'PENDING', mineToApprove: true },
    mine: { mine: true },
    overdue: { overdue: true },
    all: {},
  };

  // Land on the tab the user can actually act on once access is known, without
  // fighting a tab they have since picked themselves. "Overdue" and "All" are
  // always present, so they are never the automatic choice.
  const [defaultedTab, setDefaultedTab] = useState(false);
  if (!defaultedTab && !accessLoading) {
    const actionable = availableTabs.find((t) => t.key !== 'overdue' && t.key !== 'all');
    if (actionable) setActiveTab(actionable.key);
    setDefaultedTab(true);
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-change-requests', activeTab, page, appliedSearch, tableFilter, operationFilter, divisionFilter],
    queryFn: () =>
      getExpenseChangeRequests({
        page,
        limit: PAGE_SIZE,
        search: appliedSearch || undefined,
        tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
        operation: operationFilter === '__ALL__' ? undefined : (operationFilter as ExpenseChangeOperation),
        requesterBusinessDivision: divisionFilter === '__ALL__' ? undefined : (divisionFilter as AdminUserBusinessDivision),
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
    queryClient.invalidateQueries({ queryKey: ['expense-table'] });
  };

  const columns: DataTableColumn<ExpenseChangeRequest>[] = [
    {
      title: 'Table',
      key: 'tableKey',
      width: 190,
      render: (_v, r) => (EXPENSE_TABLE_CONFIGS[r.tableKey]?.title ?? r.tableKey).split(' (')[0],
    },
    { title: 'Type', key: 'operation', width: 100, render: (_v, r) => <OperationBadge operation={r.operation} /> },
    {
      title: 'Row',
      key: 'rowLabel',
      render: (_v, r) => r.rowLabel || <span className="text-muted-foreground italic">—</span>,
    },
    { title: 'Requested By', key: 'requestedByName', width: 150 },
    {
      title: 'Division',
      key: 'requesterBusinessDivision',
      width: 110,
      render: (_v, r) => <BusinessDivisionBadge division={r.requesterBusinessDivision} />,
    },
    {
      title: 'Reason',
      key: 'reason',
      render: (_v, r) => <span className="line-clamp-1">{r.reason}</span>,
    },
    { title: 'Status', key: 'status', width: 190, render: (_v, r) => <StatusBadge request={r} stages={stages} /> },
    { title: 'Needed By', key: 'dueDate', width: 120, render: (_v, r) => <DueDate request={r} /> },
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
      <div className="flex items-center justify-between">
        <Link to="/admin/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Expense Admin
        </Link>
        {user?.role === 'ADMIN' && (
          <Link
            to="/admin/expense-access"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ShieldCheck className="h-4 w-4" /> Access Control
          </Link>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">Expense Change Requests</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {canSeeEveryonesRequests
            ? 'Every add, edit and deletion requested across the Expense Data tables — routed by Business Division to that division’s Category Head, then to whoever is tagged MDM for final approval (Admin → Expense Access Control).'
            : canSeeOwnDivisionRequests
            ? `Every add, edit and deletion requested by ${BUSINESS_DIVISION_LABELS[access!.businessDivision!]} division, and where each one stands before it reaches the master.`
            : 'Every add, edit and deletion you have requested, and where each one stands in the approval chain before it reaches the master.'}
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
              <div className="w-full md:w-44">
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
              {canSeeEveryonesRequests && (
                <div className="w-full md:w-44">
                  <Select value={divisionFilter} onValueChange={(v) => { setDivisionFilter(v); setPage(1); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="All divisions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ALL__">All divisions</SelectItem>
                      {(Object.keys(BUSINESS_DIVISION_LABELS) as AdminUserBusinessDivision[]).map((d) => (
                        <SelectItem key={d} value={d}>
                          {BUSINESS_DIVISION_LABELS[d]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                  scroll={{ x: 1200 }}
                  pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: (p) => setPage(p) }}
                  locale={{ emptyText: 'No change requests found.' }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DetailDialog key={selected?.id ?? 'none'} request={selected} stages={stages} onClose={() => setSelected(null)} onActed={handleActed} />
    </div>
  );
}
