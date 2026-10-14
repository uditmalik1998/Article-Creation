import React, { useState } from 'react';
import { AlertTriangle, BellRing, Check, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationItem, NotificationType } from '../../services/notifications/notificationStore';

// Notifications popover body — design "Option A" (2026-10-14).
// Rendered inside the sidebar's PopoverContent (side="right", align="end"),
// so its bottom lines up with the bell row; the arrow on the left edge points
// at the bell. Slate states, no coral.

const TYPE_STYLE: Record<NotificationType, { Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  success: { Icon: Check, cls: 'bg-emerald-100 text-emerald-700' },
  error: { Icon: X, cls: 'bg-red-100 text-red-700' },
  warning: { Icon: AlertTriangle, cls: 'bg-amber-100 text-amber-700' },
  info: { Icon: Info, cls: 'bg-slate-200 text-slate-700' },
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const relativeTime = (iso: string) => {
  const t = new Date(iso).getTime();
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (t >= startOfToday()) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

interface NotificationsPanelProps {
  notifications: NotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClear,
}) => {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const unread = notifications.filter((n) => !n.read).length;
  const visible = tab === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  const today0 = startOfToday();
  const groups = [
    { label: 'TODAY', items: visible.filter((n) => new Date(n.createdAt).getTime() >= today0) },
    { label: 'EARLIER', items: visible.filter((n) => new Date(n.createdAt).getTime() < today0) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="relative">
      {/* Arrow pointing at the bell row (popover is bottom-aligned to it) */}
      <span
        aria-hidden="true"
        className="absolute -left-[7px] bottom-3 h-3 w-3 rotate-45 border-b border-l border-border bg-popover"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-slate-900 dark:text-slate-50">Notifications</span>
          {unread > 0 && (
            <span className="rounded-full bg-slate-800 px-2 py-px text-[11px] font-bold text-white">{unread} new</span>
          )}
        </span>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={!unread}
          className="text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 disabled:cursor-default disabled:text-slate-400 dark:text-slate-300"
        >
          Mark all read
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex gap-4 border-b border-border px-4">
        {(['all', 'unread'] as const).map((t) => {
          const on = tab === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t)}
              className={cn(
                'h-8 px-1 text-[12.5px] font-semibold transition-colors',
                on
                  ? 'text-slate-900 shadow-[inset_0_-2px_0_#1e293b] dark:text-slate-50 dark:shadow-[inset_0_-2px_0_#f8fafc]'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {t === 'all' ? 'All' : `Unread${unread ? ` · ${unread}` : ''}`}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="max-h-80 overflow-auto py-1.5">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <BellRing className="h-6 w-6" />
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-50">
              {tab === 'unread' && notifications.length > 0 ? 'No unread notifications' : "You're all caught up"}
            </span>
            <span className="max-w-[240px] text-[12px] leading-relaxed text-slate-500">
              Updates about extractions, SAP article creation and failed syncs will show up here.
            </span>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold tracking-[0.1em] text-slate-400">{g.label}</div>
              <ul>
                {g.items.map((n) => {
                  const { Icon, cls } = TYPE_STYLE[n.type] ?? TYPE_STYLE.info;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onMarkRead(n.id)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800',
                          !n.read && 'bg-slate-50 dark:bg-slate-800/50',
                        )}
                      >
                        <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full', cls)}>
                          <Icon className="h-[15px] w-[15px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'text-[13.5px] text-slate-900 dark:text-slate-50',
                              n.read ? 'font-medium' : 'font-bold',
                            )}
                          >
                            {n.title}
                          </span>
                          {n.description && <span className="text-[12px] text-slate-600 dark:text-slate-300">{n.description}</span>}
                          <span className="text-[11px] text-slate-400">{relativeTime(n.createdAt)}</span>
                        </span>
                        {!n.read && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-800 dark:bg-slate-200" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onClear}
          disabled={notifications.length === 0}
          className="text-[12.5px] font-semibold text-red-700 hover:text-red-800 disabled:cursor-default disabled:text-slate-400"
        >
          Clear all
        </button>
        <span className="text-[11.5px] text-slate-400">Esc to close</span>
      </div>
    </div>
  );
};

export default NotificationsPanel;
