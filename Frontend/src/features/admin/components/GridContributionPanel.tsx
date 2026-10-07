import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { AlertTriangle, Download, Upload, X } from 'lucide-react';
import {
  Autocomplete,
  Button,
  DatePicker,
  Input,
  Label,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  CONTRIBUTION_KIND_LABEL,
  createContributionBulkRequests,
  createContributionRequest,
  downloadContributionTemplate,
  getContributionAttributes,
  getContributionBlock,
  getExpenseColumnOptions,
  type ContributionBulkResult,
  type ContributionKind,
  type ContributionScope,
} from '../../../services/adminApi';
import { SLATE_PRIMARY_BTN } from './DashboardParts';

const TABLE_KEY = 'major-category-grid';

interface GridContributionPanelProps {
  scope: ContributionScope;
  /** Pre-select a block, e.g. from a grid row's action button. */
  initial?: { majorCategory: string; attributeName: string } | null;
  onClose: () => void;
  onSubmitted: () => void;
}

type ParsedRow = { majorCategory: string; attributeName: string; value: string; pct: number | string };

function formatPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Number(v)}%`;
}

/** '' -> null; otherwise a number, or NaN for something unparseable. */
function toPct(raw: string): number | null {
  const t = raw.trim().replace(/%$/, '').trim();
  return t === '' ? null : Number(t);
}

/** Reason + needed-by date, shared by both tabs. */
function RequestMeta({
  reason,
  setReason,
  dueDate,
  setDueDate,
}: {
  reason: string;
  setReason: (v: string) => void;
  dueDate: Dayjs | null;
  setDueDate: (v: Dayjs | null) => void;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label className="text-xs">
          Reason <span className="text-red-500">*</span>
        </Label>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          Needed by <span className="text-red-500">*</span>
        </Label>
        <DatePicker value={dueDate} onChange={setDueDate} />
      </div>
    </>
  );
}

/**
 * Fill Bgt Cont% / Pd Cont% for a whole (major category, attribute) block —
 * on screen, or many blocks from the Excel template. Each block becomes one
 * request: the creator's paired approver, then MDM, who applies it. Only the
 * (kind, division) pairs in `scope.creator` can be filled; the server checks
 * the same thing again.
 */
export function GridContributionPanel({ scope, initial, onClose, onSubmitted }: GridContributionPanelProps) {
  const kinds = useMemo(() => [...new Set(scope.creator.map((c) => c.kind))] as ContributionKind[], [scope]);
  const [kind, setKind] = useState<ContributionKind>(kinds[0] ?? 'BGT');
  const [tab, setTab] = useState<'block' | 'excel'>('block');
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const myDivisions = useMemo(
    () => new Set(scope.creator.filter((c) => c.kind === kind).map((c) => c.division)),
    [scope, kind]
  );
  const approverFor = (division: string | null) =>
    scope.creator.find((c) => c.kind === kind && c.division === division)?.approverEmail;

  // ── Block tab ────────────────────────────────────────────────────────────
  const [majorCategory, setMajorCategory] = useState(initial?.majorCategory ?? '');
  const [attributeName, setAttributeName] = useState(initial?.attributeName ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const { data: mcOptions = [] } = useQuery({
    queryKey: ['expense-column-options', TABLE_KEY, 'major_category'],
    queryFn: () => getExpenseColumnOptions(TABLE_KEY, 'major_category'),
    staleTime: 5 * 60_000,
  });
  const mcValid = mcOptions.includes(majorCategory);
  const mcSuggestions = useMemo(() => {
    const q = majorCategory.trim().toLowerCase();
    return (q ? mcOptions.filter((o) => o.toLowerCase().includes(q)) : mcOptions).slice(0, 50).map((o) => ({ value: o }));
  }, [mcOptions, majorCategory]);

  const { data: attributesInfo } = useQuery({
    queryKey: ['grid-contribution-attributes', majorCategory],
    queryFn: () => getContributionAttributes(majorCategory),
    enabled: mcValid,
    staleTime: 60_000,
  });

  const { data: block, isFetching: blockLoading, refetch: refetchBlock } = useQuery({
    queryKey: ['grid-contribution-block', majorCategory, attributeName],
    queryFn: () => getContributionBlock(majorCategory, attributeName),
    enabled: mcValid && !!attributeName,
    // A background refetch would re-seed the inputs and wipe what was typed.
    refetchOnWindowFocus: false,
  });

  // Seed the inputs from the block's current % of the chosen column.
  useEffect(() => {
    if (!block) return;
    const next: Record<string, string> = {};
    for (const r of block.rows) {
      const current = kind === 'BGT' ? r.bgt : r.pd;
      next[r.value] = current === null ? '' : String(current);
    }
    setInputs(next);
  }, [block, kind]);

  const divisionAllowed = !!block?.division && myDivisions.has(block.division);
  const pendingForKind = block?.pending?.[kind] ?? null;

  const parsed = useMemo(() => Object.entries(inputs).map(([value, raw]) => ({ value, pct: toPct(raw) })), [inputs]);
  const invalid = parsed.filter((p) => p.pct !== null && (Number.isNaN(p.pct) || p.pct < 0 || p.pct > 100));
  const filled = parsed.filter((p) => p.pct !== null && !Number.isNaN(p.pct));
  const total = Math.round(filled.reduce((s, p) => s + (p.pct as number), 0) * 100) / 100;
  const sumOk = filled.length === 0 || Math.abs(total - 100) < 0.005;

  const checkMeta = (): boolean => {
    if (!reason.trim()) {
      message.warning('A reason is required.');
      return false;
    }
    if (!dueDate) {
      message.warning('Pick the date you need this done by.');
      return false;
    }
    if (dueDate.isBefore(dayjs().startOf('day'))) {
      message.warning('The "needed by" date cannot be in the past.');
      return false;
    }
    return true;
  };

  const submitBlock = async () => {
    if (!block || !checkMeta()) return;
    if (invalid.length > 0) {
      message.warning(`Fix the % for ${invalid[0].value} (0–100).`);
      return;
    }
    if (!sumOk) {
      message.warning(`${CONTRIBUTION_KIND_LABEL[kind]} must add up to 100 — it adds up to ${total}.`);
      return;
    }
    setSubmitting(true);
    try {
      const values: Record<string, number | null> = {};
      for (const p of parsed) values[p.value] = p.pct;
      const res = await createContributionRequest({
        kind,
        majorCategory: block.majorCategory,
        attributeName: block.attributeName,
        values,
        reason: reason.trim(),
        dueDate: dueDate!.format('YYYY-MM-DD'),
      });
      message.success(`Request raised for ${res.changedValues} value(s) — sent to ${approverFor(block.division) ?? 'your approver'}.`);
      onSubmitted();
      refetchBlock();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Could not raise the request.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Excel tab ────────────────────────────────────────────────────────────
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileRows, setFileRows] = useState<ParsedRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [bulkResult, setBulkResult] = useState<ContributionBulkResult | null>(null);
  const fileBlocks = useMemo(() => new Set(fileRows.map((r) => `${r.majorCategory}||${r.attributeName}`)).size, [fileRows]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await downloadContributionTemplate(kind);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `GRID_${kind}_CONTRIBUTION_${dayjs().format('YYYY-MM-DD')}.xlsx`;
      a.click();
    } catch (err: any) {
      message.error(err?.message || 'Could not download the template.');
    } finally {
      setDownloading(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    setFileRows([]);
    setFileError('');
    setBulkResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const xlsx = await import('xlsx');
      const wb = xlsx.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
      const header = (aoa[0] ?? []).map((h) => String(h).trim().toUpperCase());
      const col = (name: string) => header.indexOf(name);
      const iMc = col('MAJOR CATEGORY');
      const iAttr = col('ATTRIBUTE NAME');
      const iValue = col('VALUE');
      const newHeader = `NEW ${kind} CONT%`;
      const iNew = col(newHeader);
      if (iMc < 0 || iAttr < 0 || iValue < 0 || iNew < 0) {
        setFileError(`This isn't the ${CONTRIBUTION_KIND_LABEL[kind]} template — it needs MAJOR CATEGORY, ATTRIBUTE NAME, VALUE and "${newHeader}" columns.`);
        return;
      }
      const rows: ParsedRow[] = [];
      for (const line of aoa.slice(1)) {
        const pct = line[iNew];
        if (pct === '' || pct === null || pct === undefined) continue;
        rows.push({
          majorCategory: String(line[iMc] ?? '').trim(),
          attributeName: String(line[iAttr] ?? '').trim(),
          value: String(line[iValue] ?? '').trim(),
          pct: typeof pct === 'number' ? pct : String(pct),
        });
      }
      if (rows.length === 0) setFileError(`No "${newHeader}" values are filled in this file.`);
      setFileRows(rows);
    } catch (err: any) {
      setFileError(err?.message || 'Could not read this file.');
    }
  };

  const submitBulk = async () => {
    if (fileRows.length === 0 || !checkMeta()) return;
    setSubmitting(true);
    try {
      const res = await createContributionBulkRequests({
        kind,
        rows: fileRows,
        reason: reason.trim(),
        dueDate: dueDate!.format('YYYY-MM-DD'),
      });
      setBulkResult(res);
      if (res.created > 0) {
        message.success(`${res.created} block request(s) raised${res.skipped ? `, ${res.skipped} skipped` : ''}.`);
        onSubmitted();
      } else {
        message.warning(`No requests raised — all ${res.skipped} block(s) were skipped. See the list below.`);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside
      aria-label="Contribution %"
      className="flex max-h-[calc(100vh-7rem)] w-full flex-col rounded-xl border border-slate-400 bg-card shadow-lg lg:sticky lg:top-3 lg:w-[460px] lg:shrink-0 dark:border-slate-500"
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Contribution %</span>
          <p className="m-0 text-[13px] font-semibold">
            {kinds.map((k) => CONTRIBUTION_KIND_LABEL[k]).join(' / ')} · {[...myDivisions].join(', ')}
          </p>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Close panel">
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {kinds.length > 1 && (
            <Segmented
              size="sm"
              value={kind}
              onChange={(v) => {
                setKind(v as ContributionKind);
                setFileRows([]);
                setBulkResult(null);
              }}
              options={kinds.map((k) => ({ value: k, label: CONTRIBUTION_KIND_LABEL[k] }))}
            />
          )}
          <Segmented
            size="sm"
            value={tab}
            onChange={(v) => setTab(v as 'block' | 'excel')}
            options={[
              { value: 'block', label: 'One block' },
              { value: 'excel', label: 'Excel upload' },
            ]}
          />
        </div>

        {tab === 'block' ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Major Category</Label>
              <Autocomplete
                value={majorCategory}
                onChange={(v) => {
                  setMajorCategory(v);
                  setAttributeName('');
                }}
                onSelect={(v) => {
                  setMajorCategory(v);
                  setAttributeName('');
                }}
                options={mcSuggestions}
                placeholder="Search a major category…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Attribute</Label>
              <Select value={attributeName} onValueChange={setAttributeName} disabled={!mcValid}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={mcValid ? 'Pick an attribute' : 'Pick a major category first'} />
                </SelectTrigger>
                <SelectContent>
                  {(attributesInfo?.attributes ?? []).map((a) => (
                    <SelectItem key={a.attributeName} value={a.attributeName}>
                      {a.attributeName} ({a.values})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {blockLoading && <p className="text-xs text-muted-foreground">Loading block…</p>}

            {block && !blockLoading && (
              <>
                <div className="text-xs text-muted-foreground">
                  Division <span className="font-semibold text-foreground">{block.division ?? 'unknown'}</span>
                  {divisionAllowed && (
                    <>
                      {' '}· approver <span className="font-semibold text-foreground">{approverFor(block.division)}</span>
                    </>
                  )}
                </div>

                {!divisionAllowed && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    You fill {CONTRIBUTION_KIND_LABEL[kind]} for {[...myDivisions].join(', ') || 'no division'} only — this block is{' '}
                    {block.division ?? 'outside the hierarchy'}.
                  </div>
                )}
                {pendingForKind && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    A {CONTRIBUTION_KIND_LABEL[kind]} request for this block is already pending (raised by {pendingForKind.requestedByName}).
                  </div>
                )}

                <div className="rounded-md border">
                  <div className="grid grid-cols-[1fr_56px_56px_56px_76px] gap-1 bg-muted/40 p-2 text-[11px] font-medium text-muted-foreground">
                    <span>Value</span>
                    <span className="text-right">Bgt</span>
                    <span className="text-right">Pd</span>
                    <span className="text-right">Auto</span>
                    <span className="text-right">New {kind}</span>
                  </div>
                  <div className="max-h-[320px] divide-y overflow-y-auto">
                    {block.rows.map((r) => (
                      <div key={r.id} className="grid grid-cols-[1fr_56px_56px_56px_76px] items-center gap-1 px-2 py-1 text-xs">
                        <span className="truncate" title={r.value}>
                          {r.value}
                        </span>
                        <span className="text-right text-muted-foreground">{formatPct(r.bgt)}</span>
                        <span className="text-right text-muted-foreground">{formatPct(r.pd)}</span>
                        <span className="text-right text-muted-foreground">{formatPct(r.auto)}</span>
                        <Input
                          className="h-7 px-1.5 text-right text-xs"
                          inputMode="decimal"
                          disabled={!divisionAllowed || !!pendingForKind}
                          value={inputs[r.value] ?? ''}
                          onChange={(e) => setInputs((prev) => ({ ...prev, [r.value]: e.target.value }))}
                          aria-label={`New ${CONTRIBUTION_KIND_LABEL[kind]} for ${r.value}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground">Total {CONTRIBUTION_KIND_LABEL[kind]}</span>
                    <span className={`font-semibold ${sumOk && invalid.length === 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
                      {total}% {filled.length > 0 && !sumOk ? '(must be 100)' : ''}
                    </span>
                  </div>
                </div>

                {divisionAllowed && !pendingForKind && (
                  <RequestMeta reason={reason} setReason={setReason} dueDate={dueDate} setDueDate={setDueDate} />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Download the template — every grid row of your division(s) with today’s %s. Fill the{' '}
              <span className="font-semibold text-foreground">NEW {kind} CONT%</span> column (leave a row blank to keep its %), and
              upload it. Each major category + attribute block becomes one request and must add up to 100.
            </p>
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
              <Download className="h-4 w-4" />
              {downloading ? 'Preparing…' : `Download ${CONTRIBUTION_KIND_LABEL[kind]} template`}
            </Button>

            <div className="space-y-1">
              <Label className="text-xs">Filled template</Label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 px-3 py-2 text-xs hover:bg-muted/40">
                <Upload className="h-4 w-4" />
                <span className="truncate">{fileName || 'Choose .xlsx file'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {fileError && <p className="text-xs text-red-600">{fileError}</p>}
              {fileRows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {fileRows.length.toLocaleString('en-IN')} value(s) filled across {fileBlocks.toLocaleString('en-IN')} block(s).
                </p>
              )}
            </div>

            {fileRows.length > 0 && <RequestMeta reason={reason} setReason={setReason} dueDate={dueDate} setDueDate={setDueDate} />}

            {bulkResult && (
              <div className="rounded-md border text-xs">
                <div className="bg-muted/40 p-2 font-medium">
                  {bulkResult.created} raised · {bulkResult.skipped} skipped
                </div>
                <div className="max-h-[220px] divide-y overflow-y-auto">
                  {bulkResult.results
                    .filter((r) => r.status === 'SKIPPED')
                    .map((r) => (
                      <div key={`${r.majorCategory}||${r.attributeName}`} className="px-2 py-1">
                        <span className="font-semibold">
                          {r.majorCategory} · {r.attributeName}
                        </span>
                        <span className="text-red-600"> — {r.error}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Close
        </Button>
        {tab === 'block' ? (
          <Button
            className={SLATE_PRIMARY_BTN}
            onClick={submitBlock}
            disabled={submitting || !block || !divisionAllowed || !!pendingForKind}
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </Button>
        ) : (
          <Button className={SLATE_PRIMARY_BTN} onClick={submitBulk} disabled={submitting || fileRows.length === 0}>
            {submitting ? 'Uploading…' : `Raise ${fileBlocks || ''} request(s)`}
          </Button>
        )}
      </div>
    </aside>
  );
}
