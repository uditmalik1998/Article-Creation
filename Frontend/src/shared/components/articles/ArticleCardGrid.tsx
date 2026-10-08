import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Tag } from 'lucide-react';
import { Button } from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { formatRupees, toAmount, type ArticleCardItem } from './ArticleSpecCard';
import { ACTIVE_SEGMENT_CLASS } from './ArticleFilters';

export type ArticleGroupBy = 'none' | 'vendor' | 'category';

const GROUP_BY_OPTIONS: { value: ArticleGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'category', label: 'Category' },
];

const isGroupBy = (v: unknown): v is ArticleGroupBy => v === 'none' || v === 'vendor' || v === 'category';

/** Responsive card columns; shared with the loading skeleton so nothing jumps. */
export const ARTICLE_CARD_GRID_CLASS = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(380px,100%),1fr))]';

/**
 * The dashboard's "Group by" choice. Seeded from the URL (?groupBy=) so links
 * and Back keep it, then from the user's last choice on this dashboard, then
 * 'none'. Each change is remembered in localStorage under `storageKey`.
 */
export function useArticleGroupBy(storageKey: string, urlValue: string | null) {
  const [groupBy, setGroupByState] = useState<ArticleGroupBy>(() => {
    if (isGroupBy(urlValue)) return urlValue;
    try {
      const stored = localStorage.getItem(storageKey);
      if (isGroupBy(stored)) return stored;
    } catch { /* storage unavailable */ }
    return 'none';
  });

  const setGroupBy = useCallback((value: ArticleGroupBy) => {
    setGroupByState(value);
    try { localStorage.setItem(storageKey, value); } catch { /* storage unavailable */ }
  }, [storageKey]);

  return [groupBy, setGroupBy] as const;
}

/** Segmented None / Vendor / Category switch sized for the dashboards' filter row. */
export function GroupByControl({ value, onChange }: { value: ArticleGroupBy; onChange: (value: ArticleGroupBy) => void }) {
  return (
    <div role="group" aria-label="Group cards by" className="flex h-9 items-center gap-0.5 rounded-md border border-input bg-background p-0.5 text-[13px]">
      <span className="px-1.5 text-muted-foreground">Group by</span>
      {GROUP_BY_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-full rounded-sm px-2.5 font-medium transition-colors',
            value === o.value
              ? ACTIVE_SEGMENT_CLASS
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface CardGroup<T> {
  key: string;
  title: string;
  subtitle: string | null;
  entries: { item: T; index: number }[];
}

function buildGroups<T extends ArticleCardItem>(items: T[], groupBy: Exclude<ArticleGroupBy, 'none'>): CardGroup<T>[] {
  const groups = new Map<string, CardGroup<T>>();
  items.forEach((item, index) => {
    const key = groupBy === 'vendor'
      ? (item.vendorCode || item.vendorName || '').trim().toUpperCase()
      : (item.majorCategory || '').trim().toUpperCase();
    let group = groups.get(key);
    if (!group) {
      group = groupBy === 'vendor'
        ? { key, title: item.vendorName || 'Unknown vendor', subtitle: item.vendorCode ? `Code ${item.vendorCode}` : null, entries: [] }
        : { key, title: item.majorCategory || 'Uncategorised', subtitle: null, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ item, index });
  });
  return Array.from(groups.values());
}

function initialsOf(name: string): string {
  const words = name.replace(/[^A-Z0-9 ]/gi, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

export interface ArticleCardGridProps<T extends ArticleCardItem> {
  items: T[];
  groupBy: ArticleGroupBy;
  selectedIds: Set<string>;
  /** Select (true) or deselect (false) every id in `ids` — used by a group's "Select all". */
  onSetSelection: (ids: string[], selected: boolean) => void;
  /** `index` is the item's position in `items`, as the detail page navigation expects. */
  renderCard: (item: T, index: number) => ReactNode;
}

/**
 * Lays the cards out flat, or in collapsible vendor / major-category groups.
 * The list endpoints sort by the same key when grouped, so a group stays
 * together across pages; grouping here only splits the current page.
 */
export function ArticleCardGrid<T extends ArticleCardItem>({
  items, groupBy, selectedIds, onSetSelection, renderCard,
}: ArticleCardGridProps<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => (groupBy === 'none' ? [] : buildGroups(items, groupBy)), [items, groupBy]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  if (groupBy === 'none') {
    return (
      <div className={cn(ARTICLE_CARD_GRID_CLASS, 'p-3')}>
        {items.map((item, index) => renderCard(item, index))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {groups.map((group) => {
        const open = !collapsed.has(group.key);
        const ids = group.entries.map((e) => e.item.id);
        const allSelected = ids.every((id) => selectedIds.has(id));
        const costs = group.entries.map((e) => toAmount(e.item.rate)).filter((n): n is number => n !== null);
        const lo = costs.length ? Math.min(...costs) : null;
        const hi = costs.length ? Math.max(...costs) : null;
        const missingMrp = group.entries.filter((e) => toAmount(e.item.rate) !== null && toAmount(e.item.mrp) === null).length;
        const meta = [
          group.subtitle,
          `${ids.length} ${ids.length === 1 ? 'article' : 'articles'}`,
          lo !== null ? `Cost ${lo === hi ? formatRupees(lo) : `${formatRupees(lo)}–${formatRupees(hi)}`}` : null,
        ].filter(Boolean).join(' · ');

        return (
          <section key={group.key || '__none__'} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
              <button
                type="button"
                onClick={() => toggleCollapsed(group.key)}
                aria-expanded={open}
                className="flex min-h-9 min-w-0 flex-[1_1_320px] items-center gap-3 text-left"
              >
                <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-extrabold text-primary">
                  {groupBy === 'vendor' ? initialsOf(group.title) : <Tag className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-extrabold tracking-tight text-foreground">{group.title}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">{meta}</span>
                </span>
              </button>
              {missingMrp > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  {missingMrp} missing MRP
                </span>
              )}
              <Button size="sm" variant="outline" className="h-8 px-3 text-[12px]" onClick={() => onSetSelection(ids, !allSelected)}>
                {allSelected ? 'Deselect all' : `Select all ${ids.length}`}
              </Button>
            </div>
            {open && (
              <div className={cn(ARTICLE_CARD_GRID_CLASS, 'border-t border-border bg-muted/30 p-3')}>
                {group.entries.map(({ item, index }) => renderCard(item, index))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
