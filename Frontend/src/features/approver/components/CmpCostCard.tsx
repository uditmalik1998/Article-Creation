import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Save, Scissors, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextCell } from './CostingGridCard';
import { CARD_THEME } from './cardTheme';
import { useRegisterUnsavedCard } from './unsavedCards';

// ─── CMP COST card (FG articles, shown with the BODY tab) ─────────────────────
// One matrix: process rows × AI SAM (read-only) + (BGT | ACT | VENDOR | FINAL) × (SAM | SAM VAL | PR VAL).
// CUTTING has no SAM / SAM VAL — only PR VAL.
// PR VAL cells are saved to extraction_results_flat only when Save is clicked;
// SAM/SAM VAL are UI-only. The TOTAL row is the sum of each stage's PR VAL; typing
// in a TOTAL cell overrides it, clearing it goes back to the sum.

const PROCESSES = ['CUTTING', 'STITCHING', 'IRONING', 'FINISHING'] as const;
const STAGES = ['BGT', 'ACT', 'VENDOR', 'FINAL'] as const;
const MEASURES = ['SAM', 'SAM VAL', 'PR VAL'] as const;

const isNotApplicable = (process: string, measure: string) => process === 'CUTTING' && measure !== 'PR VAL';
const cellKey = (process: string, stage: string, measure: string) => `${process}|${stage}|${measure}`;

// Maps PR VAL cell keys → ApproverItem field names (also used as the update key sent to onSave).
export const PR_VAL_FIELD: Record<string, string> = {
  'CUTTING|BGT|PR VAL':      'cuttingBgtPrVal',
  'CUTTING|ACT|PR VAL':      'cuttingActPrVal',
  'CUTTING|VENDOR|PR VAL':   'cuttingVendorPrVal',
  'CUTTING|FINAL|PR VAL':    'cuttingFinalPrVal',
  'STITCHING|BGT|PR VAL':    'stitchingBgtPrVal',
  'STITCHING|ACT|PR VAL':    'stitchingActPrVal',
  'STITCHING|VENDOR|PR VAL': 'stitchingVendorPrVal',
  'STITCHING|FINAL|PR VAL':  'stitchingFinalPrVal',
  'IRONING|BGT|PR VAL':      'ironingBgtPrVal',
  'IRONING|ACT|PR VAL':      'ironingActPrVal',
  'IRONING|VENDOR|PR VAL':   'ironingVendorPrVal',
  'IRONING|FINAL|PR VAL':    'ironingFinalPrVal',
  'FINISHING|BGT|PR VAL':    'finishingBgtPrVal',
  'FINISHING|ACT|PR VAL':    'finishingActPrVal',
  'FINISHING|VENDOR|PR VAL': 'finishingVendorPrVal',
  'FINISHING|FINAL|PR VAL':  'finishingFinalPrVal',
};

// TOTAL row cell key → ApproverItem field.
export const TOTAL_PR_VAL_FIELD: Record<string, string> = {
  'TOTAL|BGT|PR VAL':    'totalBgtPrVal',
  'TOTAL|ACT|PR VAL':    'totalActPrVal',
  'TOTAL|VENDOR|PR VAL': 'totalVendorPrVal',
  'TOTAL|FINAL|PR VAL':  'totalFinalPrVal',
};

const toNum = (v: string | undefined) => {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};
const fmtNum = (n: number) => String(Number(n.toFixed(4)));

// Sum of a stage's PR VAL cells, or '' when none are filled.
const sumPrVal = (values: Record<string, string>, stage: string): string => {
  const nums = PROCESSES.map((p) => toNum(values[cellKey(p, stage, 'PR VAL')])).filter((n): n is number => n !== null);
  return nums.length ? fmtNum(nums.reduce((a, b) => a + b, 0)) : '';
};

const groupEdge = (stageIdx: number, measureIdx: number) =>
  cn(measureIdx === 0 && (STAGES[stageIdx] === 'FINAL' ? 'border-l-2 border-l-slate-800' : 'border-l-2 border-l-slate-300'));

interface CmpCostCardProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  locked: boolean;
  /** ACT PR VAL auto-filled from precise_body_article_consumption. Presets only apply if no saved value exists. */
  actPreset?: Record<string, string>;
  /** BGT PR VAL auto-filled from rough_cmp_cost_master by major category. Presets only apply if no saved value exists. */
  bgtPreset?: Record<string, string>;
  /** Persisted PR VAL values loaded from the article record. Keyed by cell key, e.g. 'CUTTING|BGT|PR VAL'. */
  savedPrVals?: Record<string, string>;
  /** Save button: receives every PR VAL field (ApproverItem names) with its current value. */
  onSave?: (updates: Record<string, string | null>) => void | Promise<void>;
  /** Presets filled PR VALs that aren't in the DB yet — shown as unsaved. */
  hasUnsavedPreset?: boolean;
  /** Read-only AI SAM per process (ai_cmp_cost_*). Missing → "—". */
  aiSam?: Partial<Record<(typeof PROCESSES)[number], string>>;
}

const CmpCostCard: React.FC<CmpCostCardProps> = ({
  collapsed,
  onToggleCollapse,
  locked,
  actPreset,
  bgtPreset,
  savedPrVals,
  onSave,
  hasUnsavedPreset,
  aiSam,
}) => {
  const style = CARD_THEME;
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  // Stages whose TOTAL was typed by the user (otherwise TOTAL = live sum of PR VAL).
  const [manualTotals, setManualTotals] = useState<Set<string>>(new Set());

  // Initialize from saved DB values on mount / when the article changes.
  // Only apply non-empty saved values so preset-filled cells aren't wiped when
  // a sibling PR VAL is saved (item updates → savedPrVals recomputes with nulls for others).
  useEffect(() => {
    if (!savedPrVals) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(savedPrVals)) {
        if (v !== '') next[k] = v;
      }
      return next;
    });
    // A saved TOTAL that differs from the saved PR VALs' sum was an override.
    setManualTotals(
      new Set(
        STAGES.filter((stage) => {
          const saved = toNum(savedPrVals[cellKey('TOTAL', stage, 'PR VAL')]);
          const sum = toNum(sumPrVal(savedPrVals, stage));
          return saved !== null && (sum === null || Math.abs(saved - sum) > 0.00005);
        }),
      ),
    );
  }, [savedPrVals]);

  // Presets arrive already resolved by the parent: PR VALs saved in the DB win over master
  // values, so every non-empty preset value is applied as-is.
  useEffect(() => {
    if (!bgtPreset) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(bgtPreset)) if (v !== '') next[k] = v;
      return next;
    });
  }, [bgtPreset]);

  useEffect(() => {
    if (!actPreset) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(actPreset)) if (v !== '') next[k] = v;
      return next;
    });
  }, [actPreset]);

  // TOTAL of AI SAM: sum of the processes that have a value, or '' when none do.
  const aiSamTotal = (() => {
    const nums = PROCESSES.map((p) => toNum(aiSam?.[p])).filter((n): n is number => n !== null);
    return nums.length ? fmtNum(nums.reduce((a, b) => a + b, 0)) : '';
  })();
  const aiCell = (v: string | undefined, bold = false) =>
    toNum(v) !== null
      ? <span className={cn('block text-center font-mono text-[12.5px] text-slate-900', bold ? 'font-extrabold' : 'font-bold')}>{v}</span>
      : <span className="block text-center text-slate-400">—</span>;
  const AI_COL = 'w-[96px] border-l-2 border-l-slate-300 bg-slate-50';

  const handleChange = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (PR_VAL_FIELD[key] || TOTAL_PR_VAL_FIELD[key]) setDirty(true);
  }, []);

  // TOTAL shown for a stage: the user's override, else the live sum.
  const totalFor = (stage: string) =>
    manualTotals.has(stage) ? values[cellKey('TOTAL', stage, 'PR VAL')] ?? '' : sumPrVal(values, stage);

  const handleTotalChange = (stage: string, v: string) => {
    const key = cellKey('TOTAL', stage, 'PR VAL');
    setManualTotals((prev) => {
      const next = new Set(prev);
      if (v.trim() === '') next.delete(stage);
      else next.add(stage);
      return next;
    });
    handleChange(key, v);
  };

  const handleSave = async () => {
    if (!onSave) return;
    const updates: Record<string, string | null> = {};
    for (const [key, field] of Object.entries(PR_VAL_FIELD)) updates[field] = values[key] || null;
    for (const stage of STAGES) updates[TOTAL_PR_VAL_FIELD[cellKey('TOTAL', stage, 'PR VAL')]] = totalFor(stage) || null;
    setDirty(false);
    try {
      await onSave(updates);
    } catch (e) {
      setDirty(true);
      throw e;
    }
  };
  const unsaved = dirty || !!hasUnsavedPreset;
  useRegisterUnsavedCard('CMP COST', unsaved && !!onSave && !locked, handleSave);

  return (
    <div className="col-span-full overflow-hidden rounded-lg border-2 bg-white shadow-[var(--shadow-sm)]" style={{ borderColor: style.border }}>
      <div className="flex items-center border-b-2" style={{ background: style.bg, borderColor: style.bg, color: style.fg }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-1 self-stretch px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider transition-colors hover:brightness-110"
        >
          <Scissors className="h-3.5 w-3.5" />
          CMP COST
        </button>
        {onSave && !collapsed && (
          <div className="flex items-center gap-2">
            {unsaved && (
              <span className="text-[10.5px] font-medium" style={{ opacity: 0.8 }}>
                Unsaved changes
              </span>
            )}
            <button
              type="button"
              onClick={() => { handleSave().catch(() => {}); }}
              disabled={locked}
              className="flex h-6 items-center gap-1 rounded-md bg-white px-2.5 text-[11px] font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          className="flex items-center self-stretch px-2 py-1.5 transition-colors hover:brightness-110"
        >
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="overflow-x-auto px-1.5 pb-1 pt-1">
            <table className="w-full min-w-[956px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wider text-slate-700">
                  <th rowSpan={2} className="w-[110px] border-b border-slate-300 bg-slate-100 px-2.5 py-2 text-left">
                    PROCESS
                  </th>
                  <th rowSpan={2} className={cn(AI_COL, 'border-b border-slate-300 bg-slate-100 px-1.5 py-1.5 text-center')}>
                    <span className="flex items-center justify-center gap-1 text-slate-800">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      AI SAM
                    </span>
                    <span className="block text-[9.5px] font-medium normal-case tracking-normal text-slate-500">read-only</span>
                  </th>
                  {STAGES.map((stage) => (
                    <th
                      key={stage}
                      colSpan={MEASURES.length}
                      className={cn(
                        'px-2 py-1.5 text-center',
                        stage === 'FINAL'
                          ? 'border-l-2 border-l-slate-800 bg-slate-800 text-slate-50'
                          : 'border-l-2 border-l-slate-300 bg-slate-100',
                      )}
                    >
                      {stage}
                    </th>
                  ))}
                </tr>
                <tr className="text-[10.5px] font-semibold tracking-wider text-slate-600">
                  {STAGES.map((stage, si) =>
                    MEASURES.map((measure, mi) => (
                      <th
                        key={`${stage}-${measure}`}
                        className={cn('border-b border-slate-300 px-1.5 py-1.5 text-center', groupEdge(si, mi), stage === 'FINAL' && 'bg-slate-50')}
                      >
                        {measure}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {PROCESSES.map((process) => (
                  <tr key={process} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-2.5 py-1.5 font-semibold text-slate-800">{process}</td>
                    <td className={cn(AI_COL, 'px-1 py-1')}>{aiCell(aiSam?.[process])}</td>
                    {STAGES.map((stage, si) =>
                      MEASURES.map((measure, mi) => {
                        const key = cellKey(process, stage, measure);
                        const isPrVal = measure === 'PR VAL';
                        return (
                          <td key={key} className={cn('px-1 py-1', groupEdge(si, mi), stage === 'FINAL' && 'bg-slate-50')}>
                            {isNotApplicable(process, measure) ? (
                              <span className="block text-center text-slate-400">—</span>
                            ) : (
                              <TextCell
                                value={values[key] ?? ''}
                                disabled={locked || (!isPrVal && false)}
                                numeric
                                placeholder="Req."
                                onChange={(v) => handleChange(key, v)}
                              />
                            )}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 bg-slate-50/60">
                  <td className="px-2.5 py-1.5 font-bold text-slate-900">TOTAL</td>
                  <td className={cn(AI_COL, 'px-1 py-1')}>{aiCell(aiSamTotal, true)}</td>
                  {STAGES.map((stage, si) =>
                    MEASURES.map((measure, mi) => {
                      const key = cellKey('TOTAL', stage, measure);
                      return (
                        <td key={key} className={cn('px-1 py-1', groupEdge(si, mi), stage === 'FINAL' && 'bg-slate-50')}>
                          {measure === 'PR VAL' ? (
                            <TextCell
                              value={totalFor(stage)}
                              disabled={locked}
                              numeric
                              placeholder="—"
                              onChange={(v) => handleTotalChange(stage, v)}
                            />
                          ) : (
                            <span className="block text-center text-slate-400">—</span>
                          )}
                        </td>
                      );
                    }),
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-2.5 py-1.5 text-[11.5px] text-slate-500">
            Cutting has no SAM — only PR VAL. AI SAM is for reference only. All other cells are required. TOTAL = sum of PR VAL (type to override, clear to go back to the sum).
          </div>
        </>
      )}
    </div>
  );
};

export default CmpCostCard;
