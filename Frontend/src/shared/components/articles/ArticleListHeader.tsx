/**
 * ArticleListHeader — the two-row header shared by the article list dashboards
 * (FG Articles, Fabric Article, FG New Articles, GM Article). Design "Option C".
 *
 *   Row 1 (ink): icon · title · "division · sub-division · N articles";
 *                division tabs on their own line below, on the left.
 *   Row 2 (light; slate while cards are ticked):
 *     left  — "N selected · Clear · Export selected · [Reject selected] · [Revert selected]" or a hint
 *     right — Refresh, then the DOWNLOAD button group.
 */
import type { ReactNode } from 'react';
import { Download, RotateCcw, RotateCw, Sparkles, XCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';

export interface ArticleListDownload {
  key: string;
  label: string;
  onClick: () => void;
  busy?: boolean;
}

interface ArticleListHeaderProps {
  title: string;
  /** e.g. "MENS · MU" — joined with the article count. */
  scope?: string | null;
  totalCount: number;
  /** Division tabs (or nothing) — rendered on their own line under the title. */
  divisionTabs?: ReactNode;
  selectedCount: number;
  onClearSelection: () => void;
  onExportSelected: () => void;
  /** Shown only when given (FG New Articles page). */
  onRejectSelected?: () => void;
  rejecting?: boolean;
  /** Shown only when given (FG Rejected Articles page, ADMIN). */
  onRevertSelected?: () => void;
  reverting?: boolean;
  loading: boolean;
  onRefresh: () => void;
  downloads: ArticleListDownload[];
}

export const ArticleListHeader: React.FC<ArticleListHeaderProps> = ({
  title,
  scope,
  totalCount,
  divisionTabs,
  selectedCount,
  onClearSelection,
  onExportSelected,
  onRejectSelected,
  rejecting,
  onRevertSelected,
  reverting,
  loading,
  onRefresh,
  downloads,
}) => (
  <>
    {/* Row 1 — title, scope, count; division tabs below on the left */}
    <div className="flex flex-col gap-1 px-3 pt-2 text-white" style={{ background: '#1e293b' }}>
      <div className="flex min-w-0 items-center gap-2.5 pb-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-600">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="font-display truncate text-[15px] font-semibold leading-tight tracking-tight">{title}</div>
        <span className="truncate text-[12px] text-slate-300">
          {[scope || null, `${totalCount.toLocaleString('en-IN')} articles`].filter(Boolean).join(' · ')}
        </span>
      </div>
      {divisionTabs || <div className="pb-1" />}
    </div>

    {/* Row 2 — selection actions (left) · Refresh + downloads (right) */}
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5',
        selectedCount > 0 ? 'bg-slate-100' : 'bg-white',
      )}
    >
      <div className="flex min-h-[32px] flex-wrap items-center gap-2 text-[12.5px]">
        {selectedCount > 0 ? (
          <>
            <b className="text-slate-900">{selectedCount} selected</b>
            <button type="button" onClick={onClearSelection} className="text-slate-700 underline underline-offset-2 hover:text-slate-950">
              Clear
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={onExportSelected}
              className="h-8 border-slate-800 bg-white px-3 text-[12.5px] font-semibold text-slate-900 hover:bg-slate-50"
            >
              <Download /> Export selected
            </Button>
            {onRejectSelected && (
              <Button
                size="sm"
                onClick={onRejectSelected}
                disabled={rejecting}
                className="h-8 bg-red-700 px-3 text-[12.5px] font-semibold text-white hover:bg-red-800"
              >
                <XCircle /> Reject selected
              </Button>
            )}
            {onRevertSelected && (
              <Button
                size="sm"
                onClick={onRevertSelected}
                disabled={reverting}
                className="h-8 bg-slate-800 px-3 text-[12.5px] font-semibold text-white hover:bg-slate-900"
              >
                <RotateCcw /> Revert selected
              </Button>
            )}
          </>
        ) : (
          <span className="text-slate-600">
            Tick cards to {onRejectSelected ? 'export or reject' : onRevertSelected ? 'export or revert' : 'export'} them together.
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          className="h-8 border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-800 hover:border-slate-800 hover:bg-slate-50"
        >
          <RotateCw className={cn(loading && 'animate-spin')} /> Refresh
        </Button>
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-600">Download</span>
        <div role="group" aria-label="Downloads" className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
          {downloads.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={d.onClick}
              disabled={d.busy}
              className="flex h-8 items-center gap-1.5 border-r border-slate-200 px-3 text-[12.5px] font-semibold text-slate-800 last:border-r-0 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"
            >
              {d.busy ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  </>
);
