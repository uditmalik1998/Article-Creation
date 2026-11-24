import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui-tw';
import { getExpenseColumnOptions, getExpenseRowsByColumn } from '../../../services/adminApi';
import type { ExpenseTableConfig } from '../config/expenseTables';
import { BULK_ADD_LAYOUT } from '../config/expenseSections';
import { ExistingValuePicker } from './RowChangeRequestDialog';
import { BulkDeleteDialog } from './BulkDeleteDialog';

/**
 * "Delete major category" (2026-11-24): pick a major category, load every
 * row it has on this table, then hand them to the bulk-delete modal (where
 * values can still be kept back) — ONE bulk-delete request.
 */

interface Props {
  tableKey: string;
  config: ExpenseTableConfig;
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export function DeleteMajorCategoryDialog({ tableKey, config, open, onClose, onSubmitted }: Props) {
  const keyCol = BULK_ADD_LAYOUT[tableKey]?.key ?? 'major_category';
  const [mc, setMc] = useState('');
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['expense-column-options', tableKey, keyCol],
    queryFn: () => getExpenseColumnOptions(tableKey, keyCol),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const valid = !!mc && options.includes(mc);
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['expense-rows-by', tableKey, keyCol, mc, 'with-id'],
    queryFn: () => getExpenseRowsByColumn(tableKey, keyCol, mc, true),
    enabled: open && valid,
    staleTime: 30_000,
  });

  const close = () => {
    setMc('');
    setRows(null);
    onClose();
  };

  // Step 2: the regular bulk-delete modal with this major category's rows.
  if (rows) {
    return (
      <BulkDeleteDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        tableKey={tableKey}
        config={config}
        rows={rows}
        onSubmitted={() => {
          setMc('');
          setRows(null);
          onSubmitted();
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-[520px] gap-0 overflow-visible p-0">
        <DialogHeader className="flex-row items-start gap-3.5 space-y-0 border-b border-slate-200 px-6 py-4 text-left dark:border-slate-700">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <Trash2 className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 pr-8">
            <DialogTitle className="text-[17px] font-semibold tracking-tight">Delete a major category</DialogTitle>
            <p className="mt-0.5 text-[13px] text-slate-500">Removes all its rows from {config.title.split(' (')[0]} — after approval, as one request.</p>
          </div>
        </DialogHeader>
        <div className="space-y-2 px-6 py-5">
          <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">Major category</span>
          <ExistingValuePicker value={mc} onChange={setMc} options={options} loading={isLoading} placeholder="Search a major category…" />
          <p className="min-h-[20px] text-[12.5px] text-slate-500">
            {!valid ? 'Pick one from the list.' : isFetching ? 'Counting rows…' : `${found.length} row${found.length === 1 ? '' : 's'} will be listed for deletion — you can keep some back on the next screen.`}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <Button variant="outline" onClick={close} className="bg-white dark:bg-slate-900">
            Cancel
          </Button>
          <Button
            onClick={() => setRows(found)}
            disabled={!valid || isFetching || found.length === 0}
            className="bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
          >
            Review rows <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
