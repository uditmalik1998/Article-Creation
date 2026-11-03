/**
 * "From article list" composer — design "Option A · Live check before you run".
 *
 * Codes come from a dropped/browsed .xlsx/.csv (first column) or the paste box.
 * Every line is checked as you go:
 *   - locally: not an article code / duplicate (counted once)
 *   - server dry run (POST /bulk/check-articles, read-only): source photo found +
 *     detected gender / colour / framing, or why it can't run.
 * The Generate button states exactly what it will do and is the only confirmation;
 * only the codes that passed the check are sent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Check, Info, Loader2, PackageOpen, Sparkles, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ArticleListSubmit {
  file: File | null;
  codesText: string;
}

interface Props {
  submitting: boolean;
  onSubmit: (payload: ArticleListSubmit) => void;
}

interface CheckResult {
  code: string;
  found: boolean;
  reason?: string;
  gender?: string;
  colour?: string;
  framing?: string;
  colourFallback?: boolean;
}

type LineState = 'checking' | 'ready' | 'missing' | 'duplicate' | 'bad' | 'unchecked';

interface Line {
  code: string;
  state: LineState;
  note: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
const HEADER_TOKENS = new Set(['final art', 'article', 'article number', 'code', 'final article']);
const CHECK_MAX_CODES = 500; // keep in step with the backend's limit
const IMAGES_PER_ARTICLE = 5;
// FINAL ART = numeric article number, optionally "-COLOUR" (e.g. 1110097922-BLACK).
const CODE_RE = /^\d{6,}(-.+)?$/;

const GENDER_LABEL: Record<string, string> = { male: 'Men', female: 'Women', 'kid boy': 'Boys', 'kid girl': 'Girls' };
const FRAMING_LABEL: Record<string, string> = { top: 'top', bottom: 'bottom', full: 'full', unknown: 'auto framing' };

function describe(r: CheckResult): string {
  const parts = [
    r.gender ? GENDER_LABEL[r.gender] || r.gender : '',
    r.colour ? r.colour.toLowerCase() : '',
    r.framing ? FRAMING_LABEL[r.framing] || r.framing : '',
  ].filter(Boolean);
  return parts.join(' · ') + (r.colourFallback ? ' · colour from a sibling photo' : '');
}

function friendlyReason(reason?: string): string {
  if (!reason) return 'No source photo found';
  if (/lookup failed/i.test(reason)) return 'Lookup failed — try again';
  if (/no image|not found/i.test(reason)) return 'No source photo found';
  return reason;
}

const STATE_STYLE: Record<LineState, { icon: typeof Check | null; cls: string }> = {
  ready: { icon: Check, cls: 'text-emerald-700' },
  missing: { icon: X, cls: 'text-red-700' },
  bad: { icon: X, cls: 'text-red-700' },
  duplicate: { icon: AlertTriangle, cls: 'text-amber-700' },
  checking: { icon: null, cls: 'text-slate-500' },
  unchecked: { icon: null, cls: 'text-slate-500' },
};

export function ArticleListPanel({ submitting, onSubmit }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<string[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [codesText, setCodesText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [checked, setChecked] = useState<Map<string, CheckResult>>(new Map());
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const checkSeq = useRef(0);

  // Raw entries in order — the file's first column, or the pasted lines.
  const rawEntries = useMemo(() => {
    const rows = fileRows ?? codesText.split(/[\r\n,]+/);
    return rows.map((r) => String(r ?? '').trim()).filter((r) => r && !HEADER_TOKENS.has(r.toLowerCase()));
  }, [fileRows, codesText]);

  // Unique, well-formed codes (first spelling wins) — what gets checked / sent.
  const uniqueCodes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of rawEntries) {
      const k = c.toLowerCase();
      if (!CODE_RE.test(c) || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }, [rawEntries]);

  const tooMany = uniqueCodes.length > CHECK_MAX_CODES;

  // Debounced server dry run whenever the set of codes changes.
  const runCheck = useCallback(async (codes: string[]) => {
    const seq = ++checkSeq.current;
    if (codes.length === 0 || codes.length > CHECK_MAX_CODES) {
      setChecking(false);
      return;
    }
    setChecking(true);
    setCheckError(null);
    try {
      const form = new FormData();
      form.append('codesText', codes.join('\n'));
      const res = await fetch(`${API_BASE}/model-generation/bulk/check-articles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        body: form,
      });
      const data = await res.json();
      if (seq !== checkSeq.current) return; // a newer check superseded this one
      if (!res.ok || !data.success) throw new Error(data.error || 'Check failed');
      setChecked((prev) => {
        const next = new Map(prev);
        for (const r of data.results as CheckResult[]) next.set(r.code.toLowerCase(), r);
        return next;
      });
    } catch (e) {
      if (seq === checkSeq.current) setCheckError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }, []);

  const codesKey = uniqueCodes.map((c) => c.toLowerCase()).join('\n');
  useEffect(() => {
    const pending = uniqueCodes.filter((c) => !checked.has(c.toLowerCase()));
    if (pending.length === 0 || tooMany) return;
    const t = setTimeout(() => void runCheck(uniqueCodes), 600);
    return () => clearTimeout(t);
    // codesKey stands in for uniqueCodes; `checked` is read fresh each time it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, tooMany, runCheck]);

  const lines: Line[] = useMemo(() => {
    const seen = new Set<string>();
    return rawEntries.map((code) => {
      const k = code.toLowerCase();
      if (!CODE_RE.test(code)) return { code, state: 'bad', note: 'Not an article code' };
      if (seen.has(k)) return { code, state: 'duplicate', note: 'Duplicate — counted once' };
      seen.add(k);
      const r = checked.get(k);
      if (!r) return { code, state: tooMany ? 'unchecked' : 'checking', note: tooMany ? 'Checked when the job starts' : 'Checking…' };
      return r.found
        ? { code, state: 'ready', note: describe(r) || 'Ready' }
        : { code, state: 'missing', note: friendlyReason(r.reason) };
    });
  }, [rawEntries, checked, tooMany]);

  const counts = useMemo(() => {
    const c = { ready: 0, duplicate: 0, cant: 0, pending: 0 };
    for (const l of lines) {
      if (l.state === 'ready') c.ready++;
      else if (l.state === 'duplicate') c.duplicate++;
      else if (l.state === 'bad' || l.state === 'missing') c.cant++;
      else c.pending++;
    }
    return c;
  }, [lines]);

  // What will be sent: checked-ready codes; when the list is too big to pre-check,
  // every well-formed unique code (the server skips the ones it can't resolve).
  const runCodes = tooMany ? uniqueCodes : lines.filter((l) => l.state === 'ready').map((l) => l.code);
  const canRun = !submitting && runCodes.length > 0 && (tooMany || !checking);

  async function handleFile(f: File | null) {
    setFileError(null);
    if (!f) {
      setFileName(null);
      setFileRows(null);
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setFileError('Choose an .xlsx, .xls or .csv file');
      return;
    }
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
      setFileRows(matrix.map((r) => String(r?.[0] ?? '')));
      setFileName(f.name);
      setCodesText(''); // a file supersedes pasted text
    } catch {
      setFileError('Could not read the file — is it a valid .xlsx or .csv?');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const sectionLabel = 'text-xs font-bold uppercase tracking-[0.07em] text-slate-600 dark:text-slate-400';

  return (
    <div className="flex flex-col gap-4">
      {/* 1 · Add articles */}
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>1 · Add articles</span>
        <span className="text-xs text-muted-foreground">File or paste — both work</span>
      </div>

      {fileName ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] dark:border-slate-700 dark:bg-slate-800">
          <PackageOpen className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="min-w-0 flex-1 truncate font-medium" title={fileName}>{fileName}</span>
          <button
            type="button"
            onClick={() => handleFile(null)}
            className="h-8 rounded-md px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Remove
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0] ?? null); }}
          className={cn(
            'flex min-h-[92px] cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3.5 transition-colors focus-within:border-slate-800',
            dragOver ? 'border-slate-800 bg-slate-100' : 'border-slate-300 bg-slate-50 hover:border-slate-500 dark:border-slate-600 dark:bg-slate-800',
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white">
            <Upload className="h-[18px] w-[18px]" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Drop an article list, or browse</span>
            <span className="text-xs text-muted-foreground">.xlsx or .csv · one FINAL ART per row (e.g. 1110097922-BLACK)</span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      {fileError && <p className="m-0 text-xs text-red-700">{fileError}</p>}

      {!fileName && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">…or paste codes, one per line</span>
          <textarea
            rows={5}
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            placeholder={'1110097922-BLACK\n1110106859-DARK GREY'}
            spellCheck={false}
            className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-slate-800 focus:ring-2 focus:ring-slate-800/15 dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
      )}

      {/* 2 · Check */}
      {lines.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className={sectionLabel}>2 · Check</span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-slate-700 dark:text-slate-300">
              {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <b>{counts.ready} ready</b>
              {counts.duplicate > 0 && ` · ${counts.duplicate} duplicate`}
              {counts.cant > 0 && ` · ${counts.cant} can’t run`}
              {counts.pending > 0 && !tooMany && ` · ${counts.pending} checking`}
            </span>
          </div>
          <div className="max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700" role="list" aria-label="Checked article codes">
            {lines.map((l, i) => {
              const st = STATE_STYLE[l.state];
              const Icon = st.icon;
              const struck = l.state === 'duplicate' || l.state === 'bad';
              return (
                <div
                  key={`${l.code}-${i}`}
                  role="listitem"
                  className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-slate-100 px-2.5 py-2 first:border-t-0 dark:border-slate-800"
                >
                  <span className={cn('flex', st.cls)}>
                    {Icon ? <Icon className="h-4 w-4" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </span>
                  <span className={cn('truncate font-mono text-[13px] font-semibold', struck && 'text-slate-400 line-through')} title={l.code}>
                    {l.code}
                  </span>
                  <span className={cn('max-w-[200px] truncate text-right text-xs', l.state === 'ready' || l.state === 'checking' ? 'text-muted-foreground' : st.cls)} title={l.note}>
                    {l.note}
                  </span>
                </div>
              );
            })}
          </div>
          {tooMany && (
            <p className="m-0 text-xs text-amber-800">
              {uniqueCodes.length.toLocaleString()} codes is over the {CHECK_MAX_CODES} we check up front — the job checks them as it runs and skips any without a source photo.
            </p>
          )}
          {checkError && (
            <p className="m-0 flex items-center gap-2 text-xs text-red-700">
              Couldn’t check the codes ({checkError}).
              <button type="button" className="font-semibold underline" onClick={() => void runCheck(uniqueCodes)}>
                Try again
              </button>
            </p>
          )}
        </>
      )}

      <div className="flex items-start gap-2.5 rounded-xl bg-slate-100 px-3 py-2.5 text-[13px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Gender, colour and framing are read from each article’s extraction data — nothing to pick here.</span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!canRun}
          onClick={() => onSubmit({ file: null, codesText: runCodes.join('\n') })}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-800 text-[15px] font-bold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {submitting ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
          {submitting
            ? 'Starting…'
            : runCodes.length > 0
            ? `Generate ${runCodes.length.toLocaleString()} article${runCodes.length !== 1 ? 's' : ''} · ${(runCodes.length * IMAGES_PER_ARTICLE).toLocaleString()} images`
            : checking
            ? 'Checking codes…'
            : 'Add article codes to start'}
        </button>
        <span className="text-center text-xs text-muted-foreground">
          Saved to the <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">model-images</code> bucket for review
        </span>
      </div>
    </div>
  );
}
