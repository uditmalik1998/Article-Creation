import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle } from 'lucide-react';
import {
  Autocomplete,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  Switch,
  Textarea,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  createExpenseAddRequest,
  createExpenseChangeRequest,
  createExpenseDeleteRequest,
  getExpenseColumnOptions,
} from '../../../services/adminApi';
import type { ExpenseTableConfig } from '../config/expenseTables';

export type RowChangeMode = 'create' | 'update' | 'delete';

interface RowChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableKey: string;
  config: ExpenseTableConfig;
  mode: RowChangeMode;
  /** The row being edited or deleted; null when adding. */
  row: Record<string, any> | null;
  onSubmitted: () => void;
}

const MODE_COPY: Record<RowChangeMode, { title: string; submit: string; reasonLabel: string; reasonHint: string }> = {
  create: {
    title: 'Propose a New Row',
    submit: 'Submit for Approval',
    reasonLabel: 'Reason for adding this row (required)',
    reasonHint: 'Why does this row need to exist?',
  },
  update: {
    title: 'Propose an Edit',
    submit: 'Submit for Approval',
    reasonLabel: 'Reason for this change (required)',
    reasonHint: 'Why is this change needed?',
  },
  delete: {
    title: 'Propose a Deletion',
    submit: 'Submit Deletion for Approval',
    reasonLabel: 'Reason for deleting this row (required)',
    reasonHint: 'Why should this row be removed?',
  },
};

function displayValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function RowChangeRequestDialog({
  open,
  onOpenChange,
  tableKey,
  config,
  mode,
  row,
  onSubmitted,
}: RowChangeRequestDialogProps) {
  const editableColumns = useMemo(() => config.columns.filter((c) => c.editable !== false), [config]);
  const requiredKeys = useMemo(() => new Set(config.requiredOnCreate ?? []), [config]);
  const pickColumns = useMemo(() => editableColumns.filter((c) => c.pickFromExisting), [editableColumns]);

  // One query per dropdown column, fetching its distinct existing values —
  // a suggestion list, not a hard constraint, so a genuinely new value can
  // still be typed.
  const optionQueries = useQueries({
    queries: pickColumns.map((col) => ({
      queryKey: ['expense-column-options', tableKey, col.dataIndex],
      queryFn: () => getExpenseColumnOptions(tableKey, col.dataIndex),
      staleTime: 5 * 60_000,
    })),
  });
  const optionsByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    pickColumns.forEach((col, i) => {
      map[col.dataIndex] = optionQueries[i]?.data ?? [];
    });
    return map;
  }, [pickColumns, optionQueries]);

  // Seeded once, on mount: callers render this dialog only while it is open
  // (`{dialog && <RowChangeRequestDialog …/>}`), so closing it unmounts the
  // component and the next open starts from a clean form.
  const [values, setValues] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const col of editableColumns) {
      initial[col.dataIndex] = mode === 'create' ? (col.type === 'boolean' ? true : '') : row?.[col.dataIndex] ?? '';
    }
    return initial;
  });
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (mode !== 'create' && !row) return null;

  const copy = MODE_COPY[mode];

  const submit = async () => {
    if (!reason.trim()) {
      message.warning('Please explain why you are making this change.');
      return;
    }
    if (!dueDate) {
      message.warning('Please pick the date you need this done by.');
      return;
    }
    if (dueDate.isBefore(dayjs().startOf('day'))) {
      message.warning('The "needed by" date cannot be in the past.');
      return;
    }

    const meta = { reason: reason.trim(), dueDate: dueDate.format('YYYY-MM-DD') };

    let payloadCheck: Record<string, any> | null = null;
    if (mode === 'create') {
      const filled: Record<string, any> = {};
      for (const col of editableColumns) {
        const v = values[col.dataIndex];
        if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
        filled[col.dataIndex] = typeof v === 'string' ? v.trim() : v;
      }
      const missing = [...requiredKeys].filter((k) => filled[k] === undefined);
      if (missing.length > 0) {
        const labels = missing.map((k) => editableColumns.find((c) => c.dataIndex === k)?.title ?? k);
        message.warning(`Please fill in: ${labels.join(', ')}`);
        return;
      }
      if (Object.keys(filled).length === 0) {
        message.warning('Please fill in at least one field.');
        return;
      }
      payloadCheck = filled;
    } else if (mode === 'update') {
      const changes: Record<string, any> = {};
      for (const col of editableColumns) {
        const original = row![col.dataIndex] ?? '';
        const next = values[col.dataIndex] ?? '';
        if (String(original) !== String(next)) changes[col.dataIndex] = next;
      }
      if (Object.keys(changes).length === 0) {
        message.warning('No fields were changed.');
        return;
      }
      payloadCheck = changes;
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createExpenseAddRequest(tableKey, { ...meta, values: payloadCheck! });
      } else if (mode === 'update') {
        await createExpenseChangeRequest(tableKey, String(row![config.rowKey]), { ...meta, changes: payloadCheck! });
      } else {
        await createExpenseDeleteRequest(tableKey, String(row![config.rowKey]), meta);
      }
      message.success('Request submitted — pending Category Head review, then MDM approval.');
      onOpenChange(false);
      onSubmitted();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {mode === 'delete' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This row will be permanently removed once MDM gives final approval. Nothing is deleted before then.
                </span>
              </div>
              <div className="rounded-md border divide-y">
                {config.columns.map((col) => (
                  <div key={col.dataIndex} className="grid grid-cols-2 gap-2 p-2 text-sm">
                    <span className="text-muted-foreground">{col.title}</span>
                    <span className="break-all">{displayValue(row![col.dataIndex])}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            editableColumns.map((col) => (
              <div key={col.dataIndex} className="space-y-1">
                <Label className="text-xs">
                  {col.title}
                  {mode === 'create' && requiredKeys.has(col.dataIndex) && <span className="text-red-500"> *</span>}
                </Label>
                {col.type === 'boolean' ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={values[col.dataIndex] === true || values[col.dataIndex] === 'true'}
                      onCheckedChange={(checked) => setValues((v) => ({ ...v, [col.dataIndex]: checked }))}
                    />
                    <span className="text-sm text-muted-foreground">
                      {values[col.dataIndex] === true || values[col.dataIndex] === 'true' ? 'Yes' : 'No'}
                    </span>
                  </div>
                ) : col.pickFromExisting ? (
                  (() => {
                    const allOptions = optionsByColumn[col.dataIndex] ?? [];
                    const query = String(values[col.dataIndex] ?? '').trim().toLowerCase();
                    const filtered = query ? allOptions.filter((o) => o.toLowerCase().includes(query)) : allOptions;
                    return (
                      <Autocomplete
                        value={values[col.dataIndex] ?? ''}
                        onChange={(v) => setValues((prev) => ({ ...prev, [col.dataIndex]: v }))}
                        options={filtered.slice(0, 50).map((o) => ({ value: o }))}
                        placeholder={`Search or type a ${col.title.toLowerCase()}…`}
                        notFoundContent={
                          allOptions.length === 0 ? 'Loading…' : 'No match — you can still type a new value.'
                        }
                      />
                    );
                  })()
                ) : (
                  <Input
                    value={values[col.dataIndex] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [col.dataIndex]: e.target.value }))}
                  />
                )}
              </div>
            ))
          )}

          <div className="space-y-1 pt-2">
            <Label className="text-xs">{copy.reasonLabel}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.reasonHint}
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Needed by (required)</Label>
            <DatePicker value={dueDate} onChange={setDueDate} />
            <p className="text-xs text-muted-foreground">
              The date you need this done by. Both the Category Head and MDM see it, so they can tell what is running
              late.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            This won't take effect immediately — it goes to the Category Head for review, then to MDM for final
            approval, and only then is it applied to the master (and so visible to SAP).
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} variant={mode === 'delete' ? 'destructive' : 'default'}>
            {submitting ? 'Submitting…' : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
