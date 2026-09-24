import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MultiSelect,
  Popconfirm,
  Spinner,
  Tooltip,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FabricVariant {
  id: string;
  genericArticleId: string | null;
  genericArticleNumber: string | null;
  variantColor: string | null;
  variantArticleNumber: string | null;
  vendorName: string | null;
  vendorCode: string | null;
  mrp: number | null;
  rate: number | null;
  approvalStatus: string;
  sapSyncStatus: string;
  sapSyncMessage: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface FabricArticleVariantSubTableProps {
  genericId: string;
  genericRecord: { majorCategory?: string | null; imageUrl?: string | null };
  pathType?: string;
}

// ─── Add Color Modal ──────────────────────────────────────────────────────────

const AddColorModal: React.FC<{
  open: boolean;
  genericId: string;
  existingColors: string[];
  onClose: () => void;
  onAdded: () => void;
}> = ({ open, genericId, existingColors, onClose, onAdded }) => {
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [colorImages, setColorImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedColors([]);
      setStep(1);
      setColorImages({});
      setUploading({});
      return;
    }
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => setMasterColors(Array.isArray(d?.colors) ? d.colors : []))
      .catch(() => setMasterColors([]));
  }, [open]);

  const colorLabel = (code: string) => {
    const m = masterColors.find((c) => c.code.toUpperCase() === code.toUpperCase());
    return m ? `${m.name} - ${m.code}` : code;
  };

  const uploadColorImage = async (code: string, file: File) => {
    setUploading((u) => ({ ...u, [code]: true }));
    try {
      const token = localStorage.getItem('authToken');
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/upload-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      const d = await r.json();
      setColorImages((m) => ({ ...m, [code]: d.url }));
    } catch {
      message.error(`Failed to upload image for ${code}`);
    } finally {
      setUploading((u) => ({ ...u, [code]: false }));
    }
  };

  const anyUploading = Object.values(uploading).some(Boolean);
  const allImagesReady = selectedColors.length > 0 && selectedColors.every((c) => !!colorImages[c]);

  const handleAdd = async () => {
    if (!allImagesReady) { message.warning('Upload an image for every color'); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/fabric-article-data/${genericId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ colors: selectedColors, colorImages }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Failed to add colors');
      }
      const result = await res.json();
      message.success(`${result.count} variant${result.count !== 1 ? 's' : ''} created`);
      onAdded();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add colors');
    } finally {
      setSaving(false);
    }
  };

  const isColorDisabled = (code: string) =>
    existingColors.some((ec) => ec.toUpperCase() === code.toUpperCase());

  const options = masterColors.map((c) => ({
    value: c.code,
    label: `${c.name} - ${c.code}`,
    disabled: isColorDisabled(c.code),
  }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Color Variants</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <>
            <p className="text-sm text-muted-foreground">
              Select one or more colors. One variant will be created per color.
            </p>
            <MultiSelect
              options={options}
              value={selectedColors}
              onChange={setSelectedColors}
              placeholder="Select colors…"
              searchable
              searchPlaceholder="Search colors…"
            />
            {existingColors.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Already added: {existingColors.join(', ')}
              </p>
            )}
          </>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upload an image for each color.
            </p>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {selectedColors.map((code) => {
                const url = colorImages[code];
                const busy = uploading[code];
                return (
                  <div key={code} className="flex items-center gap-3 rounded-md border border-border p-2">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                      {url ? (
                        <img src={url} alt={code} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{colorLabel(code)}</div>
                      <div className={'text-[11px] ' + (busy ? 'text-muted-foreground' : url ? 'text-emerald-600' : 'text-rose-600')}>
                        {busy ? 'Uploading…' : url ? 'Image uploaded' : 'Required'}
                      </div>
                    </div>
                    <label className="shrink-0 cursor-pointer rounded-md border border-input bg-background px-2.5 py-1 text-[12px] hover:bg-muted">
                      {url ? 'Replace' : 'Upload'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadColorImage(code, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => { if (selectedColors.length === 0) { message.warning('Select at least one color'); return; } setStep(2); }} disabled={selectedColors.length === 0}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving || anyUploading}>
                Back
              </Button>
              <Button onClick={handleAdd} disabled={saving || anyUploading || !allImagesReady}>
                {saving ? 'Adding…' : 'Add Colors'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const FabricArticleVariantSubTable: React.FC<FabricArticleVariantSubTableProps> = ({
  genericId,
  pathType,
}) => {
  const [variants, setVariants] = useState<FabricVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/fabric-article-data/${genericId}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load variants');
      const d = await res.json();
      setVariants(d.data ?? []);
    } catch {
      message.error('Failed to load variants');
    } finally {
      setLoading(false);
    }
  }, [genericId]);

  useEffect(() => { fetchVariants(); }, [fetchVariants]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/fabric-article-variant/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Delete failed');
      }
      message.success('Variant deleted');
      fetchVariants();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [fetchVariants]);

  const existingColors = Array.from(
    new Set(variants.map((v) => v.variantColor).filter((c): c is string => Boolean(c)))
  );

  const columns: DataTableColumn<FabricVariant>[] = [
    {
      title: 'Color',
      dataIndex: 'variantColor',
      key: 'variantColor',
      width: 140,
      render: (v: string | null) =>
        v ? <Badge variant="info">{v}</Badge> : <span className="text-muted-foreground">—</span>,
    },
    {
      title: 'Image',
      dataIndex: 'imageUrl',
      key: 'imageUrl',
      width: 64,
      render: (url: string | null) =>
        url ? (
          <img src={url} alt="" className="h-10 w-10 rounded object-cover" />
        ) : (
          <span className="text-muted-foreground text-[11px]">—</span>
        ),
    },
    {
      title: 'Vendor',
      key: 'vendor',
      width: 160,
      render: (_v: unknown, r: FabricVariant) =>
        r.vendorName || r.vendorCode ? (
          <span>{r.vendorName ?? r.vendorCode}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      title: 'MRP',
      dataIndex: 'mrp',
      key: 'mrp',
      width: 80,
      render: (v: number | null) => (v != null ? String(v) : '—'),
    },
    {
      title: 'Variant Article #',
      dataIndex: 'variantArticleNumber',
      key: 'variantArticleNumber',
      width: 160,
      render: (v: string | null) =>
        v ? (
          <strong className="text-xs text-emerald-700">{v}</strong>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        ),
    },
    {
      title: 'SAP Status',
      key: 'sapStatus',
      width: 140,
      render: (_v: unknown, r: FabricVariant) => {
        const isSynced = r.sapSyncStatus === 'SYNCED';
        const isFailed = r.sapSyncStatus === 'FAILED';

        const pill = isSynced ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            SYNCED
          </span>
        ) : isFailed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
            <AlertCircle className="h-3 w-3" />
            FAILED
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
            <Clock className="h-3 w-3" />
            {r.sapSyncStatus || 'PENDING'}
          </span>
        );

        if (isFailed && r.sapSyncMessage) {
          return (
            <Tooltip title={r.sapSyncMessage} side="left">
              <span className="cursor-help">{pill}</span>
            </Tooltip>
          );
        }
        return pill;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_v: unknown, r: FabricVariant) => (
        <div className="flex gap-1.5">
          {r.approvalStatus !== 'APPROVED' && (
            <Popconfirm
              title="Delete variant?"
              description="This cannot be undone."
              onConfirm={() => handleDelete(r.id)}
              okText="Delete"
            >
              <Button size="sm" variant="destructive">
                <Trash2 />
              </Button>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Loading variants…</span>
      </div>
    );
  }

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/fabric-article-data/${genericId}/retry-variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Retry failed');
      message.success(d.message || `${d.synced} synced, ${d.failed} failed`);
      fetchVariants();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const failedOrUnsyncedCount = variants.filter(
    (v) => v.sapSyncStatus === 'FAILED' || (v.approvalStatus !== 'APPROVED' && !v.variantArticleNumber),
  ).length;

  return (
    <div className="rounded-md bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-[13px]">Color Variants ({variants.length})</strong>
        <div className="flex items-center gap-2">
          {failedOrUnsyncedCount > 0 && (
            <Button size="sm" variant="destructive" disabled={retrying} onClick={handleRetry}>
              {retrying ? 'Retrying…' : `Retry to SAP (${failedOrUnsyncedCount})`}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus />
            Add Color
          </Button>
        </div>
      </div>

      {variants.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No color variants yet. Use "Add Color" to create variants.
        </span>
      ) : (
        <DataTable<FabricVariant>
          columns={columns}
          dataSource={variants}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      )}


      <AddColorModal
        open={addOpen}
        genericId={genericId}
        existingColors={existingColors}
        onClose={() => setAddOpen(false)}
        onAdded={fetchVariants}
      />
    </div>
  );
};

export default FabricArticleVariantSubTable;
