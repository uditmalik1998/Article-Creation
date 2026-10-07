import { useState, type ReactNode } from 'react';
import { ChevronRight, Download, Eye, FileSpreadsheet, RotateCw, Upload, X } from 'lucide-react';
import { Button, Spinner } from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';

/**
 * Building blocks for the Admin Dashboard (design option A): an in-page jump
 * menu, pipeline rows and compact master-data cards whose upload
 * area expands in place. Selected / primary states are dark slate, not coral.
 */

export const SLATE_PRIMARY_BTN = 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300';

// ─── Jump menu ─────────────────────────────────────────────────────────────────

export interface JumpNavItem { id: string; label: string; count?: number | string }

export function JumpNav({ items }: { items: JumpNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id);
  return (
    <nav
      aria-label="On this page"
      className="sticky top-3 flex w-full flex-col gap-0.5 rounded-xl border border-border bg-card p-2 lg:w-[210px] lg:shrink-0"
    >
      <span className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">On this page</span>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={(e) => {
            e.preventDefault();
            setActive(item.id);
            document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className={cn(
            'flex h-9 items-center justify-between rounded-lg px-2.5 text-[13.5px] no-underline transition-colors',
            active === item.id ? cn(SLATE_PRIMARY_BTN, 'font-semibold') : 'text-foreground hover:bg-muted',
          )}
        >
          <span>{item.label}</span>
          {item.count !== undefined && <span className="text-[12px] opacity-70">{item.count}</span>}
        </a>
      ))}
    </nav>
  );
}

// ─── Section heading ───────────────────────────────────────────────────────────

export function SectionHeading({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="m-0 text-[17px] font-bold">{title}</h2>
      {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
      <div className="flex-1" />
      {actions}
    </div>
  );
}

// ─── Pipeline row ──────────────────────────────────────────────────────────────

export interface PipelineCounts {
  PENDING: number;
  PROCESSING: number;
  COMPLETED: number;
  FAILED: number;
  PERM_FAILED?: number;
  total: number;
}

const COUNT_STYLES: { key: keyof PipelineCounts; label: string; swatch: string }[] = [
  { key: 'PENDING', label: 'Pending', swatch: 'bg-amber-600' },
  { key: 'PROCESSING', label: 'Processing', swatch: 'bg-blue-700' },
  { key: 'COMPLETED', label: 'Completed', swatch: 'bg-green-700' },
  { key: 'FAILED', label: 'Failed', swatch: 'bg-red-700' },
  { key: 'PERM_FAILED', label: 'Perm. failed', swatch: 'bg-red-900' },
];

/** One pipeline as a row: name, a stacked progress bar with counts, then View data + the run action. */
export function PipelineRow({
  name, counts, loading, onView, runAction, message,
}: {
  name: string;
  counts: PipelineCounts | null;
  loading: boolean;
  onView: () => void;
  /** The run button (usually wrapped in its Popconfirm). */
  runAction: ReactNode;
  message?: ReactNode;
}) {
  const pct = (n = 0) => (counts && counts.total ? `${(n / counts.total) * 100}%` : '0%');
  return (
    <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-3.5 last:border-b-0">
      <div className="grid grid-cols-1 items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(170px,1fr)_minmax(300px,2.2fr)_auto]">
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-[14px] font-bold">{name}</span>
          <span className="text-[12.5px] text-muted-foreground">
            {counts ? `${counts.total.toLocaleString('en-IN')} total` : loading ? 'Loading…' : 'Status unavailable'}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex h-2 overflow-hidden rounded bg-muted">
            <span className="bg-green-700" style={{ width: pct(counts?.COMPLETED) }} />
            <span className="bg-red-900" style={{ width: pct((counts?.PERM_FAILED ?? 0) + (counts?.FAILED ?? 0)) }} />
            <span className="bg-amber-600" style={{ width: pct((counts?.PENDING ?? 0) + (counts?.PROCESSING ?? 0)) }} />
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]">
            {COUNT_STYLES.filter((c) => c.key !== 'PERM_FAILED' || counts?.PERM_FAILED !== undefined).map((c) => {
              const value = counts ? Number(counts[c.key] ?? 0) : null;
              return (
                <span key={c.key} className={cn(value === 0 && 'opacity-55')}>
                  <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-sm', c.swatch)} />
                  {c.label} <strong className="tabular-nums">{value === null ? '—' : value.toLocaleString('en-IN')}</strong>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onView}>
            <Eye />
            View data
          </Button>
          {runAction}
        </div>
      </div>
      {message}
    </div>
  );
}

// ─── Master-data card ──────────────────────────────────────────────────────────

const formatUploadDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/**
 * Compact card for one master-data upload. The existing status details and
 * upload panel are passed in and shown when the card is expanded ("Upload");
 * it stays expanded while an upload is in progress.
 */
export function MasterDataCard({
  title, description, rows, rowsLabel = 'Rows', lastUpload, loading, busy = false,
  onView, onDownload, onTemplate, onRefresh, details, upload,
}: {
  title: string;
  description?: string;
  rows: number | null | undefined;
  rowsLabel?: string;
  lastUpload?: string | null;
  loading: boolean;
  busy?: boolean;
  onView?: () => void;
  onDownload?: () => void;
  onTemplate?: () => void;
  onRefresh?: () => void;
  details: ReactNode;
  upload: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || busy;
  const known = rows !== null && rows !== undefined;
  const empty = known && rows === 0;
  const status = !known ? (loading ? 'Loading' : 'Unknown') : empty ? 'Not uploaded' : 'Uploaded';
  const uploaded = formatUploadDate(lastUpload);

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5 transition-colors',
        expanded && 'md:col-span-2',
        empty ? 'border-amber-300 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="text-[14px] leading-snug">{title}</strong>
          {description && <span className="truncate text-[12px] text-muted-foreground" title={description}>{description}</span>}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
            empty ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300'
              : known ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {status}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        <span><span className="text-muted-foreground">{rowsLabel}</span> <strong className="tabular-nums">{known ? rows!.toLocaleString('en-IN') : '—'}</strong></span>
        {lastUpload !== undefined && (
          <span><span className="text-muted-foreground">Last upload</span> <strong>{uploaded ?? (empty ? 'Never' : '—')}</strong></span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={busy} className={SLATE_PRIMARY_BTN} aria-expanded={expanded}>
          {expanded ? <X /> : <Upload />}
          {expanded ? 'Close' : empty ? 'Upload first file' : 'Upload'}
        </Button>
        {onView && <Button size="sm" variant="outline" onClick={onView}><Eye />View</Button>}
        {onDownload && <Button size="sm" variant="outline" onClick={onDownload}><Download />Download</Button>}
        {onTemplate && <Button size="sm" variant="outline" onClick={onTemplate}><FileSpreadsheet />Template</Button>}
        {onRefresh && (
          <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" onClick={onRefresh} disabled={loading} aria-label={`Refresh ${title} status`} title="Refresh status">
            <RotateCw className={loading ? 'animate-spin' : ''} />
          </Button>
        )}
      </div>

      {expanded && (
        <Spinner spinning={loading}>
          <div className="mt-1 grid grid-cols-1 gap-4 border-t border-border pt-3 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">{details}</div>
            <div className="min-w-0 lg:col-span-5">{upload}</div>
          </div>
        </Spinner>
      )}
    </div>
  );
}

// ─── Collapsible group of master-data cards ────────────────────────────────────

export function MasterGroup({ title, count, notUploaded, children }: { title: string; count: number; notUploaded: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2.5 bg-muted/40 px-4 text-left"
      >
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <strong className="text-[14px]">{title}</strong>
        <span className="text-[12.5px] text-muted-foreground">{count} {count === 1 ? 'dataset' : 'datasets'}</span>
        {notUploaded > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
            {notUploaded} not uploaded
          </span>
        )}
      </button>
      {open && <div className="grid grid-cols-1 gap-2.5 p-3 md:grid-cols-2">{children}</div>}
    </div>
  );
}
