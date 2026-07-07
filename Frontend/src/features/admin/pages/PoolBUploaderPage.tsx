/**
 * Pool B Uploader — Admin page.
 *
 * Upload a Matnr × characteristic-value Excel (the Deepak "ART" template),
 * PREVIEW what will be written WITHOUT touching SAP, then COMMIT to patch each
 * article's attribute values into SAP (AUSP) via the article patch FM.
 */

import React, { useState, useCallback } from 'react';
import { Upload as UploadIcon, FileSpreadsheet, ShieldAlert, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react';
import { Button } from '../../../shared/components/ui-tw';
import { message } from '../../../lib/message';
import { APP_CONFIG } from '../../../constants/app/config';

// Column headers for the Pool B upload template (matches the "ART" template:
// first column = article number, the rest = SAP characteristic names).
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

interface PreviewData {
  defaultEnv: string;
  matnrCount: number;
  attributeColumns: string[];
  totalValueCells: number;
  matnrColumn: string;
  skipped: number;
  warnings: string[];
  sample: { matnr: string; attrs: number; preview: string }[];
}

interface CommitReport {
  env: string;
  test: boolean;
  matnrs: number;
  ok: number;
  failed: number;
  totalWritten: number;
  totalNic: number;
  totalLocked: number;
  durationMs: number;
  results: { matnr: string; ok: boolean; matkl?: string; writtenCount: number; nicCount: number; lockedCount: number; errorMessage?: string }[];
}

export default function PoolBUploaderPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [env, setEnv] = useState<'qa' | 'prod'>('qa');
  const [testMode, setTestMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const token = () => localStorage.getItem('authToken');
  const reset = () => { setPreview(null); setReport(null); };
  const onPickFile = (f: File | null) => { setFile(f); reset(); };

  // Generate + download a blank upload template (header row only) client-side.
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
      a.href = url;
      a.download = 'poolb-article-value-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to build template');
    }
  }, []);

  const doPreview = useCallback(async () => {
    if (!file) { message.warning('Choose an Excel file first'); return; }
    setLoading(true); setReport(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/poolb/preview`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Preview failed');
      setPreview(json as PreviewData);
      if (json.defaultEnv === 'qa' || json.defaultEnv === 'prod') setEnv(json.defaultEnv);
      message.success(`Parsed ${json.matnrCount} articles · ${json.totalValueCells} values`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Preview failed');
    } finally { setLoading(false); }
  }, [file]);

  const doCommit = useCallback(async () => {
    if (!file || !preview) return;
    const envU = env.toUpperCase();
    const verb = testMode ? 'VALIDATE (SAP test mode)' : 'WRITE values';
    const ok = window.confirm(
      `You are about to ${verb} on ${envU}:\n\n` +
      `• ${preview.matnrCount} articles\n• ${preview.totalValueCells} attribute values\n\n` +
      (testMode ? 'Test mode makes NO permanent changes.' : `⚠️ This performs LIVE writes to SAP (${envU}).`) +
      `\n\nContinue?`,
    );
    if (!ok) return;

    setCommitting(true); setReport(null);
    const loadingId = message.loading(`${testMode ? 'Validating' : 'Writing'} to SAP (${envU})… this can take several minutes`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('env', env);
      fd.append('test', String(testMode));
      const res = await fetch(`${APP_CONFIG.api.baseURL}/poolb/commit`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const json = await res.json();
      message.dismiss(loadingId);
      if (!res.ok || !json.success) throw new Error(json.error || 'Commit failed');
      setReport(json as CommitReport);
      if (json.failed > 0) message.warning(`Done with ${json.failed} article(s) failed`);
      else message.success(`Done — ${json.totalWritten} values written across ${json.ok} articles`);
    } catch (e) {
      message.dismiss(loadingId);
      message.error(e instanceof Error ? e.message : 'Commit failed');
    } finally { setCommitting(false); }
  }, [file, preview, env, testMode]);

  const failedRows = report?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <UploadIcon className="h-6 w-6 text-[#FF6F61]" /> Pool B — Article Value Uploader
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a <b>Matnr × characteristic-value</b> Excel (first column = article number, other columns =
          SAP characteristics like <code>M_FAB_DIV</code>). Each article's values are written into SAP (AUSP).
          Columns are auto-detected.
        </p>
      </div>

      {/* Step 1 — File */}
      <div className="rounded-lg border bg-card p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm hover:bg-muted">
            <FileSpreadsheet className="h-4 w-4" /> Choose Excel (.xlsx / .xls)
          </span>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
          {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
        </label>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={doPreview} disabled={!file || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Preview
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" />
            Download Template
          </Button>
        </div>
      </div>

      {/* Step 2 — Preview */}
      {preview && (
        <div className="mt-4 rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-semibold">Preview (no SAP calls made)</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Articles" value={preview.matnrCount} />
            <Stat label="Attr columns" value={preview.attributeColumns.length} />
            <Stat label="Values to write" value={preview.totalValueCells} />
            <Stat label="Skipped" value={preview.skipped} />
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Article column: <b>{preview.matnrColumn}</b>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Characteristics: {preview.attributeColumns.slice(0, 12).join(', ')}
            {preview.attributeColumns.length > 12 && ` … +${preview.attributeColumns.length - 12} more`}
          </div>
          {preview.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-600">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {preview.sample.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr><th className="px-2 py-1">Article</th><th className="px-2 py-1"># attrs</th><th className="px-2 py-1">Preview</th></tr>
                </thead>
                <tbody>
                  {preview.sample.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono">{p.matnr}</td>
                      <td className="px-2 py-1">{p.attrs}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{p.preview}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Step 3 — Commit controls */}
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Environment:</span>
                <select
                  value={env}
                  onChange={(e) => setEnv(e.target.value as 'qa' | 'prod')}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="qa">QA</option>
                  <option value="prod">PROD</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
                SAP test mode (validate, no permanent write)
              </label>
            </div>
            {env === 'prod' && !testMode && (
              <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                <ShieldAlert className="h-3.5 w-3.5" /> LIVE PROD write — this commits attribute values to SAP.
              </p>
            )}
            <Button onClick={doCommit} disabled={committing || preview.matnrCount === 0} className="mt-3 bg-[#FF6F61] hover:bg-[#ff5b4d]">
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadIcon className="h-4 w-4" />}
              {testMode ? 'Validate on ' : 'Write to '} {env.toUpperCase()}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4 — Report */}
      {report && (
        <div className="mt-4 rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-semibold">
            Result — {report.env.toUpperCase()} {report.test && <span className="text-amber-600">(test mode)</span>}
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Articles OK" value={report.ok} tone="green" />
            <Stat label="Articles failed" value={report.failed} tone={report.failed ? 'red' : undefined} />
            <Stat label="Values written" value={report.totalWritten} tone="green" />
            <Stat label="NIC / Locked" value={`${report.totalNic} / ${report.totalLocked}`} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {report.matnrs} articles · {Math.round(report.durationMs / 1000)}s.
            {report.totalNic > 0 && ' NIC = characteristic not assigned to the class (run Pool A first).'}
          </p>

          {failedRows.length > 0 && (
            <div className="mt-3 max-h-64 overflow-auto rounded border border-red-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-red-50">
                  <tr><th className="px-2 py-1">Article</th><th className="px-2 py-1">Written</th><th className="px-2 py-1">NIC</th><th className="px-2 py-1">Reason</th></tr>
                </thead>
                <tbody>
                  {failedRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.matnr}</td>
                      <td className="px-2 py-1">{r.writtenCount}</td>
                      <td className="px-2 py-1">{r.nicCount}</td>
                      <td className="px-2 py-1">{r.errorMessage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1 text-sm">
            {report.failed === 0
              ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> All articles processed successfully.</>
              : <><XCircle className="h-4 w-4 text-red-600" /> {report.failed} article(s) failed — see above.</>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-foreground';
  return (
    <div className="rounded border bg-background p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
