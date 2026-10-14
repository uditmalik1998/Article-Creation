import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Zap, SlidersHorizontal, Calendar, CheckSquare, Camera, AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import './Dashboard.css';
import { APP_CONFIG } from '../../../constants/app/config';

type FlatDashboardRow = {
  id?: string;
  jobId?: string;
  division?: string | null;
  subDivision?: string | null;
  approvalStatus?: string | null;
  createdAt?: string | null;
};

type AnalyticsSummaryRow = {
  key: string;
  date: string;
  division: string;
  subDivision: string;
  totalExtractions: number;
  totalApproved: number;
};

const normalizeDivisionLabel = (value?: string | null): string => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MEN') return 'MENS';
  return normalized || 'N/A';
};

const getDashboardTableViewportOffset = (): number => {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  let offset = 150;
  if (height < 800) offset += 25;
  if (width < 1440) offset += 15;
  if (ratio > 1.25) offset += 20;
  if (ratio > 1.5) offset += 16;
  if (ratio < 1) offset -= 12;
  return offset;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const user = localStorage.getItem('user');
  const userData = user ? JSON.parse(user) : null;
  const isAdmin = userData?.role === 'ADMIN';
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [analyticsRows, setAnalyticsRows] = useState<AnalyticsSummaryRow[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const analyticsTableRef = useRef<HTMLDivElement>(null);
  const [analyticsScrollY, setAnalyticsScrollY] = useState(420);
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [divisionFilter, setDivisionFilter] = useState<string>('ALL');
  const [subDivisionFilter, setSubDivisionFilter] = useState<string>('ALL');

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const recalcAnalyticsScrollY = useCallback(() => {
    const el = analyticsTableRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const viewportOffset = getDashboardTableViewportOffset();
    setAnalyticsScrollY(Math.max(220, window.innerHeight - top - viewportOffset));
  }, []);

  useEffect(() => {
    recalcAnalyticsScrollY();
    window.addEventListener('resize', recalcAnalyticsScrollY);
    return () => window.removeEventListener('resize', recalcAnalyticsScrollY);
  }, [recalcAnalyticsScrollY]);

  useEffect(() => {
    const fetchStats = async () => {
      setAnalyticsLoading(true);
      try {
        const token = localStorage.getItem('authToken');
        const endpoint = `${APP_CONFIG.api.baseURL}/user/extraction/history/flat`;
        const response = await fetch(endpoint, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!response.ok) throw new Error('Failed to fetch extraction history');

        const result = await response.json();
        const jobs: FlatDashboardRow[] = result?.data?.jobs || [];
        const total = jobs.length;
        const today = new Date();
        const todayCountValue = jobs.filter((job) => {
          if (!job.createdAt) return false;
          const createdAt = new Date(job.createdAt);
          return createdAt.toDateString() === today.toDateString();
        }).length;

        const groupedRows = new Map<string, AnalyticsSummaryRow>();

        jobs.forEach((job) => {
          if (!job.createdAt) return;
          const createdAt = new Date(job.createdAt);
          if (Number.isNaN(createdAt.getTime())) return;

          const date = createdAt.toLocaleDateString('en-GB').replace(/\//g, '-');
          const division = normalizeDivisionLabel(job.division);
          const subDivision = String(job.subDivision || 'N/A').trim() || 'N/A';
          const key = `${date}__${division}__${subDivision}`;

          const existing = groupedRows.get(key) || {
            key,
            date,
            division,
            subDivision,
            totalExtractions: 0,
            totalApproved: 0,
          };
          existing.totalExtractions += 1;
          if (String(job.approvalStatus || '').toUpperCase() === 'APPROVED') {
            existing.totalApproved += 1;
          }
          groupedRows.set(key, existing);
        });

        const analyticsData = Array.from(groupedRows.values()).sort((a, b) => {
          const [dayA, monthA, yearA] = a.date.split('-').map(Number);
          const [dayB, monthB, yearB] = b.date.split('-').map(Number);
          const timeA = new Date(yearA, monthA - 1, dayA).getTime();
          const timeB = new Date(yearB, monthB - 1, dayB).getTime();
          if (timeB !== timeA) return timeB - timeA;
          if (a.division !== b.division) return a.division.localeCompare(b.division);
          return a.subDivision.localeCompare(b.subDivision);
        });

        setTotalCount(total);
        setTodayCount(todayCountValue);
        setAnalyticsRows(analyticsData);
        setTimeout(recalcAnalyticsScrollY, 50);
      } catch {
        setTotalCount(0);
        setTodayCount(0);
        setAnalyticsRows([]);
      } finally {
        setAnalyticsLoading(false);
      }
    };

    fetchStats();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'extractionsLastUpdated') fetchStats();
    };
    const handleFocus = () => fetchStats();

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isAdmin, recalcAnalyticsScrollY]);

  const analyticsColumns = useMemo<DataTableColumn<AnalyticsSummaryRow>[]>(
    () => [
      { title: 'Date', dataIndex: 'date', key: 'date', width: 130 },
      { title: 'Division', dataIndex: 'division', key: 'division', width: 120 },
      { title: 'Sub Division', dataIndex: 'subDivision', key: 'subDivision', width: 140 },
      { title: 'Total Extractions', dataIndex: 'totalExtractions', key: 'totalExtractions', width: 150 },
      { title: 'Total Approved', dataIndex: 'totalApproved', key: 'totalApproved', width: 140 },
    ],
    [],
  );

  const dateOptions = useMemo(() => {
    return Array.from(new Set(analyticsRows.map((row) => row.date))).sort((a, b) => {
      const [dayA, monthA, yearA] = a.split('-').map(Number);
      const [dayB, monthB, yearB] = b.split('-').map(Number);
      return new Date(yearB, monthB - 1, dayB).getTime() - new Date(yearA, monthA - 1, dayA).getTime();
    });
  }, [analyticsRows]);

  const divisionOptions = useMemo(() => {
    const rows = analyticsRows.filter((row) => dateFilter === 'ALL' || row.date === dateFilter);
    return Array.from(new Set(rows.map((row) => row.division))).sort();
  }, [analyticsRows, dateFilter]);

  const subDivisionOptions = useMemo(() => {
    const rows = analyticsRows.filter((row) => {
      if (dateFilter !== 'ALL' && row.date !== dateFilter) return false;
      if (divisionFilter !== 'ALL' && row.division !== divisionFilter) return false;
      return true;
    });
    return Array.from(new Set(rows.map((row) => row.subDivision))).sort();
  }, [analyticsRows, dateFilter, divisionFilter]);

  const filteredAnalyticsRows = useMemo(() => {
    return analyticsRows.filter((row) => {
      if (dateFilter !== 'ALL' && row.date !== dateFilter) return false;
      if (divisionFilter !== 'ALL' && row.division !== divisionFilter) return false;
      if (subDivisionFilter !== 'ALL' && row.subDivision !== subDivisionFilter) return false;
      return true;
    });
  }, [analyticsRows, dateFilter, divisionFilter, subDivisionFilter]);

  useEffect(() => {
    if (divisionFilter !== 'ALL' && !divisionOptions.includes(divisionFilter)) setDivisionFilter('ALL');
  }, [divisionFilter, divisionOptions]);

  useEffect(() => {
    if (subDivisionFilter !== 'ALL' && !subDivisionOptions.includes(subDivisionFilter)) setSubDivisionFilter('ALL');
  }, [subDivisionFilter, subDivisionOptions]);

  // ── Option E "Action-first" home (2026-10-14) ──────────────────────────────
  const role = userData?.role as string | undefined;
  const canFgArticles = ['APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'CREATOR', 'PO_COMMITTEE', 'PD'].includes(role || '');
  const canModelGen = isAdmin || role === 'CREATOR' || role === 'APPROVER' || role === 'PD_DESIGNER';

  const todayKey = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  const todayApproved = useMemo(
    () => analyticsRows.filter((r) => r.date === todayKey).reduce((s, r) => s + r.totalApproved, 0),
    [analyticsRows, todayKey],
  );

  // Most recent day before today that has data ("Yesterday at a glance").
  const glance = useMemo(() => {
    const day = analyticsRows.find((r) => r.date !== todayKey)?.date;
    if (!day) return null;
    const rows = analyticsRows.filter((r) => r.date === day);
    const byDiv = new Map<string, { ex: number; ap: number }>();
    rows.forEach((r) => {
      const d = byDiv.get(r.division) || { ex: 0, ap: 0 };
      d.ex += r.totalExtractions;
      d.ap += r.totalApproved;
      byDiv.set(r.division, d);
    });
    const [dd, mm, yy] = day.split('-').map(Number);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const label =
      day === yesterday.toLocaleDateString('en-GB').replace(/\//g, '-')
        ? 'Yesterday at a glance'
        : `${new Date(yy, mm - 1, dd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at a glance`;
    // Lowest approval among sub-divisions with a meaningful count.
    const lowest = rows
      .filter((r) => r.totalExtractions >= 5 && r.totalApproved < r.totalExtractions)
      .sort((a, b) => a.totalApproved / a.totalExtractions - b.totalApproved / b.totalExtractions)
      .slice(0, 2);
    return {
      label,
      divisions: Array.from(byDiv, ([name, v]) => ({ name, ...v, pct: v.ex ? Math.round((v.ap / v.ex) * 100) : 0 })),
      lowest,
    };
  }, [analyticsRows, todayKey]);

  const dateLabel = new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
    .toUpperCase();

  const quickActions = [
    canFgArticles && { title: 'Review new FG articles', sub: 'Approve extracted articles and push to SAP', cta: 'Open New articles', to: '/approver', Icon: CheckSquare },
    canModelGen && { title: 'Model generation', sub: 'Turn garment photos into on-model shots', cta: 'Open studio', to: '/model-generation', Icon: Camera },
    canFgArticles && { title: 'Failed creations', sub: 'Articles SAP rejected — fix and retry', cta: 'Open Failed', to: '/approver/failed', Icon: AlertTriangle },
    isAdmin
      ? { title: 'Admin panel', sub: 'Users, hierarchy and uploaders', cta: 'Open Admin', to: '/admin', Icon: SlidersHorizontal }
      : canFgArticles && { title: 'Created articles', sub: 'Articles already created in SAP', cta: 'Open Created', to: '/approver/created', Icon: ShoppingBag },
  ].filter(Boolean) as { title: string; sub: string; cta: string; to: string; Icon: typeof Camera }[];

  return (
    <div className="flex flex-col gap-5">
      {/* Hero band */}
      <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-slate-800 px-7 py-6 text-slate-50">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold tracking-[0.08em] text-slate-300">{dateLabel}</div>
          <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight">
            {greeting}, {userData?.name || 'there'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-200">
            <b className="tabular-nums">{todayCount ?? 0}</b> extraction{(todayCount ?? 0) === 1 ? '' : 's'} today ·{' '}
            <b className="tabular-nums">{todayApproved}</b> approved · <b className="tabular-nums">{totalCount ?? 0}</b> all-time
          </p>
        </div>
        <Button
          className="h-[46px] rounded-xl bg-slate-50 px-6 text-sm font-bold text-slate-900 hover:bg-white"
          onClick={() => navigate('/extraction')}
        >
          <Zap />
          Start extraction
        </Button>
      </section>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((a) => (
            <button
              key={a.to}
              type="button"
              onClick={() => navigate(a.to)}
              className="group flex flex-col items-start gap-2.5 rounded-[14px] border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            >
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                <a.Icon className="h-[19px] w-[19px]" />
              </span>
              <b className="text-[14.5px] text-slate-900 dark:text-slate-50">{a.title}</b>
              <span className="text-[12.5px] text-slate-500">{a.sub}</span>
              <span className="text-[12.5px] font-semibold text-slate-800 group-hover:underline dark:text-slate-200">{a.cta} →</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0 overflow-hidden rounded-[14px]">
        {/* Header — title + filters */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h4 className="text-[15px] font-bold leading-tight text-slate-900 dark:text-slate-50">Extraction timeline</h4>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span><span className="font-semibold tabular-nums text-foreground">{todayCount ?? 0}</span> today · <span className="font-semibold tabular-nums text-foreground">{totalCount ?? 0}</span> total</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="!h-7 w-[140px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Dates</SelectItem>
                {dateOptions.map((date) => (
                  <SelectItem key={date} value={date}>
                    {date}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={divisionFilter}
              onValueChange={(value) => {
                setDivisionFilter(value);
                setSubDivisionFilter('ALL');
              }}
            >
              <SelectTrigger className="!h-7 w-[140px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Divisions</SelectItem>
                {divisionOptions.map((division) => (
                  <SelectItem key={division} value={division}>
                    {division}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={subDivisionFilter} onValueChange={setSubDivisionFilter}>
              <SelectTrigger className="!h-7 w-[160px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sub Divisions</SelectItem>
                {subDivisionOptions.map((sd) => (
                  <SelectItem key={sd} value={sd}>
                    {sd}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div ref={analyticsTableRef} className="p-3">
          <DataTable<AnalyticsSummaryRow>
            columns={analyticsColumns}
            dataSource={filteredAnalyticsRows}
            loading={analyticsLoading}
            size="small"
            rowKey="key"
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              pageSizeOptions: ['25', '50', '100'],
            }}
            scroll={{ x: 'max-content', y: analyticsScrollY }}
            sticky
            locale={{ emptyText: 'No analytics data available yet' }}
            className="dashboard-analytics-table"
          />
        </div>
      </Card>

      {/* Yesterday (latest earlier day) at a glance */}
      <section className="flex flex-col gap-3 rounded-[14px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <b className="text-[15px] text-slate-900 dark:text-slate-50">{glance?.label ?? 'Yesterday at a glance'}</b>
        {!glance ? (
          <span className="text-[12.5px] text-slate-500">No earlier activity yet.</span>
        ) : (
          <>
            {glance.divisions.map((d) => (
              <div key={d.name} className="flex flex-col gap-1.5">
                <span className="flex justify-between text-[12.5px]">
                  <b className="text-slate-900 dark:text-slate-50">{d.name}</b>
                  <span className="tabular-nums text-slate-600 dark:text-slate-400">
                    {d.ap}/{d.ex} · {d.pct}%
                  </span>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <span className="block h-2 bg-slate-800 dark:bg-slate-200" style={{ width: `${d.pct}%` }} />
                </span>
              </div>
            ))}
            {glance.lowest.length > 0 && (
              <span className="mt-1 text-[12px] text-slate-500">
                Needs a look:{' '}
                {glance.lowest.map((r, i) => (
                  <span key={r.key}>
                    {i > 0 && ', '}
                    <b className="text-slate-900 dark:text-slate-50">{r.subDivision}</b> ({r.totalApproved} of {r.totalExtractions} approved)
                  </span>
                ))}
                .
              </span>
            )}
          </>
        )}
      </section>
      </div>
    </div>
  );
}
