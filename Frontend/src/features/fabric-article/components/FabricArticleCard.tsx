import { memo, useState, useCallback, useEffect } from 'react';
import { Minus, Plus, RotateCw, ZoomIn } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui-tw';
import { useDragToPan } from '@/shared/hooks/ui/useDragToPan';
import type { ApproverItem } from './FabricArticleTable';

export interface ArticleCardProps {
  item: ApproverItem;
  index: number;
  onClick: (item: ApproverItem, index: number) => void;
  /**
   * Which date to show in the "Date" row. The Created tab shows the
   * approval date (approvedAt); every other tab shows the extraction
   * date (createdAt). Kept in sync with the backend date filter so the date
   * shown always matches the date being filtered/exported. Defaults to createdAt.
   */
  dateField?: 'createdAt' | 'approvedAt';
  /** Whether this card is currently checked for selective export. */
  selected?: boolean;
  /**
   * Toggle this card's selection. When provided, a checkbox is rendered.
   * Must be referentially STABLE (useCallback) so the memo isn't defeated.
   */
  onToggleSelect?: (item: ApproverItem) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  PENDING:  { bg: 'bg-amber-100',  text: 'text-amber-700' },
  APPROVED: { bg: 'bg-green-100',  text: 'text-green-700' },
  REJECTED: { bg: 'bg-red-100',    text: 'text-red-700'   },
  FAILED:   { bg: 'bg-red-100',    text: 'text-red-700'   },
};

/** Padding inside the image viewer frame, in px — matches the `p-4` on the container.
 * Subtracted when fitting the image so the frame never exceeds its viewport budget. */
const VIEWER_PADDING = 16;

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
  // The image's real (natural) pixel size, captured on load. `transform: scale()`
  // alone is purely visual — it never grows the parent's scrollable area, which is
  // why zooming in previously left no real room to scroll/drag to the far edges.
  // Sizing the <img> with actual width/height (computed from this) instead makes
  // the browser's own overflow/scroll math account for the true zoomed size.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const resetImageView = useCallback(() => {
    setImgZoom(1);
    setImgRotation(0);
  }, []);

  // Click-and-drag panning once zoomed in — an alternative to relying on the
  // mouse wheel/scrollbars to see different parts of a zoomed-in image.
  const { containerRef: panRef, onMouseDown: onPanMouseDown, isDragging } = useDragToPan<HTMLDivElement>(imgZoom > 1);

  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    if (!imgModalOpen) return;
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [imgModalOpen]);

  // Base (100%-zoom) display size, fit to the same 85vw/75vh box the old
  // maxWidth/maxHeight CSS used — then scaled up by the zoom factor. Rotation at
  // 90/270° swaps which axis is width vs height so the post-rotation footprint
  // (what the scroll container needs to accommodate) is what actually gets laid out.
  const isSideways = imgRotation === 90 || imgRotation === 270;
  // `frame*` is the viewing window: the image's footprint at 100% zoom. It stays put
  // as you zoom so the dialog doesn't grow with every step — only `box*` (the image
  // itself) scales, overflowing the frame and becoming scrollable/draggable.
  let frameWidth: number | undefined;
  let frameHeight: number | undefined;
  let boxWidth: number | undefined;
  let boxHeight: number | undefined;
  if (naturalSize) {
    const maxW = viewportSize.w * 0.85 - VIEWER_PADDING * 2;
    const maxH = viewportSize.h * 0.75 - VIEWER_PADDING * 2;
    const fitScale = Math.min(1, maxW / naturalSize.w, maxH / naturalSize.h);
    const baseW = naturalSize.w * fitScale;
    const baseH = naturalSize.h * fitScale;
    frameWidth = isSideways ? baseH : baseW;
    frameHeight = isSideways ? baseW : baseH;
    boxWidth = frameWidth * imgZoom;
    boxHeight = frameHeight * imgZoom;
  }

  return (
    <>
      <div
        onClick={() => onClick(item, index)}
        className={`group flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${
          selected ? 'border-primary ring-2 ring-primary/50' : 'border-border'
        }`}
      >
        {/* Status + SAP tag */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelect(item);
                }}
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

        {/* Thumbnail + division/category */}
        <div className="flex items-start gap-2">
          {item.imageUrl ? (
            <div
              className="relative h-14 w-14 shrink-0 cursor-zoom-in"
              onClick={(e) => {
                e.stopPropagation();
                resetImageView();
                setImgModalOpen(true);
              }}
            >
              <img
                src={item.imageUrl}
                alt="article"
                loading="lazy"
                decoding="async"
                className="h-14 w-14 rounded-lg border border-border object-cover transition-opacity group-hover:opacity-90"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {/* Hover overlay */}
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

        {/* Key fields */}
        <div className="space-y-1">
          {item.articleNumber && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-10 shrink-0 text-muted-foreground">Article</span>
              <span
                className="min-w-0 truncate rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700"
                title={item.articleNumber}
              >
                {item.articleNumber}
              </span>
            </div>
          )}
          <FieldRow label="Design" value={item.designNumber || '—'} />
          <FieldRow label="Vendor" value={item.vendorName || '—'} />
          <FieldRow label="Code"   value={item.vendorCode   || '—'} />
          <FieldRow label="Date"   value={formatDate(dateField === 'approvedAt' ? (item as any).approvedAt : item.createdAt)} />
        </div>

        {/* Rate / MRP */}
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

      {/* Image preview modal — only mounted when open to avoid 50 idle Dialog instances */}
      {imgModalOpen && item.imageUrl && (
        <Dialog
          open
          onOpenChange={(o) => {
            setImgModalOpen(o);
            if (!o) resetImageView();
          }}
        >
          <DialogContent className="w-auto max-w-[92vw] p-0">
            <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-2">
              <DialogTitle className="truncate text-sm">
                {item.imageName || 'Image Preview'}
              </DialogTitle>
              {/* Zoom + rotate controls */}
              <div className="mr-8 flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                  aria-label="Zoom out"
                  disabled={imgZoom <= 0.25}
                >
                  <Minus />
                </Button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                  {Math.round(imgZoom * 100)}%
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                  aria-label="Zoom in"
                  disabled={imgZoom >= 4}
                >
                  <Plus />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="ml-1 h-7 w-7"
                  onClick={() => setImgRotation((r) => (r + 90) % 360)}
                  aria-label="Rotate 90°"
                >
                  <RotateCw />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-1 h-7 px-2 text-xs"
                  onClick={resetImageView}
                  disabled={imgZoom === 1 && imgRotation === 0}
                >
                  Reset
                </Button>
              </div>
            </DialogHeader>
            <div
              ref={panRef}
              onMouseDown={onPanMouseDown}
              className={`flex overflow-auto p-4 ${
                imgZoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
              // Fixed to the image's 100%-zoom footprint (plus padding, via border-box)
              // so the dialog stays the same size at every zoom level — zooming scrolls
              // within this frame instead of growing it.
              //
              // "safe center" degrades to plain "center" in browsers that don't support
              // it — but plain centering of overflowing flex content can make the start
              // edge unreachable by scroll, which is the other half of the "can't reach
              // the top" bug. "safe" keeps it centered until it overflows, then falls
              // back to start-aligned so every edge stays reachable.
              style={{
                width: frameWidth ? frameWidth + VIEWER_PADDING * 2 : undefined,
                height: frameHeight ? frameHeight + VIEWER_PADDING * 2 : undefined,
                maxWidth: '85vw',
                maxHeight: '80vh',
                alignItems: 'safe center',
                justifyContent: 'safe center',
              } as React.CSSProperties}
            >
              <img
                src={item.imageUrl}
                alt={item.imageName || 'preview'}
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
                }}
                className="block shrink-0 transition-[width,height,transform] duration-200 will-change-transform"
                style={
                  boxWidth && boxHeight
                    ? {
                        width: boxWidth,
                        height: boxHeight,
                        // Tailwind Preflight sets `img { max-width: 100% }`, which would
                        // cap the zoomed width at the dialog's width while the height grew
                        // freely — distorting the box so `object-fit: contain` letterboxed
                        // the image with empty bands instead of actually zooming it.
                        maxWidth: 'none',
                        maxHeight: 'none',
                        objectFit: 'contain',
                        transform: `rotate(${imgRotation}deg)`,
                        transformOrigin: 'center',
                      }
                    : {
                        maxWidth: '85vw',
                        maxHeight: '75vh',
                        objectFit: 'contain',
                        transform: `scale(${imgZoom}) rotate(${imgRotation}deg)`,
                        transformOrigin: 'center',
                      }
                }
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * Memoized so a parent re-render (filter change, pagination, sibling card's
 * modal opening) does NOT re-render every card in the grid. Only re-renders
 * when this card's own `item`/`index`/`onClick` props actually change.
 * NOTE: requires the parent to pass a STABLE `onClick` (useCallback).
 */
export const FabricArticleCard = memo(ArticleCardComponent);

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground" title={value !== '—' ? value : undefined}>
        {value}
      </span>
    </div>
  );
}
