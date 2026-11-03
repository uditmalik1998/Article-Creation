/**
 * KSML Uploader (Pool A) — Admin page, same "job console" layout as Pool B.
 *
 * Upload an Excel of (class, characteristic) pairs, PREVIEW what will be pushed
 * (auto-detected columns, counts, sample) WITHOUT touching SAP, then COMMIT to
 * assign each characteristic to its class in SAP via Z_CLS_ADD_CHAR_BAPI
 * (KLART=026).
 *
 * Web port of drivers/v2_grouped_runner.py — same race-safe grouped push, but
 * the backend does the work. The commit is one synchronous request, so the
 * console shows a working state until it returns, then the result panel plus a
 * "Needs attention" table of failed pairs (downloadable as .xlsx).
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Upload as UploadIcon,
  FileSpreadsheet,
  ShieldAlert,
  Loader2,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { message } from '../../../lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PreviewData {
  pairs: { mc: string; attr: string }[];
  classes: number;
  detectedColumns: { classColumn: string | null; attrColumn: string | null };
  totalRows: number;
  skipped: number;
  warnings: string[];
  sample: { mc: string; attr: string }[];
}

interface PairResult {
  mc: string;
  attr: string;
  status: 'added' | 'already' | 'failed';
  subrc: string;
  msg: string;
  attempt: number;
}

interface CommitReport {
  env: string;
  test: boolean;
  classes: number;
  pairs: number;
  added: number;
  already: number;
  failed: number;
  durationMs: number;
  results: PairResult[];
}

/** What the console shows: the request in flight, or its finished report. */
interface ConsoleRun {
  env: string;
  test: boolean;
  status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  pairs: number;
  classes: number;
  added: number;
  already: number;
  failed: number;
  startedAt: number;
  durationMs: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Plain-language next step for a failed pair, from its SUBRC / message. */
function fixFor(r: PairResult): string {
  const m = r.msg.toLowerCase();
  if (r.subrc === 'LOCKED' || m.includes('locked') || m.includes('bronze_bot')) return 'Class was locked in SAP — re-upload this pair later';
  if (r.subrc === 'EX') return 'Connection problem — re-upload this pair';
  if (m.includes('class') && (m.includes('not') || m.includes('exist'))) return 'Check the class name';
  if (m.includes('characteristic') && (m.includes('not') || m.includes('exist'))) return 'Check the characteristic name';
  return 'Fix the cause, then re-upload this pair';
}

const TEMPLATE_HEADERS = ['class', 'characteristic'];

// ─── Console (progress / result panel) ───────────────────────────────────────

function ConsolePanel({ run }: { run: ConsoleRun }) {
  const working = run.status === 'PROCESSING';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  const total = Math.max(1, run.pairs);
  const pct = (n: number) => (n / total) * 100;
  const pill = working
    ? { label: run.test ? 'Validating' : 'Writing', cls: 'bg-blue-700' }
    : run.status === 'COMPLETED'
    ? { label: 'Done', cls: 'bg-emerald-700' }
    : run.status === 'PARTIAL'
    ? { label: 'Done with failures', cls: 'bg-amber-700' }
    : { label: 'Failed', cls: 'bg-red-700' };
  const duration = run.durationMs != null ? formatDuration(run.durationMs) : formatDuration(now - run.startedAt);

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-slate-800 p-5 text-white sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs font-semibold', pill.cls)}>
          {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-white" />}
          {pill.label}
        </span>
        <span className="text-sm text-slate-300">
          {run.env.toUpperCase()} · {run.test ? 'test run (nothing saved)' : 'live write'} · started {clockTime(run.startedAt)} · {duration}
          {working ? ' elapsed' : ' total'}
        </span>
      </div>

      {working ? (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">
            {run.test ? 'Validating' : 'Assigning'} {run.pairs.toLocaleString()} pairs across {run.classes.toLocaleString()} classes…
          </span>
          <div className="h-3 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-label="Run in progress" aria-busy="true">
            <span className="block h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
          </div>
          <span className="text-[13px] text-slate-300">
            Classes run in parallel; pairs inside a class go one at a time. This can take several minutes — keep this page open.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col">
            <span className="text-5xl font-semibold leading-none">{(run.added + run.already).toLocaleString()}</span>
            <span className="mt-1 text-[13px] text-slate-300">
              of {run.pairs.toLocaleString()} pairs on their class · {run.classes.toLocaleString()} classes
            </span>
          </div>
          <div className="flex min-w-[260px] flex-1 flex-col gap-2">
            <div
              role="progressbar"
              aria-valuenow={Math.round(pct(run.added + run.already))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Run result"
              className="flex h-3 overflow-hidden rounded-full bg-slate-700"
            >
              <span className="bg-emerald-400" style={{ width: `${pct(run.added)}%` }} />
              <span className="bg-slate-300" style={{ width: `${pct(run.already)}%` }} />
              <span className="bg-red-400" style={{ width: `${pct(run.failed)}%` }} />
            </div>
            <div className="flex flex-wrap gap-4 text-[13px] text-slate-300">
              <span><strong className="text-emerald-300">{run.added.toLocaleString()}</strong> added</span>
              <span><strong className="text-white">{run.already.toLocaleString()}</strong> already there</span>
              <span><strong className="text-red-300">{run.failed.toLocaleString()}</strong> failed</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Needs attention table ───────────────────────────────────────────────────

function AttentionTable({ failed, test, onDownload }: { failed: PairResult[]; test: boolean; onDownload: () => void }) {
  if (failed.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        Every pair went through.{' '}
        {test ? 'Switch to Live write to save it in SAP.' : 'Verify KSML + CDHDR counts in SAP, then run Pool B.'}
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <h2 className="text-base font-semibold">Needs attention · {failed.length.toLocaleString()}</h2>
        <span className="text-[13px] text-muted-foreground">Pairs SAP did not add</span>
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
              <th className="px-4 py-2.5 font-semibold sm:px-5">Class</th>
              <th className="px-3 py-2.5 font-semibold">Characteristic</th>
              <th className="px-3 py-2.5 font-semibold">SUBRC</th>
              <th className="px-3 py-2.5 font-semibold">SAP message</th>
              <th className="px-4 py-2.5 font-semibold sm:px-5">What to do</th>
            </tr>
          </thead>
          <tbody>
            {failed.map((r, i) => (
              <tr key={`${r.mc}-${r.attr}-${i}`} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono font-medium sm:px-5">{r.mc}</td>
                <td className="px-3 py-2.5 font-mono">{r.attr}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{r.subrc || '—'}</span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.msg || '—'}</td>
                <td className="px-4 py-2.5 sm:px-5">{fixFor(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KsmlUploaderPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [inFlight, setInFlight] = useState<{ env: string; test: boolean; startedAt: number } | null>(null);
  const [env, setEnv] = useState<'qa' | 'prod'>('qa');
  const [testMode, setTestMode] = useState(true); // default to SAP test-mode for safety
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const token = () => localStorage.getItem('authToken');

  const resetRun = () => { setReport(null); setConfirming(false); setConfirmText(''); setCommitError(null); };

  const onPickFile = (f: File | null) => {
    if (f && !/\.xlsx?$/i.test(f.name)) { message.warning('Choose an .xlsx or .xls file'); return; }
    setFile(f); setPreview(null); resetRun();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = useCallback(async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('KSML');
      ws.addRow(TEMPLATE_HEADERS);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((c) => { c.width = 26; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ksml-class-characteristic-template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to build template');
    }
  }, []);

  const doPreview = useCallback(async (f: File) => {
    setLoading(true); setReport(null); setConfirming(false); setConfirmText('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/ksml/preview`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Preview failed');
      setPreview(json as PreviewData);
    } catch (e) {
      setPreview(null);
      message.error(e instanceof Error ? e.message : 'Preview failed');
    } finally { setLoading(false); }
  }, []);

  // Preview runs as soon as a file is chosen — it never calls SAP.
  useEffect(() => {
    if (file) doPreview(file);
  }, [file, doPreview]);

  const isLiveProd = env === 'prod' && !testMode;

  const doCommit = useCallback(async () => {
    if (!file || !preview) return;
    setConfirming(false); setConfirmText(''); setReport(null); setCommitError(null);
    setInFlight({ env, test: testMode, startedAt: Date.now() });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('env', env);
      fd.append('test', String(testMode));
      const res = await fetch(`${APP_CONFIG.api.baseURL}/ksml/commit`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Commit failed');
      setReport(json as CommitReport);
      if (json.failed > 0) message.warning(`Done with ${json.failed} failed pair(s)`);
      else message.success(`Done — added ${json.added}, already ${json.already}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Commit failed';
      setCommitError(msg);
      message.error(msg);
    } finally { setInFlight(null); }
  }, [file, preview, env, testMode]);

  const run: ConsoleRun | null = useMemo(() => {
    if (inFlight && preview) {
      return {
        ...inFlight, status: 'PROCESSING', pairs: preview.pairs.length, classes: preview.classes,
        added: 0, already: 0, failed: 0, durationMs: null,
      };
    }
    if (report) {
      return {
        env: report.env,
        test: report.test,
        status: report.failed === 0 ? 'COMPLETED' : report.added + report.already === 0 ? 'FAILED' : 'PARTIAL',
        pairs: report.pairs,
        classes: report.classes,
        added: report.added,
        already: report.already,
        failed: report.failed,
        startedAt: Date.now() - report.durationMs,
        durationMs: report.durationMs,
      };
    }
    return null;
  }, [inFlight, report, preview]);

  const failedRows = useMemo(() => report?.results.filter((r) => r.status === 'failed') ?? [], [report]);

  const downloadFailed = useCallback(async () => {
    if (failedRows.length === 0) return;
    try {
      const { utils, writeFile } = await import('xlsx');
      const ws = utils.json_to_sheet(
        failedRows.map((r) => ({ class: r.mc, characteristic: r.attr, SUBRC: r.subrc, 'SAP message': r.msg, 'What to do': fixFor(r) })),
      );
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Needs attention');
      writeFile(wb, `ksml-needs-attention-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`);
    } catch {
      message.error('Download failed');
    }
  }, [failedRows]);

  const running = !!inFlight;
  const actionLabel = `${testMode ? 'Validate' : 'Assign'} ${preview?.pairs.length.toLocaleString() ?? ''} pairs on ${env.toUpperCase()}`;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto space-y-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Pool A — KSML class characteristics</h1>
          <p className="text-sm text-muted-foreground">
            Assign characteristics to classes in SAP (<span className="font-mono">Z_CLS_ADD_CHAR_BAPI</span>, KLART 026). Run this before Pool B.
          </p>
        </div>
        {file && (
          <div className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card pl-3.5 pr-1.5 text-[13px]">
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            <span className="max-w-[220px] truncate font-medium" title={file.name}>{file.name}</span>
            <button
              type="button"
              onClick={() => onPickFile(null)}
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
          <ConsolePanel run={run} />
          {!running && report && <AttentionTable failed={failedRows} test={report.test} onDownload={downloadFailed} />}
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
            .xlsx or .xls · one class column (class / mc / IV_CLASS) and one characteristic column (characteristic / attr / IV_ATNAM). Columns are auto-detected.
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
                { k: 'Classes', v: preview.classes.toLocaleString() },
                { k: 'Pairs to assign', v: preview.pairs.length.toLocaleString() },
                { k: 'Rows read', v: preview.totalRows.toLocaleString() },
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

            <div className="text-xs text-muted-foreground">
              Class column <span className="font-mono text-foreground">{preview.detectedColumns.classColumn ?? '—'}</span> · characteristic column{' '}
              <span className="font-mono text-foreground">{preview.detectedColumns.attrColumn ?? '—'}</span>
            </div>
          </div>

          {preview.sample.length > 0 && (
            <div className="max-h-64 overflow-auto border-t border-border">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold sm:px-5">Class</th>
                    <th className="px-4 py-2.5 font-semibold sm:px-5">Characteristic</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono font-medium sm:px-5">{p.mc}</td>
                      <td className="px-4 py-2 font-mono sm:px-5">{p.attr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.pairs.length > preview.sample.length && (
                <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted-foreground sm:px-5">
                  Showing {preview.sample.length} of {preview.pairs.length.toLocaleString()} pairs
                </div>
              )}
            </div>
          )}

          {/* Run bar */}
          <div className="flex flex-col gap-3 border-t border-border bg-muted/30 p-4 sm:p-5">
            {commitError && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{commitError}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="SAP system">
                {(['qa', 'prod'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={env === e}
                    onClick={() => { setEnv(e); setConfirming(false); setConfirmText(''); setCommitError(null); }}
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
                {testMode ? 'SAP checks every pair but saves nothing.' : 'Characteristics are added to the classes in SAP.'}
              </span>
              {!confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={preview.pairs.length === 0}
                  className={cn(
                    'ml-auto inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50',
                    isLiveProd ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-700',
                  )}
                >
                  <UploadIcon className="h-4 w-4" />
                  {actionLabel}
                </button>
              )}
            </div>

            {confirming && (
              <div className={cn('flex flex-col gap-3 rounded-xl border-2 bg-card p-4', isLiveProd ? 'border-red-600' : 'border-slate-800')}>
                <div className="flex items-start gap-3">
                  {isLiveProd ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
                  <div className="text-sm">
                    <p className={cn('font-semibold', isLiveProd && 'text-red-800')}>
                      {testMode ? `Test run on ${env.toUpperCase()}` : `Live write to ${env.toUpperCase()}`}
                    </p>
                    <p>
                      {preview.pairs.length.toLocaleString()} pairs across {preview.classes.toLocaleString()} classes.{' '}
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
                    disabled={isLiveProd && confirmText.trim().toUpperCase() !== 'PROD'}
                    className={cn(
                      'inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50',
                      isLiveProd ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-800 hover:bg-slate-700',
                    )}
                  >
                    {actionLabel}
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
      {report && !running && preview && (
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
