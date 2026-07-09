import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RotateCw, Search } from 'lucide-react';
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

  useEffect(() => {
    void load(true, '');
  }, [load]);

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

      {groups.map(([article, imgs]) => (
        <Card key={article} className="glass rounded-2xl border border-white/60">
          <CardHeader className="px-3 py-2">
            <CardTitle className="flex items-center justify-between text-sm font-normal">
              <span className="truncate" title={article}>{article}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => imgs.forEach((im) => downloadByKey(im.key, `${article}_${im.view}.png`))}
              >
                <Download />
                Download {imgs.length}
              </Button>
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
      ))}

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
