import { memo, useState, useCallback, useEffect } from 'react';
import { ImageOff, Minus, Plus, RotateCw, Scan, Shirt, X, ZoomIn } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { useDragToPan } from '@/shared/hooks/ui/useDragToPan';
import { APP_CONFIG } from '@/shared/constants/app/config';

/**
 * Small WebP of the photo for the card (the originals are ~4 MB, 12 MP — 50 of
 * them hang scrolling). The backend makes and caches it; the zoom view still
 * shows the original. Non-https URLs (relative/local) are used as-is.
 */
function cardThumbUrl(url: string): string {
  if (!/^https:\/\//i.test(url)) return url;
  return `${APP_CONFIG.api.baseURL}/images/thumb?w=320&url=${encodeURIComponent(url)}`;
}

/**
 * The fields the card reads. Every article dashboard's row type (FG, Fabric,
 * Body, GM) satisfies this structurally, so one card serves all of them.
 */
export interface ArticleCardItem {
  id: string;
  imageUrl?: string | null;
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
  // Thumbnail first; if the backend can't make one, fall back to the original once.
  const [thumbFailed, setThumbFailed] = useState(false);
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
                src={thumbFailed ? item.imageUrl : cardThumbUrl(item.imageUrl)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-200 group-hover/img:scale-[1.03]"
                onError={() => (thumbFailed ? setImgFailed(true) : setThumbFailed(true))}
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

          {/* PR Cost / PR MRP / Margin */}
          <div className="mt-auto grid grid-cols-3 overflow-hidden rounded-lg border border-border">
            <Stat label="PR COST" value={formatRupees(cost)} />
            <Stat label="PR MRP" value={formatRupees(mrp)} className="border-l border-border" />
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
          title={item.designNumber || 'Image Preview'}
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

/**
 * One article as a table row — the "Rows" view of the dashboards. Same props and
 * behaviour as ArticleSpecCard (click opens, checkbox selects, photo zooms).
 * Rendered inside ArticleRowsTable (ArticleCardGrid.tsx), whose header matches these cells.
 */
function ArticleSpecRowComponent<T extends ArticleCardItem>({
  item, index, onClick, dateField = 'createdAt', selected = false, onToggleSelect,
}: ArticleSpecCardProps<T>) {
  const [imgFailed, setImgFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  const cost = toAmount(item.rate);
  const mrp = toAmount(item.mrp);
  const margin = cost !== null && mrp !== null && mrp > 0 ? Math.round(((mrp - cost) / mrp) * 100) : null;
  const mrpMissing = cost !== null && mrp === null;
  const crumb = [item.division, item.subDivision].filter(Boolean).join(' › ') || '—';
  const dateValue = dateField === 'approvedAt' ? item.approvedAt : item.createdAt;
  const td = 'border-b border-border px-3 py-2 text-center align-middle';
  const showSapStatus = dateField === 'approvedAt';
  const sapQueued = item.sapSyncStatus === 'PENDING' && item.approvalStatus === 'APPROVED';
  const sapFailed = item.sapSyncStatus === 'FAILED';

  return (
    <>
      <tr
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
          'cursor-pointer outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:shadow-[inset_3px_0_0_#1e293b] dark:hover:bg-slate-800/50 dark:focus-visible:bg-slate-800',
          selected && 'bg-slate-100 dark:bg-slate-800/70',
        )}
      >
        <td className={cn(td, 'w-10 pr-0')} onClick={(e) => e.stopPropagation()}>
          {onToggleSelect && (
            <label className="mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item)}
                aria-label={`Select ${item.designNumber || item.articleNumber || 'article'} for export`}
                className="h-4 w-4 cursor-pointer accent-slate-800"
              />
            </label>
          )}
        </td>
        <td className={cn(td, 'w-16 px-2')}>
          {item.imageUrl && !imgFailed ? (
            <button
              type="button"
              aria-label={`Enlarge photo${item.designNumber ? ` of ${item.designNumber}` : ''}`}
              onClick={(e) => { e.stopPropagation(); setImgModalOpen(true); }}
              className="mx-auto block h-[58px] w-11 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted"
            >
              <img
                src={thumbFailed ? item.imageUrl : cardThumbUrl(item.imageUrl)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                onError={() => (thumbFailed ? setImgFailed(true) : setThumbFailed(true))}
              />
            </button>
          ) : (
            <span className="mx-auto flex h-[58px] w-11 items-center justify-center rounded-md border border-dashed border-border bg-muted text-muted-foreground" title="No image">
              <ImageOff className="h-3.5 w-3.5" />
            </span>
          )}
        </td>
        <td className={td}>
          <div className="truncate text-[13.5px] font-bold uppercase tracking-wider text-muted-foreground">{crumb}</div>
          <div className="truncate text-[17px] font-extrabold tracking-tight text-foreground" title={item.majorCategory || undefined}>{item.majorCategory || '—'}</div>
        </td>
        {/* Article no. — its own column (was a badge next to the major category). */}
        <td className={cn(td, 'truncate whitespace-nowrap font-mono text-[15.5px] font-semibold text-muted-foreground')} title={item.articleNumber || undefined}>
          {item.articleNumber || <span className="text-muted-foreground">—</span>}
        </td>
        <td className={cn(td, 'truncate whitespace-nowrap font-mono text-[15.5px] font-semibold text-foreground')}>{item.designNumber || '—'}</td>
        <td className={td}>
          <div className="truncate text-[15.5px] font-medium text-foreground" title={item.vendorName || undefined}>{item.vendorName || '—'}</div>
          {item.vendorCode && <div className="font-mono text-[14px] font-semibold text-slate-600 dark:text-slate-300">{item.vendorCode}</div>}
        </td>
        <td className={cn(td, 'whitespace-nowrap text-[15.5px] text-foreground')}>{formatDate(dateValue)}</td>
        <td className={cn(td, 'whitespace-nowrap text-[16px] font-bold tabular-nums')}>{formatRupees(cost)}</td>
        <td className={cn(td, 'whitespace-nowrap text-[16px] font-bold tabular-nums')}>{formatRupees(mrp)}</td>
        <td className={cn(td, 'whitespace-nowrap')}>
          {margin !== null ? (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[15px] font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{margin}%</span>
          ) : mrpMissing ? (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[15px] font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">No MRP</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        {showSapStatus && (
          <td className={cn(td, 'whitespace-nowrap')}>
            {sapQueued && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[14px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Queued
              </span>
            )}
            {item.sapSyncStatus === 'SYNCED' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[14px] font-bold text-muted-foreground dark:bg-slate-800">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Synced
              </span>
            )}
            {sapFailed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-[14px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Failed
              </span>
            )}
          </td>
        )}
      </tr>
      {imgModalOpen && item.imageUrl && (
        <ImagePreviewDialog
          src={item.imageUrl}
          title={item.designNumber || 'Image Preview'}
          onClose={() => setImgModalOpen(false)}
        />
      )}
    </>
  );
}

/** Memoized for the same reason as ArticleSpecCard; needs a stable `onClick`. */
export const ArticleSpecRow = memo(ArticleSpecRowComponent) as typeof ArticleSpecRowComponent;

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

/**
 * Card photo viewer — design "Option B": ink header, a fixed 3:4 frame that shows a
 * shimmer skeleton while the full-size original (~4 MB) loads, and a floating zoom
 * toolbar under the photo. The frame is sized before the photo arrives, so the
 * dialog never opens as an empty strip and doesn't jump when the image lands.
 */
export function ImagePreviewDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotation, setImgRotation] = useState(0);
  // The image's real (natural) pixel size, captured on load. `transform: scale()`
  // alone is purely visual — it never grows the parent's scrollable area, so the
  // <img> is sized with actual width/height instead, letting the browser's own
  // overflow/scroll math account for the true zoomed size.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumps the <img> key on "Try again"
  const loading = !naturalSize && !loadFailed;

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

  // Base (100%-zoom) display size, fit to an 85vw / ~70vh box, then scaled by the
  // zoom factor. Rotation at 90/270° swaps width and height so the post-rotation
  // footprint is what gets laid out. `frame*` is the viewing window (stays put as
  // you zoom); `box*` is the image itself, which overflows and becomes scrollable.
  // Until the photo loads, the frame is a 3:4 portrait box (article photos are
  // portrait), so the loaded photo usually lands at exactly the same size.
  const maxW = viewportSize.w * 0.85 - VIEWER_PADDING * 2;
  const maxH = viewportSize.h * 0.7 - VIEWER_PADDING * 2;
  const isSideways = imgRotation === 90 || imgRotation === 270;
  let frameWidth: number;
  let frameHeight: number;
  let boxWidth: number | undefined;
  let boxHeight: number | undefined;
  if (naturalSize) {
    const fitScale = Math.min(1, maxW / naturalSize.w, maxH / naturalSize.h);
    const baseW = naturalSize.w * fitScale;
    const baseH = naturalSize.h * fitScale;
    frameWidth = isSideways ? baseH : baseW;
    frameHeight = isSideways ? baseW : baseH;
    boxWidth = frameWidth * imgZoom;
    boxHeight = frameHeight * imgZoom;
  } else {
    frameWidth = Math.min(maxW, maxH * 0.75);
    frameHeight = frameWidth / 0.75;
  }

  const zoomBtn =
    'flex h-9 w-9 items-center justify-center rounded-[10px] border border-slate-300 bg-white text-slate-900 transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="w-auto max-w-[92vw] gap-0 overflow-hidden rounded-2xl border-0 bg-slate-50 p-0 dark:bg-slate-900">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0 bg-slate-800 px-4 py-3 text-white">
          <DialogTitle className="mr-auto min-w-0 truncate text-[12px] font-bold uppercase tracking-[0.07em] text-white">
            Article image · <span className="normal-case tracking-normal">{title}</span>
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3.5 p-4">
          <div
            ref={panRef}
            onMouseDown={onPanMouseDown}
            className={cn(
              'relative flex overflow-auto rounded-xl bg-white dark:bg-slate-950',
              imgZoom > 1 && (isDragging ? 'cursor-grabbing' : 'cursor-grab'),
            )}
            // Fixed to the image's 100%-zoom footprint so the dialog stays the same
            // size at every zoom level. "safe center" keeps every edge reachable by
            // scroll once the zoomed image overflows.
            style={{ width: frameWidth, height: frameHeight, alignItems: 'safe center', justifyContent: 'safe center' } as React.CSSProperties}
          >
            {loading && (
              <div
                role="status"
                className="absolute inset-0 flex animate-pulse flex-col items-center justify-center gap-2.5 bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200 text-slate-500 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800"
              >
                <Shirt className="h-11 w-11 text-slate-400" strokeWidth={1.6} />
                <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">Loading photo…</span>
                <span className="text-xs">Full-size original</span>
              </div>
            )}
            {loadFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                <ImageOff className="h-10 w-10 text-slate-400" strokeWidth={1.6} />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Couldn’t load the photo</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoadFailed(false);
                    setAttempt((a) => a + 1);
                  }}
                  className="mt-1 h-9 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800"
                >
                  Try again
                </button>
              </div>
            )}
            {!loadFailed && (
              <img
                key={attempt}
                src={src}
                alt={title}
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
                }}
                onError={() => setLoadFailed(true)}
                className={cn(
                  'block shrink-0 transition-[width,height,transform,opacity] duration-200 will-change-transform',
                  loading ? 'pointer-events-none absolute opacity-0' : 'opacity-100',
                )}
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
                    : { width: 1, height: 1 }
                }
              />
            )}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-800">
            <button type="button" className={zoomBtn} aria-label="Zoom out" disabled={loading || loadFailed || imgZoom <= 0.25}
              onClick={() => setImgZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}>
              <Minus className="h-4 w-4" />
            </button>
            <span className={cn('w-12 text-center text-[13px] font-semibold tabular-nums', loading || loadFailed ? 'text-slate-400' : 'text-slate-900 dark:text-slate-100')}>
              {Math.round(imgZoom * 100)}%
            </span>
            <button type="button" className={zoomBtn} aria-label="Zoom in" disabled={loading || loadFailed || imgZoom >= 4}
              onClick={() => setImgZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}>
              <Plus className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-600" aria-hidden="true" />
            <button type="button" className={zoomBtn} aria-label="Fit to frame (reset)" title="Reset"
              disabled={loading || loadFailed || (imgZoom === 1 && imgRotation === 0)} onClick={resetImageView}>
              <Scan className="h-4 w-4" />
            </button>
            <button type="button" className={zoomBtn} aria-label="Rotate 90°" disabled={loading || loadFailed}
              onClick={() => setImgRotation((r) => (r + 90) % 360)}>
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
