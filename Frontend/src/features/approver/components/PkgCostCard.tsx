import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Package, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextCell } from './CostingGridCard';
import { CARD_THEME } from './cardTheme';
import { useRegisterUnsavedCard } from './unsavedCards';

// ─── PKG COST card (FG articles) ──────────────────────────────────────────────
// PKG-1 / PKG-2 tabs, each a table of
//   MAT. DESC | ARTICLE NO | ARTICLE DESC | NET RATE
// with fixed material rows. The Save button stores the current tab's NET RATEs
// and the tab itself (pkgCostType) in extraction_results_flat. On load the saved
// tab opens with its DB rates; the other tab shows the default rates.
// ARTICLE NO / ARTICLE DESC are UI-only.

const TABS = ['PKG-1', 'PKG-2'] as const;
const ROWS = ['BOPP', 'CTN', 'BARCODE', 'KIMBLE', 'TAFTA', 'THREAD'] as const;
type Row = typeof ROWS[number];
type Col = 'artNo' | 'artDesc' | 'rate';
type LocalState = Record<string, Record<string, Partial<Record<Col, string>>>>;

export const PKG_RATE_FIELDS: Record<Row, string> = {
  BOPP: 'boppNetPrice',
  CTN: 'ctnNetPrice',
  BARCODE: 'barcodeNetPrice',
  KIMBLE: 'kimbleNetPrice',
  TAFTA: 'taftaNetPrice',
  THREAD: 'threadNetPrice',
};

// Default NET RATE per tab per material row.
const DEFAULT_RATES: Record<typeof TABS[number], Record<Row, string>> = {
  'PKG-1': { BOPP: '1.1', CTN: '2', BARCODE: '1', KIMBLE: '0.5', TAFTA: '1.5', THREAD: '3' },
  'PKG-2': { BOPP: '1.45', CTN: '26', BARCODE: '1.3', KIMBLE: '0.65', TAFTA: '1.95', THREAD: '3.9' },
};

const INITIAL_LOCAL: LocalState = {
  'PKG-1': Object.fromEntries(ROWS.map((r) => [r, { rate: DEFAULT_RATES['PKG-1'][r] }])),
  'PKG-2': Object.fromEntries(ROWS.map((r) => [r, { rate: DEFAULT_RATES['PKG-2'][r] }])),
};

const GRID = 'grid grid-cols-[150px_minmax(0,1fr)_minmax(0,2fr)_120px]';

interface PkgCostCardProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Read-only article (approved/rejected outside modify mode). */
  locked: boolean;
  /** Reads the article fresh from the DB (the parent's copy can be stale). */
  loadSavedRecord?: () => Promise<Record<string, unknown> | null>;
  /** Save button: persists the current tab's net prices + pkgCostType. */
  onSaveTab?: (updates: Record<string, string | null>) => void | Promise<void>;
}

const PkgCostCard: React.FC<PkgCostCardProps> = ({ collapsed, onToggleCollapse, locked, loadSavedRecord, onSaveTab }) => {
  const style = CARD_THEME;
  const [tab, setTab] = useState<string>(TABS[0]);
  const [local, setLocal] = useState<LocalState>(INITIAL_LOCAL);
  const [dirty, setDirty] = useState(false);
  const [savedTab, setSavedTab] = useState<string | null>(null);

  useEffect(() => {
    if (!loadSavedRecord) return;
    let cancelled = false;
    loadSavedRecord().then((rec) => {
      if (!rec || cancelled) return;
      const t = String(rec.pkgCostType ?? '').trim();
      if (!(TABS as readonly string[]).includes(t)) return;
      setTab(t);
      setSavedTab(t);
      setLocal((prev) => ({
        ...prev,
        [t]: Object.fromEntries(
          ROWS.map((r) => {
            const v = rec[PKG_RATE_FIELDS[r]];
            return [r, { ...prev[t]?.[r], rate: v == null || v === '' ? '' : String(Number(v)) }];
          }),
        ),
      }));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const val = (row: string, col: Col) => local[tab]?.[row]?.[col] ?? '';
  const setVal = (row: string, col: Col, v: string) => {
    setLocal((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [row]: { ...prev[tab]?.[row], [col]: v } },
    }));
    if (col === 'rate') setDirty(true);
  };

  const handleSave = async () => {
    if (!onSaveTab) return;
    const updates: Record<string, string | null> = { pkgCostType: tab };
    for (const r of ROWS) updates[PKG_RATE_FIELDS[r]] = val(r, 'rate') || null;
    setDirty(false);
    try {
      await onSaveTab(updates);
    } catch (e) {
      setDirty(true);
      throw e;
    }
    setSavedTab(tab);
  };
  useRegisterUnsavedCard('PKG COST', dirty && !!onSaveTab && !locked, handleSave);

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
          <div className="flex items-end justify-between gap-2 px-2">
            <div role="tablist" className="flex gap-1">
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
                      'flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-bold tracking-wide transition-colors',
                      active ? 'rounded-t-md bg-white text-slate-900 shadow-[inset_0_-2px_0_#1e293b]' : 'opacity-80 hover:opacity-100',
                    )}
                    style={active ? undefined : { color: style.fg }}
                  >
                    {t}
                    {savedTab === t && (
                      <span
                        className={cn(
                          'rounded px-1 py-px text-[10px] font-semibold tracking-wider',
                          active ? 'bg-slate-200 text-slate-700' : 'bg-white/20',
                        )}
                        title="This tab's values are the ones saved"
                      >
                        SAVED
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {onSaveTab && (
              <div className="flex items-center gap-2 pb-1">
                {dirty && (
                  <span className="text-[10.5px] font-medium" style={{ color: style.fg, opacity: 0.8 }}>
                    Unsaved changes
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { handleSave().catch(() => {}); }}
                  disabled={locked}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-white px-3 text-[12.5px] font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save {tab}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="overflow-x-auto px-1.5 pb-2 pt-1">
          <div className="min-w-[640px]">
            <div className={cn(GRID, 'border-b border-slate-200 text-[11px] font-semibold tracking-wider text-slate-600')}>
              <div className="px-2.5 py-2">MAT. DESC</div>
              <div className="px-2.5 py-2">ARTICLE NO</div>
              <div className="px-2.5 py-2">ARTICLE DESC</div>
              <div className="px-2.5 py-2 text-right">NET RATE</div>
            </div>
            {ROWS.map((r) => (
              <div key={r} className={cn(GRID, 'items-center border-b border-slate-100')}>
                <div className="px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-800">{r}</div>
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
              <div className="col-[1/4] px-2.5 py-2 text-right text-[11px] font-semibold tracking-wider text-slate-600">
                TOTAL NET RATE · {tab}
              </div>
              <div className="px-2.5 py-2 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-900">
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
