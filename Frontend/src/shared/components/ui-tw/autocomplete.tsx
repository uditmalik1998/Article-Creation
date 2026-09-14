import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
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
  className?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const Autocomplete: React.FC<AutocompleteProps> = ({
  value,
  onChange,
  onSearch,
  onSelect,
  options,
  placeholder,
  autoFocus,
  notFoundContent,
  className,
  onBlur,
  onKeyDown,
}) => {
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <Popover open={open && (options.length > 0 || !!notFoundContent)} onOpenChange={setOpen}>
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
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn('h-8', className)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] max-h-56 overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0
          ? notFoundContent && <div className="px-2 py-1.5 text-sm">{notFoundContent}</div>
          : options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  onSelect?.(opt.value, opt);
                  setOpen(false);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {opt.label ?? opt.value}
              </button>
            ))}
      </PopoverContent>
    </Popover>
  );
};

// Inline PopoverAnchor wrapper to keep this file self-contained
import * as PopoverPrimitive from '@radix-ui/react-popover';
const PopoverAnchor = PopoverPrimitive.Anchor;
