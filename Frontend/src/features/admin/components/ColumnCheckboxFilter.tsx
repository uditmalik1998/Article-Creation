import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Filter, Search, X } from 'lucide-react';

interface ColumnCheckboxFilterProps {
  /** Column label, shown in the panel header and search placeholder. */
  label: string;
  /** All distinct existing values for this column. */
  options: string[];
  loading: boolean;
  /** Currently APPLIED values; empty means "no filter". */
  selected: string[];
  onApply: (values: string[]) => void;
}

const PANEL_WIDTH = 288;
const PANEL_MAX_HEIGHT = 300;
const MARGIN = 8;

/** Bold the part of `text` that matches the search. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-100 px-0.5 text-slate-900">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

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
 *
 * Look: white panel, slate/ink (no coral). Applied values are listed first
 * when the panel opens; each row has an "Only" shortcut; Enter applies and
 * Esc closes.
 */
export function ColumnCheckboxFilter({ label, options, loading, selected, onApply }: ColumnCheckboxFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  // Order frozen at open time (applied values first) so rows don't jump
  // while the user ticks them.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(MARGIN, rect.left - 8), window.innerWidth - PANEL_WIDTH - MARGIN);
    const top = Math.min(rect.bottom + 6, window.innerHeight - 120);
    setCoords({ top, left });
  };

  const openPanel = () => {
    setDraft(new Set(selected));
    setPinned(new Set(selected));
    setSearch('');
    reposition();
    setOpen(true);
  };

  const apply = (values: Set<string>) => {
    onApply([...values]);
    setOpen(false);
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

  const orderedOptions = useMemo(
    () => [...options.filter((o) => pinned.has(o)), ...options.filter((o) => !pinned.has(o))],
    [options, pinned]
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? orderedOptions.filter((o) => o.toLowerCase().includes(q)) : orderedOptions;
  }, [orderedOptions, search]);

  const allFilteredSelected = filteredOptions.length > 0 && filteredOptions.every((o) => draft.has(o));
  const someFilteredSelected = !allFilteredSelected && filteredOptions.some((o) => draft.has(o));

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
  const changed = draft.size !== selected.length || selected.some((v) => !draft.has(v));

  const box = (state: 'on' | 'off' | 'some') => (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        state === 'off'
          ? 'border-slate-300 bg-white group-hover:border-slate-500 dark:border-slate-600 dark:bg-slate-900'
          : 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
      }`}
    >
      {state === 'on' && <Check className="h-3 w-3" strokeWidth={3} />}
      {state === 'some' && <span className="h-0.5 w-2 rounded bg-current" />}
    </span>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : openPanel();
        }}
        className={`relative inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1 transition ${
          isActive
            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
            : open
              ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800'
        }`}
        title={`Filter ${label}`}
        aria-label={isActive ? `Filter ${label} — ${selected.length} selected` : `Filter ${label}`}
        aria-expanded={open}
      >
        <Filter className="h-3.5 w-3.5" fill={isActive ? 'currentColor' : 'none'} />
        {isActive && <span className="text-[10.5px] font-bold tabular-nums">{selected.length}</span>}
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Filter ${label}`}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: PANEL_WIDTH, zIndex: 1000 }}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
                e.preventDefault();
                apply(draft);
              }
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 pb-2 pt-2.5">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-bold">{label}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {loading ? 'Loading values…' : `${draft.size} of ${options.length} selected`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filter"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-3 pb-2">
              <label className="relative block">
                <span className="sr-only">Search {label}</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </label>
            </div>

            {/* Select all (of what's shown) */}
            {!loading && filteredOptions.length > 0 && (
              <button
                type="button"
                onClick={toggleAllFiltered}
                className="group flex w-full items-center gap-2.5 border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300"
              >
                {box(allFilteredSelected ? 'on' : someFilteredSelected ? 'some' : 'off')}
                <span className="flex-1">{search ? `Select all ${filteredOptions.length} matches` : 'Select all'}</span>
                <span className="text-[11px] font-medium text-slate-400">{filteredOptions.length}</span>
              </button>
            )}

            {/* Values */}
            <div style={{ maxHeight: PANEL_MAX_HEIGHT }} className="overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
              {loading ? (
                <div className="space-y-1.5 px-3 py-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12.5px] text-slate-500">No values match “{search}”.</div>
              ) : (
                filteredOptions.map((opt) => {
                  const on = draft.has(opt);
                  return (
                    <div
                      key={opt}
                      role="option"
                      aria-selected={on}
                      className={`group flex items-center gap-2.5 px-3 py-[5px] ${on ? 'bg-slate-100/70 dark:bg-slate-800/60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                    >
                      <button type="button" onClick={() => toggle(opt)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                        {box(on ? 'on' : 'off')}
                        <span className={`truncate font-mono text-[12.5px] ${on ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`} title={opt}>
                          <Highlight text={opt} query={search} />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft(new Set([opt]))}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 opacity-0 hover:bg-slate-200 hover:text-slate-900 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-white"
                        title={`Show only ${opt}`}
                      >
                        Only
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => setDraft(new Set())}
                disabled={draft.size === 0}
                className="text-[12px] font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline dark:text-slate-300"
              >
                Clear
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => apply(draft)}
                disabled={!changed}
                className="h-7 rounded-md bg-slate-800 px-3 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:cursor-default disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
              >
                {draft.size === 0 && isActive ? 'Remove filter' : draft.size > 0 ? `Apply (${draft.size})` : 'Apply'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
