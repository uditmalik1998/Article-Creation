import { useMemo, useState } from 'react';
import {
  Button,
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
import { createExpenseChangeRequest } from '../../../services/adminApi';
import type { ExpenseTableConfig } from '../config/expenseTables';

interface EditRowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableKey: string;
  config: ExpenseTableConfig;
  row: Record<string, any> | null;
  onSubmitted: () => void;
}

export function EditRowDialog({ open, onOpenChange, tableKey, config, row, onSubmitted }: EditRowDialogProps) {
  const editableColumns = useMemo(() => config.columns.filter((c) => c.editable !== false), [config]);

  const [values, setValues] = useState<Record<string, any>>({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [initializedForRow, setInitializedForRow] = useState<any>(null);

  // Re-seed form state whenever a different row is opened for editing.
  if (row && row !== initializedForRow) {
    const initial: Record<string, any> = {};
    for (const col of editableColumns) initial[col.dataIndex] = row[col.dataIndex] ?? '';
    setValues(initial);
    setReason('');
    setInitializedForRow(row);
  }

  if (!row) return null;

  const handleSubmit = async () => {
    if (!reason.trim()) {
      message.warning('Please explain why you are making this change.');
      return;
    }

    const changes: Record<string, any> = {};
    for (const col of editableColumns) {
      const original = row[col.dataIndex] ?? '';
      const next = values[col.dataIndex] ?? '';
      if (String(original) !== String(next)) changes[col.dataIndex] = next;
    }
    if (Object.keys(changes).length === 0) {
      message.warning('No fields were changed.');
      return;
    }

    setSubmitting(true);
    try {
      await createExpenseChangeRequest(tableKey, String(row[config.rowKey]), { changes, reason: reason.trim() });
      message.success('Change request submitted — pending approver review.');
      onOpenChange(false);
      onSubmitted();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Failed to submit change request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Propose an Edit</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {editableColumns.map((col) => (
            <div key={col.dataIndex} className="space-y-1">
              <Label className="text-xs">{col.title}</Label>
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
              ) : (
                <Input
                  value={values[col.dataIndex] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [col.dataIndex]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <div className="space-y-1 pt-2">
            <Label className="text-xs">Reason for this change (required)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change needed?"
              rows={3}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This won't take effect immediately — it will be sent for approver review, then final sign-off,
            before the value actually changes.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
