import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, FileDown, RotateCw, Search, Store, Undo2, X } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

interface ModelImageItem {
  key: string;
  url: string;
  articleNumber: string;
  view: string;
  size?: number;
  lastModified?: string;
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

  const load = useCallback(async (reset: boolean, prefix: string, day: Dayjs | null, cur?: string) => {
    const token = localStorage.getItem('authToken');
    setLoading(true);
    try {
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
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      setTruncated(!!data.scanTruncated);
      setLoadedOnce(true);
    } catch (e: any) {
      message.error(e.message || 'Failed to load model images');
    } finally {
      setLoading(false);
    }
  }, []);

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
    void load(true, search.trim(), date);
  };

  // Export exactly what the gallery is currently showing (same date / status / search
  // filters) as a CSV: one row per article, with the colour split out of the folder name
  // so the list can be pasted straight into a sheet or matched against a PO.
  const downloadList = () => {
    if (groups.length === 0) {
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
    const lines = groups.map(([folder, imgs]) => {
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
    message.success(`Exported ${groups.length} article${groups.length !== 1 ? 's' : ''}`);
  };

  // Escape hatch for "I searched an article and got nothing because of the date".
  const searchAllDates = () => {
    setDate(null);
    setItems([]);
    setCursor(undefined);
    void load(true, search.trim(), null);
  };

  const statusOf = useCallback(
    (article: string): ReviewStatus => (meta[article]?.status as ReviewStatus) || 'UNAPPROVED',
    [meta],
  );

  const groups = useMemo(() => {
    const m = new Map<string, ModelImageItem[]>();
    for (const it of items) {
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
    // Status lives in the meta map (already loaded in full), so this filter is applied
    // client-side over whatever pages are loaded — with the default date filter that is
    // the complete set for the day.
    const entries = Array.from(m.entries());
    return status === 'ALL' ? entries : entries.filter(([article]) => statusOf(article) === status);
  }, [items, status, statusOf]);

  const visibleArticles = useMemo(() => groups.map(([a]) => a), [groups]);
  // Count what's actually on screen — with a status filter active, items.length is the
  // unfiltered total and would report far more images than the page shows.
  const shownImageCount = useMemo(() => groups.reduce((n, [, imgs]) => n + imgs.length, 0), [groups]);
  const allVisibleSelected = visibleArticles.length > 0 && visibleArticles.every((a) => selected.has(a));
  const selectedList = useMemo(
    () => visibleArticles.filter((a) => selected.has(a)),
    [visibleArticles, selected],
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
      if (visibleArticles.every((a) => prev.has(a))) {
        const next = new Set(prev);
        visibleArticles.forEach((a) => next.delete(a));
        return next;
      }
      return new Set([...prev, ...visibleArticles]);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="glass rounded-2xl border border-white/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            model-images bucket
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {groups.length} article{groups.length !== 1 ? 's' : ''} · {shownImageCount} image
              {shownImageCount !== 1 ? 's' : ''}
              {cursor ? '+' : ''}
              {status !== 'ALL' && ` of ${items.length}`}
              {' · '}
              {date
                ? date.isSame(dayjs(), 'day')
                  ? `today (${date.format('DD/MM/YYYY')})`
                  : date.format('DD/MM/YYYY')
                : 'all dates'}
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker
              value={date}
              onChange={applyDate}
              placeholder="Generated on…"
              className="h-9 w-40"
            />
            <Button
              type="button"
              size="sm"
              variant={date ? 'outline' : 'secondary'}
              onClick={() => applyDate(date ? null : dayjs())}
              title={date ? 'Show images from every date' : 'Jump back to today'}
            >
              {date ? 'All dates' : 'Today'}
            </Button>
            <Select value={status} onValueChange={(v) => setStatus(v as 'ALL' | ReviewStatus)}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Filter by article number…"
                className="h-9 w-56 pl-8"
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={runSearch}>
              Search
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={downloadList}
              disabled={groups.length === 0}
              title="Export the articles currently listed (article number + colour) as CSV"
            >
              <FileDown />
              Download list
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => { setSearch(''); setItems([]); setCursor(undefined); void load(true, '', date); }}
              title="Reset & refresh"
            >
              <RotateCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </CardHeader>
        {truncated && (
          <CardContent className="pt-0">
            <p className="text-xs text-amber-600">
              The bucket is larger than one date scan — some images from this date may not be listed.
              Narrow the search by article number.
            </p>
          </CardContent>
        )}
        {groups.length > 0 && (
          <CardContent className="flex flex-wrap items-center gap-3 border-t border-white/60 pt-3">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
              Select all {visibleArticles.length}
            </label>
            {selectedList.length > 0 && (
              <>
                <span className="text-sm text-muted-foreground">{selectedList.length} selected</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={bulkRunning || eligible('approve').length === 0}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
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
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
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
              </>
            )}
          </CardContent>
        )}
      </Card>

      {loading && items.length === 0 && (
        <div className="py-16 text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-muted-foreground">Loading model images…</p>
        </div>
      )}

      {loadedOnce && !loading && groups.length === 0 && (
        <Card className="flex min-h-[300px] items-center justify-center glass rounded-2xl border border-white/60">
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>
      )}

      {groups.map(([article, imgs]) => {
        const m = meta[article];
        const articleStatus = statusOf(article);
        const isApproved = articleStatus === 'APPROVED';
        const tag = articleStatus === 'UNAPPROVED' ? null : STATUS_TAG[articleStatus];
        const busy = approving.has(article);
        return (
        <Card key={article} className="glass rounded-2xl border border-white/60">
          <CardHeader className="px-3 py-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-normal">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.has(article)}
                    onCheckedChange={() => toggleSelected(article)}
                    aria-label={`Select ${article}`}
                  />
                  <span className="truncate" title={article}>{article}</span>
                  {tag && (
                    <Tag className={`text-[10px] ${tag.className}`}>
                      {articleStatus === 'APPROVED' && <Check className="mr-0.5 h-3 w-3" />}
                      {articleStatus === 'REJECTED' && <X className="mr-0.5 h-3 w-3" />}
                      {articleStatus === 'REVERTED' && <Undo2 className="mr-0.5 h-3 w-3" />}
                      {tag.label}
                    </Tag>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
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
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => imgs.forEach((im) => downloadByKey(im.key, `${article}_${im.view}.png`))}
                >
                  <Download />
                  Download {imgs.length}
                </Button>
                {canApprove(articleStatus) && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    className={
                      isApproved
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-[#FF6F61] text-white hover:bg-[#ff5b4d]'
                    }
                    onClick={() => review([article], 'approve')}
                  >
                    {busy ? <RotateCw className="animate-spin" /> : isApproved ? <Check /> : <Store />}
                    {busy ? 'Working…' : isApproved ? 'Re-approve' : 'Approve for E-commerce'}
                  </Button>
                )}
                {canRevert(articleStatus) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => review([article], 'revert')}
                    title="Undo the approval and remove the E-commerce copies"
                  >
                    <Undo2 />
                    Revert
                  </Button>
                )}
                {canReject(articleStatus) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                    onClick={() => review([article], 'reject')}
                    title={isApproved ? 'Reject and remove the E-commerce copies' : 'Mark these images as rejected'}
                  >
                    <X />
                    Reject
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(imgs.length, 1)}, minmax(0, 1fr))` }}>
              {imgs.map((im) => (
                <div key={im.key} className="flex flex-col gap-1">
                  <img
                    src={im.url}
                    alt={`${article} - ${im.view}`}
                    loading="lazy"
                    className="aspect-[2/3] w-full cursor-pointer rounded object-cover"
                    onClick={() => setPreview(im.url)}
                  />
                  <div className="flex items-center justify-between">
                    <Tag className="border-[#FF6F61]/30 bg-[#FF6F61]/10 text-[10px] text-[#FF6F61]">
                      {VIEW_LABELS[im.view] || im.view}
                    </Tag>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => downloadByKey(im.key, `${article}_${im.view}.png`)}
                    >
                      <Download />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        );
      })}

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
