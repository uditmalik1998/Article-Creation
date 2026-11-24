import { useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle, Info, Trash2, Undo2, X } from 'lucide-react';
import { Button, DatePicker, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { createExpenseBulkDeleteRequest } from '../../../services/adminApi';
import type { ExpenseTableConfig } from '../config/expenseTables';
import { BULK_ADD_LAYOUT } from '../config/expenseSections';

/**
 * "Propose deleting N rows" (design option A, 2026-11-24): one screen, rows
 * grouped by attribute as red struck chips — click one to keep it back.
 * Sent as ONE bulk-delete request (not one request per row).
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableKey: string;
  config: ExpenseTableConfig;
  rows: Record<string, any>[];
  onSubmitted: () => void;
}

const fmt = (x: unknown) => (x === true || x === 'true' ? 'Active' : x === false || x === 'false' ? 'Inactive' : x == null || x === '' ? '—' : String(x));

export function BulkDeleteDialog({ open, onOpenChange, tableKey, config, rows, onSubmitted }: Props) {
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visibleCols = config.columns.filter((c) => c.dataIndex !== 'id' && c.type !== 'date');
  const layout = BULK_ADD_LAYOUT[tableKey];
  // Group by the table's attribute column (Major Category Grid: attribute
  // name); otherwise by the first visible column. Value = the next one.
  const keyCol = layout?.key;
  const groupCol = layout ? layout.group : visibleCols[0]?.dataIndex;
  const valueCol = layout ? layout.value : visibleCols[1]?.dataIndex ?? visibleCols[0]?.dataIndex;
  const keyOf = (r: Record<string, any>) => String(r[config.rowKey]);
  const valueText = (r: Record<string, any>) => {
    const detail = layout?.detail ? ` (${layout.detail.map((d) => fmt(r[d])).join('–')})` : '';
    return `${fmt(r[valueCol ?? ''])}${detail}`;
  };

  const groups = useMemo(() => {
    const map = new Map<string, Record<string, any>[]>();
    const fallback = visibleCols.find((c) => c.dataIndex === valueCol)?.title ?? 'Rows';
    for (const r of rows) {
      const g = groupCol ? fmt(r[groupCol]) : fallback;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(r);
    }
    return [...map.entries()];
  }, [rows, groupCol, valueCol]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = keyCol ? [...new Set(rows.map((r) => fmt(r[keyCol])))] : [];
  const deleting = rows.length - kept.size;
  const groupTitle = layout?.groupTitle ?? (visibleCols.find((c) => c.dataIndex === groupCol)?.title?.toLowerCase() ?? 'groups');
  const tableName = config.title.split(' (')[0];

  const toggle = (k: string) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleGroup = (list: Record<string, any>[]) =>
    setKept((prev) => {
      const next = new Set(prev);
      const allKept = list.every((r) => next.has(keyOf(r)));
      for (const r of list) {
        if (allKept) next.delete(keyOf(r));
        else next.add(keyOf(r));
      }
      return next;
    });

  const submit = async () => {
    if (deleting === 0) return message.warning('Every row is kept back — nothing to delete.');
    if (!reason.trim()) return message.warning('Please explain why these rows should be removed.');
    if (!dueDate) return message.warning('Please pick the date you need this done by.');
    if (dueDate.isBefore(dayjs().startOf('day'))) return message.warning('The "needed by" date cannot be in the past.');
    const rowIds = rows.map(keyOf).filter((k) => !kept.has(k));
    setSubmitting(true);
    try {
      const res = await createExpenseBulkDeleteRequest(tableKey, {
        rowIds,
        reason: reason.trim(),
        dueDate: dueDate.format('YYYY-MM-DD'),
        label: `${keys.length === 1 ? `${keys[0]} — ` : ''}${rowIds.length} rows deleted`,
      });
      message.success(`Deletion request for ${res.rowCount} rows submitted — now pending approval.`);
      onOpenChange(false);
      onSubmitted();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const tile = (label: string, value: number | string, tone = 'text-slate-900 dark:text-slate-100') => (
    <div className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-[19px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[680px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-start gap-3.5 space-y-0 border-b border-slate-200 px-6 py-4 text-left dark:border-slate-700">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <Trash2 className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 pr-8">
            <DialogTitle className="text-[17px] font-semibold tracking-tight">
              Delete {deleting} row{deleting === 1 ? '' : 's'} from {tableName}
            </DialogTitle>
            <p className="mt-0.5 text-[13px] text-slate-500">
              {keys.length === 1 && (
                <>
                  Major Category <b className="text-slate-900 dark:text-slate-100">{keys[0]}</b> ·{' '}
                </>
              )}
              {groupCol ? `${groups.length} ${groupTitle} · ` : ''}goes to approval first
            </p>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="flex gap-2.5">
            {tile('Rows to delete', deleting, 'text-red-700 dark:text-red-400')}
            {groupCol ? tile(groupTitle, groups.length) : tile('Selected', rows.length)}
            {tile('Kept back', kept.size)}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 text-[12.5px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <Info className="h-3.5 w-3.5 shrink-0" /> Click a value to keep it (not delete).
              {kept.size > 0 && (
                <button type="button" onClick={() => setKept(new Set())} className="ml-auto font-semibold text-slate-800 hover:underline dark:text-slate-200">
                  Delete all again
                </button>
              )}
            </div>
            <div className="max-h-[300px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {groups.map(([g, list]) => {
                const keptHere = list.filter((r) => kept.has(keyOf(r))).length;
                return (
                  <div key={g} className="px-3.5 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{g}</span>
                      <span className="text-[12px] text-slate-500">
                        {list.length - keptHere} row{list.length - keptHere === 1 ? '' : 's'}
                      </span>
                      <button type="button" onClick={() => toggleGroup(list)} className="ml-auto text-[11.5px] font-semibold text-slate-500 hover:text-slate-900 hover:underline">
                        {keptHere === list.length ? 'Delete all' : 'Keep all'}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {list.map((r) => {
                        const k = keyOf(r);
                        const keep = kept.has(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => toggle(k)}
                            aria-pressed={!keep}
                            title={keep ? 'Kept — click to delete it too' : 'Will be deleted — click to keep it'}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12.5px] font-medium transition ${
                              keep
                                ? 'border-dashed border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900'
                                : 'border-red-200 bg-red-50 text-red-800 line-through hover:border-red-300 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                            }`}
                          >
                            {valueText(r)}
                            {keep ? <Undo2 className="h-3 w-3" /> : <X className="h-3 w-3 opacity-50" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <label className="space-y-1.5">
              <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">Reason (required)</span>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why should these rows be removed?"
                className="h-10 bg-white text-[13.5px] focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-900/10 dark:bg-slate-900"
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">Needed by (required)</span>
              <DatePicker value={dueDate} onChange={setDueDate} />
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] text-red-800 dark:bg-red-500/10 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Removed only after the last approval stage signs off. Nothing is deleted before then.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <span className="mr-auto text-[12.5px] text-slate-600 dark:text-slate-400">
            <b className="text-slate-900 dark:text-slate-100">{deleting} rows</b> · sent as one request
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="bg-white dark:bg-slate-900">
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || deleting === 0} className="bg-red-700 text-white hover:bg-red-800">
            <Trash2 className="h-4 w-4" />
            {submitting ? 'Submitting…' : `Submit ${deleting} deletion${deleting === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
