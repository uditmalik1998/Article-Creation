import * as React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Visual size. Compact = inline in tables, default = section-level. */
  size?: 'compact' | 'default';
}

/**
 * Branded empty state.
 *
 * Renders the icon inside a soft slate-tinted halo, matching the ink/slate theme (concentric rings of
 * decreasing opacity) so empty states feel intentional rather than blank.
 * Title uses display font; description uses body font, muted.
 *
 * Defaults to a generic `Inbox` icon when none is provided.
 */
export const Empty: React.FC<EmptyProps> = ({
  icon,
  title,
  description,
  size = 'default',
  className,
  children,
  ...props
}) => {
  const isCompact = size === 'compact';
  const haloOuter = isCompact ? 'h-16 w-16' : 'h-24 w-24';
  const haloMid = isCompact ? 'h-12 w-12' : 'h-16 w-16';
  const haloInner = isCompact ? 'h-8 w-8' : 'h-12 w-12';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        isCompact ? 'py-6' : 'py-12',
        className,
      )}
      {...props}
    >
      <div className={cn('relative flex items-center justify-center', haloOuter)}>
        {/* outer ring — almost invisible */}
        <span className={cn('absolute inline-block rounded-full bg-slate-500/8 dark:bg-slate-400/10', haloOuter)} />
        {/* mid ring */}
        <span className={cn('absolute inline-block rounded-full bg-slate-500/12 dark:bg-slate-400/15', haloMid)} />
        {/* inner ring */}
        <span className={cn('absolute inline-block rounded-full bg-slate-500/20 dark:bg-slate-400/25', haloInner)} />
        {/* icon */}
        <span className="relative z-10 flex items-center justify-center text-slate-700 dark:text-slate-200">
          {icon ?? <Inbox className={isCompact ? 'h-5 w-5' : 'h-7 w-7'} strokeWidth={1.75} />}
        </span>
      </div>

      {title && (
        <div className={cn('font-display font-semibold tracking-tight text-foreground', isCompact ? 'text-sm' : 'text-base')}>
          {title}
        </div>
      )}
      {description && (
        <div className={cn('max-w-sm text-muted-foreground', isCompact ? 'text-xs' : 'text-sm')}>
          {description}
        </div>
      )}
      {children}
    </div>
  );
};
