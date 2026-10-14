import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextCell } from './CostingGridCard';
import { CARD_THEME } from './cardTheme';

// ─── CMP COST card (FG articles, shown with the BODY tab) ─────────────────────
// One matrix: process rows × (BGT | ACT | VENDOR | FINAL) × (SAM | SAM VAL | PR VAL).
// CUTTING has no SAM / SAM VAL — only PR VAL. No SAP attribute backs these
// cells, so every value is UI-only local state for now (like PKG COST).

const PROCESSES = ['CUTTING', 'STITCHING', 'IRONING', 'FINISHING'] as const;
const STAGES = ['BGT', 'ACT', 'VENDOR', 'FINAL'] as const;
const MEASURES = ['SAM', 'SAM VAL', 'PR VAL'] as const;

const isNotApplicable = (process: string, measure: string) => process === 'CUTTING' && measure !== 'PR VAL';
const cellKey = (process: string, stage: string, measure: string) => `${process}|${stage}|${measure}`;

// First column of each stage group gets a divider; FINAL is the dark group.
const groupEdge = (stageIdx: number, measureIdx: number) =>
  cn(measureIdx === 0 && (STAGES[stageIdx] === 'FINAL' ? 'border-l-2 border-l-slate-800' : 'border-l-2 border-l-slate-300'));

interface CmpCostCardProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Read-only article (approved/rejected outside modify mode). */
  locked: boolean;
  /** ACT column values auto-filled from precise_body_article_consumption on body article selection. */
  actPreset?: Record<string, string>;
}

const CmpCostCard: React.FC<CmpCostCardProps> = ({ collapsed, onToggleCollapse, locked, actPreset }) => {
  const style = CARD_THEME;
  // UI-only values keyed by "PROCESS|STAGE|MEASURE".
  const [values, setValues] = useState<Record<string, string>>({});

  // Merge incoming ACT preset whenever body article changes.
  useEffect(() => {
    if (!actPreset || Object.keys(actPreset).length === 0) return;
    setValues((prev) => ({ ...prev, ...actPreset }));
  }, [actPreset]);

  return (
    <div className="col-span-full overflow-hidden rounded-lg border-2 bg-white shadow-[var(--shadow-sm)]" style={{ borderColor: style.border }}>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between border-b-2 px-2 py-1.5 transition-colors hover:brightness-110"
        style={{ background: style.bg, borderColor: style.bg, color: style.fg }}
      >
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
          <Scissors className="h-3.5 w-3.5" />
          CMP COST
        </span>
        {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {!collapsed && (
        <>
          <div className="overflow-x-auto px-1.5 pb-1 pt-1">
            <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
              <thead>
                <tr className="text-[10px] font-semibold tracking-wider text-slate-700">
                  <th rowSpan={2} className="w-[110px] border-b border-slate-300 bg-slate-100 px-2.5 py-2 text-left">
                    PROCESS
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
                <tr className="text-[9.5px] font-semibold tracking-wider text-slate-600">
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
                    {STAGES.map((stage, si) =>
                      MEASURES.map((measure, mi) => {
                        const key = cellKey(process, stage, measure);
                        return (
                          <td key={key} className={cn('px-1 py-1', groupEdge(si, mi), stage === 'FINAL' && 'bg-slate-50')}>
                            {isNotApplicable(process, measure) ? (
                              <span className="block text-center text-slate-400">—</span>
                            ) : (
                              <TextCell
                                value={values[key] ?? ''}
                                disabled={locked}
                                numeric
                                placeholder="Req."
                                onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                              />
                            )}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-2.5 py-1.5 text-[10.5px] text-slate-500">
            Cutting has no SAM — only PR VAL. All other cells are required.
          </div>
        </>
      )}
    </div>
  );
};

export default CmpCostCard;
