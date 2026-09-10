import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter } from 'lucide-react';
import { Button, Checkbox, Input } from '@/shared/components/ui-tw';

interface ColumnCheckboxFilterProps {
  /** Column label, used only for the "Select all" wording. */
  label: string;
  /** All distinct existing values for this column. */
  options: string[];
  loading: boolean;
  /** Currently APPLIED values; empty means "no filter". */
  selected: string[];
  onApply: (values: string[]) => void;
}

const PANEL_WIDTH = 240;
const PANEL_MAX_HEIGHT = 320;
const MARGIN = 8;

/**
 * An Excel-style column header filter: click the funnel to search + tick
 * values, Apply to commit. Deliberately NOT built on Radix Popover — the
 * table it lives in scrolls both ways with a sticky header (`overflow-auto`
 * on an ancestor), which clips any in-flow dropdown, and a bounded few
 * hundred distinct values is exactly the kind of tall content that
 * previously sent Radix's collision math to the wrong place entirely (see
 * ExistingValuePicker in RowChangeRequestDialog). Instead this portals a
 * `position: fixed` panel to document.body and positions it itself from the
 * trigger's own `getBoundingClientRect()` — `fixed` isn't clipped by an
 * ancestor's overflow, and there is no collision system to misbehave.
 */
export function ColumnCheckboxFilter({ label, options, loading, selected, onApply }: ColumnCheckboxFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - PANEL_WIDTH - MARGIN);
    const top = Math.min(rect.bottom + 4, window.innerHeight - 100);
    setCoords({ top, left });
  };

  const openPanel = () => {
    setDraft(new Set(selected));
    setSearch('');
    reposition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    reposition();

    const onScrollOrResize = () => reposition();
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('mousedown', onMouseDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const allFilteredSelected = filteredOptions.length > 0 && filteredOptions.every((o) => draft.has(o));

  const toggle = (value: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredOptions.forEach((o) => next.delete(o));
      else filteredOptions.forEach((o) => next.add(o));
      return next;
    });
  };

  const isActive = selected.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : openPanel();
        }}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
        title={`Filter ${label}`}
      >
        <Filter className="h-3.5 w-3.5" fill={isActive ? 'currentColor' : 'none'} />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: PANEL_WIDTH, zIndex: 1000 }}
            className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-2 border-b border-border">
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-8"
              />
            </div>

            <div className="flex items-center justify-between px-2 py-1 border-b border-border text-xs">
              <button type="button" className="text-primary hover:underline" onClick={toggleAllFiltered}>
                {allFilteredSelected ? 'Unselect all' : 'Select all'}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setDraft(new Set())}
              >
                Clear
              </button>
            </div>

            <div style={{ maxHeight: PANEL_MAX_HEIGHT }} className="overflow-y-auto p-1">
              {loading ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">Loading…</div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">No values match.</div>
              ) : (
                filteredOptions.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox checked={draft.has(opt)} onCheckedChange={() => toggle(opt)} />
                    <span className="truncate">{opt}</span>
                  </label>
                ))
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border p-2">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  onApply([...draft]);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
