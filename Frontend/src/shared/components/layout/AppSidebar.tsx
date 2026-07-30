import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  AlertTriangle,
  Upload,
  ClipboardList,
  Bell,
  ChevronRight,
  ChevronDown,
  LogOut,
  Settings,
  PanelLeftClose,
  Sun,
  Moon,
  Monitor,
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
  Empty,
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

const COLLAPSED_KEY = 'appSidebarCollapsed';

interface NavLeaf {
  key: string;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
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
  // PD is an approval-only role: article queues + PD Approval, no extraction/admin.
  const isPd = role === 'PD';

  const items: NavItem[] = isPdDesigner
    ? [{ key: '/model-generation', Icon: Camera, label: 'Model Generation' }]
    : [{ key: '/dashboard', Icon: Home, label: 'Home' }];

  if (!isPdDesigner) {
    if (isAdmin) {
      items.push({ key: '/products', Icon: ShoppingBag, label: 'Products' });
    }
    // Extraction is available to creator-side roles and to APPROVER.
    // (CATEGORY_HEAD and PD remain approval-only and do not get it.)
    if ((!isApproverSide && !isPd) || role === 'APPROVER') {
      items.push({ key: '/extraction', Icon: FileSearch, label: 'Extraction' });
    }
    // Model Generation — ADMIN, CREATOR, APPROVER (PD_DESIGNER already has it via the items init above).
    if (isAdmin || role === 'CREATOR' || role === 'APPROVER') {
      items.push({ key: '/model-generation', Icon: Camera, label: 'Model Generation' });
    }
  }

  if (
    !isPdDesigner &&
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
      children: [
        { key: '/approver', Icon: FileText, label: 'New articles' },
        { key: '/approver/old-articles', Icon: History, label: 'Old articles' },
        { key: '/approver/rejected', Icon: XCircle, label: 'Rejected' },
        { key: '/approver/created', Icon: CheckCircle2, label: 'Created' },
        { key: '/approver/failed', Icon: AlertTriangle, label: 'Failed Creations' },
      ],
    });
  }

  if (
    !isPdDesigner &&
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
      Icon: CheckSquare,
      label: 'Fabric Article',
      children: [
        { key: '/fabric-article', Icon: FileText, label: 'New articles' },
        { key: '/fabric-article/old-articles', Icon: History, label: 'Old articles' },
        { key: '/fabric-article/rejected', Icon: XCircle, label: 'Rejected' },
        { key: '/fabric-article/created', Icon: CheckCircle2, label: 'Created' },
        { key: '/fabric-article/failed', Icon: AlertTriangle, label: 'Failed Creations' },
      ],
    });
  }

  if (!isPdDesigner && (role === 'APPROVER' || role === 'CATEGORY_HEAD' || role === 'SUB_DIVISION_HEAD' || isAdmin)) {
    items.push({ key: '/po-presentation', Icon: FileText, label: 'PO Presentation' });
  }

  if (!isPdDesigner && isAdmin) {
    items.push({
      key: '/admin',
      Icon: SlidersHorizontal,
      label: 'Admin Panel',
      children: [
        { key: '/admin/status-dashboard', Icon: BarChart3, label: 'Status Dashboard' },
        { key: '/admin/hierarchy', Icon: Globe, label: 'Hierarchy' },
        { key: '/admin/users', Icon: User, label: 'Users' },
        { key: '/admin/expenses', Icon: ShoppingBag, label: 'Expenses' },
        { key: '/admin/srm-failed', Icon: AlertTriangle, label: 'Failed Extractions' },
        { key: '/admin/ksml-uploader', Icon: Upload, label: 'KSML Uploader' },
        { key: '/admin/poolb-uploader', Icon: Upload, label: 'Pool B Uploader' },
        { key: '/admin/modify-logs', Icon: ClipboardList, label: 'Modification Logs' },
      ],
    });
  }

  const isPathActive = (key: string) => location.pathname === key || location.pathname.startsWith(key + '/');

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

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-collapsed={collapsed}
        className={cn(
          'group/sb relative flex h-full shrink-0 flex-col border-r border-border bg-white',
          'shadow-[var(--shadow-sm)]',
          'transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out-quart)]',
          collapsed ? 'w-[60px]' : 'w-[232px]',
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
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
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
              'hover:bg-primary hover:text-primary-foreground hover:scale-105',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <ul className={cn('flex flex-col gap-0.5', collapsed ? 'px-1.5' : 'px-2')}>
            {items.map((item) => {
              if (hasChildren(item)) {
                const groupActive = item.children.some((c) => isPathActive(c.key));
                const isOpen = !!openGroups[item.key];

                if (collapsed) {
                  // Popover-on-hover for the submenu when collapsed
                  return (
                    <li key={item.key}>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              'flex h-9 w-full items-center justify-center rounded-md transition-colors',
                              groupActive
                                ? 'bg-primary/12 text-primary'
                                : 'text-foreground hover:bg-accent',
                            )}
                          >
                            <item.Icon className="h-4 w-4" />
                            <span className="sr-only">{item.label}</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5">
                          <div className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {item.label}
                          </div>
                          <ul className="flex flex-col gap-0.5">
                            {item.children.map((c) => {
                              const active = isPathActive(c.key);
                              return (
                                <li key={c.key}>
                                  <button
                                    type="button"
                                    onClick={() => navigate(c.key)}
                                    className={cn(
                                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                      active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                                    )}
                                  >
                                    <c.Icon className="h-4 w-4" />
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

                // Expanded — inline collapsible
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                      }
                      className={cn(
                        'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
                        groupActive
                          ? 'bg-primary/10 font-medium text-foreground'
                          : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <item.Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-base)]',
                          isOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {isOpen && (
                      <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                        {item.children.map((c) => {
                          const active = isPathActive(c.key);
                          return (
                            <li key={c.key}>
                              <button
                                type="button"
                                onClick={() => navigate(c.key)}
                                className={cn(
                                  'relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
                                  active
                                    ? 'bg-primary/10 font-medium text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                )}
                              >
                                {active && (
                                  <span className="absolute -left-2.5 top-1.5 h-5 w-0.5 rounded-r bg-primary" />
                                )}
                                <c.Icon className="h-3.5 w-3.5" />
                                {c.label}
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
                  className={cn(
                    'relative flex h-9 w-full items-center rounded-md text-sm transition-colors',
                    collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-foreground hover:bg-accent',
                  )}
                >
                  {active && !collapsed && (
                    <span className="absolute -left-2 top-2 h-5 w-0.5 rounded-r bg-primary" />
                  )}
                  <item.Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );

              return (
                <li key={item.key}>
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
            })}
          </ul>
        </nav>

        <Separator />

        {/* Footer: notifications + user */}
        <div className={cn('flex shrink-0 flex-col gap-1 py-2', collapsed ? 'px-1.5' : 'px-2')}>
          {/* Notifications */}
          <Popover>
            <PopoverTrigger asChild>
              {collapsed ? (
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="relative flex h-9 w-full items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
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
                  className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  <Bell className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">Notifications</span>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-[18px] justify-center px-1 text-[10px]">
                      {unreadCount}
                    </Badge>
                  )}
                </button>
              )}
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={8} className="w-80 p-0">
              <div className="flex items-center justify-between p-3">
                <span className="font-display text-sm font-semibold">Notifications</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-1"
                    onClick={markAllRead}
                    disabled={!unreadCount}
                  >
                    Mark all read
                  </Button>
                  <Button variant="link" size="sm" className="h-auto px-1" onClick={clearNotifications}>
                    Clear
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="max-h-80 overflow-auto">
                {notifications.length === 0 ? (
                  <Empty description="No notifications" size="compact" className="py-3" />
                ) : (
                  <ul className="divide-y divide-border">
                    {notifications.map((n) => (
                      <li
                        key={n.id}
                        className={cn(
                          'cursor-pointer p-3 transition-colors hover:bg-accent',
                          n.read ? '' : 'bg-primary/5',
                        )}
                        onClick={() => markRead(n.id)}
                      >
                        <div className={cn('text-sm', !n.read && 'font-semibold')}>{n.title}</div>
                        <div className="text-sm text-muted-foreground">{n.description}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatTime(n.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
            <button
              type="button"
              onClick={cycleTheme}
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <ThemeIcon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Theme</span>
              <span className="text-[11px] font-medium text-muted-foreground">{themeLabel}</span>
            </button>
          )}

          {/* User */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {collapsed ? (
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-full items-center justify-center rounded-md transition-colors hover:bg-accent"
                    >
                      <Avatar className="h-7 w-7 bg-neutral-900">
                        <AvatarFallback className="bg-neutral-900 text-[11px] text-white">
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
                  className="flex w-full items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-accent"
                >
                  <Avatar className="h-8 w-8 bg-neutral-900">
                    <AvatarFallback className="bg-neutral-900 text-[12px] text-white">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                    <span className="truncate text-sm font-semibold">{userData?.name || 'User'}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {userData?.role
                        ? userData.role.charAt(0).toUpperCase() + userData.role.slice(1).toLowerCase()
                        : 'Member'}
                    </span>
                  </div>
                </button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" sideOffset={8}>
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <Settings className="h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Logout
              </DropdownMenuItem>
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
