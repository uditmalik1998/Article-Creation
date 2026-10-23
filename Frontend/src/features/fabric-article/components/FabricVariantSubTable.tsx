import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MultiSelect,
  Spinner,
  Tag,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import VariantGrid, { StatusPill } from '../../approver/components/VariantGrid';
import type { ApproverItem } from '../types';

const FALLBACK_COLORS = ['BLACK', 'WHITE', 'RED', 'NAVY', 'GREY', 'BLUE', 'GREEN'];

interface VariantSubTableProps {
  genericId: string;
  genericRecord: ApproverItem;
  onRefresh: () => void;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
}

// ── Add Color modal ───────────────────────────────────────────────────────────

interface AddColorModalProps {
  open: boolean;
  genericId: string;
  majorCategory: string;
  existingColors: string[];
  /** Existing (size, color) pairs already created, as `SIZE||COLOR` (upper-cased). */
  existingPairs: Set<string>;
  sizeCount: number;
  onClose: () => void;
  onAdded: () => void;
}

const AddColorModal: React.FC<AddColorModalProps> = ({
  open,
  genericId,
  majorCategory,
  existingColors,
  existingPairs,
  sizeCount,
  onClose,
  onAdded,
}) => {
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>([]);
  // Step 2: per-color image upload. step 1 = pick colors/sizes, step 2 = upload images.
  const [step, setStep] = useState<1 | 2>(1);
  const [colorImages, setColorImages] = useState<Record<string, string>>({}); // color code → uploaded URL
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) { setSelectedColors([]); setStep(1); setColorImages({}); setUploading({}); return; }
    const token = localStorage.getItem('authToken');
    // Colors from the color_master table.
    fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => setMasterColors(Array.isArray(d?.colors) ? d.colors : []))
      .catch(() => setMasterColors([]));
  }, [open, majorCategory]);

  // color code → "Name - CODE" label for the image step.
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

  const handleNext = () => {
    if (selectedColors.length === 0) { message.warning('Please select at least one color'); return; }
    setStep(2);
  };

  const handleOk = async () => {
    if (selectedColors.length === 0) {
      message.warning('Please select at least one color');
      return;
    }
    if (!allImagesReady) {
      message.warning('Upload an image for every color');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const body = { colors: selectedColors, colorImages };
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/add-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || payload?.error || 'Failed to add color variants');
      }
      const result = await response.json();
      message.success(`${result.count} variant${result.count !== 1 ? 's' : ''} created`);
      onAdded();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add colors');
    } finally {
      setSaving(false);
    }
  };

  const isColorDisabled = (code: string, label?: string): boolean => {
    const codeU = code.toUpperCase();
    const labelU = label?.toUpperCase();
    return existingColors.some((ec) => ec.toUpperCase() === codeU || (labelU ? ec.toUpperCase() === labelU : false));
  };

  // Colors come from the color_master table (child_color + sap_create_old).
  // value  = sap_create_old (stored on the variant), label = "CHILD COLOR - SAP_CODE".
  // Falls back to a fixed list only if color_master is unavailable.
  const options =
    masterColors.length > 0
      ? masterColors.map((c) => ({
          value: c.code,
          label: `${c.name} - ${c.code}`,
          disabled: isColorDisabled(c.code),
        }))
      : FALLBACK_COLORS.map((c) => ({ code: c, label: c })).map(({ code, label }) => ({
          value: code,
          label: label !== code ? `${code} — ${label}` : code,
          disabled: isColorDisabled(code, label),
        }));

  const variantPreview =
      selectedColors.length > 0 && sizeCount > 0
      ? `${selectedColors.length} color${selectedColors.length > 1 ? 's' : ''} × ${sizeCount} size${
          sizeCount > 1 ? 's' : ''
        } = ${selectedColors.length * sizeCount} variants`
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Color Variants</DialogTitle>
        </DialogHeader>

        {step === 1 && (
        <>
        <p className="mb-3 text-sm text-muted-foreground">
          Select one or more colors. One variant will be created per size for each color.
        </p>
        <MultiSelect
          options={options}
          value={selectedColors}
          onChange={setSelectedColors}
          placeholder="Select colors…"
          searchable
          searchPlaceholder="Search colors…"
        />

        {variantPreview && (
          <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5">
            <span className="text-[13px] text-emerald-700">
              Will create: <strong>{variantPreview}</strong>
            </span>
          </div>
        )}

        {existingColors.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Already added:{' '}
            {existingColors.map((c) => (
              <Tag key={c} className="ml-1">
                {c}
              </Tag>
            ))}
          </div>
        )}
        </>
        )}

        {/* Step 2 — per-color image upload */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upload an image for each color. That image is applied to all sizes of the color.
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
                      <div
                        className={
                          'text-[11px] ' +
                          (busy ? 'text-muted-foreground' : url ? 'text-emerald-600' : 'text-rose-600')
                        }
                      >
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
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleNext}
                disabled={selectedColors.length === 0}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving || anyUploading}>
                Back
              </Button>
              <Button onClick={handleOk} disabled={saving || anyUploading || !allImagesReady}>
                {saving ? 'Adding…' : 'Add Colors'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Main VariantSubTable ──────────────────────────────────────────────────────

const FabricVariantSubTable: React.FC<VariantSubTableProps> = ({
  genericId,
  genericRecord,
  onRefresh,
  pathType,
}) => {
  const [variants, setVariants] = useState<ApproverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [addColorOpen, setAddColorOpen] = useState(false);
  const [majCatSizeCount, setMajCatSizeCount] = useState<number | null>(null);
  const [deletingColor, setDeletingColor] = useState<string | null>(null);

  const fetchVariants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch variants');
      const result = await response.json();
      setVariants(result.data || result);
    } catch {
      if (!silent) message.error('Failed to load variants');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [genericId]);

  // Refetch on mount/genericId change, AND when the generic is approved/synced
  // (Save & Submit flips approvalStatus → APPROVED and sets sapArticleId) so the
  // variant rows refresh to show their updated status / SAP article numbers.
  useEffect(() => {
    fetchVariants();
  }, [fetchVariants, genericRecord.approvalStatus, genericRecord.sapArticleId]);

  // Variants sync to SAP a bit AFTER the generic, so the first refetch above often
  // still shows them "Pending SAP". Quietly re-poll every 5s while the generic is
  // APPROVED and any variant is still un-synced, so their SAP numbers/status appear
  // without a hard refresh. Self-stops once all variants resolve (or after 3 min).
  const variantPollElapsedRef = useRef(0);
  useEffect(() => { variantPollElapsedRef.current = 0; }, [genericId]);
  useEffect(() => {
    if (genericRecord.approvalStatus !== 'APPROVED') return;
    const anyPending = variants.some(
      (v) => v.sapSyncStatus === 'PENDING' || v.sapSyncStatus === 'NOT_SYNCED',
    );
    if (!anyPending || variantPollElapsedRef.current >= 180) return;
    const t = window.setTimeout(() => {
      variantPollElapsedRef.current += 5;
      void fetchVariants(true);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [variants, genericRecord.approvalStatus, fetchVariants]);

  useEffect(() => {
    const majCat = genericRecord.majorCategory;
    if (!majCat) return;
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/sizes-for-majcat/${encodeURIComponent(majCat)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setMajCatSizeCount(d.count ?? null))
      .catch(() => setMajCatSizeCount(null));
  }, [genericRecord.majorCategory]);

  const existingColors = Array.from(
    new Set(variants.map((v) => v.variantColor).filter((c): c is string => Boolean(c))),
  );

  // Existing (size, color) combinations, so the Add-Color modal can tell apart
  // "this color exists for some sizes" from "this exact size × color exists".
  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
  );

  const sizeCount =
    majCatSizeCount ?? Array.from(new Set(variants.map((v) => v.variantSize).filter(Boolean))).length;

  const handleVariantSaved = useCallback(() => {
    fetchVariants();
  }, [fetchVariants]);

  const handleRetryVariants = useCallback(async () => {
    setRetrying(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/retry-variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Retry failed');
      message.success(data.message || `${data.synced} synced, ${data.failed} failed`);
      fetchVariants();
      onRefresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }, [genericId, fetchVariants, onRefresh]);

  // ── Grid wiring (shared VariantGrid, design "Option E") ───────────────────
  // Only variants still pending approval can be deleted (unchanged rule).
  const isPendingVariant = (v: ApproverItem) => !v.sapArticleId && (!v.approvalStatus || v.approvalStatus === 'PENDING');

  const deleteVariants = async (ids: string[]) => {
    const token = localStorage.getItem('authToken');
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`${APP_CONFIG.api.baseURL}/approver/items/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed) message.error(`${failed} variant${failed !== 1 ? 's' : ''} could not be deleted`);
    else message.success(`Deleted ${ids.length} variant${ids.length !== 1 ? 's' : ''}`);
    fetchVariants();
  };

  const handleDeleteColorVariants = async (color: string) => {
    const ids = variants.filter((v) => (v.variantColor || '').toUpperCase() === color).map((v) => v.id);
    setDeletingColor(color);
    try {
      await deleteVariants(ids);
    } finally {
      setDeletingColor(null);
    }
  };

  const renderStatus = (v: ApproverItem) => {
    if (v.sapArticleId) return <StatusPill tone="green">Synced</StatusPill>;
    if (v.sapSyncStatus === 'FAILED') {
      return <StatusPill tone="red" tooltip={v.sapSyncMessage || 'SAP returned an error'}>Failed</StatusPill>;
    }
    if (v.sapSyncStatus === 'SYNCED') return <StatusPill tone="amber">Synced, no #</StatusPill>;
    if (v.approvalStatus === 'REJECTED') return <StatusPill tone="red">Rejected</StatusPill>;
    if (v.approvalStatus === 'APPROVED') return <StatusPill tone="slate">Pending SAP</StatusPill>;
    return <StatusPill tone="amber">Pending approval</StatusPill>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Loading variants…</span>
      </div>
    );
  }

  const retryNeededCount = variants.filter(
    (v) =>
      v.sapSyncStatus === 'FAILED' ||
      (v.approvalStatus === 'APPROVED' && v.sapSyncStatus === 'NOT_SYNCED') ||
      v.approvalStatus === 'PENDING',
  ).length;

  return (
    <div>
      <VariantGrid<ApproverItem>
        variants={variants}
        fallbackColor={genericRecord.colour}
        isSelectable={isPendingVariant}
        isDeletable={isPendingVariant}
        onBulkDelete={deleteVariants}
        canDeleteColor={(_color, rows) => rows.length > 0 && !!rows[0].variantColor && rows.every(isPendingVariant)}
        onDeleteColor={handleDeleteColorVariants}
        deletingColor={deletingColor}
        renderStatus={renderStatus}
        toolbarActions={
          <>
            {pathType === 'created' && retryNeededCount > 0 && (
              <Button size="sm" variant="destructive" className="h-7 text-[12px]" disabled={retrying} onClick={handleRetryVariants}>
                {retrying ? 'Retrying…' : `Retry Variants to SAP (${retryNeededCount})`}
              </Button>
            )}
            <Button size="sm" className="h-7 bg-slate-800 text-[12px] text-white hover:bg-slate-900" onClick={() => setAddColorOpen(true)}>
              <Plus />
              Add Color
            </Button>
          </>
        }
      />

      <AddColorModal
        open={addColorOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingColors={existingColors}
        existingPairs={existingPairs}
        sizeCount={sizeCount}
        onClose={() => setAddColorOpen(false)}
        onAdded={handleVariantSaved}
      />
    </div>
  );
};

export default FabricVariantSubTable;
