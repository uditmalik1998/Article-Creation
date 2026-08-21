import { memo, useState, useCallback } from 'react';
import { Minus, Plus, RotateCw, ZoomIn } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui-tw';
import type { ApproverItem } from '../../fabric-article/components/FabricArticleTable';

export interface ArticleCardProps {
  item: ApproverItem;
  index: number;
  onClick: (item: ApproverItem, index: number) => void;
  dateField?: 'createdAt' | 'approvedAt';
  selected?: boolean;
  onToggleSelect?: (item: ApproverItem) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  PENDING:  { bg: 'bg-amber-100',  text: 'text-amber-700' },
  APPROVED: { bg: 'bg-green-100',  text: 'text-green-700' },
  REJECTED: { bg: 'bg-red-100',    text: 'text-red-700'   },
  FAILED:   { bg: 'bg-red-100',    text: 'text-red-700'   },
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function ArticleCardComponent({ item, index, onClick, dateField = 'createdAt', selected = false, onToggleSelect }: ArticleCardProps) {
  const statusKey = (item.approvalStatus ?? 'PENDING') as string;
  const s = STATUS_STYLES[statusKey] ?? STATUS_STYLES.PENDING;

  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotation, setImgRotation] = useState(0);

  const resetImageView = useCallback(() => {
    setImgZoom(1);
    setImgRotation(0);
  }, []);

  return (
    <>
      <div
        onClick={() => onClick(item, index)}
        className={`group flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${
          selected ? 'border-primary ring-2 ring-primary/50' : 'border-border'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); onToggleSelect(item); }}
                aria-label="Select article for export"
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
              />
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}>
              {statusKey}
            </span>
          </div>
          {item.sapSyncStatus === 'SYNCED' && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">SAP ✓</span>
          )}
          {item.sapSyncStatus === 'PENDING' && item.approvalStatus === 'APPROVED' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">SAP …</span>
          )}
          {item.sapSyncStatus === 'FAILED' && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">SAP ✗</span>
          )}
        </div>

        <div className="flex items-start gap-2">
          {item.imageUrl ? (
            <div
              className="relative h-14 w-14 shrink-0 cursor-zoom-in"
              onClick={(e) => { e.stopPropagation(); resetImageView(); setImgModalOpen(true); }}
            >
              <img
                src={item.imageUrl}
                alt="article"
                loading="lazy"
                decoding="async"
                className="h-14 w-14 rounded-lg border border-border object-cover transition-opacity group-hover:opacity-90"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition-colors hover:bg-black/25">
                <ZoomIn className="h-4 w-4 text-white opacity-0 drop-shadow transition-opacity hover:opacity-100" />
              </div>
            </div>
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[9px] text-muted-foreground">
              No img
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {[item.division, item.subDivision].filter(Boolean).join(' › ') || '—'}
            </div>
            <div className="truncate text-[13px] font-bold text-foreground" title={item.majorCategory || undefined}>
              {item.majorCategory || '—'}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          {item.articleNumber && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-10 shrink-0 text-muted-foreground">Article</span>
              <span className="min-w-0 truncate rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700" title={item.articleNumber}>
                {item.articleNumber}
              </span>
            </div>
          )}
          <FieldRow label="Design" value={item.designNumber || '—'} />
          <FieldRow label="Vendor" value={item.vendorName || '—'} />
          <FieldRow label="Code"   value={item.vendorCode   || '—'} />
          <FieldRow label="Date"   value={formatDate(dateField === 'approvedAt' ? (item as any).approvedAt : item.createdAt)} />
        </div>

        {(item.rate || item.mrp) && (
          <div className="flex items-center gap-3 border-t border-border pt-2">
            {item.rate && (
              <span className="text-[11px] text-muted-foreground">
                Cost <span className="font-semibold text-foreground">₹{item.rate}</span>
              </span>
            )}
            {item.mrp && (
              <span className="text-[11px] text-muted-foreground">
                MRP <span className="font-semibold text-foreground">₹{item.mrp}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {imgModalOpen && item.imageUrl && (
        <Dialog open onOpenChange={(o) => { setImgModalOpen(o); if (!o) resetImageView(); }}>
          <DialogContent className="w-auto max-w-[92vw] p-0">
            <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-2">
              <DialogTitle className="truncate text-sm">{item.imageName || 'Image Preview'}</DialogTitle>
              <div className="mr-8 flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                  disabled={imgZoom <= 0.25}><Minus /></Button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(imgZoom * 100)}%</span>
                <Button size="icon" variant="outline" className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                  disabled={imgZoom >= 4}><Plus /></Button>
                <Button size="icon" variant="outline" className="ml-1 h-7 w-7"
                  onClick={() => setImgRotation((r) => (r + 90) % 360)}><RotateCw /></Button>
                <Button size="sm" variant="ghost" className="ml-1 h-7 px-2 text-xs"
                  onClick={resetImageView} disabled={imgZoom === 1 && imgRotation === 0}>Reset</Button>
              </div>
            </DialogHeader>
            <div className="flex items-center justify-center overflow-auto p-4" style={{ maxHeight: '80vh' }}>
              <img
                src={item.imageUrl}
                alt={item.imageName || 'preview'}
                className="block transition-transform duration-200 will-change-transform"
                style={{ maxWidth: '85vw', maxHeight: '75vh', objectFit: 'contain', transform: `scale(${imgZoom}) rotate(${imgRotation}deg)`, transformOrigin: 'center' }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export const BodyArticleCard = memo(ArticleCardComponent);

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground" title={value !== '—' ? value : undefined}>{value}</span>
    </div>
  );
}
