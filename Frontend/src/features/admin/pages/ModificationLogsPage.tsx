import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Search, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, ArrowRight } from 'lucide-react';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { message } from '@/lib/message';
import {
  getModifyLogs,
  getModifyLogGroups,
  type ModifyLog,
  type ModifyLogGroup,
  type ModifyLogsParams,
} from '../../../services/adminApi';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'custom', label: 'Custom' },
];

// Short tokens in camelCase field keys that read better upper-cased.
const ABBREVIATIONS = new Set(['bgt', 'pr', 'val', 'dc', 'sam', 'v2', 'mrp', 'sap', 'gm', 'fg']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: string): string {
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

function formatWhen(ts: string): string {
  const d = dayjs(ts);
  const time = d.format('HH:mm:ss');
  if (d.isSame(dayjs(), 'day')) return `Today, ${time}`;
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `Yesterday, ${time}`;
  return d.format('DD MMM YYYY, HH:mm:ss');
}

/** SAP characteristics are stored as M_* codes; everything else is a costing / form field. */
function isSapAttribute(label: string): boolean {
  return /^M_/.test(label);
}

function readableLabel(label: string): string {
  if (isSapAttribute(label)) {
    const words = label.slice(2).toLowerCase().split('_').filter(Boolean);
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const words = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((w) => (ABBREVIATIONS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function titleCase(name: string): string {
  return name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function presetRange(preset: DatePreset): { dateFrom: string; dateTo: string } {
  const today = dayjs().format('YYYY-MM-DD');
  switch (preset) {
    case 'today':
      return { dateFrom: today, dateTo: today };
    case '7d':
      return { dateFrom: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), dateTo: today };
    case '30d':
      return { dateFrom: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), dateTo: today };
    default:
      return { dateFrom: '', dateTo: '' };
  }
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface FilterState {
  articleNumber: string;
  labelName: string;
  modifiedBy: string;
  sapStatus: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  articleNumber: '',
  labelName: '',
  modifiedBy: '',
  sapStatus: '',
  dateFrom: '',
  dateTo: '',
};

// ─── Facet button (popover with one text field) ──────────────────────────────

interface TextFacetProps {
  label: string;
  value: string;
  placeholder: string;
  onApply: (value: string) => void;
}

function TextFacet({ label, value, placeholder, onApply }: TextFacetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const apply = () => {
    onApply(draft.trim());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
            value
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-border bg-card text-foreground hover:bg-slate-100',
          )}
        >
          <span className={value ? 'text-slate-300' : 'text-muted-foreground'}>{label}</span>
          <span className="max-w-[140px] truncate font-semibold">{value || 'Any'}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <label className="block text-xs font-medium text-muted-foreground">{label}</label>
        <Input
          autoFocus
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
        <div className="flex justify-end gap-2">
          {value && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onApply('');
                setOpen(false);
              }}
            >
              Clear
            </Button>
          )}
          <Button size="sm" className="bg-slate-800 text-white hover:bg-slate-700" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SapFacet({ value, onApply }: { value: string; onApply: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = [
    { key: '', label: 'All' },
    { key: 'SUCCESS', label: 'Synced' },
    { key: 'FAILED', label: 'Failed' },
  ];
  const current = options.find((o) => o.key === value) ?? options[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
            value
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-border bg-card text-foreground hover:bg-slate-100',
          )}
        >
          <span className={value ? 'text-slate-300' : 'text-muted-foreground'}>SAP</span>
          <span className="font-semibold">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {options.map((o) => (
          <button
            key={o.key || 'all'}
            type="button"
            onClick={() => {
              onApply(o.key);
              setOpen(false);
            }}
            className={cn(
              'flex h-9 w-full items-center rounded-md px-3 text-left text-sm',
              o.key === value ? 'bg-slate-800 text-white' : 'hover:bg-slate-100',
            )}
          >
            {o.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ─── Save card ────────────────────────────────────────────────────────────────

function ChangeRow({ log }: { log: ModifyLog }) {
  const failed = log.sapStatus !== 'SUCCESS';
  return (
    <div className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] items-center gap-3 border-t border-slate-100 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium" title={readableLabel(log.labelName)}>
          {readableLabel(log.labelName)}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={log.labelName}>
          {log.labelName}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
        {log.oldValue ? (
          <span className="break-all text-rose-800 line-through">{log.oldValue}</span>
        ) : (
          <span className="italic text-muted-foreground">empty</span>
        )}
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {log.newValue ? (
          <span className="break-all rounded bg-green-50 px-1.5 py-px font-medium text-green-800">{log.newValue}</span>
        ) : (
          <span className="italic text-muted-foreground">cleared</span>
        )}
        {failed && (
          <span className="ml-auto rounded bg-red-100 px-1.5 py-px font-sans text-[11px] font-semibold text-red-700">
            {log.sapStatus}
          </span>
        )}
      </div>
    </div>
  );
}

function ChangeColumn({ title, rows }: { title: string; rows: ModifyLog[] }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex justify-between pb-2 pt-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span>{rows.length}</span>
      </div>
      {rows.map((r) => (
        <ChangeRow key={r.id} log={r} />
      ))}
    </div>
  );
}

function SaveCard({
  group,
  expanded,
  onToggle,
}: {
  group: ModifyLogGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sapRows = group.rows.filter((r) => isSapAttribute(r.labelName));
  const otherRows = group.rows.filter((r) => !isSapAttribute(r.labelName));
  const failed = group.failedCount > 0;
  const previewLabels = group.rows.slice(0, 3).map((r) => r.labelName);
  const extra = group.rows.length - previewLabels.length;

  return (
    <article
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors',
        expanded ? 'border-slate-800' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-4 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            expanded ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-800',
          )}
        >
          {initials(group.modifiedByName)}
        </span>
        <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-2.5">
            <span className="font-mono text-[15px] font-medium">{group.articleNumber}</span>
            <span className="text-[13px] text-muted-foreground">
              {group.fieldCount} field{group.fieldCount !== 1 ? 's' : ''} changed
            </span>
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {titleCase(group.modifiedByName)} · {group.modifiedByEmail}
          </span>
        </span>
        {!expanded && (
          <span className="hidden flex-[1_1_240px] flex-wrap gap-1.5 md:flex">
            {previewLabels.map((l, i) => (
              <span key={`${l}-${i}`} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px]">
                {l}
              </span>
            ))}
            {extra > 0 && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px]">+{extra}</span>
            )}
          </span>
        )}
        <span className="text-[13px] text-muted-foreground" title={formatTs(group.modifiedAt)}>
          {formatWhen(group.modifiedAt)}
        </span>
        <span
          className={cn(
            'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold',
            failed ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800',
          )}
        >
          {failed ? `${group.failedCount} failed` : `${group.fieldCount} / ${group.fieldCount} synced`}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            expanded ? 'bg-slate-100' : '',
          )}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 sm:px-5">
          <div className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
            {sapRows.length > 0 && <ChangeColumn title="SAP attributes" rows={sapRows} />}
            {otherRows.length > 0 && <ChangeColumn title="Costing & other fields" rows={otherRows} />}
          </div>
          <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
            Group {group.modificationGroupId}
          </p>
        </div>
      )}
    </article>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ModificationLogsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // Live search, debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const setFilter = useCallback((field: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1);
  }, []);

  const choosePreset = useCallback((p: DatePreset) => {
    setPreset(p);
    if (p !== 'custom') {
      const range = presetRange(p);
      setFilters((prev) => ({ ...prev, ...range }));
      setPage(1);
    }
  }, []);

  const clearAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchDraft('');
    setSearch('');
    setPreset('all');
    setPage(1);
  }, []);

  // ── Query ──────────────────────────────────────────────────────────────────

  // The person facet matches either name or email.
  const queryParams: ModifyLogsParams = useMemo(
    () => ({
      ...(search && { search }),
      ...(filters.articleNumber && { articleNumber: filters.articleNumber }),
      ...(filters.labelName && { labelName: filters.labelName }),
      ...(filters.modifiedBy &&
        (filters.modifiedBy.includes('@')
          ? { modifiedByEmail: filters.modifiedBy }
          : { modifiedByName: filters.modifiedBy })),
      ...(filters.sapStatus && { sapStatus: filters.sapStatus }),
      ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
      ...(filters.dateTo && { dateTo: filters.dateTo }),
    }),
    [search, filters],
  );

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['modify-log-groups', page, queryParams],
    queryFn: () => getModifyLogGroups({ ...queryParams, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const groups = data?.data ?? [];
  const totalSaves = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Open the newest save when a fresh result set arrives.
  const firstGroupId = groups[0]?.modificationGroupId;
  useEffect(() => {
    setExpanded(firstGroupId ? new Set([firstGroupId]) : new Set());
  }, [firstGroupId]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await getModifyLogs({ ...queryParams, page: 1, limit: 10000 });
      const rows = result.data;

      if (rows.length === 0) {
        message.warning('No data to export.');
        return;
      }

      if (result.total > 10000) {
        message.warning(`Only the first 10,000 of ${result.total.toLocaleString()} records were exported.`);
      }

      const { utils, writeFile } = await import('xlsx');

      const wsData = rows.map((r) => ({
        Time: formatTs(r.modifiedAt),
        'Article Number': r.articleNumber,
        Label: r.labelName,
        'Old Value': r.oldValue ?? '',
        'New Value': r.newValue ?? '',
        'Modified By': r.modifiedByName,
        'Modified By Email': r.modifiedByEmail,
        'SAP Status': r.sapStatus,
        'Group ID': r.modificationGroupId,
      }));

      const ws = utils.json_to_sheet(wsData);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Modification Logs');

      const fileName = `modification-logs-${dayjs().format('YYYY-MM-DD-HHmm')}.xlsx`;
      writeFile(wb, fileName);
      message.success(`Exported ${rows.length} rows to ${fileName}`);
    } catch (err) {
      console.error('Export failed:', err);
      message.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [queryParams]);

  // ── Active filter chips ────────────────────────────────────────────────────

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (search) chips.push({ key: 'search', label: `“${search}”`, clear: () => setSearchDraft('') });
  if (filters.articleNumber)
    chips.push({ key: 'article', label: `Article ${filters.articleNumber}`, clear: () => setFilter('articleNumber', '') });
  if (filters.labelName)
    chips.push({ key: 'label', label: `Field ${filters.labelName}`, clear: () => setFilter('labelName', '') });
  if (filters.modifiedBy)
    chips.push({ key: 'person', label: filters.modifiedBy, clear: () => setFilter('modifiedBy', '') });
  if (filters.sapStatus)
    chips.push({
      key: 'sap',
      label: filters.sapStatus === 'FAILED' ? 'SAP failed' : 'SAP synced',
      clear: () => setFilter('sapStatus', ''),
    });
  if (filters.dateFrom || filters.dateTo) {
    const presetLabel = DATE_PRESETS.find((p) => p.key === preset)?.label;
    chips.push({
      key: 'date',
      label:
        preset !== 'custom' && presetLabel
          ? presetLabel
          : `${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`,
      clear: () => choosePreset('all'),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Modification Logs</h1>
          <p className="text-sm text-muted-foreground">Every saved change to an article, grouped by save.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Date range">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => choosePreset(p.key)}
                aria-pressed={preset === p.key}
                className={cn(
                  'h-9 rounded-md px-3 text-[13px] font-medium transition-colors',
                  preset === p.key ? 'bg-slate-800 text-white' : 'text-foreground hover:bg-slate-100',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || isLoading}
            className="h-11 gap-2"
          >
            {isExporting ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        </div>
      </header>

      {/* Filters */}
      <section aria-label="Filters" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 min-w-0 flex-[999_1_320px] items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 focus-within:border-slate-800">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              aria-label="Search"
              placeholder="Search article no., field, value or person"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {isFetching && !isLoading && <Spinner size="sm" />}
          </label>
          <TextFacet
            label="Article"
            value={filters.articleNumber}
            placeholder="e.g. 1115122913"
            onApply={(v) => setFilter('articleNumber', v)}
          />
          <TextFacet
            label="Field"
            value={filters.labelName}
            placeholder="e.g. M_WASH or autoBgt"
            onApply={(v) => setFilter('labelName', v)}
          />
          <TextFacet
            label="Person"
            value={filters.modifiedBy}
            placeholder="Name or email"
            onApply={(v) => setFilter('modifiedBy', v)}
          />
          <SapFacet value={filters.sapStatus} onApply={(v) => setFilter('sapStatus', v)} />
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              From
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilter('dateFrom', e.target.value)}
                className="w-44"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              To
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilter('dateTo', e.target.value)}
                className="w-44"
              />
            </label>
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Active:</span>
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-800 pl-2.5 pr-1 text-white"
              >
                {c.label}
                <button
                  type="button"
                  onClick={c.clear}
                  aria-label={`Remove ${c.label}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button type="button" onClick={clearAll} className="ml-1 font-medium underline-offset-2 hover:underline">
              Clear all
            </button>
          </div>
        )}
      </section>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span>
            <strong className="text-foreground">
              {totalSaves.toLocaleString()} save{totalSaves !== 1 ? 's' : ''}
            </strong>{' '}
            · {data.totalChanges.toLocaleString()} field change{data.totalChanges !== 1 ? 's' : ''}
            {data.failedChanges > 0 && (
              <>
                {' '}
                · <strong className="text-red-700">{data.failedChanges.toLocaleString()} failed in SAP</strong>
              </>
            )}
          </span>
          <span>Newest first</span>
        </div>
      )}

      {/* Saves */}
      {isError ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-red-600">
          Failed to load modification logs. Please try again.
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="md" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          No modifications match these filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((g) => (
            <SaveCard
              key={g.modificationGroupId}
              group={g}
              expanded={expanded.has(g.modificationGroupId)}
              onToggle={() => toggle(g.modificationGroupId)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
