/**
 * Pool B Uploader — Admin page ("job console" layout).
 *
 * Upload a Matnr × characteristic-value Excel (the Deepak "ART" template),
 * PREVIEW what will be written WITHOUT touching SAP, then COMMIT to patch each
 * article's attribute values into SAP (AUSP) via the article patch FM.
 *
 * Small files (≤ batchSize rows): synchronous — results appear immediately.
 * Large files (> batchSize rows): queued async job — page polls for progress
 * and shows batch-by-batch status until the job completes.
 *
 * Both paths end in the same console: a dark progress panel plus a
 * "Needs attention" table built from the per-article results (NIC / Locked /
 * Error), downloadable as .xlsx.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Upload as UploadIcon,
  FileSpreadsheet,
  ShieldAlert,
  Loader2,
  Download,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Copy,
  X,
} from 'lucide-react';
import { message } from '../../../lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import { cn } from '@/lib/utils';

const TEMPLATE_HEADERS = [
  'Matnr', 'M_FAB_DIV', 'M_YARN', 'M_FAB_MAIN_MVGR_1', 'M_FAB_MAIN_MVGR_2', 'M_WEAVE_01',
  'M_WEAVE_02', 'M_COUNT', 'M_GSM', 'M_OUNZ', 'M_CONSTRUCTION', 'M_COMPOSITION', 'M_FINISH',
  'M_WIDTH', 'M_LYCRA', 'M_NECK_TYPE', 'M_NECK_STYLE', 'M_COLLAR_TYPE', 'M_COLLAR_STYLE',
  'M_SLEEVES_MAIN_STYLE', 'M_SLEEVE_FOLD', 'M_SET', 'M_PLACKET', 'M_BLT_TYPE', 'M_BLT_STYLE',
  'M_BTM_FOLD', 'M_POCKET', 'M_NO_OF_POCKET', 'M_EXTRA_POCKET', 'M_LENGTH', 'M_FIT',
  'M_BODY_STYLE', 'M_DC_STYLE', 'M_DC_SHAPE', 'M_ZIP_TYPE', 'M_ZIP_COL', 'M_BTN_TYPE',
  'M_BTN_CLR', 'M_PATCH_STYLE', 'M_PATCHE_TYPE', 'M_HTRF_STYLE', 'M_HTRF_TYPE',
  'M_PRINT_PLACEMENT', 'M_PRINT_STYLE', 'M_PRINT_TYPE', 'M_EMB_TYPE', 'M_EMBROIDERY_STYLE',
  'M_EMB_PLACEMENT', 'M_WASH', 'M_AGE_GROUP', 'M_NO_OF_SIZE', 'M_NO_OF_CLR', 'M_IMP_ATBT',
  'M_FAB_VDR', 'M_REF_ARTICLE', 'M_BODY_ART',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface PreviewData {
  defaultEnv: string;
  batchSize: number;
  willQueue: boolean;
  matnrCount: number;
  attributeColumns: string[];
  totalValueCells: number;
  matnrColumn: string;
  skipped: number;
  warnings: string[];
  sample: { matnr: string; attrs: number; preview: string }[];
}

interface ItemResult {
  matnr: string;
  ok: boolean;
  matkl?: string;
  writtenCount: number;
  nicCount: number;
  lockedCount: number;
  /** Characteristic names SAP refused as not-on-class / locked (newer backends only). */
  nicAttrs?: string[];
  lockedAttrs?: string[];
  errorMessage?: string;
  /** Class the article really sits in when SAP refused to link it to its MC class. */
  linkedClass?: string;
  linkError?: string;
}

interface SyncReport {
  queued: false;
  env: string;
  test: boolean;
  matnrs: number;
  ok: number;
  failed: number;
  totalWritten: number;
  totalNic: number;
  totalLocked: number;
  durationMs: number;
  results: ItemResult[];
}

interface JobBatch {
  id: string;
  batchIndex: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  startRow: number;
  endRow: number;
  rowCount: number;
  successCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  results: ItemResult[] | null;
}

interface JobStatus {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  env: string;
  test: boolean;
  totalRows: number;
  totalBatches: number;
  batchSize: number;
  successRows: number;
  failedRows: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  batches: JobBatch[];
}

type IssueKind = 'NIC' | 'Wrong class' | 'Locked' | 'Error';

interface Issue extends ItemResult {
  kinds: IssueKind[];
  problem: string;
  fix: string;
}

/** What the console shows — the same shape for a sync report and an async job. */
interface ConsoleRun {
  env: string;
  test: boolean;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total: number;
  ok: number;
  failed: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  jobId: string | null;
  batchSize: number | null;
  batches: JobBatch[];
  results: ItemResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JOB_TERMINAL = new Set(['COMPLETED', 'PARTIAL', 'FAILED']);
const POLL_INTERVAL_MS = 3000;

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function elapsed(start: string | null, end: string | null): string {
  if (!start) return '—';
  return formatDuration(new Date(end ?? new Date()).getTime() - new Date(start).getTime());
}

function clockTime(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "M_A, M_B, M_C +2 more" — keeps the Problem cell short. */
function nameList(names: string[] | undefined, max = 4): string {
  if (!names || names.length === 0) return '';
  return names.slice(0, max).join(', ') + (names.length > max ? ` +${names.length - max} more` : '');
}

function toIssue(r: ItemResult): Issue | null {
  const kinds: IssueKind[] = [];
  // A failed article whose only problem is characteristics missing from its
  // class (SAP's "not in any class KSML" atomic-fail) is NIC, not a generic
  // error — the fix is Pool A, not the article.
  const nicOnlyFailure = !r.ok && r.nicCount > 0;
  if (!r.ok && !nicOnlyFailure) kinds.push('Error');
  // NIC because the article still sits in an older class (KSSK) — Pool A on the MC
  // class can't help; the article has to move to its MC class.
  const wrongClass = r.nicCount > 0 && !!r.linkedClass && r.linkedClass !== r.matkl;
  if (r.nicCount > 0) kinds.push(wrongClass ? 'Wrong class' : 'NIC');
  if (r.lockedCount > 0) kinds.push('Locked');
  if (kinds.length === 0) return null;

  const pool = `Run Pool A to add ${r.nicCount !== 1 ? 'them' : 'it'} to class ${r.matkl || '(this MC)'}, then re-upload`;
  if (!r.ok && !nicOnlyFailure) {
    return {
      ...r,
      kinds,
      problem: r.errorMessage || 'SAP rejected the article',
      fix: /not found|does not exist/i.test(r.errorMessage ?? '')
        ? 'Check the article number'
        : 'Fix the cause, then re-upload this article',
    };
  }
  if (wrongClass) {
    const names = nameList(r.nicAttrs);
    return {
      ...r,
      kinds,
      problem:
        `In SAP the article is linked to class ${r.linkedClass}, not its MC ${r.matkl} — ` +
        `${names || `${r.nicCount} characteristic${r.nicCount !== 1 ? 's' : ''}`} not on ${r.linkedClass}` +
        (r.ok ? '' : '; SAP saved nothing for this article'),
      fix: `Move the article to class ${r.matkl} in SAP (CL24N), or run Pool A for class ${r.linkedClass}, then re-upload`,
    };
  }
  if (r.nicCount > 0) {
    const names = nameList(r.nicAttrs);
    return {
      ...r,
      kinds,
      problem:
        `Not on the class${names ? `: ${names}` : ` (${r.nicCount} characteristic${r.nicCount !== 1 ? 's' : ''})`}` +
        (r.ok ? '' : ' — SAP saved nothing for this article'),
      fix: pool,
    };
  }
  const locked = nameList(r.lockedAttrs);
  return {
    ...r,
    kinds,
    problem: `Locked, ignored${locked ? `: ${locked}` : ` (${r.lockedCount} field${r.lockedCount !== 1 ? 's' : ''})`}`,
    fix: 'No action — locked fields are not changed',
  };
}

const KIND_STYLE: Record<IssueKind, string> = {
  Error: 'bg-red-100 text-red-700',
  NIC: 'bg-amber-100 text-amber-800',
  'Wrong class': 'bg-orange-100 text-orange-800',
  Locked: 'bg-slate-200 text-slate-800',
};

// ─── Console (progress panel) ────────────────────────────────────────────────

function statusPill(run: ConsoleRun, doneBatches: number) {
  if (run.status === 'QUEUED') return { label: 'Queued', cls: 'bg-slate-600' };
  if (run.status === 'PROCESSING') {
    const label = run.batches.length > 0
      ? `${run.test ? 'Validating' : 'Writing'} · batch ${Math.min(doneBatches + 1, run.batches.length)} of ${run.batches.length}`
      : run.test ? 'Validating' : 'Writing';
    return { label, cls: 'bg-blue-700' };
  }
  if (run.status === 'COMPLETED') return { label: 'Done', cls: 'bg-emerald-700' };
  if (run.status === 'PARTIAL') return { label: 'Done with failures', cls: 'bg-amber-700' };
  return { label: 'Failed', cls: 'bg-red-700' };
}

function ConsolePanel({ run, polling }: { run: ConsoleRun; polling: boolean }) {
  const doneBatches = run.batches.filter((b) => b.status === 'COMPLETED' || b.status === 'FAILED').length;
  const processed = run.ok + run.failed;
  const pct = run.total > 0 ? Math.round((processed / run.total) * 100) : 0;
  const okPct = run.total > 0 ? (run.ok / run.total) * 100 : 0;
  const failPct = run.total > 0 ? (run.failed / run.total) * 100 : 0;
  const waiting = Math.max(0, run.total - processed);
  const pill = statusPill(run, doneBatches);
  const duration = run.durationMs != null ? formatDuration(run.durationMs) : elapsed(run.startedAt, run.completedAt);

  const copyJobId = () => {
    if (!run.jobId) return;
    navigator.clipboard?.writeText(run.jobId).then(
      () => message.success('Job ID copied'),
      () => message.error('Could not copy'),
    );
  };

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-slate-800 p-5 text-white sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs font-semibold', pill.cls)}>
          {polling ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-white" />}
          {pill.label}
        </span>
        <span className="text-sm text-slate-300">
          {run.env.toUpperCase()} · {run.test ? 'test run (nothing saved)' : 'live write'}
          {run.startedAt && ` · started ${clockTime(run.startedAt)}`} · {duration}
          {JOB_TERMINAL.has(run.status) ? ' total' : ' elapsed'}
        </span>
        {run.jobId && (
          <button
            type="button"
            onClick={copyJobId}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-slate-600 px-3 text-[13px] font-medium hover:bg-slate-700"
          >
            <Copy className="h-3.5 w-3.5" /> Copy job ID
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col">
          <span className="text-5xl font-semibold leading-none">{pct}%</span>
          <span className="mt-1 text-[13px] text-slate-300">
            {processed.toLocaleString()} of {run.total.toLocaleString()} articles done
          </span>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-2">
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Run progress"
            className="flex h-3 overflow-hidden rounded-full bg-slate-700"
          >
            <span className="bg-emerald-400 transition-all duration-500" style={{ width: `${okPct}%` }} />
            <span className="bg-red-400 transition-all duration-500" style={{ width: `${failPct}%` }} />
          </div>
          <div className="flex flex-wrap gap-4 text-[13px] text-slate-300">
            <span><strong className="text-white">{run.ok.toLocaleString()}</strong> ok</span>
            <span><strong className="text-red-300">{run.failed.toLocaleString()}</strong> failed</span>
            {waiting > 0 && <span><strong className="text-white">{waiting.toLocaleString()}</strong> waiting</span>}
          </div>
        </div>
      </div>

      {run.batches.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {run.batches.map((b) => {
            const done = b.status === 'COMPLETED' || b.status === 'FAILED';
            const label = b.status === 'COMPLETED' ? 'Done' : b.status === 'FAILED' ? 'Failed' : b.status === 'PROCESSING' ? (run.test ? 'Validating' : 'Writing') : 'Queued';
            return (
              <div
                key={b.id}
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border bg-slate-700/60 p-3.5',
                  b.status === 'PROCESSING' ? 'border-blue-500' : b.status === 'FAILED' ? 'border-red-400' : 'border-slate-600',
                )}
              >
                <div className="flex justify-between text-[13px]">
                  <span className="font-semibold">Batch {b.batchIndex + 1}</span>
                  <span
                    className={cn(
                      'font-semibold',
                      b.status === 'COMPLETED' && 'text-emerald-300',
                      b.status === 'FAILED' && 'text-red-300',
                      b.status === 'PROCESSING' && 'text-blue-300',
                      b.status === 'QUEUED' && 'text-slate-300',
                    )}
                  >
                    {label}
                  </span>
                </div>
                <span className="text-xs text-slate-300">
                  Rows {(b.startRow + 1).toLocaleString()}–{(b.endRow + 1).toLocaleString()} · {elapsed(b.startedAt, b.completedAt)}
                </span>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-600">
                  {done ? (
                    <span className="flex h-full">
                      <span className="bg-emerald-400" style={{ width: `${(b.successCount / Math.max(1, b.rowCount)) * 100}%` }} />
                      <span className="bg-red-400" style={{ width: `${(b.failedCount / Math.max(1, b.rowCount)) * 100}%` }} />
                    </span>
                  ) : b.status === 'PROCESSING' ? (
                    <span className="block h-full w-1/3 animate-pulse bg-blue-400" />
                  ) : null}
                </div>
                <span className="text-xs text-slate-300">
                  {done
                    ? `${b.successCount} ok · ${b.failedCount} failed`
                    : `${b.rowCount} ${b.status === 'PROCESSING' ? 'in progress' : 'waiting'}`}
                </span>
                {b.errorMessage && <span className="text-xs text-red-300">{b.errorMessage}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Needs attention table ───────────────────────────────────────────────────

function AttentionTable({ issues, running, onDownload }: { issues: Issue[]; running: boolean; onDownload: () => void }) {
  const [filter, setFilter] = useState<'All' | IssueKind>('All');
  const counts = useMemo(
    () => ({
      NIC: issues.filter((i) => i.kinds.includes('NIC')).length,
      'Wrong class': issues.filter((i) => i.kinds.includes('Wrong class')).length,
      Locked: issues.filter((i) => i.kinds.includes('Locked')).length,
      Error: issues.filter((i) => i.kinds.includes('Error')).length,
    }),
    [issues],
  );
  const shown = filter === 'All' ? issues : issues.filter((i) => i.kinds.includes(filter));
  const tabs: ('All' | IssueKind)[] = ['All', 'NIC', 'Wrong class', 'Locked', 'Error'];

  if (issues.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm">
        {running ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            No problems so far. Articles that need attention show here as each batch finishes.
          </>
        ) : (
          <>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Every article went through with no NIC, locked or failed values.
          </>
        )}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <h2 className="text-base font-semibold">Needs attention · {issues.length.toLocaleString()}</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter problems">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              aria-pressed={filter === t}
              className={cn(
                'h-9 rounded-lg px-3 text-xs font-medium transition-colors',
                filter === t ? 'bg-slate-800 text-white' : 'border border-border bg-card hover:bg-slate-100',
              )}
            >
              {t === 'All' ? 'All' : `${t} · ${counts[t]}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-slate-100"
        >
          <Download className="h-4 w-4" /> Download (.xlsx)
        </button>
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-semibold sm:px-5">Article</th>
              <th className="px-3 py-2.5 font-semibold">MC</th>
              <th className="px-3 py-2.5 font-semibold">Written</th>
              <th className="px-3 py-2.5 font-semibold">Problem</th>
              <th className="px-4 py-2.5 font-semibold sm:px-5">What to do</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.matnr} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono font-medium sm:px-5">{i.matnr}</td>
                <td className="px-3 py-2.5 font-mono text-muted-foreground">
                  {i.matkl || '—'}
                  {i.kinds.includes('Wrong class') && (
                    <span className="block text-[11px] font-semibold text-orange-800" title={i.linkError}>
                      linked: {i.linkedClass}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{i.writtenCount}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {i.kinds.map((k) => (
                      <span key={k} className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', KIND_STYLE[k])}>
                        {k}
                      </span>
                    ))}
                    <span className="text-muted-foreground">{i.problem}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5 sm:px-5">{i.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {counts.NIC > 0 && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          NIC = the characteristic is not assigned to the article's class. Run Pool A (KSML Uploader) for those classes first.
        </p>
      )}
      {counts['Wrong class'] > 0 && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          Wrong class = SAP keeps the article in an older class than its MC, so it checks values against that class.
          Move it to its MC class in SAP (CL24N), or add the characteristics to the old class with Pool A.
        </p>
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PoolBUploaderPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [env, setEnv] = useState<'qa' | 'prod'>('qa');
  const [testMode, setTestMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const token = () => localStorage.getItem('authToken');

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((jobId: string) => {
    setPolling(true);
    const poll = async () => {
      try {
        const res = await fetch(`${APP_CONFIG.api.baseURL}/poolb/job/${jobId}`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const json = await res.json();
        if (!res.ok || !json.success) { stopPolling(); return; }
        setJobStatus(json as JobStatus);
        if (JOB_TERMINAL.has(json.status)) {
          stopPolling();
          if (json.status === 'COMPLETED') message.success(`All ${json.totalRows} records processed`);
          else if (json.status === 'PARTIAL') message.warning(`Done with ${json.failedRows} failed record(s)`);
          else message.error('Job failed — check the batches');
        }
      } catch { stopPolling(); }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const resetRun = () => { setReport(null); setJobStatus(null); stopPolling(); setConfirming(false); setConfirmText(''); };

  const onPickFile = (f: File | null) => {
    if (f && !/\.xlsx?$/i.test(f.name)) { message.warning('Choose an .xlsx or .xls file'); return; }
    setFile(f); setPreview(null); resetRun();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startOver = () => onPickFile(null);

  const downloadTemplate = useCallback(async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('ART');
      ws.addRow(TEMPLATE_HEADERS);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((c) => { c.width = 18; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'poolb-article-value-template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to build template');
    }
  }, []);

  const doPreview = useCallback(async (f: File) => {
    setLoading(true); resetRun();
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/poolb/preview`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Preview failed');
      setPreview(json as PreviewData);
      if (json.defaultEnv === 'qa' || json.defaultEnv === 'prod') setEnv(json.defaultEnv);
    } catch (e) {
      setPreview(null);
      message.error(e instanceof Error ? e.message : 'Preview failed');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPolling]);

  // Preview runs as soon as a file is chosen — it never calls SAP.
  useEffect(() => {
    if (file) doPreview(file);
  }, [file, doPreview]);

  const isLiveProd = env === 'prod' && !testMode;

  const doCommit = useCallback(async () => {
    if (!file || !preview) return;
    const envU = env.toUpperCase();
    setCommitting(true); setConfirming(false); setConfirmText(''); setReport(null); setJobStatus(null); stopPolling();
    const loadingId = preview.willQueue
      ? undefined
      : message.loading(`${testMode ? 'Validating' : 'Writing'} on ${envU}… this can take several minutes`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('env', env);
      fd.append('test', String(testMode));
      const res = await fetch(`${APP_CONFIG.api.baseURL}/poolb/commit`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      if (loadingId !== undefined) message.dismiss(loadingId);
      if (!res.ok || !json.success) throw new Error(json.error || 'Commit failed');

      if (json.queued) {
        setJobStatus({
          id: json.jobId,
          status: 'QUEUED',
          env,
          test: testMode,
          totalRows: json.totalRows,
          totalBatches: json.totalBatches,
          batchSize: json.batchSize,
          successRows: 0,
          failedRows: 0,
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          batches: [],
        });
        startPolling(json.jobId);
      } else {
        setReport(json as SyncReport);
        if (json.failed > 0) message.warning(`Done with ${json.failed} article(s) failed`);
        else message.success(`Done — ${json.totalWritten} values across ${json.ok} articles`);
      }
    } catch (e) {
      if (loadingId !== undefined) message.dismiss(loadingId);
      message.error(e instanceof Error ? e.message : 'Commit failed');
    } finally { setCommitting(false); }
  }, [file, preview, env, testMode, startPolling, stopPolling]);

  // ── Console data (sync report or async job, one shape) ──────────────────

  const run: ConsoleRun | null = useMemo(() => {
    if (jobStatus) {
      return {
        env: jobStatus.env,
        test: jobStatus.test,
        status: jobStatus.status,
        total: jobStatus.totalRows,
        ok: jobStatus.successRows,
        failed: jobStatus.failedRows,
        startedAt: jobStatus.startedAt ?? jobStatus.createdAt,
        completedAt: jobStatus.completedAt,
        durationMs: null,
        jobId: jobStatus.id,
        batchSize: jobStatus.batchSize,
        batches: jobStatus.batches,
        results: jobStatus.batches.flatMap((b) => (Array.isArray(b.results) ? b.results : [])),
      };
    }
    if (report) {
      return {
        env: report.env,
        test: report.test,
        status: report.failed === 0 ? 'COMPLETED' : report.ok === 0 ? 'FAILED' : 'PARTIAL',
        total: report.matnrs,
        ok: report.ok,
        failed: report.failed,
        startedAt: null,
        completedAt: null,
        durationMs: report.durationMs,
        jobId: null,
        batchSize: null,
        batches: [],
        results: report.results,
      };
    }
    return null;
  }, [jobStatus, report]);

  const issues = useMemo(
    () => (run ? run.results.map(toIssue).filter((i): i is Issue => i !== null) : []),
    [run],
  );

  const downloadIssues = useCallback(async () => {
    if (issues.length === 0) return;
    try {
      const { utils, writeFile } = await import('xlsx');
      const ws = utils.json_to_sheet(
        issues.map((i) => ({
          Article: i.matnr,
          MC: i.matkl ?? '',
          'Linked class': i.linkedClass ?? '',
          Status: i.ok
            ? 'OK'
            : i.kinds.includes('Error')
              ? 'FAILED'
              : i.kinds.includes('Wrong class')
                ? 'NOT SAVED (WRONG CLASS)'
                : 'NOT SAVED (NIC)',
          'Values written': i.writtenCount,
          NIC: i.nicCount,
          'Not on class': (i.nicAttrs ?? []).join(', '),
          Locked: i.lockedCount,
          'Locked fields': (i.lockedAttrs ?? []).join(', '),
          Problem: i.problem,
          'What to do': i.fix,
        })),
      );
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Needs attention');
      writeFile(wb, `poolb-needs-attention-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`);
    } catch {
      message.error('Download failed');
    }
  }, [issues]);

  const running = !!run && !JOB_TERMINAL.has(run.status);
  const batchCount = preview ? Math.ceil(preview.matnrCount / (preview.batchSize || 500)) : 0;
  const actionLabel = `${testMode ? 'Validate' : 'Write'} ${preview?.totalValueCells.toLocaleString() ?? ''} values on ${env.toUpperCase()}`;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto space-y-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Pool B — Article values</h1>
          <p className="text-sm text-muted-foreground">
            Write characteristic values onto articles in SAP (AUSP). Run Pool A first so every characteristic is on the class.
          </p>
        </div>
        {file && (
          <div className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card pl-3.5 pr-1.5 text-[13px]">
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            <span className="max-w-[220px] truncate font-medium" title={file.name}>{file.name}</span>
            <button
              type="button"
              onClick={startOver}
              disabled={running}
              className="h-8 rounded-md bg-slate-100 px-2.5 text-xs font-medium hover:bg-slate-200 disabled:opacity-50"
            >
              New upload
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-slate-100"
        >
          <Download className="h-4 w-4" /> Template
        </button>
      </header>

      {/* Run console */}
      {run && (
        <>
          <ConsolePanel run={run} polling={polling} />
          <AttentionTable issues={issues} running={running} onDownload={downloadIssues} />
        </>
      )}

      {/* Upload */}
      {!file && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer.files?.[0] ?? null); }}
          className={cn(
            'flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus-within:border-slate-800',
            dragOver ? 'border-slate-800 bg-slate-50' : 'border-slate-300 bg-card hover:border-slate-500',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-white">
            <UploadIcon className="h-6 w-6" />
          </span>
          <span className="text-base font-semibold">Drop the Excel here, or browse</span>
          <span className="text-[13px] text-muted-foreground">
            .xlsx or .xls · first column Matnr, then one column per characteristic (M_FAB_DIV, M_WASH…). Type BLANK to clear a value.
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {file && loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading {file.name}…
        </div>
      )}

      {/* Review + run settings (hidden once a run starts) */}
      {preview && !run && !loading && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Ready to run</h2>
              <span className="text-[13px] text-muted-foreground">Nothing has been sent to SAP yet.</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: 'Articles', v: preview.matnrCount.toLocaleString() },
                { k: 'Characteristics', v: preview.attributeColumns.length.toLocaleString() },
                { k: 'Values to write', v: preview.totalValueCells.toLocaleString() },
                { k: 'Rows skipped', v: preview.skipped.toLocaleString(), warn: preview.skipped > 0 },
              ].map((s) => (
                <div key={s.k} className="flex flex-col gap-0.5 rounded-xl bg-muted/60 px-4 py-3">
                  <span className="text-xs text-muted-foreground">{s.k}</span>
                  <span className={cn('text-2xl font-semibold', s.warn && 'text-amber-800')}>{s.v}</span>
                </div>
              ))}
            </div>

            {preview.warnings.length > 0 && (
              <div className="flex flex-col gap-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                <span className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Check before running
                </span>
                {preview.warnings.map((w, i) => <span key={i}>• {w}</span>)}
              </div>
            )}

            {preview.willQueue && (
              <div className="flex items-center gap-2.5 rounded-xl bg-slate-100 px-4 py-2.5 text-[13px]">
                <Clock className="h-4 w-4 shrink-0" />
                {preview.matnrCount.toLocaleString()} articles is over the {preview.batchSize} limit, so this runs in the background as {batchCount} batches.
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Article column <span className="font-mono text-foreground">{preview.matnrColumn}</span> · characteristics{' '}
              <span className="font-mono">
                {preview.attributeColumns.slice(0, 12).join(', ')}
                {preview.attributeColumns.length > 12 && ` … +${preview.attributeColumns.length - 12} more`}
              </span>
            </div>
          </div>

          {preview.sample.length > 0 && (
            <div className="max-h-64 overflow-auto border-t border-border">
              <table className="w-full min-w-[600px] border-collapse text-[13px]">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold sm:px-5">Article</th>
                    <th className="px-3 py-2.5 font-semibold">Values</th>
                    <th className="px-4 py-2.5 font-semibold sm:px-5">Sample (first {preview.sample.length})</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono font-medium sm:px-5">{p.matnr}</td>
                      <td className="px-3 py-2">{p.attrs}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground sm:px-5">{p.preview}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Run bar */}
          <div className="flex flex-col gap-3 border-t border-border bg-muted/30 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="SAP system">
                {(['qa', 'prod'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={env === e}
                    onClick={() => { setEnv(e); setConfirming(false); setConfirmText(''); }}
                    className={cn(
                      'h-10 rounded-md px-4 text-[13px] font-semibold transition-colors',
                      env === e ? (e === 'prod' ? 'bg-red-700 text-white' : 'bg-slate-800 text-white') : 'hover:bg-slate-200',
                    )}
                  >
                    {e.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Mode">
                {[
                  { v: true, label: 'Test run (no save)' },
                  { v: false, label: 'Live write' },
                ].map((m) => (
                  <button
                    key={String(m.v)}
                    type="button"
                    role="radio"
                    aria-checked={testMode === m.v}
                    onClick={() => { setTestMode(m.v); setConfirming(false); setConfirmText(''); }}
                    className={cn(
                      'h-10 rounded-md px-4 text-[13px] font-medium transition-colors',
                      testMode === m.v ? 'bg-slate-800 text-white' : 'hover:bg-slate-200',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-[13px] text-muted-foreground">
                {testMode ? 'SAP validates every value but saves nothing.' : 'Values are saved in SAP.'}
              </span>
              {!confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={committing || preview.matnrCount === 0}
                  className={cn(
                    'ml-auto inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50',
                    isLiveProd ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-700',
                  )}
                >
                  {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadIcon className="h-4 w-4" />}
                  {actionLabel}
                </button>
              )}
            </div>

            {confirming && (
              <div
                className={cn(
                  'flex flex-col gap-3 rounded-xl border-2 bg-card p-4',
                  isLiveProd ? 'border-red-600' : 'border-slate-800',
                )}
              >
                <div className="flex items-start gap-3">
                  {isLiveProd ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
                  <div className="text-sm">
                    <p className={cn('font-semibold', isLiveProd && 'text-red-800')}>
                      {testMode ? `Test run on ${env.toUpperCase()}` : `Live write to ${env.toUpperCase()}`}
                    </p>
                    <p>
                      {preview.totalValueCells.toLocaleString()} values on {preview.matnrCount.toLocaleString()} articles
                      {preview.willQueue && ` in ${batchCount} background batches`}.{' '}
                      {testMode ? 'Nothing is saved.' : "This can't be undone from here."}
                    </p>
                  </div>
                </div>
                {isLiveProd && (
                  <label className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
                    <span>Type <strong className="font-mono text-foreground">PROD</strong> to confirm</span>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className="h-11 max-w-xs rounded-lg border border-border bg-card px-3 font-mono text-[15px] text-foreground outline-none focus:border-red-600"
                    />
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={doCommit}
                    disabled={committing || (isLiveProd && confirmText.trim().toUpperCase() !== 'PROD')}
                    className={cn(
                      'inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50',
                      isLiveProd ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-700',
                    )}
                  >
                    {committing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {preview.willQueue ? 'Start background job' : actionLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirming(false); setConfirmText(''); }}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* After a finished run: offer another pass on the same file */}
      {run && !running && preview && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
          <span>Same file, different settings?</span>
          <button
            type="button"
            onClick={resetRun}
            className="h-10 rounded-lg border border-border bg-card px-3.5 font-medium text-foreground hover:bg-slate-100"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
