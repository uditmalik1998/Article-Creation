import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle } from 'lucide-react';
import {
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
  getExpenseColumnMapping,
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

/**
 * A small, self-contained "type or pick from existing values" field.
 * Deliberately NOT built on the shared Popover-based Autocomplete: that one
 * portals its panel to document.body and positions it via viewport math,
 * which inside this dialog (itself scrollable and centered) sometimes
 * resolved to the wrong place entirely and to an unbounded height. This
 * renders its options list as a normal in-flow child directly under the
 * input (`absolute` against a `relative` wrapper, no portal), so it can
 * never drift from the field, and stays capped to a handful of rows with
 * its own scrollbar.
 */
function ExistingValuePicker({
  value,
  onChange,
  options,
  loading,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  loading: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const query = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.toLowerCase().includes(query)) : options).slice(0, 50),
    [options, query]
  );

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              {loading ? 'Loading…' : 'No match — you can still type a new value.'}
            </div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt);
                  setOpen(false);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
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

  // One query per auto-fill column, fetching its {sourceValue: value} map —
  // e.g. Size Master's Sub Division, keyed by Major Category.
  const autoFillColumns = useMemo(() => editableColumns.filter((c) => c.autoFillFrom), [editableColumns]);
  const autoFillQueries = useQueries({
    queries: autoFillColumns.map((col) => ({
      queryKey: ['expense-column-mapping', tableKey, col.autoFillFrom, col.dataIndex],
      queryFn: () => getExpenseColumnMapping(tableKey, col.autoFillFrom!, col.dataIndex),
      staleTime: 5 * 60_000,
    })),
  });
  const autoFillMapByColumn = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    autoFillColumns.forEach((col, i) => {
      map[col.dataIndex] = autoFillQueries[i]?.data ?? {};
    });
    return map;
  }, [autoFillColumns, autoFillQueries]);

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

  // Every field's onChange goes through this — besides setting its own
  // value, it fills in any OTHER column whose autoFillFrom names this one,
  // if the mapping has an entry for the value just picked. Still a plain
  // editable field afterward, not locked to the auto-filled value.
  const updateValue = (key: string, value: any) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      for (const col of autoFillColumns) {
        if (col.autoFillFrom !== key) continue;
        const mapped = autoFillMapByColumn[col.dataIndex]?.[value];
        if (mapped !== undefined) next[col.dataIndex] = mapped;
      }
      return next;
    });
  };

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
      message.success('Request submitted — now pending approval.');
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
                      onCheckedChange={(checked) => updateValue(col.dataIndex, checked)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {values[col.dataIndex] === true || values[col.dataIndex] === 'true' ? 'Yes' : 'No'}
                    </span>
                  </div>
                ) : col.pickFromExisting ? (
                  <ExistingValuePicker
                    value={values[col.dataIndex] ?? ''}
                    onChange={(v) => updateValue(col.dataIndex, v)}
                    options={optionsByColumn[col.dataIndex] ?? []}
                    loading={(optionsByColumn[col.dataIndex] ?? []).length === 0}
                    placeholder={`Search or type a ${col.title.toLowerCase()}…`}
                  />
                ) : (
                  <Input
                    value={values[col.dataIndex] ?? ''}
                    onChange={(e) => updateValue(col.dataIndex, e.target.value)}
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
              The date you need this done by. Every approver in the chain sees it, so they can tell what is running
              late.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            This won't take effect immediately — it goes through the approval chain, and is applied to the master
            (and so visible to SAP) only once every stage has signed off.
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
