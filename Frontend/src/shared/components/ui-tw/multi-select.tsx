import * as React from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Checkbox } from './checkbox';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  /** Optional plain-text used for searching when `label` is not a string. */
  searchText?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxDisplay?: number;
  /** Show a search box at the top of the dropdown to filter options. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  className,
  maxDisplay = 3,
  searchable = false,
  searchPlaceholder = 'Search…',
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  // Clear the search term whenever the dropdown closes.
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const searchStrFor = (opt: MultiSelectOption) =>
    (opt.searchText ?? (typeof opt.label === 'string' ? opt.label : opt.value)).toLowerCase();

  const q = query.trim().toLowerCase();
  const filteredOptions = searchable && q
    ? options.filter((o) => searchStrFor(o).includes(q) || o.value.toLowerCase().includes(q))
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex min-h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1">
            {value.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {value.slice(0, maxDisplay).map((v) => (
              <Badge key={v} variant="secondary" className="gap-1 py-0">
                {labelFor(v)}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(v);
                  }}
                  className="ml-0.5 cursor-pointer rounded-sm hover:bg-foreground/10"
                >
                  <X className="h-3 w-3" />
                </span>
              </Badge>
            ))}
            {value.length > maxDisplay && (
              <Badge variant="secondary" className="py-0">
                +{value.length - maxDisplay}
              </Badge>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] overflow-hidden p-1">
        {searchable && (
          <div className="mb-1 flex items-center gap-1.5 border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <span
                role="button"
                tabIndex={-1}
                onClick={() => setQuery('')}
                className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        )}
        <div
          className="max-h-56 overflow-y-auto overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {filteredOptions.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              {options.length === 0 ? 'No options' : 'No matches'}
            </div>
          )}
          {filteredOptions.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="flex-1">{opt.label}</span>
                {checked && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
