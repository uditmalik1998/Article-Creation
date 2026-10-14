import React, { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import { Input, Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { APP_CONFIG } from '../../../constants/app/config';

// ─── Costing grid cards (FG articles) ─────────────────────────────────────────
// Option B layout shared by B TRIM (group 'VA ACC.') and V. ADD ('VA PRCS'):
//   <ITEM> | TYPE | STYLE | <3rd spec col> | DESC | AUTO-BGT | ROUGH-V2 | VDR COST | FINAL COST
// with SPECIFICATION / COSTING column-group headers, optional tabs and an
// optional collapsible "other" block (closed by default).
//
// Cells that map to an existing SAP attribute (config.cellMap) are dropdowns
// of that attribute's allowed values on every tab. Persistence: only the
// FIRST tab's mapped cells are saved — through the card's normal handleSave,
// so SAP sync is unchanged. Every other cell (other tabs' picks, other-block
// rows, costs, unmapped cells) is UI-only local state for now — nothing is
// written to the DB.

type AttrValue = { shortForm: string; fullForm?: string | null };
export type CostingGridAttr = { field: string; label: string; values: AttrValue[] };

type SpecCol = 'type' | 'style' | 'c3';
type Col = SpecCol | 'rough' | 'vdr' | 'fin';
type RowState = Partial<Record<Col, string>>;

export interface CostingGridConfig {
  title: string;
  /** Header of the first (row-name) column. */
  itemLabel: string;
  /** Header of the 3rd specification column (CLR / PLACEMENT). */
  c3Label: string;
  /** Tabs; one entry = no tab strip. The first tab is the one saved to SAP. */
  tabs: readonly string[];
  fixedRows: readonly string[];
  /** Collapsible block under the table (closed by default). */
  other?: { label: string; rows: readonly string[] };
  /** row → column → item field of the SAP attribute behind that cell. */
  cellMap: Record<string, Partial<Record<SpecCol, string>>>;
  /** Tailwind grid template (literal class so Tailwind picks it up). */
  grid: string;
}

export const BTRIM_CONFIG: CostingGridConfig = {
  title: 'B TRIM',
  itemLabel: 'BT DESCRIPTION',
  c3Label: 'CLR',
  tabs: ['BT-01', 'BT-02'],
  fixedRows: ['M_BTN', 'DC', 'ZIP', 'PATCH', 'H-TRF'],
  other: { label: 'OTHER ACC', rows: ['ELASTIC', 'FUSING', 'BADGE', 'RIVET', 'TAPE', 'OTHER'] },
  // M_BTN_TYPE values (POLY_BTN, KUNDI_BTN…) are button styles, so they sit
  // in the STYLE column; the button size (e.g. 26L) is TYPE.
  cellMap: {
    M_BTN: { style: 'button', c3: 'btnColour' },          // M_BTN_TYPE, M_BTN_CLR
    DC: { type: 'dcShape', style: 'drawcord' },           // M_DC_SHAPE, M_DC_STYLE
    ZIP: { type: 'zipper', c3: 'zipColour' },             // M_ZIP_TYPE, M_ZIP_COL
    PATCH: { type: 'patches', style: 'patchesType' },     // M_PATCHE_TYPE, M_PATCH_STYLE
    'H-TRF': { type: 'htrfType', style: 'htrfStyle' },    // M_HTRF_TYPE, M_HTRF_STYLE
  },
  grid: 'grid grid-cols-[150px_110px_minmax(0,1.3fr)_90px_minmax(0,1.5fr)_88px_92px_92px_100px]',
};

export const VADD_CONFIG: CostingGridConfig = {
  title: 'V. ADD',
  itemLabel: 'V. ADD',
  c3Label: 'PLACEMENT',
  tabs: ['V. ADD'],
  fixedRows: ['PRINT', 'EMB', 'WASHING'],
  cellMap: {
    PRINT: { type: 'printType', style: 'printStyle', c3: 'printPlacement' },  // M_PRINT_TYPE/STYLE/PLACEMENT
    EMB: { type: 'embroidery', style: 'embroideryType', c3: 'embPlacement' }, // M_EMB_TYPE, M_EMBROIDERY_STYLE, M_EMB_PLACEMENT
    WASHING: { type: 'wash' },                                                // M_WASH
  },
  grid: 'grid grid-cols-[150px_130px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_88px_92px_92px_100px]',
};

/** Item fields a config's table covers (the rest of the group renders as normal rows). */
export const gridFields = (config: CostingGridConfig) =>
  new Set(Object.values(config.cellMap).flatMap((m) => Object.values(m) as string[]));

interface CostingGridCardProps {
  config: CostingGridConfig;
  icon?: React.ReactNode;
  style: { bg: string; fg: string; border: string };
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** The group's attrs (from the attribute config) — used to bind SAP cells. */
  attrs: CostingGridAttr[];
  getValue: (field: string) => string | null;
  onSave: (field: string, value: string | null) => void;
  isFieldLocked: (field: string) => boolean;
  /** Read-only article (approved/rejected outside modify mode). */
  locked: boolean;
  /** Any other attrs in this group that the table doesn't cover. */
  extraRows?: React.ReactNode;
  /** When true, each spec-cell change triggers a precise_trim_master lookup (by attribute name + value) and fills AUTO-BGT. */
  enablePreciseTrimLookup?: boolean;
}

const SelectCell: React.FC<{
  value: string | null;
  options: AttrValue[];
  disabled: boolean;
  onPick: (v: string | null) => void;
}> = ({ value, options, disabled, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const empty = !value || !value.trim();
  const lower = q.trim().toLowerCase();
  const matches = lower
    ? options.filter((o) => o.shortForm.toLowerCase().includes(lower) || (o.fullForm ?? '').toLowerCase().includes(lower))
    : options;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-7 w-full items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11.5px] hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-700 disabled:cursor-default disabled:bg-slate-50 disabled:hover:border-slate-200"
        >
          <span className={cn('truncate', empty ? 'text-slate-400' : 'font-medium text-slate-900')}>
            {empty ? (disabled ? '—' : 'Select') : value}
          </span>
          {!disabled && <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <div className="flex items-center border-b px-2 py-1.5">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
          >
            <X className="h-3 w-3 shrink-0" />
            Clear selection
          </button>
        )}
        <div className="max-h-56 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">No options found</div>
          ) : (
            matches.map((o) => (
              <button
                key={o.shortForm}
                type="button"
                onClick={() => {
                  onPick(o.shortForm);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col px-3 py-1.5 text-left text-[11px] hover:bg-slate-100',
                  o.shortForm === value && 'bg-slate-100',
                )}
              >
                <span className="font-medium">{o.shortForm}</span>
                {o.fullForm && o.fullForm !== o.shortForm && (
                  <span className="truncate text-[10px] text-muted-foreground">{o.fullForm}</span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const TextCell: React.FC<{
  value: string;
  disabled: boolean;
  numeric?: boolean;
  strong?: boolean;
  placeholder: string;
  onChange: (v: string) => void;
}> = ({ value, disabled, numeric, strong, placeholder, onChange }) => (
  <Input
    value={value}
    disabled={disabled}
    inputMode={numeric ? 'decimal' : undefined}
    placeholder={disabled ? '—' : placeholder}
    onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)}
    className={cn(
      'h-7 rounded-md border-slate-200 px-2 text-[11.5px] focus-visible:ring-1 focus-visible:ring-slate-700',
      numeric && 'text-right font-mono tabular-nums',
      strong && 'border-slate-300 font-semibold',
    )}
  />
);

const CostingGridCard: React.FC<CostingGridCardProps> = ({
  config,
  icon,
  style,
  collapsed,
  onToggleCollapse,
  attrs,
  getValue,
  onSave,
  isFieldLocked,
  locked,
  extraRows,
  enablePreciseTrimLookup,
}) => {
  const { grid: GRID, tabs, fixedRows, other, cellMap } = config;
  const [tab, setTab] = useState<string>(tabs[0]);
  const [otherOpen, setOtherOpen] = useState(false);
  // UI-only values: local[tab][row][col]
  const [local, setLocal] = useState<Record<string, Record<string, RowState>>>({});
  // AUTO-BGT from precise_trim_master: row → { bt1, bt2 }
  const [autoBgt, setAutoBgt] = useState<Record<string, { bt1: string; bt2: string }>>({});
  const [autoBgtLoading, setAutoBgtLoading] = useState<Record<string, boolean>>({});

  // attributeName = SAP field from cellMap (e.g. "drawcord" for M_DC_STYLE), value = selected shortForm
  const lookupPreciseTrim = useCallback(async (row: string, attributeName: string, value: string) => {
    if (!enablePreciseTrimLookup || !attributeName || !value) return;
    setAutoBgtLoading((prev) => ({ ...prev, [row]: true }));
    try {
      const token = localStorage.getItem('authToken');
      const url = `${APP_CONFIG.api.baseURL}/admin/precise-trim-master/lookup?attributeName=${encodeURIComponent(attributeName)}&type=${encodeURIComponent(value)}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json();
      if (data.success && data.data) {
        setAutoBgt((prev) => ({
          ...prev,
          [row]: {
            bt1: data.data.bt1 !== null ? String(data.data.bt1) : '',
            bt2: data.data.bt2 !== null ? String(data.data.bt2) : '',
          },
        }));
      }
    } catch {
      // silent — AUTO-BGT just stays as-is
    } finally {
      setAutoBgtLoading((prev) => ({ ...prev, [row]: false }));
    }
  }, [enablePreciseTrimLookup]);

  const attrByField = new Map(attrs.map((a) => [a.field, a]));

  // SAP attr behind a cell (every tab uses its allowed values as dropdown
  // options) — only if that attr is configured for this article's major category.
  const boundAttr = (row: string, col: Col): CostingGridAttr | null => {
    if (col !== 'type' && col !== 'style' && col !== 'c3') return null;
    const field = cellMap[row]?.[col];
    return field ? attrByField.get(field) ?? null : null;
  };
  // Only the first tab reads/writes the SAP field; other tabs keep picks in local state.
  const savesToSap = (row: string, col: Col) => tab === tabs[0] && !!boundAttr(row, col);

  const localVal = (row: string, col: Col) => local[tab]?.[row]?.[col] ?? '';
  const setLocalVal = (row: string, col: Col, v: string) =>
    setLocal((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [row]: { ...prev[tab]?.[row], [col]: v } },
    }));

  const cellVal = (row: string, col: Col): string => {
    const a = boundAttr(row, col);
    return savesToSap(row, col) && a ? (getValue(a.field) ?? '').trim() : localVal(row, col).trim();
  };

  const renderSpecCell = (row: string, col: SpecCol) => {
    const a = boundAttr(row, col);
    if (a) {
      const toSap = savesToSap(row, col);
      return (
        <SelectCell
          value={toSap ? getValue(a.field) : localVal(row, col)}
          options={a.values ?? []}
          disabled={toSap ? isFieldLocked(a.field) : locked}
          onPick={(v) => {
            if (toSap) onSave(a.field, v); else setLocalVal(row, col, v ?? '');
            if (v) lookupPreciseTrim(row, a.field, v);
          }}
        />
      );
    }
    return (
      <TextCell value={localVal(row, col)} disabled={locked} placeholder="Enter" onChange={(v) => setLocalVal(row, col, v)} />
    );
  };

  const filledCount = (rows: readonly string[]) =>
    rows.filter((r) => (['type', 'style', 'c3', 'rough', 'vdr', 'fin'] as Col[]).some((c) => cellVal(r, c))).length;

  const renderRow = (row: string, last: boolean) => {
    // DESC is auto-built: STYLE-TYPE (e.g. KUNDI_BTN-26L)
    const desc = [cellVal(row, 'style'), cellVal(row, 'type')].filter((p) => p && !/^-+$/.test(p)).join('-');
    const tabIdx = tabs.indexOf(tab);
    const bgt = autoBgt[row];
    const autoBgtVal = bgt ? (tabIdx === 0 ? bgt.bt1 : bgt.bt2) : '';
    const bgtLoading = autoBgtLoading[row];
    return (
      <div key={row} className={cn(GRID, 'items-center', !last && 'border-b border-slate-100')}>
        <div className="px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-800">{row}</div>
        <div className="px-1 py-1.5">{renderSpecCell(row, 'type')}</div>
        <div className="px-1 py-1.5">{renderSpecCell(row, 'style')}</div>
        <div className="px-1 py-1.5">{renderSpecCell(row, 'c3')}</div>
        <div className={cn('truncate px-2.5 py-1.5 font-mono text-[11px]', desc ? 'text-slate-900' : 'text-slate-400')}>
          {desc || '—'}
        </div>
        <div
          className={cn(
            'px-2.5 py-1.5 text-right font-mono text-[11px]',
            bgtLoading ? 'text-slate-300' : autoBgtVal ? 'font-semibold text-slate-900' : 'text-slate-400',
          )}
          title={autoBgtVal ? `AUTO-BGT from precise_trim_master (BT-${tabIdx + 1})` : 'Auto budget — select a spec value'}
        >
          {bgtLoading ? '…' : autoBgtVal || '—'}
        </div>
        <div className="px-1 py-1.5">
          <TextCell value={localVal(row, 'rough')} disabled={locked} numeric placeholder="0.00" onChange={(v) => setLocalVal(row, 'rough', v)} />
        </div>
        <div className="px-1 py-1.5">
          <TextCell value={localVal(row, 'vdr')} disabled={locked} numeric placeholder="0.00" onChange={(v) => setLocalVal(row, 'vdr', v)} />
        </div>
        <div className="px-1 py-1.5">
          <TextCell value={localVal(row, 'fin')} disabled={locked} numeric strong placeholder="0.00" onChange={(v) => setLocalVal(row, 'fin', v)} />
        </div>
      </div>
    );
  };

  return (
    <div className="col-span-full overflow-hidden rounded-lg border-2 bg-white shadow-[var(--shadow-sm)]" style={{ borderColor: style.border }}>
      {/* Header: title + collapse, then underline tabs (when more than one) */}
      <div className="border-b-2" style={{ background: style.bg, borderColor: style.bg }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-between px-2 py-1.5 transition-colors hover:brightness-95"
        >
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: style.fg }}>
            {icon}
            {config.title}
          </span>
          {collapsed ? (
            <ChevronDown className="h-3 w-3" style={{ color: style.fg }} />
          ) : (
            <ChevronUp className="h-3 w-3" style={{ color: style.fg }} />
          )}
        </button>
        {!collapsed && tabs.length > 1 && (
          <div role="tablist" className="flex gap-1 px-2">
            {tabs.map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex h-8 items-center gap-1 px-3 text-[11.5px] font-bold tracking-wide transition-colors',
                    active ? 'rounded-t-md bg-white text-slate-900 shadow-[inset_0_-2px_0_#1e293b]' : 'opacity-80 hover:opacity-100',
                  )}
                  style={active ? undefined : { color: style.fg }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="overflow-x-auto px-1.5 pb-2 pt-1">
            <div className="min-w-[1000px]">
              {/* Column groups */}
              <div className={cn(GRID, 'pt-1.5')}>
                <div className="flex h-6 items-center px-2.5 text-[9.5px] font-bold tracking-[0.1em] text-slate-500">ITEM</div>
                <div className="col-[2/6] mx-0.5 flex h-6 items-center rounded-t-md bg-slate-100 px-2.5 text-[9.5px] font-bold tracking-[0.1em] text-slate-700">
                  SPECIFICATION
                </div>
                <div className="col-[6/10] mx-0.5 flex h-6 items-center rounded-t-md bg-slate-800 px-2.5 text-[9.5px] font-bold tracking-[0.1em] text-slate-50">
                  COSTING
                </div>
              </div>
              <div className={cn(GRID, 'border-b border-slate-200 text-[10px] font-semibold tracking-wider text-slate-600')}>
                <div className="px-2.5 py-2">{config.itemLabel}</div>
                <div className="px-2.5 py-2">TYPE</div>
                <div className="px-2.5 py-2">STYLE</div>
                <div className="px-2.5 py-2">{config.c3Label}</div>
                <div className="px-2.5 py-2">
                  DESC <span className="ml-1 font-medium tracking-normal text-slate-400">auto</span>
                </div>
                <div className="px-2.5 py-2 text-right">AUTO-BGT</div>
                <div className="px-2.5 py-2 text-right">ROUGH-V2</div>
                <div className="px-2.5 py-2 text-right">VDR COST</div>
                <div className="px-2.5 py-2 text-right">FINAL COST</div>
              </div>
              {fixedRows.map((r, i) => renderRow(r, i === fixedRows.length - 1))}
            </div>
          </div>

          {/* Other block — collapsed by default */}
          {other && (
            <div className="mx-2 mb-2 overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                aria-expanded={otherOpen}
                onClick={() => setOtherOpen((o) => !o)}
                className="flex h-10 w-full items-center justify-between bg-slate-50 px-3 text-left hover:bg-slate-100"
              >
                <span className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-slate-700">
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', otherOpen && 'rotate-90')} />
                  {other.label}
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10.5px] font-medium tracking-normal text-slate-600">
                    {filledCount(other.rows)} / {other.rows.length} filled
                  </span>
                </span>
                <span className="hidden text-[11px] text-slate-500 sm:inline">
                  {otherOpen ? 'Click to collapse' : other.rows.join(' · ')}
                </span>
              </button>
              {otherOpen && (
                <div className="overflow-x-auto bg-white px-1.5 pb-1">
                  <div className="min-w-[1000px]">
                    {other.rows.map((r, i) => (
                      <div key={r} className={cn(i > 0 && 'border-t border-slate-100')}>
                        {renderRow(r, true)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {extraRows && <div className="space-y-0 border-t border-slate-100 p-1">{extraRows}</div>}
        </>
      )}
    </div>
  );
};

export default CostingGridCard;
