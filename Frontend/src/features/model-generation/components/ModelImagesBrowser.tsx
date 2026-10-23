import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, FileDown, MoreHorizontal, RotateCw, Search, Store, Undo2, X } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tag,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

interface ModelImageItem {
  key: string;
  url: string;
  articleNumber: string;
  view: string;
  size?: number;
  lastModified?: string;
}

interface ModelImagesPage {
  items: ModelImageItem[];
  nextCursor?: string;
  scanTruncated?: boolean;
}

interface UserRef {
  id: number;
  name: string;
}

type ReviewStatus = 'UNAPPROVED' | 'APPROVED' | 'REJECTED' | 'REVERTED';
type ReviewAction = 'approve' | 'reject' | 'revert';

interface ArticleMeta {
  generatedBy?: UserRef | null;
  status?: ReviewStatus;
  approved?: boolean;
  approvedBy?: UserRef | null;
  approvedAt?: string | null;
  reviewedBy?: UserRef | null;
  reviewedAt?: string | null;
}

const STATUS_FILTERS: Array<{ value: 'ALL' | ReviewStatus; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'UNAPPROVED', label: 'Unapproved' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REVERTED', label: 'Reverted' },
];

const STATUS_TAG: Record<Exclude<ReviewStatus, 'UNAPPROVED'>, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Rejected', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  REVERTED: { label: 'Reverted', className: 'border-amber-200 bg-amber-50 text-amber-700' },
};

const ACTION_LABEL: Record<ReviewAction, string> = { approve: 'Approve', reject: 'Reject', revert: 'Revert' };

// Which actions are offered per status. REJECTED is terminal for this set of images —
// no buttons at all; regenerating the article clears the rejection (the generator resets
// the review row), which is how a rejected article becomes reviewable again.
//   UNAPPROVED → Approve, Reject
//   APPROVED   → Re-approve, Revert, Reject
//   REJECTED   → (download only)
//   REVERTED   → Approve, Reject
const canApprove = (s: ReviewStatus) => s !== 'REJECTED';
const canRevert = (s: ReviewStatus) => s === 'APPROVED';
const canReject = (s: ReviewStatus) => s !== 'REJECTED';
const CAN: Record<ReviewAction, (s: ReviewStatus) => boolean> = {
  approve: canApprove,
  revert: canRevert,
  reject: canReject,
};

// 'three_quarter' was replaced by 'style_shoot'; it stays listed so images generated
// before the switch keep their position and label in the gallery.
const VIEW_ORDER = ['front', 'back', 'side', 'style_shoot', 'three_quarter', 'left_side', 'closeup'];
const VIEW_LABELS: Record<string, string> = {
  front: 'Front',
  back: 'Back',
  side: 'Side',
  style_shoot: 'Style Shoot',
  three_quarter: '3/4',
  left_side: 'Left Side',
  closeup: 'Closeup',
};

// Bucket folders are "{articleNumber}-{COLOUR}" (e.g. "1112105394-LIGHT BLUE"), but some
// have no colour suffix at all ("1116103218"). Split on the first hyphen after the numeric
// article code; anything that doesn't match that shape is treated as a bare article number
// rather than guessing a colour out of it.
function splitArticleColour(folder: string): { article: string; colour: string } {
  const m = /^(\d+)-(.+)$/.exec(folder.trim());
  return m ? { article: m[1], colour: m[2].trim() } : { article: folder.trim(), colour: '' };
}

// The gallery renders at most this many images at a time. A day can hold 400+ images
// and mounting them all at once stalls the tab (hundreds of parallel image requests),
// so the loaded set is paged client-side instead.
const PAGE_IMAGE_LIMIT = 50;

// Compact pager: first, last, and a window around the current page, with gaps elided.
function pageWindow(page: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(total - 1, page + 1);
  if (from > 2) out.push('…');
  for (let n = from; n <= to; n++) out.push(n);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

// A CSV export walks the listing page by page; this caps the walk so a runaway bucket
// can't spin forever (200 x 300 keys is far above the current bucket size).
const MAX_EXPORT_PAGES = 200;

// Group a flat list of objects into [articleFolder, images[]] with the views in
// display order. Used both for the gallery and for the export's full-bucket fetch.
function groupByArticle(list: ModelImageItem[]): Array<[string, ModelImageItem[]]> {
  const m = new Map<string, ModelImageItem[]>();
  for (const it of list) {
    const arr = m.get(it.articleNumber) || [];
    arr.push(it);
    m.set(it.articleNumber, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => {
      const ia = VIEW_ORDER.indexOf(a.view);
      const ib = VIEW_ORDER.indexOf(b.view);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }
  return Array.from(m.entries());
}

// Download via the backend proxy (R2 public URLs don't allow cross-origin fetch,
// so downloading them client-side would just open the image). The proxy streams
// the bytes with a Content-Disposition attachment header.
async function downloadByKey(key: string, filename: string) {
  const token = localStorage.getItem('authToken');
  try {
    const res = await fetch(`${API_BASE}/model-generation/model-images/download?key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('download failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    message.error('Download failed');
  }
}

export function ModelImagesBrowser() {
  const [items, setItems] = useState<ModelImageItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // Defaults to today so the gallery opens on the images generated in this session.
  // null = no date filter (browse the whole bucket).
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [status, setStatus] = useState<'ALL' | ReviewStatus>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, ArticleMeta>>({});
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);

  // One page of the bucket listing. Shared by the gallery loader and by the CSV export,
  // which walks every page rather than exporting only what's on screen.
  const fetchPage = useCallback(async (prefix: string, day: Dayjs | null, cur?: string): Promise<ModelImagesPage> => {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (cur) params.set('cursor', cur);
    if (day) {
      // Send the picked day's boundaries in the BROWSER's timezone, so the server
      // filters on the user's calendar day rather than its own (UTC in prod).
      params.set('from', day.startOf('day').toDate().toISOString());
      params.set('to', day.add(1, 'day').startOf('day').toDate().toISOString());
    }
    const res = await fetch(`${API_BASE}/model-generation/model-images?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load model images');
    return data as ModelImagesPage;
  }, []);

  // Every page for the current filters. With no date picked the server pages the bucket,
  // so the gallery holds one page while the export needs the lot — first upload to last.
  const fetchAll = useCallback(async (prefix: string, day: Dayjs | null) => {
    const all: ModelImageItem[] = [];
    let cur: string | undefined;
    let pages = 0;
    let scanTruncated = false;
    do {
      const page = await fetchPage(prefix, day, cur);
      all.push(...(page.items || []));
      scanTruncated = scanTruncated || !!page.scanTruncated;
      cur = page.nextCursor;
      pages += 1;
    } while (cur && pages < MAX_EXPORT_PAGES);
    return { items: all, incomplete: !!cur || scanTruncated };
  }, [fetchPage]);

  const load = useCallback(async (reset: boolean, prefix: string, day: Dayjs | null, cur?: string) => {
    setLoading(true);
    try {
      const data = await fetchPage(prefix, day, cur);
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      setTruncated(!!data.scanTruncated);
      setLoadedOnce(true);
    } catch (e: any) {
      message.error(e.message || 'Failed to load model images');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  // Per-article generator + approval info (who generated, who approved, approved flag).
  const loadMeta = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_BASE}/model-generation/model-images/meta`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setMeta(data.meta || {});
    } catch {
      // non-fatal — the gallery still works without generator/approval labels
    }
  }, []);

  useEffect(() => {
    void load(true, '', dayjs());
    void loadMeta();
    // Intentionally runs once on mount — the initial view is always "today".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadMeta]);

  // Re-query whenever the picked day changes (including clearing it to "all dates").
  const applyDate = (day: Dayjs | null) => {
    setDate(day);
    setItems([]);
    setCursor(undefined);
    setPage(1);
    void load(true, search.trim(), day);
  };

  // Approve / reject / revert one or more articles. Approving copies the views into
  // E-commerce/{article}/1.jpg…; rejecting and reverting both REMOVE those copies (a
  // withdrawn article must not stay live) and differ only in the recorded status.
  const review = async (articles: string[], action: ReviewAction) => {
    if (articles.length === 0) return;
    const token = localStorage.getItem('authToken');
    const bulk = articles.length > 1;
    if (bulk) setBulkRunning(true);
    setApproving((prev) => {
      const next = new Set(prev);
      articles.forEach((a) => next.add(a));
      return next;
    });

    try {
      const res = await fetch(`${API_BASE}/model-generation/model-images/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ articleNumbers: articles, action }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `${ACTION_LABEL[action]} failed`);

      const okArticles: string[] = (data.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => r.articleNumber);

      setMeta((prev) => {
        const next = { ...prev };
        for (const a of okArticles) {
          const wasApproved = action === 'approve';
          next[a] = {
            ...next[a],
            status: data.status as ReviewStatus,
            approved: wasApproved,
            // A revert/reject keeps the previous approver on record — that's who's being undone.
            approvedBy: wasApproved ? (data.reviewedBy ?? next[a]?.approvedBy ?? null) : (next[a]?.approvedBy ?? null),
            approvedAt: wasApproved ? (data.reviewedAt ?? new Date().toISOString()) : (next[a]?.approvedAt ?? null),
            reviewedBy: data.reviewedBy ?? next[a]?.reviewedBy ?? null,
            reviewedAt: data.reviewedAt ?? new Date().toISOString(),
          };
        }
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        okArticles.forEach((a) => next.delete(a));
        return next;
      });

      const verb = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reverted';
      if (data.failed > 0) {
        const firstError = (data.results || []).find((r: any) => !r.success)?.error;
        message.warning(`${data.succeeded} ${verb}, ${data.failed} failed${firstError ? ` — ${firstError}` : ''}`);
      } else if (bulk) {
        message.success(`${data.succeeded} article${data.succeeded !== 1 ? 's' : ''} ${verb}`);
      } else {
        const count = data.results?.[0]?.count;
        message.success(
          action === 'approve'
            ? `${count} image${count !== 1 ? 's' : ''} approved to E-commerce for ${articles[0]}`
            : `${articles[0]} ${verb}${count ? ` · ${count} E-commerce copy/copies removed` : ''}`
        );
      }
    } catch (e: any) {
      message.error(e.message || `Failed to ${action}`);
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        articles.forEach((a) => next.delete(a));
        return next;
      });
      if (bulk) setBulkRunning(false);
    }
  };

  const runSearch = () => {
    setItems([]);
    setCursor(undefined);
    setPage(1);
    void load(true, search.trim(), date);
  };

  // Export the CSV for the current date / status / search filters: one row per article,
  // with the colour split out of the folder name so the list can be pasted straight into
  // a sheet or matched against a PO.
  //
  // The gallery is paged, so it may be holding only the first page — with no date picked
  // that is a slice of the bucket, not "all dates". So when more pages exist, the export
  // walks the listing to the end first and writes EVERY article, first date to last,
  // regardless of how much the gallery has scrolled in.
  const downloadList = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let rows = groups;
      let partial = false;
      if (cursor) {
        const all = await fetchAll(search.trim(), date);
        rows = applyStatus(groupByArticle(all.items));
        partial = all.incomplete;
      } else {
        partial = truncated;
      }
      if (rows.length === 0) {
        message.warning('Nothing to export for the current filters');
        return;
      }
      const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [
        'article_number',
        'colour',
        'full_code',
        'status',
        'images',
        'views',
        'generated_by',
        'approved_by',
        'approved_at',
        'last_reviewed_at',
      ];
      const lines = rows.map(([folder, imgs]) => {
        const { article, colour } = splitArticleColour(folder);
        const m = meta[folder];
        const s = statusOf(folder);
        return [
          esc(article),
          esc(colour),
          esc(folder),
          s,
          String(imgs.length),
          esc(imgs.map((i) => VIEW_LABELS[i.view] || i.view).join(' | ')),
          esc(m?.generatedBy?.name || ''),
          esc(s === 'APPROVED' ? m?.approvedBy?.name || '' : ''),
          esc(s === 'APPROVED' && m?.approvedAt ? new Date(m.approvedAt).toLocaleString() : ''),
          esc(m?.reviewedAt ? new Date(m.reviewedAt).toLocaleString() : ''),
        ].join(',');
      });
      const csv = [header.join(','), ...lines].join('\r\n');
      // BOM so Excel reads the UTF-8 colour names correctly.
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const scope = status === 'ALL' ? 'all' : status.toLowerCase();
      const when = date ? date.format('YYYY-MM-DD') : 'all-dates';
      a.href = url;
      a.download = `model-images_${scope}_${when}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(
        `Exported ${rows.length} article${rows.length !== 1 ? 's' : ''}${date ? '' : ' across all dates'}`
      );
      if (partial) {
        message.warning('The bucket is larger than one export scan — some older articles may be missing');
      }
    } catch (e: any) {
      message.error(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Escape hatch for "I searched an article and got nothing because of the date".
  const searchAllDates = () => {
    setDate(null);
    setItems([]);
    setCursor(undefined);
    setPage(1);
    void load(true, search.trim(), null);
  };

  const statusOf = useCallback(
    (article: string): ReviewStatus => (meta[article]?.status as ReviewStatus) || 'UNAPPROVED',
    [meta],
  );

  // Status lives in the meta map (already loaded in full), so this filter is applied
  // client-side over whatever pages are loaded — with the default date filter that is
  // the complete set for the day.
  const applyStatus = useCallback(
    (entries: Array<[string, ModelImageItem[]]>) =>
      status === 'ALL' ? entries : entries.filter(([article]) => statusOf(article) === status),
    [status, statusOf],
  );

  const groups = useMemo(() => applyStatus(groupByArticle(items)), [items, applyStatus]);

  // Split the matched articles into pages of at most PAGE_IMAGE_LIMIT images. An article
  // is never split across pages, so a page can run slightly under the limit.
  const pages = useMemo(() => {
    const out: Array<Array<[string, ModelImageItem[]]>> = [];
    let current: Array<[string, ModelImageItem[]]> = [];
    let count = 0;
    for (const group of groups) {
      const n = group[1].length;
      if (current.length > 0 && count + n > PAGE_IMAGE_LIMIT) {
        out.push(current);
        current = [];
        count = 0;
      }
      current.push(group);
      count += n;
    }
    if (current.length > 0) out.push(current);
    return out;
  }, [groups]);

  const pageCount = pages.length;
  const pageGroups = pages[page - 1] || [];

  // A narrowed filter can leave the current page out of range (e.g. sitting on page 6 of
  // 9 and then picking a status that only matches two pages' worth).
  useEffect(() => {
    setPage((p) => Math.min(Math.max(p, 1), Math.max(pageCount, 1)));
  }, [pageCount]);

  const goToPage = (n: number) => {
    setPage(Math.min(Math.max(n, 1), Math.max(pageCount, 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Articles on THIS page — what the select-all checkbox covers.
  const pageArticles = useMemo(() => pageGroups.map(([a]) => a), [pageGroups]);
  // Every article matching the filters, across all pages. Selection survives paging, so
  // a bulk approve still covers what was ticked on an earlier page.
  const matchedArticles = useMemo(() => groups.map(([a]) => a), [groups]);
  // Count what's actually matched — with a status filter active, items.length is the
  // unfiltered total and would report far more images than the gallery shows.
  const shownImageCount = useMemo(() => groups.reduce((n, [, imgs]) => n + imgs.length, 0), [groups]);
  const pageImageCount = useMemo(() => pageGroups.reduce((n, [, imgs]) => n + imgs.length, 0), [pageGroups]);
  const allVisibleSelected = pageArticles.length > 0 && pageArticles.every((a) => selected.has(a));
  const selectedList = useMemo(
    () => matchedArticles.filter((a) => selected.has(a)),
    [matchedArticles, selected],
  );
  // A bulk action applies only to the selected articles its status rule allows — the
  // same rule the per-article buttons use, so selecting a rejected article can never
  // approve it through the back door.
  const eligible = useCallback(
    (action: ReviewAction) => selectedList.filter((a) => CAN[action](statusOf(a))),
    [selectedList, statusOf],
  );

  const toggleSelected = (article: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(article)) next.delete(article);
      else next.add(article);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (pageArticles.every((a) => prev.has(a))) {
        const next = new Set(prev);
        pageArticles.forEach((a) => next.delete(a));
        return next;
      }
      return new Set([...prev, ...pageArticles]);
    });
  };

  // Article counts per status for the tab badges — over everything loaded, ignoring
  // the status filter itself (so switching tabs doesn't change the numbers).
  const statusCounts = useMemo(() => {
    const all = groupByArticle(items);
    const counts: Record<'ALL' | ReviewStatus, number> = { ALL: all.length, UNAPPROVED: 0, APPROVED: 0, REJECTED: 0, REVERTED: 0 };
    for (const [article] of all) counts[statusOf(article)]++;
    return counts;
  }, [items, statusOf]);

  const pager = pageCount > 1 && (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={page <= 1} onClick={() => goToPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      {pageWindow(page, pageCount).map((n, i) =>
        n === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => goToPage(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(
              'h-9 min-w-9 rounded-lg px-2 text-[13px] font-semibold transition-colors',
              n === page ? 'bg-slate-800 text-white' : 'text-foreground hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {n}
          </button>
        )
      )}
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={page >= pageCount} onClick={() => goToPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </nav>
  );

  const dateLabel = date
    ? date.isSame(dayjs(), 'day')
      ? `today (${date.format('DD/MM/YYYY')})`
      : date.format('DD/MM/YYYY')
    : 'all dates';

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar — design "Option A": status tabs with counts + one row of filters */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div role="tablist" aria-label="Review status" className="flex flex-wrap gap-0.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {STATUS_FILTERS.map((s) => {
              const on = status === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setStatus(s.value); setPage(1); }}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors',
                    on ? 'bg-slate-800 text-white' : 'text-foreground hover:bg-white dark:hover:bg-slate-700',
                  )}
                >
                  {s.value === 'ALL' ? 'All' : s.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11.5px] tabular-nums',
                      on ? 'bg-white/20' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
                    )}
                  >
                    {statusCounts[s.value]}
                    {cursor ? '+' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <DatePicker value={date} onChange={applyDate} placeholder="Generated on…" className="h-10 w-40" />
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => applyDate(date ? null : dayjs())}
            title={date ? 'Show images from every date' : 'Jump back to today'}
          >
            {date ? 'All dates' : 'Today'}
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Article number…"
              aria-label="Filter by article number"
              className="h-10 w-56 pl-9"
            />
          </div>
          <Button type="button" variant="outline" className="h-10" onClick={runSearch}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => void downloadList()}
            disabled={exporting || (groups.length === 0 && !cursor)}
            title={
              date
                ? 'Export the articles listed for this date (article number + colour) as CSV'
                : 'Export every article in the bucket, all dates, as CSV'
            }
          >
            {exporting ? <Spinner className="h-4 w-4" /> : <FileDown />}
            {exporting ? 'Preparing…' : 'Download list'}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-10 w-10"
            onClick={() => { setSearch(''); setItems([]); setCursor(undefined); setPage(1); void load(true, '', date); }}
            title="Reset & refresh"
            aria-label="Reset and refresh"
          >
            <RotateCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
        {truncated && (
          <p className="m-0 text-xs text-amber-700">
            The bucket is larger than one date scan — some images from this date may not be listed. Narrow the search by article number.
          </p>
        )}
      </section>

      {/* Selection + summary + pager */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[13px]">
          <label className="flex cursor-pointer select-none items-center gap-2 font-semibold">
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
            Select all {pageArticles.length} on this page
          </label>
          {selectedList.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{selectedList.length} selected</span>
              <Button
                type="button"
                size="sm"
                disabled={bulkRunning || eligible('approve').length === 0}
                className="bg-emerald-700 text-white hover:bg-emerald-800"
                onClick={() => review(eligible('approve'), 'approve')}
                title="Rejected articles are skipped"
              >
                {bulkRunning ? <RotateCw className="animate-spin" /> : <Check />}
                Approve {eligible('approve').length}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkRunning || eligible('reject').length === 0}
                className="border-rose-300 text-rose-700 hover:bg-rose-50"
                onClick={() => review(eligible('reject'), 'reject')}
                title="Already-rejected articles are skipped"
              >
                <X />
                Reject {eligible('reject').length}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkRunning || eligible('revert').length === 0}
                onClick={() => review(eligible('revert'), 'revert')}
                title="Only approved articles can be reverted"
              >
                <Undo2 />
                Revert {eligible('revert').length}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          ) : (
            <span className="text-muted-foreground">
              model-images bucket · {groups.length} article{groups.length !== 1 ? 's' : ''} · {shownImageCount} image
              {shownImageCount !== 1 ? 's' : ''}
              {cursor ? '+' : ''} · {dateLabel}
              {pageCount > 1 && ` · showing ${pageImageCount} on page ${page} of ${pageCount}`}
            </span>
          )}
          <div className="ml-auto">{pager}</div>
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="py-16 text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-muted-foreground">Loading model images…</p>
        </div>
      )}

      {loadedOnce && !loading && groups.length === 0 && (
        <section className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
          <Empty
            description={
              <div className="flex flex-col items-center gap-2">
                <span className="text-muted-foreground">
                  {date
                    ? `No model images generated on ${date.format('DD/MM/YYYY')}${search.trim() ? ` for "${search.trim()}"` : ''}.`
                    : 'No model images found in the bucket.'}
                  {status !== 'ALL' && ` No article here is ${STATUS_FILTERS.find((s) => s.value === status)?.label.toLowerCase()}.`}
                </span>
                <div className="flex items-center gap-2">
                  {status !== 'ALL' && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setStatus('ALL')}>
                      Show all statuses
                    </Button>
                  )}
                  {date && (
                    <Button type="button" size="sm" variant="outline" onClick={searchAllDates}>
                      Search all dates
                    </Button>
                  )}
                </div>
              </div>
            }
          />
        </section>
      )}

      {pageGroups.map(([article, imgs]) => {
        const m = meta[article];
        const articleStatus = statusOf(article);
        const isApproved = articleStatus === 'APPROVED';
        const tag = articleStatus === 'UNAPPROVED' ? null : STATUS_TAG[articleStatus];
        const busy = approving.has(article);
        const { article: articleNo, colour } = splitArticleColour(article);
        return (
          <article key={article} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox checked={selected.has(article)} onCheckedChange={() => toggleSelected(article)} aria-label={`Select ${article}`} />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[16px] font-semibold" title={article}>{articleNo}</span>
                  {colour && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {colour}
                    </span>
                  )}
                  {tag ? (
                    <Tag className={`text-[11px] ${tag.className}`}>
                      {articleStatus === 'APPROVED' && <Check className="mr-0.5 h-3 w-3" />}
                      {articleStatus === 'REJECTED' && <X className="mr-0.5 h-3 w-3" />}
                      {articleStatus === 'REVERTED' && <Undo2 className="mr-0.5 h-3 w-3" />}
                      {tag.label}
                    </Tag>
                  ) : (
                    <Tag className="border-slate-200 bg-slate-50 text-[11px] text-slate-700">Waiting for review</Tag>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {m?.generatedBy && <span>Generated by {m.generatedBy.name}</span>}
                  {isApproved && m?.approvedBy && (
                    <span>
                      Approved by {m.approvedBy.name}
                      {m.approvedAt ? ` · ${new Date(m.approvedAt).toLocaleDateString()}` : ''}
                    </span>
                  )}
                  {!isApproved && articleStatus !== 'UNAPPROVED' && (
                    <span>
                      {tag?.label} by {m?.reviewedBy?.name || 'unknown'}
                      {m?.reviewedAt ? ` · ${new Date(m.reviewedAt).toLocaleDateString()}` : ''}
                      {m?.approvedBy ? ` (was approved by ${m.approvedBy.name})` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Only the actions this status allows (see CAN rules above) */}
              <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => imgs.forEach((im) => downloadByKey(im.key, `${article}_${im.view}.png`))}
                >
                  <Download />
                  Download {imgs.length}
                </Button>
                {canApprove(articleStatus) && (
                  <Button
                    type="button"
                    disabled={busy}
                    variant={isApproved ? 'outline' : 'default'}
                    className={cn('h-10', !isApproved && 'bg-emerald-700 text-white hover:bg-emerald-800')}
                    onClick={() => review([article], 'approve')}
                    title={isApproved ? 'Push the approved images to E-commerce again' : 'Approve and copy the images to E-commerce'}
                  >
                    {busy ? <RotateCw className="animate-spin" /> : isApproved ? <RotateCw /> : <Store />}
                    {busy ? 'Working…' : isApproved ? 'Re-approve' : 'Approve for E-commerce'}
                  </Button>
                )}
                {canReject(articleStatus) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    className="h-10 border-rose-300 text-rose-700 hover:bg-rose-50"
                    onClick={() => review([article], 'reject')}
                    title={isApproved ? 'Reject and remove the E-commerce copies' : 'Mark these images as rejected'}
                  >
                    <X />
                    Reject
                  </Button>
                )}
                {canRevert(articleStatus) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="outline" className="h-10 w-10" disabled={busy} aria-label="More actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => review([article], 'revert')}>
                        <Undo2 className="mr-2 h-4 w-4" />
                        Revert approval (remove E-commerce copies)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Shots — fixed-width tiles (~2 articles per screen instead of 1) */}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 168px))' }}>
              {imgs.map((im) => {
                const label = VIEW_LABELS[im.view] || im.view;
                return (
                  <figure key={im.key} className="m-0 flex flex-col gap-1.5">
                    <div className="group relative overflow-hidden rounded-xl bg-slate-100">
                      <img
                        src={im.url}
                        alt={`${article} - ${label}`}
                        loading="lazy"
                        className="block aspect-[2/3] w-full cursor-zoom-in object-cover"
                        onClick={() => setPreview(im.url)}
                      />
                      <button
                        type="button"
                        onClick={() => downloadByKey(im.key, `${article}_${im.view}.png`)}
                        aria-label={`Download ${label}`}
                        className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900/70 text-white hover:bg-slate-900"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                    <figcaption className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</figcaption>
                  </figure>
                );
              })}
            </div>
          </article>
        );
      })}

      {pageCount > 1 && <div className="flex justify-center py-1">{pager}</div>}

      {cursor && (
        <div className="flex justify-center py-2">
          <Button type="button" variant="outline" disabled={loading} onClick={() => load(false, search.trim(), date, cursor)}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          {preview && <img src={preview} alt="preview" className="max-h-[85vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
