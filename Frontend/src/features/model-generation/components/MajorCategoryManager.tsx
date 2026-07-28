import { useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

const FRAME_OPTIONS = [
  { value: 'upper', label: 'upper — waist-up (top / shirt)' },
  { value: 'lower', label: 'lower — waist-down (bottomwear)' },
  { value: 'set', label: 'set — full body (full outfit / one-piece)' },
  { value: 'fw', label: 'fw — footwear' },
] as const;

const DIV_OPTIONS = ['WOMEN', 'MEN', 'KIDS'];
const IDEAL_FOR_OPTIONS = ['WOMEN', 'MEN', 'KIDS BOY', 'KIDS GIRL', 'KIDS & INFANTS'];

export interface MajorCat {
  id: number;
  majCat: string;
  name: string | null;
  div: string | null;
  idealFor: string | null;
  frame: string;
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('authToken');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Button + dialog to view and add MAJ CAT entries in the major_cat_master table.
 * The `frame` value (fw | upper | lower | set) drives how the AI model photoshoot
 * is framed when generating from an article number + colour + majcat.
 */
export function MajorCategoryManager() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MajorCat[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Add-form state
  const [majCat, setMajCat] = useState('');
  const [name, setName] = useState('');
  const [div, setDiv] = useState('');
  const [idealFor, setIdealFor] = useState('');
  const [frame, setFrame] = useState<string>('upper');

  const loadList = async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`${API_BASE}/model-generation/major-categories`, {
        headers: { ...authHeaders() },
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load categories');
      setList(json.data as MajorCat[]);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load major categories');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (open) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resetForm = () => {
    setMajCat('');
    setName('');
    setDiv('');
    setIdealFor('');
    setFrame('upper');
  };

  const handleAdd = async () => {
    const code = majCat.trim().toUpperCase();
    if (!code) {
      message.error('MAJ CAT code is required');
      return;
    }
    if (!frame) {
      message.error('Frame is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/model-generation/major-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          majCat: code,
          name: name.trim() || undefined,
          div: div || undefined,
          idealFor: idealFor || undefined,
          frame,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const msg = Array.isArray(json.error) ? json.error[0]?.message : json.error;
        throw new Error(msg || 'Failed to save category');
      }
      message.success(`Saved "${code}"`);
      resetForm();
      loadList();
    } catch (err: any) {
      message.error(err?.message || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.majCat.toUpperCase().includes(q) ||
        (r.name || '').toUpperCase().includes(q),
    );
  }, [list, search]);

  const frameBadgeClass = (f: string) =>
    f === 'lower'
      ? 'bg-amber-100 text-amber-700'
      : f === 'set'
        ? 'bg-violet-100 text-violet-700'
        : f === 'fw'
          ? 'bg-slate-200 text-slate-700'
          : 'bg-emerald-100 text-emerald-700';

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Layers />
        Major Categories
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Major Category Master</DialogTitle>
            <DialogDescription>
              Add a new MAJ CAT and its model-image frame (upper / lower / set / fw).
              These drive how the AI photoshoot is framed for article-based generation.
            </DialogDescription>
          </DialogHeader>

          {/* Add form */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>MAJ CAT code *</Label>
              <Input
                placeholder="e.g. LW_JACKET_FS"
                value={majCat}
                onChange={(e) => setMajCat(e.target.value.toUpperCase())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. JACKETS"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Frame *</Label>
              <Select value={frame} onValueChange={setFrame}>
                <SelectTrigger>
                  <SelectValue placeholder="Select frame" />
                </SelectTrigger>
                <SelectContent>
                  {FRAME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Division</Label>
              <Select value={div} onValueChange={setDiv}>
                <SelectTrigger>
                  <SelectValue placeholder="Select division" />
                </SelectTrigger>
                <SelectContent>
                  {DIV_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Ideal for</Label>
              <Select value={idealFor} onValueChange={setIdealFor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select ideal-for" />
                </SelectTrigger>
                <SelectContent>
                  {IDEAL_FOR_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-1">
            <Button type="button" onClick={handleAdd} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : <Plus />}
              Add / Update Category
            </Button>
          </DialogFooter>

          {/* Existing list */}
          <div className="mt-2 border-t pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                Existing categories{list.length ? ` (${list.length})` : ''}
              </span>
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-7 text-xs"
                  placeholder="Search code / name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <ScrollArea className="h-56 rounded-md border">
              {loadingList ? (
                <div className="flex h-full items-center justify-center py-8">
                  <Spinner className="size-5" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No categories found.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">MAJ CAT</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Div</th>
                      <th className="px-3 py-2 font-medium">Frame</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-1.5 font-mono">{r.majCat}</td>
                        <td className="px-3 py-1.5">{r.name || '—'}</td>
                        <td className="px-3 py-1.5">{r.div || '—'}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="secondary" className={frameBadgeClass(r.frame)}>
                            {r.frame}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
