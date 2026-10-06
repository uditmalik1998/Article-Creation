import { useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { CalendarDays, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, RangePicker } from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { formatDivisionLabel } from '@/shared/utils/ui/formatters';

/** Height + type size shared by every control in the dashboards' filter row. */
export const FILTER_CONTROL_CLASS = 'h-9 text-[13px]';

/** Selected state for segments and chips: dark slate, matching the brand strip (light in dark mode). */
export const ACTIVE_SEGMENT_CLASS = 'bg-slate-800 font-semibold text-white shadow-sm dark:bg-slate-200 dark:text-slate-900';

const SEGMENT_GROUP_CLASS = 'flex h-9 items-center gap-0.5 rounded-md border border-input bg-background p-0.5 text-[13px]';
const segmentClass = (active: boolean) => cn(
  'flex h-full items-center gap-1.5 rounded-sm px-2.5 font-medium whitespace-nowrap transition-colors',
  active ? ACTIVE_SEGMENT_CLASS : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
);

// ─── Division tabs ─────────────────────────────────────────────────────────────

export interface DivisionOption { value: string; label: string }

/** Title-cased tab labels: MENS → Mens. */
export function divisionOption(value: string): DivisionOption {
  const label = formatDivisionLabel(value);
  return { value, label: label.charAt(0) + label.slice(1).toLowerCase() };
}

/**
 * Division as tabs inside a dashboard's dark brand strip. `basis-full` puts the
 * tabs on their own line at the bottom of the strip's flex-wrap row.
 */
export function DivisionTabs({ value, onChange, options }: {
  value: string;
  onChange: (value: string) => void;
  options: DivisionOption[];
}) {
  const tabs = [{ value: 'ALL', label: 'All divisions' }, ...options];
  return (
    <div role="tablist" aria-label="Division" className="-mb-1.5 flex basis-full flex-wrap gap-1">
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'h-9 border-b-[3px] px-3 text-[13px] transition-colors',
              active ? 'border-[#FF6F61] font-semibold text-white' : 'border-transparent text-white/70 hover:text-white',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Date presets ──────────────────────────────────────────────────────────────

type DateRange = [Dayjs | null, Dayjs | null] | null;

const DATE_PRESETS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7d', label: '7 days', days: 6 },
  { id: '30d', label: '30 days', days: 29 },
] as const;

type PresetId = 'any' | 'custom' | (typeof DATE_PRESETS)[number]['id'];

function presetRange(days: number): DateRange {
  return [dayjs().subtract(days, 'day').startOf('day'), dayjs().endOf('day')];
}

/** Which preset (if any) a stored range corresponds to — ranges are compared by calendar day. */
function activePreset(value: DateRange): PresetId {
  const [start, end] = value || [null, null];
  if (!start && !end) return 'any';
  if (start && end && end.isSame(dayjs(), 'day')) {
    const days = dayjs().startOf('day').diff(start.startOf('day'), 'day');
    const match = DATE_PRESETS.find((p) => p.days === days);
    if (match) return match.id;
  }
  return 'custom';
}

/**
 * Any / Today / 7 days / 30 days / Custom… — a segmented date filter. Custom
 * opens the existing from/to pickers. The value shape is the dashboards'
 * existing `dateRangeFilter`, so fetch/URL/export logic is unchanged.
 */
export function DatePresetFilter({ label, value, onChange }: {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const active = activePreset(value);
  const [start, end] = value || [null, null];
  const customLabel = active === 'custom'
    ? `${start ? start.format('DD MMM') : '…'} – ${end ? end.format('DD MMM') : '…'}`
    : 'Custom';

  return (
    <div role="group" aria-label={`${label} date`} className={SEGMENT_GROUP_CLASS}>
      <span className="px-1.5 text-muted-foreground">{label}</span>
      <button type="button" aria-pressed={active === 'any'} onClick={() => onChange(null)} className={segmentClass(active === 'any')}>
        Any
      </button>
      {DATE_PRESETS.map((p) => (
        <button key={p.id} type="button" aria-pressed={active === p.id} onClick={() => onChange(presetRange(p.days))} className={segmentClass(active === p.id)}>
          {p.label}
        </button>
      ))}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-pressed={active === 'custom'} className={segmentClass(active === 'custom')}>
            <CalendarDays className="h-3.5 w-3.5" />
            {customLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <div className="mb-2 text-[12px] font-semibold text-muted-foreground">{label} between</div>
          <RangePicker value={value} onChange={onChange} placeholder={['From', 'To']} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── SAP sync chips (Created tabs) ─────────────────────────────────────────────

const SAP_SYNC_OPTIONS = [
  { value: 'ALL', label: 'All', dot: null },
  { value: 'SYNCED', label: 'Synced', dot: 'bg-blue-600' },
  { value: 'PENDING', label: 'Queued', dot: 'bg-amber-600' },
  { value: 'FAILED', label: 'Failed', dot: 'bg-red-700' },
] as const;

export function SapSyncChips({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div role="group" aria-label="SAP sync status" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">SAP sync</span>
      {SAP_SYNC_OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
              active
                ? 'border-slate-800 bg-slate-800 font-semibold text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                : 'border-input bg-background text-foreground hover:bg-accent',
            )}
          >
            {o.dot && <span className={cn('h-2 w-2 rounded-full', o.dot, active && 'ring-2 ring-white/80')} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Reset ─────────────────────────────────────────────────────────────────────

export function ResetFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-[#a8321b] underline underline-offset-2 hover:text-[#7f2414] dark:text-red-300"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      Reset filters
    </button>
  );
}
