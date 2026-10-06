import { memo, useState, useCallback, useEffect } from 'react';
import { ImageOff, Minus, Plus, RotateCw, ZoomIn } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { useDragToPan } from '@/shared/hooks/ui/useDragToPan';

/**
 * The fields the card reads. Every article dashboard's row type (FG, Fabric,
 * Body, GM) satisfies this structurally, so one card serves all of them.
 */
export interface ArticleCardItem {
  id: string;
  imageUrl?: string | null;
  imageName?: string | null;
  articleNumber?: string | null;
  division?: string | null;
  subDivision?: string | null;
  majorCategory?: string | null;
  vendorName?: string | null;
  vendorCode?: string | null;
  designNumber?: string | null;
  approvalStatus?: string | null;
  sapSyncStatus?: string | null;
  createdAt?: string | null;
  approvedAt?: string | null;
  /** Cost */
  rate?: number | string | null;
  mrp?: number | string | null;
}

export interface ArticleSpecCardProps<T extends ArticleCardItem> {
  item: T;
  index: number;
  onClick: (item: T, index: number) => void;
  /**
   * Which date to show. The Created tab shows the approval date (approvedAt);
   * every other tab shows the extraction date (createdAt). Kept in sync with the
   * backend date filter so the date shown always matches the date being
   * filtered/exported. Defaults to createdAt.
   */
  dateField?: 'createdAt' | 'approvedAt';
  /** Whether this card is currently checked for selective export. */
  selected?: boolean;
  /**
   * Toggle this card's selection. When provided, a checkbox is rendered.
   * Must be referentially STABLE (useCallback) so the memo isn't defeated.
   */
  onToggleSelect?: (item: T) => void;
}

// PENDING is the default state of every list's working set, so it gets no badge.
const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  FAILED:   'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/** Padding inside the image viewer frame, in px — matches the `p-4` on the container.
 * Subtracted when fitting the image so the frame never exceeds its viewport budget. */
const VIEWER_PADDING = 16;

export function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatRupees(value: number | null): string {
  return value === null ? '—' : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ArticleSpecCardComponent<T extends ArticleCardItem>({
  item, index, onClick, dateField = 'createdAt', selected = false, onToggleSelect,
}: ArticleSpecCardProps<T>) {
  const statusKey = String(item.approvalStatus ?? 'PENDING');
  const statusClass = STATUS_STYLES[statusKey];
  const [imgFailed, setImgFailed] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  const cost = toAmount(item.rate);
  const mrp = toAmount(item.mrp);
  const margin = cost !== null && mrp !== null && mrp > 0 ? Math.round(((mrp - cost) / mrp) * 100) : null;
  const mrpMissing = cost !== null && mrp === null;

  const crumb = [item.division, item.subDivision].filter(Boolean).join(' › ') || '—';
  const dateValue = dateField === 'approvedAt' ? item.approvedAt : item.createdAt;
  const hasBadges = !!statusClass || !!item.articleNumber
    || item.sapSyncStatus === 'SYNCED' || item.sapSyncStatus === 'FAILED'
    || (item.sapSyncStatus === 'PENDING' && item.approvalStatus === 'APPROVED');

  return (
    <>
      <div
        role="link"
        tabIndex={0}
        aria-label={`Open ${[item.majorCategory, item.designNumber].filter(Boolean).join(' ') || 'article'}`}
        onClick={() => onClick(item, index)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick(item, index);
          }
        }}
        className={cn(
          'group flex cursor-pointer gap-3.5 rounded-xl border bg-card p-3 shadow-sm outline-none',
          // Neutral slate states, matching the filter row's open/focused fields — the theme's coral read as an error.
          'transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md',
          'focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25',
          selected ? 'border-slate-500 ring-[3px] ring-slate-400/25' : 'border-border',
        )}
      >
        {/* Photo */}
        <div className="w-[112px] shrink-0 self-start">
          {item.imageUrl && !imgFailed ? (
            <button
              type="button"
              aria-label={`Enlarge photo${item.designNumber ? ` of ${item.designNumber}` : ''}`}
              onClick={(e) => { e.stopPropagation(); setImgModalOpen(true); }}
              className="group/img relative block aspect-[3/4] w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted"
            >
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-200 group-hover/img:scale-[1.03]"
                onError={() => setImgFailed(true)}
              />
              <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-800 opacity-80 shadow-sm transition-opacity group-hover/img:opacity-100">
                <ZoomIn className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted text-[10px] text-muted-foreground">
              <ImageOff className="h-4 w-4" />
              No image
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{crumb}</div>
              <div className="truncate text-[15px] font-extrabold leading-snug tracking-tight text-foreground" title={item.majorCategory || undefined}>
                {item.majorCategory || '—'}
              </div>
            </div>
            {onToggleSelect && (
              <label
                onClick={(e) => e.stopPropagation()}
                className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(item)}
                  aria-label={`Select ${item.designNumber || item.articleNumber || 'article'} for export`}
                  className="h-4 w-4 cursor-pointer accent-slate-800"
                />
              </label>
            )}
          </div>

          {hasBadges && (
            <div className="flex flex-wrap items-center gap-1">
              {statusClass && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', statusClass)}>{statusKey}</span>
              )}
              {item.articleNumber && (
                <span className="max-w-full truncate rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" title={item.articleNumber}>
                  {item.articleNumber}
                </span>
              )}
              {item.sapSyncStatus === 'SYNCED' && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">SAP ✓</span>
              )}
              {item.sapSyncStatus === 'PENDING' && item.approvalStatus === 'APPROVED' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">SAP …</span>
              )}
              {item.sapSyncStatus === 'FAILED' && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">SAP ✗</span>
              )}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Field label="Design no.">
              <span className="font-mono text-[12px]">{item.designNumber || '—'}</span>
            </Field>
            <Field label={dateField === 'approvedAt' ? 'Approved' : 'Added'}>{formatDate(dateValue)}</Field>
            <Field label="Vendor" className="col-span-2" wrap>
              <span className="line-clamp-2" title={item.vendorName || undefined}>
                {item.vendorName || '—'}
                {item.vendorCode && <span className="font-medium text-muted-foreground"> · {item.vendorCode}</span>}
              </span>
            </Field>
          </dl>

          {/* Cost / MRP / Margin */}
          <div className="mt-auto grid grid-cols-3 overflow-hidden rounded-lg border border-border">
            <Stat label="Cost" value={formatRupees(cost)} />
            <Stat label="MRP" value={formatRupees(mrp)} className="border-l border-border" />
            {margin !== null ? (
              <Stat
                label="Margin"
                value={`${margin}%`}
                className="border-l border-border bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                labelClassName="text-emerald-800/80 dark:text-emerald-300/80"
              />
            ) : mrpMissing ? (
              <Stat
                label="Margin"
                value="No MRP"
                className="border-l border-border bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                labelClassName="text-amber-800/80 dark:text-amber-300/80"
                valueClassName="text-[12.5px]"
              />
            ) : (
              <Stat label="Margin" value="—" className="border-l border-border" />
            )}
          </div>
        </div>
      </div>

      {/* Image preview modal — only mounted when open to avoid 50 idle Dialog instances */}
      {imgModalOpen && item.imageUrl && (
        <ImagePreviewDialog
          src={item.imageUrl}
          title={item.imageName || item.designNumber || 'Image Preview'}
          onClose={() => setImgModalOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Memoized so a parent re-render (filter change, pagination, sibling card's
 * modal opening) does NOT re-render every card in the grid. Only re-renders
 * when this card's own props actually change.
 * NOTE: requires the parent to pass a STABLE `onClick` (useCallback).
 */
export const ArticleSpecCard = memo(ArticleSpecCardComponent) as typeof ArticleSpecCardComponent;

function Field({ label, className, wrap = false, children }: { label: string; className?: string; wrap?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
      <dd className={cn('m-0 text-[12.5px] font-semibold leading-snug text-foreground', !wrap && 'truncate')}>{children}</dd>
    </div>
  );
}

function Stat({ label, value, className, labelClassName, valueClassName }: {
  label: string; value: string; className?: string; labelClassName?: string; valueClassName?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5 px-2 py-1.5', className)}>
      <span className={cn('text-[10.5px] text-muted-foreground', labelClassName)}>{label}</span>
      <span className={cn('truncate text-[14px] font-extrabold tabular-nums', valueClassName)}>{value}</span>
    </div>
  );
}

function ImagePreviewDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotation, setImgRotation] = useState(0);
  // The image's real (natural) pixel size, captured on load. `transform: scale()`
  // alone is purely visual — it never grows the parent's scrollable area, so the
  // <img> is sized with actual width/height instead, letting the browser's own
  // overflow/scroll math account for the true zoomed size.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const resetImageView = useCallback(() => {
    setImgZoom(1);
    setImgRotation(0);
  }, []);

  // Click-and-drag panning once zoomed in.
  const { containerRef: panRef, onMouseDown: onPanMouseDown, isDragging } = useDragToPan<HTMLDivElement>(imgZoom > 1);

  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Base (100%-zoom) display size, fit to an 85vw/75vh box, then scaled by the
  // zoom factor. Rotation at 90/270° swaps width and height so the post-rotation
  // footprint is what gets laid out. `frame*` is the viewing window (stays put as
  // you zoom); `box*` is the image itself, which overflows and becomes scrollable.
  const isSideways = imgRotation === 90 || imgRotation === 270;
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-auto max-w-[92vw] p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-2">
          <DialogTitle className="truncate text-sm">{title}</DialogTitle>
          <div className="mr-8 flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Zoom out"
              onClick={() => setImgZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
              disabled={imgZoom <= 0.25}>
              <Minus />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(imgZoom * 100)}%</span>
            <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Zoom in"
              onClick={() => setImgZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              disabled={imgZoom >= 4}>
              <Plus />
            </Button>
            <Button size="icon" variant="outline" className="ml-1 h-7 w-7" aria-label="Rotate 90°"
              onClick={() => setImgRotation((r) => (r + 90) % 360)}>
              <RotateCw />
            </Button>
            <Button size="sm" variant="ghost" className="ml-1 h-7 px-2 text-xs"
              onClick={resetImageView} disabled={imgZoom === 1 && imgRotation === 0}>
              Reset
            </Button>
          </div>
        </DialogHeader>
        <div
          ref={panRef}
          onMouseDown={onPanMouseDown}
          className={cn('flex overflow-auto p-4', imgZoom > 1 && (isDragging ? 'cursor-grabbing' : 'cursor-grab'))}
          // Fixed to the image's 100%-zoom footprint so the dialog stays the same
          // size at every zoom level. "safe center" keeps every edge reachable by
          // scroll once the zoomed image overflows.
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
            src={src}
            alt={title}
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
                    // Preflight's `img { max-width: 100% }` would cap the zoomed
                    // width and distort the box, so lift it here.
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
  );
}
