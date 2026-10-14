import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextCell } from './CostingGridCard';
import { CARD_THEME } from './cardTheme';

// ─── PKG COST card (FG articles) ──────────────────────────────────────────────
// PKG-1 / PKG-2 tabs, each a table of
//   MAT. DESC | ARTICLE NO | ARTICLE DESC | NET RATE
// with fixed material rows. No SAP attribute backs these cells, so every
// value is UI-only local state for now — nothing is written to the DB.

const TABS = ['PKG-1', 'PKG-2'] as const;
const ROWS = ['BOPP', 'CTN', 'BARCODE', 'KIMBLE', 'TAG', 'THREAD'] as const;
type Col = 'artNo' | 'artDesc' | 'rate';

// Default NET RATE per tab per material row.
const DEFAULT_RATES: Record<typeof TABS[number], Record<typeof ROWS[number], string>> = {
  'PKG-1': { BOPP: '1.1', CTN: '2', BARCODE: '1', KIMBLE: '0.5', TAG: '1.5', THREAD: '3' },
  'PKG-2': { BOPP: '1.45', CTN: '26', BARCODE: '1.3', KIMBLE: '0.65', TAG: '1.95', THREAD: '3.9' },
};

const INITIAL_LOCAL: Record<string, Record<string, Partial<Record<Col, string>>>> = {
  'PKG-1': Object.fromEntries(ROWS.map((r) => [r, { rate: DEFAULT_RATES['PKG-1'][r] }])),
  'PKG-2': Object.fromEntries(ROWS.map((r) => [r, { rate: DEFAULT_RATES['PKG-2'][r] }])),
};

const GRID = 'grid grid-cols-[150px_minmax(0,1fr)_minmax(0,2fr)_120px]';


interface PkgCostCardProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Read-only article (approved/rejected outside modify mode). */
  locked: boolean;
}

const PkgCostCard: React.FC<PkgCostCardProps> = ({ collapsed, onToggleCollapse, locked }) => {
  const style = CARD_THEME;
  const [tab, setTab] = useState<string>(TABS[0]);
  // UI-only values: local[tab][row][col]
  const [local, setLocal] = useState<Record<string, Record<string, Partial<Record<Col, string>>>>>(INITIAL_LOCAL);

  const val = (row: string, col: Col) => local[tab]?.[row]?.[col] ?? '';
  const setVal = (row: string, col: Col, v: string) =>
    setLocal((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [row]: { ...prev[tab]?.[row], [col]: v } },
    }));

  const total = ROWS.reduce((sum, r) => sum + (parseFloat(val(r, 'rate')) || 0), 0);

  return (
    <div className="col-span-full overflow-hidden rounded-lg border-2 bg-white shadow-[var(--shadow-sm)]" style={{ borderColor: style.border }}>
      <div className="border-b-2" style={{ background: style.bg, borderColor: style.bg }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-between px-2 py-1.5 transition-colors hover:brightness-95"
        >
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: style.fg }}>
            <Package className="h-3.5 w-3.5" />
            PKG COST
          </span>
          {collapsed ? (
            <ChevronDown className="h-3 w-3" style={{ color: style.fg }} />
          ) : (
            <ChevronUp className="h-3 w-3" style={{ color: style.fg }} />
          )}
        </button>
        {!collapsed && (
          <div role="tablist" className="flex gap-1 px-2">
            {TABS.map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex h-8 items-center px-3 text-[11.5px] font-bold tracking-wide transition-colors',
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
        <div className="overflow-x-auto px-1.5 pb-2 pt-1">
          <div className="min-w-[640px]">
            <div className={cn(GRID, 'border-b border-slate-200 text-[10px] font-semibold tracking-wider text-slate-600')}>
              <div className="px-2.5 py-2">MAT. DESC</div>
              <div className="px-2.5 py-2">ARTICLE NO</div>
              <div className="px-2.5 py-2">ARTICLE DESC</div>
              <div className="px-2.5 py-2 text-right">NET RATE</div>
            </div>
            {ROWS.map((r) => (
              <div key={r} className={cn(GRID, 'items-center border-b border-slate-100')}>
                <div className="px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-800">{r}</div>
                <div className="px-1 py-1.5">
                  <TextCell value={val(r, 'artNo')} disabled={locked} placeholder="Enter" onChange={(v) => setVal(r, 'artNo', v)} />
                </div>
                <div className="px-1 py-1.5">
                  <TextCell value={val(r, 'artDesc')} disabled={locked} placeholder="Enter" onChange={(v) => setVal(r, 'artDesc', v)} />
                </div>
                <div className="px-1 py-1.5">
                  <TextCell value={val(r, 'rate')} disabled={locked} numeric strong placeholder="0.00" onChange={(v) => setVal(r, 'rate', v)} />
                </div>
              </div>
            ))}
            <div className={cn(GRID, 'items-center bg-slate-50')}>
              <div className="col-[1/4] px-2.5 py-2 text-right text-[10px] font-semibold tracking-wider text-slate-600">
                TOTAL NET RATE · {tab}
              </div>
              <div className="px-2.5 py-2 text-right font-mono text-[11.5px] font-semibold tabular-nums text-slate-900">
                {total.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PkgCostCard;
