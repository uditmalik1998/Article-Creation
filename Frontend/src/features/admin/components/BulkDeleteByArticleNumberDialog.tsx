import { useRef, useState } from 'react';
import { AlertTriangle, Inbox, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';

interface MatchedRow {
  id: string;
  [key: string]: any;
}

interface PreviewData {
  totalRequested: number;
  matchedCount: number;
  unmatchedCount: number;
  matched: MatchedRow[];
  matchedArticleNumbers: string[];
  unmatchedSample: string[];
}

interface BulkDeleteByArticleNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Fabric Article Data" / "Body Article Data" — used in copy only. */
  label: string;
  /** e.g. "Fabric Article Number" / "Body Article Number". */
  articleNumberLabel: string;
  /** Key to read the article number off a `matched` row — matches the Prisma
   * field name the backend's preview response uses (fabricArticleNumber /
   * bodyArticleNumber). */
  articleNumberKey: string;
  articleDescriptionKey: string;
  deleteTemplateEndpoint: string;
  deleteTemplateFilename: string;
  previewEndpoint: string;
  confirmEndpoint: string;
  /** Called after a successful delete so the caller can refresh its own
   * status/count display. */
  onDeleted: (deletedCount: number) => void;
}

type Step = 'idle' | 'previewing' | 'preview' | 'confirming';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Generic "download a one-column template → fill in article numbers → upload
 * → preview matches → confirm" bulk-delete flow, shared by the Fabric and
 * Body Article Data admin cards. Deleting is a two-step preview/confirm —
 * the preview call never writes anything; only the confirm call does.
 */
export function BulkDeleteByArticleNumberDialog({
  open,
  onOpenChange,
  label,
  articleNumberLabel,
  articleNumberKey,
  articleDescriptionKey,
  deleteTemplateEndpoint,
  deleteTemplateFilename,
  previewEndpoint,
  confirmEndpoint,
  onDeleted,
}: BulkDeleteByArticleNumberDialogProps) {
  const [step, setStep] = useState<Step>('idle');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setStep('idle');
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = () => {
    fetch(`${APP_CONFIG.api.baseURL}${deleteTemplateEndpoint}`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to download template');
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = deleteTemplateFilename;
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const handleFile = async (file: File) => {
    setStep('previewing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${APP_CONFIG.api.baseURL}${previewEndpoint}`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse the uploaded file');
      setPreview(data.data as PreviewData);
      setStep('preview');
    } catch (err: any) {
      message.error(err?.message || 'Failed to parse the uploaded file');
      setStep('idle');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleConfirm = async () => {
    if (!preview || preview.matchedArticleNumbers.length === 0) return;
    setStep('confirming');
    try {
      const res = await fetch(`${APP_CONFIG.api.baseURL}${confirmEndpoint}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleNumbers: preview.matchedArticleNumbers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
      message.success(`Deleted ${Number(data.data.deletedCount).toLocaleString()} row(s) from ${label}.`);
      onDeleted(data.data.deletedCount);
      handleOpenChange(false);
    } catch (err: any) {
      message.error(err?.message || 'Bulk delete failed');
      setStep('preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Delete — {label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {step === 'preview' || step === 'confirming' ? (
            preview && (
              <>
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{preview.matchedCount.toLocaleString()}</strong> of{' '}
                    {preview.totalRequested.toLocaleString()} {articleNumberLabel.toLowerCase()}(s) matched existing
                    rows and will be <strong>permanently deleted</strong>.
                    {preview.unmatchedCount > 0 && (
                      <> {preview.unmatchedCount.toLocaleString()} were not found and will be skipped.</>
                    )}
                  </span>
                </div>

                {preview.matched.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                    {preview.matched.map((row) => (
                      <div key={row.id} className="grid grid-cols-2 gap-2 p-2 text-sm">
                        <span className="font-mono">{row[articleNumberKey]}</span>
                        <span className="truncate text-muted-foreground">{row[articleDescriptionKey] || '—'}</span>
                      </div>
                    ))}
                    {preview.matchedCount > preview.matched.length && (
                      <div className="p-2 text-xs text-muted-foreground">
                        + {(preview.matchedCount - preview.matched.length).toLocaleString()} more…
                      </div>
                    )}
                  </div>
                )}

                {preview.unmatchedSample.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Not found: {preview.unmatchedSample.join(', ')}
                    {preview.unmatchedCount > preview.unmatchedSample.length ? ', …' : ''}
                  </div>
                )}
              </>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Download the delete template, list the {articleNumberLabel} of every row you want removed (one per
                row), then upload it here. Nothing is deleted until you review the matches and confirm.
              </p>
              <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={step === 'previewing'}>
                Download Delete Template
              </Button>

              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />

              {step === 'previewing' ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Reading the file and checking for matches…
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-red-400 hover:bg-red-50"
                >
                  <Inbox className="mb-2 h-8 w-8 text-red-500" />
                  <p className="text-[13px]">
                    Click to upload the filled-in <strong>.xlsx</strong> template
                  </p>
                  <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                </button>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={step === 'previewing' || step === 'confirming'}
          >
            Cancel
          </Button>
          {(step === 'preview' || step === 'confirming') && (
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!preview || preview.matchedCount === 0 || step === 'confirming'}
            >
              <Trash2 className="h-4 w-4" />
              {step === 'confirming'
                ? 'Deleting…'
                : `Permanently Delete ${preview?.matchedCount.toLocaleString() ?? 0} Row(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
