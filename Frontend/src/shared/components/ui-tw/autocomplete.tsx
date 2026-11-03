import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Popover, PopoverContent } from './popover';
import { Input } from './input';
import { cn } from '@/lib/utils';

export interface AutocompleteOption {
  value: string;
  label?: React.ReactNode;
  [key: string]: any;
}

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (q: string) => void;
  onSelect?: (value: string, option: AutocompleteOption) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  autoFocus?: boolean;
  notFoundContent?: React.ReactNode;
  /** Optional line above the options (e.g. "12 vendors"). */
  header?: React.ReactNode;
  className?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Text input with a suggestion panel. The panel is as wide as the input (at least
 * 320 px, at most 520 px — it used to spread across the whole page because the
 * width class lacked `var()`), rows are slate-highlighted, and ↑ ↓ / Enter / Esc
 * work from the input.
 */
export const Autocomplete: React.FC<AutocompleteProps> = ({
  value,
  onChange,
  onSearch,
  onSelect,
  options,
  placeholder,
  autoFocus,
  notFoundContent,
  header,
  className,
  onBlur,
  onKeyDown,
}) => {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // New results → nothing highlighted until the user moves.
  React.useEffect(() => {
    setActive(-1);
  }, [options]);

  React.useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (opt: AutocompleteOption) => {
    onChange(opt.value);
    onSelect?.(opt.value, opt);
    setOpen(false);
  };

  const showPanel = open && (options.length > 0 || !!notFoundContent);

  return (
    <Popover open={showPanel} onOpenChange={setOpen}>
      <PopoverAnchor>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
            onSearch?.(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (showPanel && options.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, options.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' && active >= 0) {
                e.preventDefault();
                pick(options[active]);
                return;
              }
            }
            if (e.key === 'Escape' && showPanel) {
              e.preventDefault();
              setOpen(false);
              return;
            }
            onKeyDown?.(e);
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showPanel}
          aria-autocomplete="list"
          className={cn('h-8', className)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] max-w-[min(520px,90vw)] overflow-hidden rounded-xl border-slate-200 p-0 shadow-xl dark:border-slate-700"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Clicking/focusing the input itself must not count as "outside" and close the panel.
        onInteractOutside={(e) => {
          if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) e.preventDefault();
        }}
      >
        {header && options.length > 0 && (
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11.5px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {header}
          </div>
        )}
        <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
          {options.length === 0
            ? notFoundContent && <div className="px-2.5 py-2 text-[13px] text-slate-500">{notFoundContent}</div>
            : options.map((opt, i) => (
                <button
                  key={opt.value}
                  data-idx={i}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt);
                  }}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    'w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-900 transition-colors dark:text-slate-100',
                    i === active ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                  )}
                >
                  {opt.label ?? opt.value}
                </button>
              ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
