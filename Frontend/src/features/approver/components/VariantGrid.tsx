import React, { useState } from 'react';
import { Info, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Popconfirm,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';

// ─── Variants grid (design "Option E", 2026-10-12) ────────────────────────────
// Shared by the FG (VariantSubTable), GM (GMVariantTable) and Fabric
// (FabricVariantSubTable) variant tables. Each page keeps its own data
// fetching and rules and passes them in: what can be selected/deleted, how a
// colour is deleted, the status pill, an optional weight column (FG) and an
// optional per-row action (GM/Fabric Edit).
//
// Layout: toolbar (filter tabs · selection actions · page actions), rows
// grouped by colour with a "Delete colour" header, sizes sorted XS → 5XL,
// inherited columns (Maj. Cat, Div, Vendor, Rate, MRP) greyed.

export interface VariantGridRow {
  id: string;
  variantSize?: string | null;
  variantColor?: string | null;
  colour?: string | null;
  majorCategory?: string | null;
  division?: string | null;
  vendorName?: string | null;
  vendorCode?: string | null;
  rate?: number | string | null;
  mrp?: number | string | null;
  sapArticleId?: string | null;
  sapSyncStatus?: string | null;
  sapSyncMessage?: string | null;
}

// ── Size ordering (XS → 5XL, then numeric sizes, then the rest A→Z) ─────────
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const sizeRank = (s: string | null | undefined): number => {
  const k = String(s ?? '').trim().toUpperCase().replace(/^XXL$/, '2XL').replace(/^XXXL$/, '3XL');
  const i = SIZE_ORDER.indexOf(k);
  if (i !== -1) return i;
  const n = parseFloat(k);
  return isNaN(n) ? 10_000 : 100 + n;
};
export const compareSizes = (a: string | null | undefined, b: string | null | undefined) =>
  sizeRank(a) - sizeRank(b) || String(a ?? '').localeCompare(String(b ?? ''));

// ── Status pill ───────────────────────────────────────────────────────────────
const PILL_TONES = {
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
} as const;

export const StatusPill: React.FC<{ tone: keyof typeof PILL_TONES; children: React.ReactNode; tooltip?: string | null; large?: boolean }> = ({
  tone,
  children,
  tooltip,
  large = false,
}) => {
  const pill = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
        large ? 'text-[13px]' : 'text-[11px]',
        PILL_TONES[tone],
        tooltip && 'cursor-help',
      )}
    >
      {children}
      {tooltip && <Info className="h-3 w-3" />}
    </span>
  );
  return tooltip ? (
    <Tooltip title={tooltip} side="top">
      {pill}
    </Tooltip>
  ) : (
    pill
  );
};

interface VariantGridProps<T extends VariantGridRow> {
  variants: T[];
  /** Colour shown when a variant has none of its own (the generic's colour). */
  fallbackColor?: string | null;
  /** Page buttons on the right of the toolbar (Sync Color, Retry, Add Color). */
  toolbarActions: React.ReactNode;
  isSelectable: (v: T) => boolean;
  /** Of the selected rows, which may be deleted. */
  isDeletable: (v: T) => boolean;
  onBulkDelete: (ids: string[]) => Promise<void>;
  /** Whether a colour group shows "Delete colour" (color is upper-cased). */
  canDeleteColor: (color: string, rows: T[]) => boolean;
  onDeleteColor: (color: string) => void;
  deletingColor?: string | null;
  renderStatus: (v: T) => React.ReactNode;
  /** FG only: weight column, "Missing weight" filter and bulk "Set weight…". */
  weight?: {
    renderCell: (v: T) => React.ReactNode;
    isMissing: (v: T) => boolean;
    onBulkSet: (ids: string[], weight: string) => Promise<void>;
  };
  /** GM/Fabric: trailing per-row action (Edit). */
  renderRowAction?: (v: T) => React.ReactNode;
  /** GM: every text size 2px larger. */
  large?: boolean;
}

// Text sizes as whole class names so Tailwind generates both sets.
const FONT = { xs: 'text-[10px]', sm: 'text-[11px]', smd: 'text-[11.5px]', md: 'text-[12px]' } as const;
const FONT_LG = { xs: 'text-[12px]', sm: 'text-[13px]', smd: 'text-[13.5px]', md: 'text-[14px]' } as const;

type Filter = 'all' | 'missing' | 'unsynced';

function VariantGrid<T extends VariantGridRow>({
  variants,
  fallbackColor,
  toolbarActions,
  isSelectable,
  isDeletable,
  onBulkDelete,
  canDeleteColor,
  onDeleteColor,
  deletingColor,
  renderStatus,
  weight,
  renderRowAction,
  large = false,
}: VariantGridProps<T>) {
  const fs = large ? FONT_LG : FONT;
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWeight, setBulkWeight] = useState('');
  const [bulkWeightOpen, setBulkWeightOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const isSynced = (v: T) => !!v.sapArticleId;
  const colorOf = (v: T) => (v.variantColor || v.colour || fallbackColor || '—').toUpperCase();

  const missingCount = weight ? variants.filter((v) => weight.isMissing(v)).length : 0;
  const unsyncedCount = variants.filter((v) => !isSynced(v)).length;

  const visible = variants.filter((v) =>
    filter === 'missing' && weight ? weight.isMissing(v) : filter === 'unsynced' ? !isSynced(v) : true,
  );

  // Group by colour (first-seen order), sizes sorted inside each group.
  const groupMap = new Map<string, T[]>();
  for (const v of visible) {
    const key = colorOf(v);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(v);
  }
  const groups = Array.from(groupMap, ([color, rows]) => ({
    color,
    rows: [...rows].sort((a, b) => compareSizes(a.variantSize, b.variantSize)),
  }));

  const selectableIds = visible.filter(isSelectable).map((v) => v.id);
  const selectedIds = selectableIds.filter((id) => selected.has(id));
  const deletableIds = selectedIds.filter((id) => {
    const v = variants.find((x) => x.id === id);
    return !!v && isDeletable(v);
  });
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (fn: () => Promise<void>) => {
    setBulkBusy(true);
    try {
      await fn();
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const applyBulkWeight = () => {
    const w = bulkWeight.trim();
    if (!weight || !w || selectedIds.length === 0) return;
    void runBulk(async () => {
      await weight.onBulkSet(selectedIds, w);
      setBulkWeight('');
      setBulkWeightOpen(false);
    });
  };

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: variants.length },
    ...(weight ? [{ key: 'missing' as Filter, label: 'Missing weight', count: missingCount }] : []),
    { key: 'unsynced', label: 'Not synced', count: unsyncedCount },
  ];

  // Column template — weight (FG) and row action (GM/Fabric) are optional.
  // Every data column has a minimum width plus a share (fr) of the spare width,
  // so extra space is spread evenly across the row instead of pooling in one
  // column (mid-row gap) or at the end.
  const gridTemplateColumns = [
    '40px',
    'minmax(56px,0.6fr)', // size
    'minmax(110px,1.1fr)', // color
    'minmax(110px,1.1fr)', // maj. cat
    'minmax(70px,0.7fr)', // div
    'minmax(150px,1.6fr)', // vendor
    'minmax(60px,0.6fr)', // rate
    'minmax(60px,0.6fr)', // mrp
    ...(weight ? ['minmax(100px,1fr)'] : []),
    'minmax(170px,1.5fr)', // sap article #
    'minmax(110px,1fr)', // status
    ...(renderRowAction ? ['80px'] : []),
  ].join(' ');
  const gridStyle = { gridTemplateColumns };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Toolbar: filters · selection actions · page actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div role="tablist" aria-label="Filter variants" className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-3 font-semibold transition-colors', fs.md,
                  active ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-white',
                )}
              >
                {f.label}
                <span className={cn('font-medium', fs.sm, active ? 'text-slate-300' : 'text-slate-500')}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {selectedIds.length > 0 && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <span className={cn('font-semibold text-slate-900', fs.md)}>{selectedIds.length} selected</span>
            {weight && (
              <Popover open={bulkWeightOpen} onOpenChange={setBulkWeightOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className={cn('h-7', fs.md)} disabled={bulkBusy}>
                    Set weight…
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-3">
                  <label htmlFor="bulk-weight" className={cn('mb-1.5 block font-semibold text-slate-600', fs.sm)}>
                    Weight for {selectedIds.length} variant{selectedIds.length !== 1 ? 's' : ''} (kg)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="bulk-weight"
                      autoFocus
                      inputMode="decimal"
                      value={bulkWeight}
                      placeholder="e.g. 0.25"
                      onChange={(e) => setBulkWeight(e.target.value.replace(/[^0-9.]/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && applyBulkWeight()}
                      className={cn('h-8 text-right font-mono', fs.md)}
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-slate-800 hover:bg-slate-900"
                      disabled={!bulkWeight.trim() || bulkBusy}
                      onClick={applyBulkWeight}
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {deletableIds.length > 0 && (
              <Popconfirm
                title={`Delete ${deletableIds.length} variant${deletableIds.length !== 1 ? 's' : ''}?`}
                onConfirm={() => void runBulk(() => onBulkDelete(deletableIds))}
                okText="Delete"
                cancelText="Cancel"
              >
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-7 border-red-200 text-red-700 hover:bg-red-50', fs.md)}
                  disabled={bulkBusy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </Popconfirm>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">{toolbarActions}</div>
      </div>

      {variants.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No variants yet. Use "Add Color" to create color variants.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[1180px]">
              {/* Header */}
              <div
                className={cn('grid items-center border-b border-slate-200 bg-slate-50 font-semibold tracking-wider text-slate-600', fs.xs)}
                style={gridStyle}
              >
                <div className="flex justify-center py-2">
                  <Checkbox
                    aria-label="Select all variants"
                    checked={allSelected ? true : selectedIds.length > 0 ? 'indeterminate' : false}
                    disabled={selectableIds.length === 0}
                    onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
                  />
                </div>
                <div className="px-2 py-2">SIZE</div>
                <div className="px-2 py-2">COLOR</div>
                <div className="px-2 py-2">MAJ. CAT</div>
                <div className="px-2 py-2">DIV</div>
                <div className="px-2 py-2">VENDOR</div>
                <div className="px-2 py-2 text-right">RATE</div>
                <div className="px-2 py-2 text-right">MRP</div>
                {weight && (
                  <div className="px-2 py-2">
                    WEIGHT <span className="text-red-600">*</span>
                  </div>
                )}
                <div className="px-2 py-2">SAP ARTICLE #</div>
                <div className="px-2 py-2">STATUS</div>
                {renderRowAction && <div />}
              </div>

              {groups.length === 0 && (
                <div className={cn('px-4 py-5 text-center text-muted-foreground', fs.md)}>No variants match this filter.</div>
              )}

              {groups.map(({ color, rows }) => {
                const all = variants.filter((v) => colorOf(v) === color);
                const syncedInColor = all.filter(isSynced).length;
                return (
                  <React.Fragment key={color}>
                    {/* Colour group header with Delete colour */}
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className={cn('rounded bg-slate-800 px-1.5 py-0.5 font-bold tracking-wide text-white', fs.sm)}>{color}</span>
                        <span className={cn('text-slate-500', fs.smd)}>
                          {all.length} size{all.length !== 1 ? 's' : ''} · {syncedInColor} synced to SAP
                        </span>
                      </span>
                      {canDeleteColor(color, all) && (
                        <Popconfirm
                          title={`Delete all variants for color ${color}?`}
                          onConfirm={() => onDeleteColor(color)}
                          okText="Delete All"
                          cancelText="Cancel"
                        >
                          <button
                            type="button"
                            disabled={deletingColor === color}
                            className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50', fs.smd)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingColor === color ? 'Deleting…' : 'Delete colour'}
                          </button>
                        </Popconfirm>
                      )}
                    </div>

                    {rows.map((v) => {
                      const selectable = isSelectable(v);
                      const isSel = selectable && selected.has(v.id);
                      return (
                        <div
                          key={v.id}
                          className={cn(
                            'grid min-h-[36px] items-center border-b border-slate-100', fs.md,
                            isSel ? 'bg-slate-100' : 'hover:bg-slate-50',
                          )}
                          style={gridStyle}
                        >
                          <div className="flex justify-center">
                            <Checkbox
                              aria-label={`Select variant ${v.variantSize ?? ''}`}
                              checked={isSel}
                              disabled={!selectable}
                              onCheckedChange={() => toggleSelect(v.id)}
                            />
                          </div>
                          <div className="px-2 font-bold text-slate-900">{v.variantSize || '—'}</div>
                          <div className="truncate px-2 font-semibold text-slate-800">
                            {v.variantColor || v.colour || fallbackColor || '—'}
                          </div>
                          {/* Inherited from the article — greyed */}
                          <div className="truncate px-2 text-slate-500">{v.majorCategory || '—'}</div>
                          <div className="truncate px-2 text-slate-500">{v.division || '—'}</div>
                          <div className="truncate px-2 text-slate-500">{v.vendorName || v.vendorCode || '—'}</div>
                          <div className="px-2 text-right font-mono text-slate-500">{v.rate != null ? String(v.rate) : '—'}</div>
                          <div className="px-2 text-right font-mono text-slate-500">{v.mrp != null ? String(v.mrp) : '—'}</div>
                          {weight && <div className="px-1.5">{weight.renderCell(v)}</div>}
                          <div className={cn('px-2 font-mono text-slate-900', fs.md)}>
                            {v.sapArticleId || <span className="text-slate-400">—</span>}
                          </div>
                          <div className="px-2">{renderStatus(v)}</div>
                          {renderRowAction && <div className="flex justify-end px-2">{renderRowAction(v)}</div>}
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className={cn('flex flex-wrap justify-between gap-2 bg-slate-50 px-3 py-2 text-slate-500', fs.smd)}>
            <span>Grey columns are inherited from the article — edit them on the cards above.</span>
            <span>Sorted by size: XS → 5XL</span>
          </div>
        </>
      )}
    </div>
  );
}

export default VariantGrid;
