import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  Popconfirm,
  Spinner,
  Tooltip,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import GMAddColorModal from './GMAddColorModal';

// ─── Types ────────────────────────────────────────────────────────────────────

// Rows of gm_variants_article_data (one per size × color).
interface FabricVariant {
  id: string;
  genericArticleId: string | null;
  genericArticleNumber: string | null;
  variantColor: string | null;
  variantSize: string | null;
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

interface GMArticleVariantSubTableProps {
  genericId: string;
  genericRecord: { majorCategory?: string | null; imageUrl?: string | null };
  pathType?: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

const GMArticleVariantSubTable: React.FC<GMArticleVariantSubTableProps> = ({
  genericId,
  genericRecord,
}) => {
  const [variants, setVariants] = useState<FabricVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-articles/${genericId}/variants`, {
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
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-article-variant/${id}`, {
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

  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
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
      title: 'Size',
      dataIndex: 'variantSize',
      key: 'variantSize',
      width: 80,
      render: (v: string | null) => (v ? <strong className="text-xs">{v}</strong> : <span className="text-muted-foreground">—</span>),
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

  return (
    <div className="rounded-md bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-[13px]">Color Variants ({variants.length})</strong>
        <div className="flex items-center gap-2">
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

      <GMAddColorModal
        open={addOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingPairs={existingPairs}
        attributes={[]}
        onClose={() => setAddOpen(false)}
        onAdded={fetchVariants}
      />
    </div>
  );
};

export default GMArticleVariantSubTable;
