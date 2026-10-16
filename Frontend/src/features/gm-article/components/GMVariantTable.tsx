import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Spinner } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import VariantGrid, { StatusPill } from '../../approver/components/VariantGrid';
import GMAddColorModal from './GMAddColorModal';

// ─── GM Article colour variants ───────────────────────────────────────────────
// Same grid as the FG article pages (shared VariantGrid: filters, colour groups,
// multi-select delete, "Delete colour"), backed by the GM variant logic:
//   rows   → gm_variants_article_data  (GET  /approver/gm-articles/:id/variants)
//   add    → GMAddColorModal           (POST /approver/gm-articles/:id/variants,
//                                        sizes from gm_size_master)
//   delete → DELETE /approver/gm-article-variant/:id (approved variants are locked)

interface GMVariantRow {
  id: string;
  genericArticleId: string | null;
  genericArticleNumber: string | null;
  variantColor: string | null;
  variantSize: string | null;
  variantArticleNumber: string | null;
  division: string | null;
  majorCategory: string | null;
  vendorName: string | null;
  vendorCode: string | null;
  mrp: number | null;
  rate: number | null;
  approvalStatus: string;
  sapSyncStatus: string;
  sapSyncMessage: string | null;
  imageUrl: string | null;
  /** variantArticleNumber, under the name VariantGrid reads for the article # column. */
  sapArticleId: string | null;
}

interface GMVariantTableProps {
  genericId: string;
  genericRecord: {
    majorCategory?: string | null;
    colour?: string | null;
    approvalStatus?: string | null;
    /** GM generic's SAP number (gm_article_number). */
    articleNumber?: string | null;
  };
  pathType?: string;
  onRefresh?: () => void;
}

// Only variants still pending approval (and without an article number) can be deleted.
const isPendingVariant = (v: GMVariantRow) =>
  !v.sapArticleId && (!v.approvalStatus || v.approvalStatus === 'PENDING');

const GMVariantTable: React.FC<GMVariantTableProps> = ({ genericId, genericRecord, pathType, onRefresh }) => {
  const [variants, setVariants] = useState<GMVariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [addColorOpen, setAddColorOpen] = useState(false);
  const [deletingColor, setDeletingColor] = useState<string | null>(null);

  const fetchVariants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-articles/${genericId}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load variants');
      const d = await res.json();
      const rows: Omit<GMVariantRow, 'sapArticleId'>[] = d.data ?? [];
      setVariants(rows.map((r) => ({ ...r, sapArticleId: r.variantArticleNumber })));
    } catch {
      if (!silent) message.error('Failed to load variants');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [genericId]);

  // Refetch when the generic is submitted (variants go to SAP right after it).
  useEffect(() => {
    fetchVariants();
  }, [fetchVariants, genericRecord.approvalStatus, genericRecord.articleNumber]);

  // Same RFC as FG (ZMM_VAR_ART_CRT_V8) — sends every variant without an article number.
  const handleRetryVariants = async () => {
    setRetrying(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-articles/${genericId}/retry-variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Retry failed');
      if (data?.failed) message.error(data.message);
      else message.success(data?.message || 'Variants synced');
      fetchVariants();
      onRefresh?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const retryNeededCount = variants.filter((v) => !v.sapArticleId).length;

  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
  );

  const deleteVariants = async (ids: string[]) => {
    const token = localStorage.getItem('authToken');
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`${APP_CONFIG.api.baseURL}/approver/gm-article-variant/${id}`, {
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

  const renderStatus = (v: GMVariantRow) => {
    if (v.sapArticleId) return <StatusPill tone="green">Synced</StatusPill>;
    if (v.sapSyncStatus === 'FAILED') {
      return <StatusPill tone="red" tooltip={v.sapSyncMessage || 'SAP returned an error'}>Failed</StatusPill>;
    }
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

  return (
    <div>
      <VariantGrid<GMVariantRow>
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
            {pathType === 'created' && !!genericRecord.articleNumber && retryNeededCount > 0 && (
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

      <GMAddColorModal
        open={addColorOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingPairs={existingPairs}
        attributes={[]}
        onClose={() => setAddColorOpen(false)}
        onAdded={() => fetchVariants()}
      />
    </div>
  );
};

export default GMVariantTable;
