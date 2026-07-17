import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, RotateCw, Search, Store } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  Empty,
  Input,
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

interface ArticleMeta {
  generatedBy?: UserRef | null;
  approved?: boolean;
  approvedBy?: UserRef | null;
  approvedAt?: string | null;
}

const VIEW_ORDER = ['front', 'back', 'side', 'three_quarter', 'left_side', 'closeup'];
const VIEW_LABELS: Record<string, string> = {
  front: 'Front',
  back: 'Back',
  side: 'Side',
  three_quarter: '3/4',
  left_side: 'Left Side',
  closeup: 'Closeup',
};

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
  const [preview, setPreview] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, ArticleMeta>>({});

  const load = useCallback(async (reset: boolean, prefix: string, cur?: string) => {
    const token = localStorage.getItem('authToken');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (prefix) params.set('prefix', prefix);
      if (cur) params.set('cursor', cur);
      const res = await fetch(`${API_BASE}/model-generation/model-images?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load model images');
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
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
    void load(true, '');
    void loadMeta();
  }, [load, loadMeta]);

  // Promote an article's views into the E-commerce/ folder (E-commerce/{article}/1.jpg…).
  const approveForEcommerce = async (article: string) => {
    const token = localStorage.getItem('authToken');
    setApproving((prev) => new Set(prev).add(article));
    try {
      const res = await fetch(`${API_BASE}/model-generation/model-images/approve-ecommerce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ articleNumber: article }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Approve failed');
      setMeta((prev) => ({
        ...prev,
        [article]: {
          ...prev[article],
          approved: true,
          approvedBy: data.approvedBy ?? prev[article]?.approvedBy ?? null,
          approvedAt: data.approvedAt ?? new Date().toISOString(),
        },
      }));
      message.success(`${data.count} image${data.count !== 1 ? 's' : ''} approved to E-commerce for ${article}`);
    } catch (e: any) {
      message.error(e.message || 'Failed to approve for e-commerce');
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        next.delete(article);
        return next;
      });
    }
  };

  const runSearch = () => {
    setItems([]);
    setCursor(undefined);
    void load(true, search.trim());
  };

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
    return Array.from(m.entries());
  }, [items]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="glass rounded-2xl border border-white/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            model-images bucket
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {groups.length} article{groups.length !== 1 ? 's' : ''} · {items.length} image{items.length !== 1 ? 's' : ''}
              {cursor ? '+' : ''}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
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
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => { setSearch(''); setItems([]); setCursor(undefined); void load(true, ''); }}
              title="Reset & refresh"
            >
              <RotateCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </CardHeader>
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
            <Empty description={<span className="text-muted-foreground">No model images found in the bucket.</span>} />
          </CardContent>
        </Card>
      )}

      {groups.map(([article, imgs]) => {
        const m = meta[article];
        const isApproved = !!m?.approved;
        return (
        <Card key={article} className="glass rounded-2xl border border-white/60">
          <CardHeader className="px-3 py-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-normal">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate" title={article}>{article}</span>
                  {isApproved && (
                    <Tag className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                      <Check className="mr-0.5 h-3 w-3" />
                      Approved
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
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => imgs.forEach((im) => downloadByKey(im.key, `${article}_${im.view}.png`))}
                >
                  <Download />
                  Download {imgs.length}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={approving.has(article)}
                  className={
                    isApproved
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-[#FF6F61] text-white hover:bg-[#ff5b4d]'
                  }
                  onClick={() => approveForEcommerce(article)}
                >
                  {approving.has(article) ? (
                    <RotateCw className="animate-spin" />
                  ) : isApproved ? (
                    <Check />
                  ) : (
                    <Store />
                  )}
                  {approving.has(article)
                    ? 'Approving…'
                    : isApproved
                      ? 'Re-approve'
                      : 'Approve for E-commerce'}
                </Button>
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
          <Button type="button" variant="outline" disabled={loading} onClick={() => load(false, search.trim(), cursor)}>
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
