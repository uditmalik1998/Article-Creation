import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ClipboardList, History, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  Popconfirm,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  ALL_EXPENSE_TABLES,
  REQUESTER_LEVEL,
  createExpenseAccessGrant,
  createExpenseApprovalStage,
  deleteExpenseAccessGrant,
  deleteExpenseApprovalStage,
  getExpenseAccessGrants,
  getExpenseApprovalStages,
  reorderExpenseApprovalStages,
  updateExpenseAccessGrant,
  updateExpenseApprovalStage,
  type ExpenseAccessGrant,
  type ExpenseAccessGrantInput,
  type ExpenseApprovalStage,
} from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';

const REQUESTER_META = {
  label: 'Sub-Division Editor',
  blurb:
    'Raises add / edit / delete requests, each with a reason and a “needed by” date. Creator, Approver and Category ' +
    'Head already have this by role — grant it explicitly here only to hand it to someone with a different role, or ' +
    'to limit it to one table.',
  className: 'bg-slate-100 text-slate-700 border-slate-200',
};

/** Colour cycles through the chain by position, so a 4th, 5th, ... stage
 * still reads distinctly instead of falling back to one leftover colour. */
const STAGE_COLORS = [
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-teal-100 text-teal-700 border-teal-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
];

function stageColor(activeIndex: number): string {
  return STAGE_COLORS[activeIndex % STAGE_COLORS.length];
}

function tableLabel(tableKey: string): string {
  if (tableKey === ALL_EXPENSE_TABLES) return 'All expense tables';
  return (EXPENSE_TABLE_CONFIGS[tableKey]?.title ?? tableKey).split(' (')[0];
}

// ═══════════════════════════════════════════════════════
// APPROVAL STAGES — the editable chain
// ═══════════════════════════════════════════════════════

type StageDraft = {
  id?: number;
  key?: string;
  label: string;
  description: string;
  afterKey: string | null;
  isActive: boolean;
};

const EMPTY_STAGE_DRAFT: StageDraft = { label: '', description: '', afterKey: undefined as any, isActive: true };

interface StageDialogProps {
  draft: StageDraft | null;
  activeStages: ExpenseApprovalStage[];
  onClose: () => void;
  onSaved: () => void;
}

function StageDialog({ draft, activeStages, onClose, onSaved }: StageDialogProps) {
  const [form, setForm] = useState<StageDraft>(draft ?? EMPTY_STAGE_DRAFT);
  const isEdit = draft?.id !== undefined;

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? updateExpenseApprovalStage(draft!.id!, { label: form.label, description: form.description || null })
        : createExpenseApprovalStage({
            label: form.label,
            description: form.description || null,
            afterKey: form.afterKey ?? null,
          }),
    onSuccess: () => {
      message.success(isEdit ? 'Stage updated.' : 'Stage added — it now appears in the approval chain.');
      onSaved();
      onClose();
    },
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to save the stage.'),
  });

  if (!draft) return null;

  const submit = () => {
    if (!form.label.trim()) {
      message.warning('Please enter a label for this stage.');
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Approval Stage' : 'Add Approval Stage'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="space-y-1">
            <Label className="text-xs">Label</Label>
            <Input
              value={form.label}
              placeholder="e.g. Regional Head"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={form.description}
              rows={2}
              placeholder="What does this stage check for?"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {!isEdit && (
            <div className="space-y-1">
              <Label className="text-xs">Insert into the chain</Label>
              <Select
                value={form.afterKey ?? '__START__'}
                onValueChange={(v) => setForm((f) => ({ ...f, afterKey: v === '__START__' ? null : v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__START__">At the very start of the chain</SelectItem>
                  {activeStages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      After &quot;{s.label}&quot;
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Every request created from now on will walk through this stage at this position. Requests already in
                flight finish the chain they started on.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add Stage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalStagesPanel({
  stages,
  isLoading,
  onChanged,
}: {
  stages: ExpenseApprovalStage[];
  isLoading: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<StageDraft | null>(null);

  const active = useMemo(() => stages.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder), [stages]);
  const retired = useMemo(() => stages.filter((s) => !s.isActive), [stages]);

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) => reorderExpenseApprovalStages(orderedIds),
    onSuccess: () => onChanged(),
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to reorder stages.'),
  });

  const retire = useMutation({
    mutationFn: (stage: ExpenseApprovalStage) => updateExpenseApprovalStage(stage.id, { isActive: !stage.isActive }),
    onSuccess: () => {
      message.success('Stage updated.');
      onChanged();
    },
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to update the stage.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteExpenseApprovalStage(id),
    onSuccess: () => {
      message.success('Stage deleted.');
      onChanged();
    },
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to delete the stage.'),
  });

  const move = (index: number, dir: -1 | 1) => {
    const next = [...active];
    const swapWith = index + dir;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    reorder.mutate(next.map((s) => s.id));
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Approval Chain</h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              The ordered sequence every add / edit / delete request walks through after the Sub-Division Editor
              raises it. Approving the last stage applies the change to the master. Add a stage here at any time —
              e.g. insert &quot;Regional Head&quot; between Category Head and MDM — with no other setup.
            </p>
          </div>
          <Button size="sm" onClick={() => setDraft({ ...EMPTY_STAGE_DRAFT })}>
            <Plus className="h-4 w-4" />
            Add Stage
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex flex-col items-center justify-center rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Sub-Division
                <br />
                Editor
              </div>
              {active.map((stage, i) => (
                <div key={stage.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground">→</span>
                  <div className={`flex flex-col gap-1 rounded-md border p-2 ${stageColor(i)}`}>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium">{stage.label}</span>
                      {i === active.length - 1 && (
                        <span title="Approving this stage applies the change">⚑</span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        disabled={i === 0 || reorder.isPending}
                        onClick={() => move(i, -1)}
                        title="Move earlier"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        disabled={i === active.length - 1 || reorder.isPending}
                        onClick={() => move(i, 1)}
                        title="Move later"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => setDraft({ id: stage.id, label: stage.label, description: stage.description ?? '', afterKey: null, isActive: stage.isActive })}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Popconfirm
                        title={`Retire "${stage.label}"?`}
                        description="No new request will stop here again. Requests currently waiting on it must be resolved first."
                        okText="Retire"
                        onConfirm={() => retire.mutate(stage)}
                      >
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-50" title="Retire">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              ))}
              {active.length === 0 && (
                <p className="text-sm text-muted-foreground self-center ml-2">
                  No active stages — requests can't be raised until at least one is added.
                </p>
              )}
            </div>

            {retired.length > 0 && (
              <div className="pt-2 border-t space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Retired stages (kept for history)</div>
                <div className="flex flex-wrap gap-2">
                  {retired.map((stage) => (
                    <div key={stage.id} className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs">
                      <span>{stage.label}</span>
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => retire.mutate(stage)}>
                        Reactivate
                      </Button>
                      <Popconfirm
                        title={`Permanently delete "${stage.label}"?`}
                        description="Only possible if no grant or request history references it any more."
                        okText="Delete"
                        onConfirm={() => remove.mutate(stage.id)}
                      >
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </Popconfirm>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <StageDialog draft={draft} activeStages={active} onClose={() => setDraft(null)} onSaved={onChanged} />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════
// ACCESS GRANTS
// ═══════════════════════════════════════════════════════

type DraftGrant = ExpenseAccessGrantInput & { id?: number };

function emptyGrantDraft(): DraftGrant {
  return {
    email: '',
    level: REQUESTER_LEVEL,
    tableKey: ALL_EXPENSE_TABLES,
    subDivision: '',
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    isActive: true,
    note: '',
  };
}

interface GrantDialogProps {
  draft: DraftGrant;
  stages: ExpenseApprovalStage[];
  onClose: () => void;
  onSaved: () => void;
}

/** Mounted only while open, so the form seeds once from `draft` and every
 * re-open starts clean. */
function GrantDialog({ draft, stages, onClose, onSaved }: GrantDialogProps) {
  const [form, setForm] = useState<DraftGrant>(draft);

  const save = useMutation({
    mutationFn: (payload: DraftGrant) =>
      payload.id !== undefined
        ? updateExpenseAccessGrant(payload.id, payload)
        : createExpenseAccessGrant(payload),
    onSuccess: () => {
      message.success('Access saved.');
      onSaved();
      onClose();
    },
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to save access.'),
  });

  const isEditor = form.level === REQUESTER_LEVEL;
  const stage = stages.find((s) => s.key === form.level);

  const submit = () => {
    if (!form.email.trim()) {
      message.warning('Please enter an email address.');
      return;
    }
    if (isEditor && !form.canCreate && !form.canUpdate && !form.canDelete) {
      message.warning('A sub-division editor needs at least one of add / edit / delete.');
      return;
    }
    save.mutate({ ...form, email: form.email.trim().toLowerCase() });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id !== undefined ? 'Edit Access' : 'Grant Access'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="space-y-1">
            <Label className="text-xs">Email address</Label>
            <Input
              value={form.email}
              placeholder="name@company.com"
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Matched against the address the person signs in with, case-insensitively.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Level</Label>
            <Select value={form.level} onValueChange={(v) => setForm((f) => ({ ...f, level: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={REQUESTER_LEVEL}>{REQUESTER_META.label}</SelectItem>
                {stages.map((s, i) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                    {!s.isActive ? ' (retired)' : ` — stage ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isEditor ? REQUESTER_META.blurb : stage?.description || 'Approves at this stage of the chain.'}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Applies to</Label>
            <Select
              value={form.tableKey ?? ALL_EXPENSE_TABLES}
              onValueChange={(v) => setForm((f) => ({ ...f, tableKey: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EXPENSE_TABLES}>All expense tables</SelectItem>
                {Object.entries(EXPENSE_TABLE_CONFIGS).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    {cfg.title.split(' (')[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isEditor && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Sub-division (optional)</Label>
                <Input
                  value={form.subDivision ?? ''}
                  placeholder="e.g. TOPWEAR"
                  onChange={(e) => setForm((f) => ({ ...f, subDivision: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  A label for your own records — it is shown in this list but does not restrict which rows they can
                  touch.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Allowed to request</Label>
                <div className="flex flex-wrap gap-4">
                  {([
                    ['canCreate', 'Add rows'],
                    ['canUpdate', 'Edit rows'],
                    ['canDelete', 'Delete rows'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form[key] ?? false}
                        onCheckedChange={(checked) => setForm((f) => ({ ...f, [key]: checked === true }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={form.note ?? ''}
              rows={2}
              placeholder="Why this person has this access"
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={form.isActive ?? true}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
            />
            <span className="text-sm">{form.isActive ?? true ? 'Active' : 'Suspended'}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseAccessControlPage() {
  const queryClient = useQueryClient();

  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('__ALL__');
  const [tableFilter, setTableFilter] = useState<string>('__ALL__');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [draft, setDraft] = useState<DraftGrant | null>(null);

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['expense-approval-stages'],
    queryFn: () => getExpenseApprovalStages(),
  });
  const activeStages = useMemo(() => stages.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder), [stages]);

  const { data: grants = [], isLoading, isError } = useQuery({
    queryKey: ['expense-access-grants', appliedSearch, levelFilter, tableFilter, includeInactive],
    queryFn: () =>
      getExpenseAccessGrants({
        email: appliedSearch || undefined,
        level: levelFilter === '__ALL__' ? undefined : levelFilter,
        tableKey: tableFilter === '__ALL__' ? undefined : tableFilter,
        includeInactive,
      }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-access-grants'] });
    // A revoked or widened grant changes which buttons the expense pages show.
    queryClient.invalidateQueries({ queryKey: ['my-expense-access'] });
  };

  const invalidateStages = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-approval-stages'] });
    queryClient.invalidateQueries({ queryKey: ['expense-access-grants'] });
    queryClient.invalidateQueries({ queryKey: ['my-expense-access'] });
    queryClient.invalidateQueries({ queryKey: ['expense-change-requests'] });
  };

  const remove = useMutation({
    mutationFn: (id: number) => deleteExpenseAccessGrant(id),
    onSuccess: () => {
      message.success('Access revoked.');
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to revoke access.'),
  });

  const toggleActive = useMutation({
    mutationFn: (grant: ExpenseAccessGrant) => updateExpenseAccessGrant(grant.id, { isActive: !grant.isActive }),
    onSuccess: () => invalidate(),
    onError: (err: any) => message.error(err?.response?.data?.error || 'Failed to update access.'),
  });

  const levelLabel = (level: string): string => {
    if (level === REQUESTER_LEVEL) return REQUESTER_META.label;
    return stages.find((s) => s.key === level)?.label ?? level;
  };
  const levelBadgeClass = (level: string): string => {
    if (level === REQUESTER_LEVEL) return REQUESTER_META.className;
    const idx = activeStages.findIndex((s) => s.key === level);
    return idx === -1 ? 'bg-gray-100 text-gray-700 border-gray-200' : stageColor(idx);
  };

  const counts = useMemo(() => {
    const active = grants.filter((g) => g.isActive);
    const byLevel = new Map<string, number>();
    for (const g of active) byLevel.set(g.level, (byLevel.get(g.level) ?? 0) + 1);
    return byLevel;
  }, [grants]);

  const columns: DataTableColumn<ExpenseAccessGrant>[] = [
    { title: 'Email', key: 'email', render: (_v, g) => <span className="text-sm font-medium">{g.email}</span> },
    {
      title: 'Level',
      key: 'level',
      width: 175,
      render: (_v, g) => <Badge className={levelBadgeClass(g.level)}>{levelLabel(g.level)}</Badge>,
    },
    { title: 'Applies To', key: 'tableKey', width: 190, render: (_v, g) => <span className="text-sm">{tableLabel(g.tableKey)}</span> },
    {
      title: 'Sub-Division',
      key: 'subDivision',
      width: 130,
      render: (_v, g) => g.subDivision || <span className="text-muted-foreground italic text-sm">—</span>,
    },
    {
      title: 'Can Request',
      key: 'ops',
      width: 150,
      render: (_v, g) => {
        if (g.level !== REQUESTER_LEVEL) return <span className="text-muted-foreground italic text-sm">approves only</span>;
        const ops = [g.canCreate && 'Add', g.canUpdate && 'Edit', g.canDelete && 'Delete'].filter(Boolean);
        return <span className="text-sm">{ops.length > 0 ? ops.join(' · ') : '—'}</span>;
      },
    },
    {
      title: 'Status',
      key: 'isActive',
      width: 110,
      align: 'center',
      render: (_v, g) => (
        <Badge
          className={g.isActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}
        >
          {g.isActive ? 'Active' : 'Suspended'}
        </Badge>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 150,
      align: 'right',
      render: (_v, g) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => toggleActive.mutate(g)}
            title={g.isActive ? 'Suspend this access' : 'Reactivate this access'}
          >
            {g.isActive ? 'Suspend' : 'Activate'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() =>
              setDraft({
                id: g.id,
                email: g.email,
                level: g.level,
                tableKey: g.tableKey,
                subDivision: g.subDivision ?? '',
                canCreate: g.canCreate,
                canUpdate: g.canUpdate,
                canDelete: g.canDelete,
                isActive: g.isActive,
                note: g.note ?? '',
              })
            }
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Popconfirm
            title="Revoke this access?"
            description="They lose this right immediately. Requests they already raised are untouched."
            okText="Revoke"
            onConfirm={() => remove.mutate(g.id)}
          >
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:bg-red-50" title="Revoke">
              <Trash2 className="h-4 w-4" />
            </Button>
          </Popconfirm>
        </div>
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
          <Link
            to="/admin/expense-audit-log"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <History className="h-4 w-4" /> Audit Log
          </Link>
          <Link
            to="/admin/expense-change-requests"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ClipboardList className="h-4 w-4" /> Change Requests
          </Link>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Expense Access Control</h1>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">
          Raising an add / edit / delete request needs no setup here: anyone with the <strong>Creator</strong>,{' '}
          <strong>Approver</strong> or <strong>Category Head</strong> role already can, on every table. Sign-off is
          role-based too where a role fits — <strong>Category Head</strong> approves the Category Head stage, and{' '}
          <strong>Admin</strong> approves every stage (MDM included, since there is no separate MDM role). What this
          page manages is the <strong>approval chain</strong> itself — its stages and their order — plus the rare
          case of handing a right to someone by email instead of by role. Admins hold every right implicitly and
          need no grant here.
        </p>
      </div>

      <ApprovalStagesPanel stages={stages} isLoading={stagesLoading} onChanged={invalidateStages} />

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <Badge className={REQUESTER_META.className}>{REQUESTER_META.label}</Badge>
              <span className="text-2xl font-bold">{counts.get(REQUESTER_LEVEL) ?? 0}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{REQUESTER_META.blurb}</p>
          </CardContent>
        </Card>
        {activeStages.map((s, i) => (
          <Card key={s.key}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <Badge className={stageColor(i)}>{s.label}</Badge>
                <span className="text-2xl font-bold">{counts.get(s.key) ?? 0}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {s.description || (i === activeStages.length - 1 ? 'Final sign-off — applies the change to the master.' : `Stage ${i + 1} sign-off.`)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Access Grants</h2>
        <Button size="sm" onClick={() => setDraft(emptyGrantDraft())} disabled={stagesLoading}>
          <Plus className="h-4 w-4" />
          Grant Access
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end pt-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search email…"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setAppliedSearch(draftSearch); }}
            />
          </div>
          <div className="w-full md:w-52">
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All levels</SelectItem>
                <SelectItem value={REQUESTER_LEVEL}>{REQUESTER_META.label}</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                    {!s.isActive ? ' (retired)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full md:w-60">
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All tables" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All tables</SelectItem>
                <SelectItem value={ALL_EXPENSE_TABLES}>Grants scoped to “all tables”</SelectItem>
                {Object.entries(EXPENSE_TABLE_CONFIGS).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    {cfg.title.split(' (')[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} />
            <span className="text-sm whitespace-nowrap">Show suspended</span>
          </div>
          <Button onClick={() => setAppliedSearch(draftSearch)}>Apply</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="py-10 text-center text-red-500 text-sm">Failed to load access grants.</div>
          ) : (
            <DataTable
              columns={columns}
              dataSource={grants}
              loading={isLoading}
              rowKey="id"
              size="small"
              scroll={{ x: 1100 }}
              locale={{ emptyText: 'No access granted yet. Use “Grant Access” to add the first email address.' }}
            />
          )}
        </CardContent>
      </Card>

      {draft && <GrantDialog draft={draft} stages={stages} onClose={() => setDraft(null)} onSaved={invalidate} />}
    </div>
  );
}
