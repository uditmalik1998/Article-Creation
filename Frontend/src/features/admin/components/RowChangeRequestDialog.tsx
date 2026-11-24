import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
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
  getExpenseRowsByColumn,
} from '../../../services/adminApi';
import type { ExpenseTableColumnConfig, ExpenseTableConfig } from '../config/expenseTables';
import { BulkDeleteDialog } from './BulkDeleteDialog';
import { BULK_ADD_LAYOUT } from '../config/expenseSections';

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
  /** 'dialog' (default) is a modal; 'panel' renders the same form inline as a side panel. */
  variant?: 'dialog' | 'panel';
  /** Delete mode only: propose deleting all these rows at once (one request
   * per row, same reason and date). `row` may be null when this is set. */
  bulkRows?: Record<string, any>[];
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
export function ExistingValuePicker({
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
  // Every match is listed (was capped at 50, which hid most of the 359 major
  // categories); the list scrolls.
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.toLowerCase().includes(query)) : options),
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
        onFocus={() => setOpen(true)}
        className="bg-white focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:bg-slate-900"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          {filtered.length > 0 && (
            <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 border-b border-slate-100 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              {query ? `${filtered.length} of ${options.length} match` : `${options.length} values`}
            </div>
          )}
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
                className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${opt === value ? 'bg-slate-100 font-semibold dark:bg-slate-800' : ''}`}
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
  variant = 'dialog',
  bulkRows,
}: RowChangeRequestDialogProps) {
  const isBulk = mode === 'delete' && !!bulkRows && bulkRows.length > 0;
  const editableColumns = useMemo(() => config.columns.filter((c) => c.editable !== false), [config]);
  const rowLabel = (r: Record<string, any>) =>
    config.columns.filter((c) => c.dataIndex !== 'id').slice(0, 3).map((c) => displayValue(r[c.dataIndex])).join(' · ');
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
      initial[col.dataIndex] =
        mode === 'create' ? (col.type === 'boolean' ? true : col.dataIndex === 'status' ? 'ACT' : '') : row?.[col.dataIndex] ?? '';
    }
    return initial;
  });
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // New-row form (design option A, 2026-11-24): the major category comes
  // first; its other rows fill the "carry" columns (Division, Sub Division,
  // MC Code …) and show which values it already has, so duplicates are
  // visible before submitting.
  const mcLayout = BULK_ADD_LAYOUT[tableKey];
  const mcCol = mode === 'create' && mcLayout && editableColumns.some((c) => c.dataIndex === mcLayout.key) ? mcLayout.key : null;
  const carryCols = useMemo(
    () => (mcCol ? (mcLayout?.carry ?? []).filter((k) => editableColumns.some((c) => c.dataIndex === k)) : []),
    [mcCol, mcLayout, editableColumns]
  );
  const { data: mcOptions = [] } = useQuery({
    queryKey: ['expense-column-options', tableKey, mcCol],
    queryFn: () => getExpenseColumnOptions(tableKey, mcCol!),
    enabled: !!mcCol,
    staleTime: 5 * 60_000,
  });
  const mcValue = mcCol ? String(values[mcCol] ?? '').trim() : '';
  const mcKnown = !!mcValue && mcOptions.includes(mcValue);
  const { data: mcRows = [] } = useQuery({
    queryKey: ['expense-rows-by', tableKey, mcCol, mcValue],
    queryFn: () => getExpenseRowsByColumn(tableKey, mcCol!, mcValue),
    enabled: !!mcCol && mcKnown,
    staleTime: 60_000,
  });
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!carryCols.length || !mcRows.length) return;
    const first = mcRows[0];
    setValues((prev) => {
      const next = { ...prev };
      const filled = new Set<string>();
      for (const k of carryCols) {
        const v = first[k];
        if (v == null || v === '') continue;
        if (String(prev[k] ?? '') === '' || autoFilled.has(k)) {
          next[k] = String(v);
          filled.add(k);
        }
      }
      setAutoFilled(filled);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcRows, carryCols]);

  // Every field's onChange goes through this — besides setting its own
  // value, it fills in any OTHER column whose autoFillFrom names this one,
  // if the mapping has an entry for the value just picked. Still a plain
  // editable field afterward, not locked to the auto-filled value.
  const updateValue = (key: string, value: any) => {
    if (autoFilled.has(key)) {
      setAutoFilled((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
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

  // Several rows to delete → the dedicated bulk-delete modal (one request).
  if (isBulk) {
    return <BulkDeleteDialog open={open} onOpenChange={onOpenChange} tableKey={tableKey} config={config} rows={bulkRows!} onSubmitted={onSubmitted} />;
  }

  if (mode !== 'create' && !row && !isBulk) return null;

  const copy = isBulk
    ? {
        title: `Propose Deleting ${bulkRows!.length} Rows`,
        submit: `Submit ${bulkRows!.length} Deletions for Approval`,
        reasonLabel: 'Reason for deleting these rows (required)',
        reasonHint: 'Why should these rows be removed?',
      }
    : MODE_COPY[mode];

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
    if (isBulk) {
      // One request per row, in order; a failure (e.g. a row that already has
      // a pending request) doesn't stop the rest.
      let ok = 0;
      const failed: string[] = [];
      for (const r of bulkRows!) {
        try {
          await createExpenseDeleteRequest(tableKey, String(r[config.rowKey]), meta);
          ok += 1;
        } catch (err: any) {
          failed.push(`${rowLabel(r)}: ${err?.response?.data?.error || 'failed'}`);
        }
      }
      setSubmitting(false);
      if (ok > 0) message.success(`${ok} deletion request${ok === 1 ? '' : 's'} submitted — now pending approval.`);
      if (failed.length > 0) message.error(`${failed.length} not submitted — ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}`);
      if (ok > 0) {
        onOpenChange(false);
        onSubmitted();
      }
      return;
    }
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

  const INPUT_CLS = 'h-10 bg-white text-[13.5px] focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:bg-slate-900';

  /** Values the chosen major category already has for the "value" column
   * (narrowed to the chosen group, e.g. attribute, when the table has one). */
  const existingValues = (() => {
    if (!mcCol || !mcLayout || !mcRows.length) return [] as string[];
    const g = mcLayout.group;
    const gv = g ? String(values[g] ?? '').trim() : '';
    if (g && !gv) return [];
    return [...new Set(mcRows.filter((r) => !g || String(r[g] ?? '') === gv).map((r) => String(r[mcLayout.value] ?? '')))].filter(Boolean);
  })();

  const renderField = (col: ExpenseTableColumnConfig, hint?: string) => {
    const isAuto = autoFilled.has(col.dataIndex);
    const isValueCol = mode === 'create' && !!mcLayout && col.dataIndex === mcLayout.value;
    const typed = String(values[col.dataIndex] ?? '').trim().toUpperCase();
    const dup = isValueCol && !!typed && existingValues.some((v) => v.toUpperCase() === typed);
    return (
      <div key={col.dataIndex} className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
          {col.title}
          {mode === 'create' && requiredKeys.has(col.dataIndex) && <span className="text-red-500">*</span>}
          {isAuto && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 text-[10.5px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Sparkles className="h-2.5 w-2.5" /> auto-filled
            </span>
          )}
        </Label>
        {col.type === 'boolean' ? (
          <div className="flex h-10 items-center gap-2">
            <Switch
              checked={values[col.dataIndex] === true || values[col.dataIndex] === 'true'}
              onCheckedChange={(checked) => updateValue(col.dataIndex, checked)}
            />
            <span className="text-sm text-muted-foreground">
              {values[col.dataIndex] === true || values[col.dataIndex] === 'true' ? 'Yes' : 'No'}
            </span>
          </div>
        ) : col.dataIndex === 'status' ? (
          <div role="radiogroup" aria-label={col.title} className="inline-flex rounded-lg bg-slate-200 p-0.5 dark:bg-slate-800">
            {['ACT', 'INACT'].map((o) => {
              const on = String(values[col.dataIndex] ?? '').toUpperCase() === o;
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => updateValue(col.dataIndex, o)}
                  className={`rounded-md px-4 py-1.5 text-[12.5px] font-semibold transition ${on ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        ) : col.pickFromExisting || col.dataIndex === mcCol ? (
          <ExistingValuePicker
            value={values[col.dataIndex] ?? ''}
            onChange={(v) => updateValue(col.dataIndex, v)}
            options={col.dataIndex === mcCol && !col.pickFromExisting ? mcOptions : optionsByColumn[col.dataIndex] ?? []}
            loading={(col.dataIndex === mcCol && !col.pickFromExisting ? mcOptions : optionsByColumn[col.dataIndex] ?? []).length === 0}
            placeholder={`Search or type a ${col.title.toLowerCase()}…`}
          />
        ) : (
          <Input
            value={values[col.dataIndex] ?? ''}
            onChange={(e) => updateValue(col.dataIndex, e.target.value)}
            className={`${INPUT_CLS} ${isAuto ? 'bg-slate-50' : ''} ${dup ? 'border-amber-400' : ''}`}
          />
        )}
        {hint && <p className="text-[11.5px] text-slate-500">{hint}</p>}
        {isValueCol && existingValues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11.5px] text-slate-500">Already has:</span>
            {existingValues.slice(0, 24).map((v) => (
              <span
                key={v}
                className={`rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${v.toUpperCase() === typed ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
              >
                {v}
              </span>
            ))}
            {existingValues.length > 24 && <span className="text-[11.5px] text-slate-500">+{existingValues.length - 24} more</span>}
          </div>
        )}
        {dup && <p className="text-[11.5px] font-semibold text-amber-700">This value already exists for {mcValue}.</p>}
        {mode === 'update' && row && (
          <p className="text-[11.5px] text-muted-foreground">
            Current: <span className="font-mono">{displayValue(row[col.dataIndex])}</span>
            {String(values[col.dataIndex] ?? '') !== String(row[col.dataIndex] ?? '') && (
              <span className="font-semibold text-slate-800 dark:text-slate-200"> · changed</span>
            )}
          </p>
        )}
      </div>
    );
  };

  const body = (
        <div className="space-y-3 mt-2">
          {isBulk ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  These {bulkRows!.length} rows will be permanently removed once MDM gives final approval. Each becomes its own
                  request with the reason and date below. Nothing is deleted before then.
                </span>
              </div>
              <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
                {bulkRows!.map((r) => (
                  <li key={String(r[config.rowKey])} className="truncate px-2.5 py-1.5" title={rowLabel(r)}>
                    {rowLabel(r)}
                  </li>
                ))}
              </ul>
            </div>
          ) : mode === 'delete' ? (
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
          ) : mode === 'create' ? (
            <>
              {mcCol && (
                <section className="space-y-3 pt-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">1 · Where</div>
                  {renderField(editableColumns.find((c) => c.dataIndex === mcCol)!, `Pick first${carryCols.length ? ' — ' + carryCols.map((k) => editableColumns.find((c) => c.dataIndex === k)?.title ?? k).join(', ') + ' fill in from it.' : '.'}`)}
                  {carryCols.length > 0 && (
                    <div className={`grid gap-3 ${carryCols.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                      {carryCols.map((k) => renderField(editableColumns.find((c) => c.dataIndex === k)!))}
                    </div>
                  )}
                </section>
              )}
              <section className={`space-y-3 ${mcCol ? 'border-t border-slate-200 pt-4 dark:border-slate-700' : 'pt-1'}`}>
                {mcCol && <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">2 · Row</div>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {editableColumns
                    .filter((c) => c.dataIndex !== mcCol && !carryCols.includes(c.dataIndex))
                    .map((col) => (
                      <div key={col.dataIndex} className={col.dataIndex === mcLayout?.value || col.dataIndex === mcLayout?.group ? 'sm:col-span-2' : ''}>
                        {renderField(col)}
                      </div>
                    ))}
                </div>
              </section>
            </>
          ) : (
            editableColumns.map((col) => renderField(col))
          )}

          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            {mode === 'create' && mcCol && <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">3 · Why</div>}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                  Reason <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={copy.reasonHint}
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                  Needed by <span className="text-red-500">*</span>
                </Label>
                <DatePicker value={dueDate} onChange={setDueDate} />
              </div>
            </div>
            <p className="text-[12px] text-slate-500">
              Nothing changes until every approval stage signs off — then it is applied to the master (and so visible to SAP).
            </p>
          </section>
        </div>
  );

  const actions = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
        Cancel
      </Button>
      <Button
        onClick={submit}
        disabled={submitting}
        variant={mode === 'delete' ? 'destructive' : 'default'}
        className={mode === 'delete' ? undefined : 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300'}
      >
        {submitting ? 'Submitting…' : copy.submit}
      </Button>
    </>
  );

  if (variant === 'panel') {
    if (!open) return null;
    return (
      <aside
        aria-label={copy.title}
        className="flex max-h-[calc(100vh-7rem)] w-full flex-col rounded-xl border border-slate-400 bg-card shadow-lg lg:sticky lg:top-3 lg:w-[380px] lg:shrink-0 dark:border-slate-500"
      >
        <div className="flex items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{copy.title}</span>
            {isBulk && <p className="m-0 text-[13px] font-semibold">{bulkRows!.length} rows selected</p>}
            {row && !isBulk && (
              <p className="m-0 truncate text-[13px] font-semibold" title={config.columns.slice(0, 3).map((c) => displayValue(row[c.dataIndex])).join(' · ')}>
                {config.columns.filter((c) => c.dataIndex !== 'id').slice(0, 2).map((c) => displayValue(row[c.dataIndex])).join(' · ')}
              </p>
            )}
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onOpenChange(false)} aria-label="Close panel">
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{body}</div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{actions}</div>
      </aside>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-slate-200 px-6 pb-3.5 pt-5 text-left dark:border-slate-700">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{copy.title}</span>
          <DialogTitle className="break-words pr-8 text-[17px] font-bold leading-snug">
            {isBulk
              ? `${bulkRows!.length} rows selected`
              : row
                ? config.columns.filter((c) => c.dataIndex !== 'id').slice(0, 3).map((c) => displayValue(row[c.dataIndex])).join(' · ')
                : config.title.split(' (')[0]}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{body}</div>
        <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/60">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
