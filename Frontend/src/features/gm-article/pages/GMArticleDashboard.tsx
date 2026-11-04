import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import { Search, ChevronDown } from 'lucide-react';
import type { Dayjs } from 'dayjs';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import type { ApproverItem } from '../types';
import { ArticleSpecCard } from '@/shared/components/articles/ArticleSpecCard';
import { ArticleCardGrid, ARTICLE_CARD_GRID_CLASS, GroupByControl, useArticleGroupBy } from '@/shared/components/articles/ArticleCardGrid';
import { DatePresetFilter, DivisionTabs, divisionOption, ResetFiltersButton, SapSyncChips } from '@/shared/components/articles/ArticleFilters';
import { ArticleListHeader } from '@/shared/components/articles/ArticleListHeader';
import { APP_CONFIG } from '../../../constants/app/config';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import { getMcCodeByMajorCategory, MAJOR_CATEGORY_ALLOWED_VALUES } from '../../../data/majorCategoryMcCodeMap';
import { exportToExcel } from '../../../shared/utils/export/extractionExport';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import type { DetailFilters, DetailNavigationState } from './GMArticleDetailPage';

const inferMcCode = (majorCategory?: string | null) => getMcCodeByMajorCategory(majorCategory);

const normalizeText = (value?: string | null): string => String(value || '').trim().toUpperCase();

const getDivisionVariants = (value?: string | null): string[] => {
  const parts = String(value || '').split(/[;,|]+/).map(normalizeText).filter(Boolean);
  const canonical = parts.map(n => {
    if (n === 'MEN' || n === 'MENS') return 'MENS';
    if (n === 'LADIES' || n === 'WOMEN' || n === 'WOMAN') return 'LADIES';
    if (n === 'KID' || n === 'KIDS') return 'KIDS';
    return n;
  });
  return Array.from(new Set(canonical));
};

const getSubDivisionVariants = (value?: string | null): string[] =>
  Array.from(new Set(String(value || '').split(/[;,|]+/).map(normalizeText).filter(Boolean)));

const getSubDivisionOptions = (division?: string): string[] => {
  if (!division) return [];
  if (division.match(/LADIES|WOMEN/i)) return SIMPLIFIED_HIERARCHY['Ladies'];
  if (division.match(/KIDS/i)) return SIMPLIFIED_HIERARCHY['Kids'];
  if (division.match(/MEN/i)) return SIMPLIFIED_HIERARCHY['MENS'];
  return [];
};

// GM Excel download (gm_article_data + gm_variants_article_data). GM attribute columns
// (GM_BRAND, GM_MATERIAL, …) follow these — only the ones with a value in some exported row.
const GM_EXPORT_HEADERS = [
  'Article Number', 'Article Description',
  'Division', 'Sub Division', 'Major Category', 'MC Description',
  'Status', 'SAP Sync Status',
  'Vendor Name', 'Vendor Code', 'Design Number', 'PPT Number',
  'Rate', 'MRP', 'Rough V2', 'Vendor Cost', 'Final Cost',
  'Segment', 'Article Fashion Type', 'Source',
  'Created Date', 'Approved Date', 'Approved By',
] as const;

// "With variants": the two article-number columns lead, then the variant's colour / size,
// then the rest of GM_EXPORT_HEADERS (minus 'Article Number').
const GM_VARIANT_LEAD_HEADERS = ['Parent Article Number', 'Variant Article Number', 'Variant Color', 'Variant Size'] as const;

const toExportDate = (v?: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB') : '';
};
const toExportNum = (v: unknown) => (v == null || v === '' ? undefined : Number(v));

/** GM_* attribute codes that have a value in at least one row, A→Z. */
function gmAttrCodesWithValues(rows: any[]): string[] {
  const codes = new Set<string>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('GM_') && v != null && String(v).trim() !== '') codes.add(k);
    }
  }
  return [...codes].sort();
}

function mapGmExportRow(row: any, attrCodes: string[]): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {
    'Article Number':        row.articleNumber || '',
    // The API maps gm_article_description onto fabricArticleDescription (shared card shape).
    'Article Description':   row.fabricArticleDescription || '',
    Division:                row.division || '',
    'Sub Division':          row.subDivision || '',
    'Major Category':        row.majorCategory || '',
    'MC Description':        row.mcDescription || '',
    Status:                  row.approvalStatus || '',
    'SAP Sync Status':       row.sapSyncStatus || '',
    'Vendor Name':           row.vendorName || '',
    'Vendor Code':           row.vendorCode || '',
    'Design Number':         row.designNumber || '',
    'PPT Number':            row.pptNumber || '',
    Rate:                    toExportNum(row.rate),
    MRP:                     toExportNum(row.mrp),
    'Rough V2':              toExportNum(row.roughV2),
    'Vendor Cost':           toExportNum(row.vdrCost),
    'Final Cost':            toExportNum(row.finalCost),
    Segment:                 row.segment || '',
    'Article Fashion Type':  row.articleFashionType || '',
    Source:                  row.source || '',
    'Created Date':          toExportDate(row.createdAt),
    'Approved Date':         toExportDate(row.approvedAt),
    'Approved By':           row.approvedByName || '',
    // Generic row: its own number is the parent; variant number left empty.
    'Parent Article Number': row._rowType === 'Variant' ? row._parentArticleNumber || '' : row.articleNumber || '',
    'Variant Article Number': row._rowType === 'Variant' ? row.articleNumber || '' : '',
    'Variant Color':         row.variantColor || '',
    'Variant Size':          row.variantSize || '',
  };
  for (const code of attrCodes) out[code] = row[code] ?? '';
  return out;
}

// Download file names: GM-<Tab>-Article[-Variants|-Selected][-<division>]-<date>.xlsx
const exportFileLabel = (pathType?: string) =>
  pathType === 'old' ? 'GM-Old-Article' : pathType === 'new' ? 'GM-New-Article'
  : pathType === 'rejected' ? 'GM-Rejected-Article' : pathType === 'created' ? 'GM-Created-Article'
  : pathType === 'failed' ? 'GM-Failed-Article' : 'GM-Article';

const PAGE_SIZE = 50;

interface ApproverDashboardProps {
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
}

export default function ApproverDashboard({ pathType }: ApproverDashboardProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // When returning from the detail page via its Back button, the filters that
  // were active when the card was opened are passed back in navigation state.
  // We seed the filter useStates from this so the list stays filtered (e.g. a
  // "MIX VENDOR" search) instead of resetting on Back.
  const restoredFilters = (location.state as { restoreFilters?: DetailFilters } | null)?.restoreFilters;

  const [items, setItems] = useState<ApproverItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Read ?page=N from URL so Back-button navigation restores the correct page
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(searchParams.get('page') || '1', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [totalCount, setTotalCount] = useState(0);
  const [user, setUser] = useState<any>(null);

  // Filters are seeded from the URL query string first (so browser back/forward,
  // hard refresh and shared links keep the filters), then from the detail page's
  // Back-button navigation state, then defaults.
  const seed = (key: keyof DetailFilters, fallback: string) =>
    searchParams.get(key as string) ?? restoredFilters?.[key] ?? fallback;

  const [searchText, setSearchText] = useState(() => seed('search', ''));
  const [divisionFilter, setDivisionFilter] = useState<string>(() => seed('division', 'ALL'));
  const [subDivisionFilter, setSubDivisionFilter] = useState<string>(() => seed('subDivision', 'ALL'));
  const [majorCategoryFilter, setMajorCategoryFilter] = useState<string>(() => seed('majorCategory', ''));
  // SAP sync-status filter (Created tab): ALL | SYNCED | PENDING | FAILED
  const [sapSyncFilter, setSapSyncFilter] = useState<string>('ALL');
  const [dateRangeFilter, setDateRangeFilter] = useState<[Dayjs | null, Dayjs | null] | null>(() => {
    const start = searchParams.get('startDate') ?? restoredFilters?.startDate;
    const end = searchParams.get('endDate') ?? restoredFilters?.endDate;
    return start || end ? [start ? dayjs(start) : null, end ? dayjs(end) : null] : null;
  });
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingWithVariants, setExportingWithVariants] = useState(false);
  // IDs of cards checked for selective export. Scoped to the current page only:
  // cleared on every fetch (pagination / filter change) so it never holds ids
  // that aren't currently rendered.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useArticleGroupBy('articleGroupBy:gm', searchParams.get('groupBy'));
  // Bumped by Reset to remount the (uncontrolled) search input empty.
  const [searchKey, setSearchKey] = useState(0);

  // Combobox open/search state for the two searchable filter dropdowns
  const [subDivOpen, setSubDivOpen] = useState(false);
  const [subDivSearch, setSubDivSearch] = useState('');
  const [majCatOpen, setMajCatOpen] = useState(false);
  const [majCatSearch, setMajCatSearch] = useState('');

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether this is the first fetch so we honour the ?page= from the URL
  const isInitialFetch = useRef(true);
  // Holds the latest data that handleCardClick needs, so the click handler can
  // stay referentially STABLE (deps: [navigate]) — this keeps the memoized
  // ArticleCards from re-rendering whenever filters/items change identity.
  const cardClickDataRef = useRef<any>(null);

  const userAssignedDivisions = useMemo(() => getDivisionVariants(user?.division), [user]);
  const userAssignedSubDivisions = useMemo(() => getSubDivisionVariants(user?.subDivision), [user]);
  // Unscoped roles (ADMIN, PD, PO_COMMITTEE) see all divisions → full division/sub-division filters.
  const isUnscoped = user?.role === 'ADMIN' || user?.role === 'PD' || user?.role === 'PO_COMMITTEE';

  const [fabHierarchy, setFabHierarchy] = useState<{
    divisions: string[];
    subDivsByDiv: Record<string, string[]>;
    majCatsBySubDiv: Record<string, string[]>;
    mcDesByMajCat: Record<string, string[]>;
  }>({ divisions: [], subDivsByDiv: {}, majCatsBySubDiv: {}, mcDesByMajCat: {} });

  // GM roles use the (server-scoped) fabHierarchy for their filters instead of user.division/subDivision
  const isGMRole = user?.role === 'GM_APPROVER' || user?.role === 'GM_CREATOR';
  const showDivisionFilter = isGMRole
    ? fabHierarchy.divisions.length > 1
    : !isUnscoped && userAssignedDivisions.length > 1;
  const showSubDivisionFilter = isGMRole
    ? Object.values(fabHierarchy.subDivsByDiv).flat().length > 1
    : !isUnscoped && userAssignedSubDivisions.length > 1;

  useEffect(() => {
    const str = localStorage.getItem('user');
    if (str) { try { setUser(JSON.parse(str)); } catch { /* skip */ } }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/gm-hierarchy`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(data => {
      if (data && typeof data.subDivsByDiv === 'object') setFabHierarchy(data);
    }).catch(() => {});
  }, []);



  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (value === '') { setSearchText(''); return; }
    if (value.length < 3) return;
    searchDebounceRef.current = setTimeout(() => setSearchText(value), 700);
  }, []);

  const fetchItems = useCallback(
    async (page = 1) => {
      setLoading(true);
      setCurrentPage(page);
      // Selection is current-page-only: drop any checked cards when (re)fetching.
      setSelectedIds(new Set());
      try {
        const token = localStorage.getItem('authToken');
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(PAGE_SIZE));
        if (groupBy !== 'none') params.set('groupBy', groupBy);
        if (pathType) params.set('pathType', pathType);
        if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
        if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
        if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
        if (sapSyncFilter !== 'ALL') params.set('sapSyncStatus', sapSyncFilter);
        if (searchText) params.set('search', searchText);
        if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
        if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());

        const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-articles?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to fetch items');
        const result = await response.json();
        const withMcCode = (result.data || []).map((item: ApproverItem) => ({
          ...item,
          mcCode: item.mcCode || inferMcCode(item.majorCategory),
        }));
        setItems(withMcCode);
        setTotalCount(result.meta?.total || 0);
      } catch {
        message.error('Failed to load items');
      } finally {
        setLoading(false);
      }
    },
    [divisionFilter, subDivisionFilter, majorCategoryFilter, sapSyncFilter, searchText, dateRangeFilter, pathType, groupBy],
  );

  useEffect(() => {
    if (isInitialFetch.current) {
      isInitialFetch.current = false;
      // On mount honour the page from the URL (?page=N); filter changes always reset to 1
      fetchItems(currentPage);
    } else {
      fetchItems(1);
    }
  // currentPage intentionally omitted: only used on first mount via the ref guard
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchItems]);

  // Sync page + active filters → URL query string (separate from fetching so the
  // two don't interfere). Keeps browser back/forward, hard refresh and shared
  // links in step with the on-screen filters.
  useEffect(() => {
    setSearchParams(p => {
      const setOrDel = (key: string, val: string | null | undefined) => {
        if (val) p.set(key, val); else p.delete(key);
      };
      p.set('page', String(currentPage));
      setOrDel('search', searchText);
      setOrDel('division', divisionFilter !== 'ALL' ? divisionFilter : '');
      setOrDel('subDivision', subDivisionFilter !== 'ALL' ? subDivisionFilter : '');
      setOrDel('majorCategory', majorCategoryFilter);
      setOrDel('startDate', dateRangeFilter?.[0]?.toISOString());
      setOrDel('endDate', dateRangeFilter?.[1]?.toISOString());
      setOrDel('groupBy', groupBy !== 'none' ? groupBy : '');
      return p;
    }, { replace: true });
  // setSearchParams is stable; these drive the sync
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchText, divisionFilter, subDivisionFilter, majorCategoryFilter, dateRangeFilter, groupBy]);

  // ─── Export (gm_article_data, + gm_variants_article_data for "With variants") ──

  // Ticked cards (`ids`) or every row matching the on-screen filters.
  const downloadGmExcel = useCallback(async (opts: { withVariants: boolean; ids?: string[]; fileName: string }) => {
    const loadingId = message.loading(opts.withVariants ? 'Fetching articles with variants…' : 'Fetching all records for export…');
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams();
      if (pathType) params.set('pathType', pathType);
      if (opts.ids) {
        params.set('ids', opts.ids.join(','));
      } else {
        if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
        if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
        if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
        if (sapSyncFilter !== 'ALL') params.set('sapSyncStatus', sapSyncFilter);
        if (searchText) params.set('search', searchText);
        if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
        if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
      }
      if (opts.withVariants) params.set('withVariants', '1');

      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/gm-articles/export-all?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const rows: any[] = (await response.json()).data || [];
      message.dismiss(loadingId);
      if (rows.length === 0) {
        message.warning('No records found for the current filters');
        return;
      }
      const attrCodes = gmAttrCodesWithValues(rows);
      const headers = opts.withVariants
        ? [...GM_VARIANT_LEAD_HEADERS, ...GM_EXPORT_HEADERS.filter((h) => h !== 'Article Number'), ...attrCodes]
        : [...GM_EXPORT_HEADERS, ...attrCodes];
      await exportToExcel(rows.map((r) => mapGmExportRow(r, attrCodes)), headers, [], undefined, { fileBaseName: opts.fileName });
      message.success(`Exported ${rows.length} rows`);
    } catch {
      message.dismiss(loadingId);
      message.error('Export failed. Please try again.');
    }
  }, [pathType, divisionFilter, subDivisionFilter, majorCategoryFilter, sapSyncFilter, searchText, dateRangeFilter]);

  const divLabel = divisionFilter !== 'ALL' ? `-${divisionFilter.replace(/\s+/g, '-')}` : '';

  const handleExportAll = useCallback(async () => {
    setExportingAll(true);
    try {
      await downloadGmExcel({ withVariants: false, fileName: `${exportFileLabel(pathType)}${divLabel}` });
    } finally {
      setExportingAll(false);
    }
  }, [downloadGmExcel, pathType, divLabel]);

  // Created tab only: each generic followed by its SAP-created variants.
  const handleExportWithVariants = useCallback(async () => {
    setExportingWithVariants(true);
    try {
      await downloadGmExcel({ withVariants: true, fileName: `GM-Created-Article-Variants${divLabel}` });
    } finally {
      setExportingWithVariants(false);
    }
  }, [downloadGmExcel, divLabel]);

  // ─── Selective export ─────────────────────────────────────────────────────────

  // Stable (empty deps, functional update) so memoized ArticleCards don't
  // re-render just because this handler's identity changed.
  const toggleSelect = useCallback((item: ApproverItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  // A group's "Select all" / "Deselect all".
  const setSelection = useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => { if (select) next.add(id); else next.delete(id); });
      return next;
    });
  }, []);

  const hasActiveFilters = !!searchText
    || divisionFilter !== 'ALL'
    || subDivisionFilter !== 'ALL'
    || !!majorCategoryFilter
    || sapSyncFilter !== 'ALL'
    || !!dateRangeFilter?.[0]
    || !!dateRangeFilter?.[1];

  const resetFilters = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchText('');
    setSearchKey((k) => k + 1);
    setDivisionFilter('ALL');
    setSubDivisionFilter('ALL');
    setMajorCategoryFilter('');
    setSapSyncFilter('ALL');
    setDateRangeFilter(null);
  }, [pathType]);

  const allOnPageSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((i) => prev.has(i.id));
      return allSelected ? new Set() : new Set(items.map((i) => i.id));
    });
  }, [items]);

  const handleExportSelected = useCallback(async () => {
    const ids = items.filter((i) => selectedIds.has(i.id)).map((i) => i.id);
    if (ids.length === 0) {
      message.warning('No cards selected');
      return;
    }
    // Created tab: with their variants, like FG.
    await downloadGmExcel({
      withVariants: pathType === 'created',
      ids,
      fileName: `${exportFileLabel(pathType)}-Selected${divLabel}`,
    });
  }, [items, selectedIds, downloadGmExcel, pathType, divLabel]);

  // ─── Card click ───────────────────────────────────────────────────────────────

  // Keep the ref pointed at the latest values every render (cheap, render-safe).
  cardClickDataRef.current = {
    items, currentPage, totalCount, divisionFilter, subDivisionFilter,
    majorCategoryFilter, searchText, dateRangeFilter, pathType,
  };

  // Stable handler (deps: [navigate]) so memoized ArticleCards never re-render
  // just because this callback's identity changed.
  const handleCardClick = useCallback((item: ApproverItem, index: number) => {
    const d = cardClickDataRef.current;
    const effectiveStatus =
      d.pathType === 'new' ? 'PENDING' : d.pathType === 'rejected' ? 'REJECTED'
      : d.pathType === 'created' ? 'APPROVED' : 'PENDING';
    const filters: DetailFilters = {
      status: effectiveStatus,
      division: d.divisionFilter,
      subDivision: d.subDivisionFilter,
      majorCategory: d.majorCategoryFilter,
      source: 'SRM',
      search: d.searchText,
      startDate: d.dateRangeFilter?.[0]?.toISOString(),
      endDate: d.dateRangeFilter?.[1]?.toISOString(),
      pathType: d.pathType,
    };
    const basePath =
      d.pathType === 'rejected' ? '/gm-article/rejected'
      : d.pathType === 'created' ? '/gm-article/created'
      : d.pathType === 'failed' ? '/gm-article/failed'
      : '/gm-article';
    const state: DetailNavigationState = {
      items: d.items, currentIndex: index, currentPage: d.currentPage,
      totalCount: d.totalCount, pathType: d.pathType, filters,
      listPage: d.currentPage,
    };
    navigate(`${basePath}/${item.id}`, { state });
  }, [navigate]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 mb-2 -mx-1 px-1 pt-1">
        <div className="overflow-hidden rounded-xl border border-white/60 bg-white/85 shadow-[var(--shadow-md)] backdrop-blur">
          {/* Header (design "Option C · two rows") — shared with the other article dashboards */}
          <ArticleListHeader
            title={pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles' : pathType === 'rejected' ? 'Rejected Articles' : pathType === 'created' ? 'Created Articles' : pathType === 'failed' ? 'Failed Creations' : 'Approver Dashboard'}
            scope={user?.division ? [formatDivisionLabel(user.division), user.subDivision].filter(Boolean).join(' · ') : null}
            totalCount={totalCount}
            divisionTabs={
              (showDivisionFilter || isUnscoped || isGMRole) ? (
                <DivisionTabs
                  value={divisionFilter}
                  onChange={(v) => { setDivisionFilter(v); setSubDivisionFilter('ALL'); setMajorCategoryFilter(''); }}
                  options={(isUnscoped || isGMRole) ? fabHierarchy.divisions.map(divisionOption) : userAssignedDivisions.map(divisionOption)}
                />
              ) : null
            }
            selectedCount={selectedIds.size}
            onClearSelection={() => setSelectedIds(new Set())}
            onExportSelected={handleExportSelected}
            loading={loading}
            onRefresh={() => fetchItems(currentPage)}
            downloads={[
              { key: 'all', label: pathType === 'created' ? 'All' : `All ${totalCount.toLocaleString('en-IN')}`, onClick: handleExportAll, busy: exportingAll, show: true },
              { key: 'variants', label: 'With variants', onClick: handleExportWithVariants, busy: exportingWithVariants, show: pathType === 'created' },
            ].filter((d) => d.show)}
          />

          {/* Filter row */}
          <div className="border-t border-border/60 bg-gradient-to-b from-slate-50/40 to-transparent px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                key={searchKey}
                placeholder="Search article, vendor, design, PPT no..."
                defaultValue={searchText}
                onChange={handleSearchChange}
                allowClear
                onClear={() => setSearchText('')}
                className="!h-9 w-full text-[13px] sm:w-[260px] hover:border-slate-400 focus-within:border-slate-500 focus-within:ring-slate-400/25"
              />
              {(showSubDivisionFilter || isUnscoped || isGMRole) && (
                <Popover
                  open={subDivOpen}
                  onOpenChange={(o) => { setSubDivOpen(o); if (!o) setSubDivSearch(''); }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-[130px] items-center justify-between rounded-md border border-input bg-background px-2.5 text-[13px] hover:border-slate-400 focus-visible:outline-none focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25"
                    >
                      <span className="truncate text-left">
                        {subDivisionFilter === 'ALL' ? 'All Sub-Divs' : subDivisionFilter}
                      </span>
                      <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-0" align="start">
                    <div className="flex items-center border-b px-2 py-1.5">
                      <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        value={subDivSearch}
                        onChange={(e) => setSubDivSearch(e.target.value)}
                        placeholder="Search sub-division..."
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {(() => {
                        const opts = (isUnscoped || isGMRole)
                          ? (divisionFilter !== 'ALL' && fabHierarchy.subDivsByDiv[divisionFilter]
                              ? fabHierarchy.subDivsByDiv[divisionFilter]
                              : Object.values(fabHierarchy.subDivsByDiv).flat())
                          : userAssignedSubDivisions;
                        const filtered = (['ALL'] as string[]).concat(opts)
                          .filter((sd) => sd === 'ALL' || sd.toLowerCase().includes(subDivSearch.toLowerCase()));
                        return filtered.length === 0
                          ? <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
                          : filtered.map((sd) => (
                            <button
                              key={sd}
                              type="button"
                              onClick={() => { setSubDivisionFilter(sd); setMajorCategoryFilter(''); setSubDivOpen(false); setSubDivSearch(''); }}
                              className={cn(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                                subDivisionFilter === sd && 'bg-accent font-medium',
                              )}
                            >
                              {sd === 'ALL' ? 'All Sub-Divs' : sd}
                            </button>
                          ));
                      })()}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Popover
                open={majCatOpen}
                onOpenChange={(o) => { setMajCatOpen(o); if (!o) setMajCatSearch(''); }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-[170px] items-center justify-between rounded-md border border-input bg-background px-2.5 text-[13px] hover:border-slate-400 focus-visible:outline-none focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25"
                  >
                    <span className="truncate text-left">
                      {majorCategoryFilter || 'All Major Categories'}
                    </span>
                    <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <div className="flex items-center border-b px-2 py-1.5">
                    <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={majCatSearch}
                      onChange={(e) => setMajCatSearch(e.target.value)}
                      placeholder="Search category..."
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {(() => {
                      // Source maj_cats from fabric_article_master, cascading from sub-div → div → all
                      let majCats: string[] = [];
                      if (subDivisionFilter !== 'ALL' && fabHierarchy.majCatsBySubDiv[subDivisionFilter]) {
                        majCats = fabHierarchy.majCatsBySubDiv[subDivisionFilter];
                      } else if (divisionFilter !== 'ALL' && fabHierarchy.subDivsByDiv[divisionFilter]) {
                        majCats = fabHierarchy.subDivsByDiv[divisionFilter]
                          .flatMap(sd => fabHierarchy.majCatsBySubDiv[sd] ?? []);
                      } else {
                        majCats = Object.values(fabHierarchy.majCatsBySubDiv).flat();
                      }
                      const unique = Array.from(new Set(majCats)).sort();
                      const filtered = unique.filter((v) => v.toLowerCase().includes(majCatSearch.toLowerCase()));
                      return (
                        <>
                          {!majCatSearch && (
                            <button
                              type="button"
                              onClick={() => { setMajorCategoryFilter(''); setMajCatOpen(false); setMajCatSearch(''); }}
                              className={cn(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                                !majorCategoryFilter && 'bg-accent font-medium',
                              )}
                            >
                              All Major Categories
                            </button>
                          )}
                          {filtered.map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => { setMajorCategoryFilter(v); setMajCatOpen(false); setMajCatSearch(''); }}
                              className={cn(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                                majorCategoryFilter === v && 'bg-accent font-medium',
                              )}
                            >
                              {v}
                            </button>
                          ))}
                          {filtered.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">No categories found</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
              <DatePresetFilter
                label={pathType === 'created' ? 'Approved' : 'Added'}
                value={dateRangeFilter}
                onChange={setDateRangeFilter}
              />
              <div className="flex-1" />
              <GroupByControl value={groupBy} onChange={setGroupBy} />
              <div className="flex basis-full flex-wrap items-center gap-2">
                {pathType === 'created' && <SapSyncChips value={sapSyncFilter} onChange={setSapSyncFilter} />}
                <div className="flex-1" />
                {hasActiveFilters && <ResetFiltersButton onClick={resetFilters} />}
                {items.length > 0 && (
                  <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-[13px] text-foreground hover:border-slate-400">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAllOnPage}
                      className="h-4 w-4 cursor-pointer accent-slate-800"
                    />
                    Select page
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className={cn(ARTICLE_CARD_GRID_CLASS, 'p-3')}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
          <span className="text-4xl">📭</span>
          <span className="text-sm">No articles found</span>
        </div>
      ) : (
        <>
          <ArticleCardGrid
            items={items}
            groupBy={groupBy}
            selectedIds={selectedIds}
            onSetSelection={setSelection}
            renderCard={(item, index) => (
              <ArticleSpecCard key={item.id} item={item} index={index} onClick={handleCardClick} dateField={pathType === 'created' ? 'approvedAt' : 'createdAt'} selected={selectedIds.has(item.id)} onToggleSelect={toggleSelect} />
            )}
          />
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 border-t py-3">
              <Button size="sm" variant="outline" disabled={currentPage === 1}
                onClick={() => fetchItems(currentPage - 1)}
                className="h-7 px-3 text-[12px]">
                ← Prev
              </Button>
              <span className="text-[12px] text-muted-foreground">
                Page {currentPage} of {Math.ceil(totalCount / PAGE_SIZE)} · {totalCount} articles
              </span>
              <Button size="sm" variant="outline" disabled={currentPage * PAGE_SIZE >= totalCount}
                onClick={() => fetchItems(currentPage + 1)}
                className="h-7 px-3 text-[12px]">
                Next →
              </Button>
            </div>
          )}
        </>
      )}

    </div>
  );
}
