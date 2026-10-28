import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { canAccessArticleType } from '../../utils/articleTypeAccess';
import {
  Home,
  ShoppingBag,
  FileSearch,
  Camera,
  CheckSquare,
  FileText,
  History,
  XCircle,
  CheckCircle2,
  SlidersHorizontal,
  BarChart3,
  Globe,
  User,
  Upload,
  ClipboardList,
  Bell,
  ChevronRight,
  ChevronDown,
  LogOut,
  PanelLeftClose,
  Sun,
  Moon,
  Monitor,
  Layers,
  Shirt,
  Package,
  MoreVertical,
} from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { useThemeMode, type Theme } from '@/lib/use-theme';
import {
  getNotifications,
  markAllRead,
  markRead,
  clearNotifications,
  type NotificationItem,
} from '../../services/notifications/notificationStore';
import { resetExtractionSession } from '../../hooks/extraction/useImageExtraction';
import { NotificationsPanel } from './NotificationsPanel';
import { getMyExpenseAccess } from '../../../services/adminApi';

const COLLAPSED_KEY = 'appSidebarCollapsed';

// Option A sidebar (2026-10-14): items grouped under section labels, active
// states in dark slate (no coral), sub-pages hang off a thin tree line.
type NavSection = 'WORKSPACE' | 'ARTICLES' | 'ADMIN';

interface NavLeaf {
  key: string;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Section label shown above this item (top-level items only; none = no label, e.g. Home). */
  section?: NavSection;
}
interface NavGroup extends NavLeaf {
  children: NavLeaf[];
}
type NavItem = NavLeaf | NavGroup;
const hasChildren = (n: NavItem): n is NavGroup => 'children' in n;

interface AppSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ collapsed, onCollapsedChange }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const userData = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null;
  const isAdmin = userData?.role === 'ADMIN';
  const role = userData?.role;
  const isApproverSide = role === 'APPROVER' || role === 'CATEGORY_HEAD';

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [notifOpen, setNotifOpen] = useState(false);
  const [themeMode, setThemeMode] = useThemeMode();
  const cycleTheme = () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(themeMode) + 1) % order.length];
    setThemeMode(next);
  };
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'system' ? Monitor : Sun;
  const themeLabel = themeMode === 'dark' ? 'Dark' : themeMode === 'system' ? 'System' : 'Light';

  useEffect(() => {
    const load = () => {
      if (!userData?.id) {
        setNotifications([]);
        return;
      }
      setNotifications(getNotifications(userData.id));
    };
    load();
    window.addEventListener('notifications:updated', load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener('notifications:updated', load);
      window.removeEventListener('storage', load);
    };
  }, [userData?.id]);

  // PD_DESIGNER is a single-purpose role — only Model Generation, no other nav.
  const isPdDesigner = role === 'PD_DESIGNER';
  // GM_APPROVER / GM_CREATOR are single-purpose roles — only GM Article, no other nav.
  const isGmOnly = role === 'GM_APPROVER' || role === 'GM_CREATOR';

  // Expense Data access is per-email, not per-role, so the only way to know
  // whether to show its nav entry is to ask. Admins already reach it through
  // the Admin Panel, so they are skipped.
  const { data: expenseAccess } = useQuery({
    queryKey: ['my-expense-access', undefined],
    queryFn: () => getMyExpenseAccess(),
    enabled: !isPdDesigner && !isGmOnly && !isAdmin && !!userData?.id,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // PD is an approval-only role: article queues + PD Approval, no extraction/admin.
  const isPd = role === 'PD';

  const items: NavItem[] = isPdDesigner
    ? [{ key: '/model-generation', Icon: Camera, label: 'Model Generation', section: 'WORKSPACE' }]
    : isGmOnly
    ? []
    : [{ key: '/dashboard', Icon: Home, label: 'Home' }];

  if (!isPdDesigner && !isGmOnly) {
    if (isAdmin) {
    }
    // Extraction is available to creator-side roles and to APPROVER.
    // (CATEGORY_HEAD and PD remain approval-only and do not get it.)
    if ((!isApproverSide && !isPd) || role === 'APPROVER') {
      items.push({
        key: '/extraction-group',
        Icon: FileSearch,
        label: 'Extraction',
        section: 'WORKSPACE',
        children: [
          { key: '/extraction/fg-article', Icon: FileText, label: 'FG Article' },
        ],
      });
    }
    // Model Generation — ADMIN, CREATOR, APPROVER (PD_DESIGNER already has it via the items init above).
    if (isAdmin || role === 'CREATOR' || role === 'APPROVER') {
      items.push({ key: '/model-generation', Icon: Camera, label: 'Model Generation', section: 'WORKSPACE' });
    }
  }

  if (
    !isPdDesigner && !isGmOnly && canAccessArticleType(userData, 'FG') &&
    (role === 'APPROVER' ||
      role === 'CATEGORY_HEAD' ||
      role === 'SUB_DIVISION_HEAD' ||
      isAdmin ||
      role === 'CREATOR' ||
      role === 'PO_COMMITTEE' ||
      isPd)
  ) {
    items.push({
      key: '/approver-group',
      Icon: CheckSquare,
      label: 'FG Articles',
      section: 'ARTICLES',
      children: [
        { key: '/approver', Icon: FileText, label: 'New articles' },
        { key: '/approver/created', Icon: CheckCircle2, label: 'Created' },
        { key: '/approver/rejected', Icon: XCircle, label: 'Rejected' },
        { key: '/approver/old-articles', Icon: History, label: 'Old articles' },
      ],
    });
  }

  if (
    !isPdDesigner && !isGmOnly && canAccessArticleType(userData, 'FABRIC') &&
    (role === 'APPROVER' ||
      role === 'CATEGORY_HEAD' ||
      role === 'SUB_DIVISION_HEAD' ||
      isAdmin ||
      role === 'CREATOR' ||
      role === 'PO_COMMITTEE' ||
      isPd)
  ) {
    items.push({
      key: '/fabric-article-group',
      Icon: Layers,
      label: 'Fabric Article',
      section: 'ARTICLES',
      children: [
        { key: '/fabric-article', Icon: FileText, label: 'New articles' },
        { key: '/fabric-article/created', Icon: CheckCircle2, label: 'Created' },
        { key: '/fabric-article/rejected', Icon: XCircle, label: 'Rejected' },
        { key: '/fabric-article/fg-new', Icon: FileText, label: 'FG New Articles' },
        { key: '/fabric-article/fg-created', Icon: CheckCircle2, label: 'FG Created' },
      ],
    });
  }

  // Body Article — visible to standard approver roles AND the dedicated BODY_APPROVER role
  if (
    !isPdDesigner && !isGmOnly &&
    (role === 'APPROVER' ||
      role === 'CATEGORY_HEAD' ||
      role === 'SUB_DIVISION_HEAD' ||
      role === 'BODY_APPROVER' ||
      isAdmin ||
      role === 'CREATOR' ||
      role === 'PO_COMMITTEE' ||
      isPd)
  ) {
    items.push({
      key: '/body-article-group',
      Icon: Shirt,
      label: 'Body Article',
      section: 'ARTICLES',
      children: [
        { key: '/body-article', Icon: FileText, label: 'New articles' },
        { key: '/body-article/created', Icon: CheckCircle2, label: 'Created' },
      ],
    });
  }

  // GM Article — visible to standard approver roles AND GM_APPROVER / GM_CREATOR
  if (
    !isPdDesigner && canAccessArticleType(userData, 'GM') &&
    (role === 'APPROVER' ||
      role === 'CATEGORY_HEAD' ||
      role === 'SUB_DIVISION_HEAD' ||
      role === 'GM_APPROVER' ||
      role === 'GM_CREATOR' ||
      isAdmin ||
      role === 'CREATOR' ||
      role === 'PO_COMMITTEE' ||
      isPd)
  ) {
    items.push({
      key: '/gm-article-group',
      Icon: Package,
      label: 'GM Article',
      section: 'ARTICLES',
      children: [
        { key: '/gm-article', Icon: FileText, label: 'New articles' },
        { key: '/gm-article/created', Icon: CheckCircle2, label: 'Created' },
        { key: '/gm-article/rejected', Icon: XCircle, label: 'Rejected' },
      ],
    });
  }


  // Expense Data: CREATOR/APPROVER get requester rights by role, everyone
  // else in `canView` (a historic view role, or a grant) gets read access —
  // `canView` from /expense/my-access folds both in. Admin reaches the same
  // tables via the full Admin → Expenses page instead.
  if (!isPdDesigner && !isAdmin && expenseAccess?.canView) {
    items.push({ key: '/admin/expense-masters', Icon: ShoppingBag, label: 'Expense Data', section: 'ADMIN' });
    items.push({ key: '/admin/expense-change-requests', Icon: ClipboardList, label: 'Expense Change Requests', section: 'ADMIN' });
  }

  if (!isPdDesigner && isAdmin) {
    items.push({
      key: '/admin',
      Icon: SlidersHorizontal,
      label: 'Admin Panel',
      section: 'ADMIN',
      children: [
        { key: '/admin/status-dashboard', Icon: BarChart3, label: 'Status Dashboard' },
        { key: '/admin/hierarchy', Icon: Globe, label: 'Hierarchy' },
        { key: '/admin/users', Icon: User, label: 'Users' },
        { key: '/admin/expenses', Icon: ShoppingBag, label: 'Expenses' },
        { key: '/admin/expense-audit-log', Icon: History, label: 'Expense Audit Log' },

        { key: '/admin/poolb-uploader', Icon: Upload, label: 'Pool B Uploader' },
        { key: '/admin/ksml-uploader', Icon: Upload, label: 'KSML Uploader' },
        { key: '/admin/modify-logs', Icon: ClipboardList, label: 'Modification Logs' },
      ],
    });
  }

  const isPathActive = (key: string) => location.pathname === key || location.pathname.startsWith(key + '/');

  // Within a group only the most specific match is active, so /approver/created
  // highlights "Created" and not also "New articles" (/approver).
  const isChildActive = (key: string, siblings: { key: string }[]) =>
    isPathActive(key) && !siblings.some((s) => s.key.length > key.length && isPathActive(s.key));

  // Auto-open the group containing the active path
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of items) {
      if (hasChildren(item) && item.children.some((c) => isPathActive(c.key))) {
        next[item.key] = true;
      }
    }
    setOpenGroups((prev) => ({ ...prev, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    resetExtractionSession();
    navigate('/');
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const initials =
    (userData?.name || userData?.email || 'U')
      .split(/\s|@/)
      .map((p: string) => p.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('') || 'U';

  // Active page = filled dark slate; open group with an active child = light slate.
  const ACTIVE = 'bg-slate-800 font-semibold text-white hover:bg-slate-800';
  const IDLE = 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50';

  const renderNavItem = (item: NavItem) => {
    if (hasChildren(item)) {
      const groupActive = item.children.some((c) => isPathActive(c.key));
      const isOpen = !!openGroups[item.key];

      if (collapsed) {
        // Popover for the submenu when collapsed
        return (
          <li>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  className={cn(
                    'flex h-9 w-full items-center justify-center rounded-lg transition-colors',
                    groupActive ? ACTIVE : IDLE,
                  )}
                >
                  <item.Icon className="h-[18px] w-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5">
                <div className="mb-1 px-2 pt-1 text-[10.5px] font-semibold tracking-[0.1em] text-slate-400">
                  {item.label.toUpperCase()}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {item.children.map((c) => {
                    const active = isChildActive(c.key, item.children);
                    return (
                      <li key={c.key}>
                        <button
                          type="button"
                          onClick={() => navigate(c.key)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium transition-colors',
                            active ? ACTIVE : IDLE,
                          )}
                        >
                          <c.Icon className="h-[15px] w-[15px]" />
                          {c.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </PopoverContent>
            </Popover>
          </li>
        );
      }

      // Expanded — inline collapsible, children hang off a thin tree line
      return (
        <li>
          <button
            type="button"
            onClick={() => setOpenGroups((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
            aria-expanded={isOpen}
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors',
              groupActive
                ? 'bg-slate-100 font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                : IDLE,
            )}
          >
            <item.Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1 truncate text-left">{item.label}</span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--duration-base)]',
                isOpen && 'rotate-180',
              )}
            />
          </button>
          {isOpen && (
            <ul className="mb-1 ml-[20px] mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-2.5 dark:border-slate-700">
              {item.children.map((c) => {
                const active = isChildActive(c.key, item.children);
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => navigate(c.key)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                        active ? ACTIVE : IDLE,
                      )}
                    >
                      <c.Icon className="h-[15px] w-[15px] shrink-0" />
                      <span className="truncate">{c.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    }

    // Leaf nav item
    const active = isPathActive(item.key);
    const btn = (
      <button
        type="button"
        onClick={() => navigate(item.key)}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'flex h-9 w-full items-center rounded-lg text-sm font-medium transition-colors',
          collapsed ? 'justify-center' : 'gap-3 px-2.5',
          active ? ACTIVE : IDLE,
        )}
      >
        <item.Icon className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
    );

    return (
      <li>
        {collapsed ? (
          <TooltipRoot>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {item.label}
            </TooltipContent>
          </TooltipRoot>
        ) : (
          btn
        )}
      </li>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-collapsed={collapsed}
        className={cn(
          'group/sb relative flex h-full shrink-0 flex-col border-r border-border bg-white',
          'shadow-[var(--shadow-sm)]',
          'transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out-quart)]',
          collapsed ? 'w-[60px]' : 'w-[256px]',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-border',
            collapsed ? 'justify-center px-1' : 'gap-2.5 px-3',
          )}
        >
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className={cn(
              'flex items-center gap-2.5 truncate rounded-md transition-colors',
              !collapsed && 'flex-1 px-1.5 py-1 hover:bg-accent',
            )}
          >
            <img src="/V2retail.png" alt="V2Retail" className="h-7 w-7 shrink-0 object-contain" />
            {!collapsed && (
              <span className="font-display truncate text-[15px] font-semibold tracking-tight">
                Article Creation
              </span>
            )}
          </button>
          {!collapsed && (
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              onClick={() => onCollapsedChange(true)}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose />
            </Button>
          )}
        </div>

        {/* Reopen affordance when collapsed — a floating chevron at the brand row */}
        {collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            aria-label="Expand sidebar"
            className={cn(
              'absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full',
              'border border-border bg-white text-muted-foreground shadow-[var(--shadow-sm)]',
              'transition-all duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
              'hover:bg-slate-800 hover:text-white hover:scale-105',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <ul className={cn('flex flex-col gap-0.5', collapsed ? 'px-1.5' : 'px-2.5')}>
            {items.map((item, idx) => {
              // Section label (expanded) / thin divider (collapsed) when the section changes.
              const sectionStart =
                !!item.section && item.section !== items[idx - 1]?.section ? (
                  collapsed ? (
                    <li key={`sec-${item.section}`} aria-hidden="true" className="mx-2 my-1.5 h-px bg-border" />
                  ) : (
                    <li
                      key={`sec-${item.section}`}
                      className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold tracking-[0.1em] text-slate-400"
                    >
                      {item.section}
                    </li>
                  )
                ) : null;
              return (
                <React.Fragment key={item.key}>
                  {sectionStart}
                  {renderNavItem(item)}
                </React.Fragment>
              );
            })}
          </ul>
        </nav>

        <Separator />

        {/* Footer: notifications + user */}
        <div className={cn('flex shrink-0 flex-col gap-1 py-2', collapsed ? 'px-1.5' : 'px-2')}>
          {/* Notifications — popover opens beside the bell row, bottom-aligned, arrow points at it */}
          <Popover open={notifOpen} onOpenChange={setNotifOpen}>
            <PopoverTrigger asChild>
              {collapsed ? (
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                      className={cn(
                        'relative flex h-9 w-full items-center justify-center rounded-lg transition-colors',
                        notifOpen ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-50' : IDLE,
                      )}
                    >
                      <Bell className="h-4 w-4" />
                      {unreadCount > 0 && (
                        <Badge
                          variant="destructive"
                          className="absolute right-1 top-1 h-3.5 min-w-[14px] justify-center px-1 text-[9px] leading-none"
                        >
                          {unreadCount}
                        </Badge>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Notifications
                  </TooltipContent>
                </TooltipRoot>
              ) : (
                <button
                  type="button"
                  aria-expanded={notifOpen}
                  className={cn(
                    'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors',
                    notifOpen ? 'bg-slate-200 font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-50' : IDLE,
                  )}
                >
                  <Bell className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 text-left">Notifications</span>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="h-[18px] min-w-[18px] justify-center rounded-full px-1.5 text-[11px]">
                      {unreadCount}
                    </Badge>
                  )}
                </button>
              )}
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="end"
              sideOffset={12}
              className="w-[380px] rounded-2xl p-0 shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
            >
              <NotificationsPanel
                notifications={notifications}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
                onClear={clearNotifications}
              />
            </PopoverContent>
          </Popover>

          {/* Theme toggle — cycles light → dark → system */}
          {collapsed ? (
            <TooltipRoot>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={cycleTheme}
                  className="flex h-9 w-full items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
                >
                  <ThemeIcon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Theme: {themeLabel} (click to cycle)
              </TooltipContent>
            </TooltipRoot>
          ) : (
            // Expanded: segmented Light / Dark / System switch
            <div role="radiogroup" aria-label="Theme" className="mx-1 flex rounded-lg bg-slate-100 p-[3px] dark:bg-slate-800">
              {([
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
                ['system', 'System', Monitor],
              ] as const).map(([mode, label, Icon]) => {
                const on = themeMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setThemeMode(mode)}
                    className={cn(
                      'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors',
                      on
                        ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-slate-950 dark:text-slate-50'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* User */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {collapsed ? (
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Account: ${userData?.name || 'User'}`}
                      className="flex h-9 w-full items-center justify-center rounded-lg transition-colors hover:bg-slate-100 data-[state=open]:bg-slate-200 dark:hover:bg-slate-800 dark:data-[state=open]:bg-slate-700"
                    >
                      <Avatar className="h-7 w-7 bg-slate-800">
                        <AvatarFallback className="bg-slate-800 text-[11px] font-bold text-white">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {userData?.name || 'Account'}
                  </TooltipContent>
                </TooltipRoot>
              ) : (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2 transition-colors hover:bg-slate-100 data-[state=open]:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:data-[state=open]:bg-slate-700"
                >
                  <Avatar className="h-8 w-8 bg-slate-800">
                    <AvatarFallback className="bg-slate-800 text-[12px] font-bold text-white">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                    <span className="truncate text-sm font-semibold">{userData?.name || 'User'}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {userData?.role
                        ? userData.role.charAt(0).toUpperCase() + userData.role.slice(1).toLowerCase()
                        : 'Member'}
                    </span>
                  </div>
                  <MoreVertical className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              )}
            </DropdownMenuTrigger>
            {/* Account menu — same treatment as Notifications: beside the user card,
                bottom-aligned, arrow pointing at it, slate states */}
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={12}
              className="relative w-64 overflow-visible rounded-2xl p-0 shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
            >
              <span
                aria-hidden="true"
                className="absolute -left-[7px] bottom-5 h-3 w-3 rotate-45 border-b border-l border-border bg-popover"
              />
              <DropdownMenuLabel className="flex items-center gap-3 px-4 py-3.5 font-normal">
                <Avatar className="h-10 w-10 bg-slate-800">
                  <AvatarFallback className="bg-slate-800 text-[13px] font-bold text-white">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[14px] font-bold text-slate-900 dark:text-slate-50">
                    {userData?.name || 'User'}
                  </span>
                  {userData?.email && (
                    <span className="truncate text-[12px] text-slate-500">{userData.email}</span>
                  )}
                  <span className="mt-1 w-fit rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {userData?.role ? String(userData.role).replace(/_/g, ' ') : 'MEMBER'}
                  </span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="mx-0 my-0" />
              <div className="p-1.5">
                <DropdownMenuItem
                  onClick={() => navigate('/profile')}
                  className="h-9 gap-3 rounded-lg px-2.5 font-medium text-slate-700 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-200 dark:focus:bg-slate-800"
                >
                  <User className="h-4 w-4" />
                  Profile
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator className="mx-0 my-0" />
              <div className="p-1.5">
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="h-9 gap-3 rounded-lg px-2.5 font-semibold text-red-700 focus:bg-red-50 focus:text-red-800 dark:text-red-400 dark:focus:bg-red-950/40"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
};

/** Read the persisted collapsed flag once at mount. */
export const useSidebarCollapsed = (): [boolean, (next: boolean) => void] => {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [collapsed, setCollapsed];
};
