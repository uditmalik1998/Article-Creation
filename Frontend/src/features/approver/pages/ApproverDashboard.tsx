import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import { RotateCw, Download, Sparkles, Search, ChevronDown } from 'lucide-react';
import type { Dayjs } from 'dayjs';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import type { ApproverItem } from '../components/ApproverTable';
import { ArticleCard } from '../components/ArticleCard';
import { APP_CONFIG } from '../../../constants/app/config';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import { getMcCodeByMajorCategory, MAJOR_CATEGORY_ALLOWED_VALUES } from '../../../data/majorCategoryMcCodeMap';
import { exportToExcel } from '../../../shared/utils/export/extractionExport';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import type { DetailFilters, DetailNavigationState } from './ArticleDetailPage';

const inferMcCode = (majorCategory?: string | null) => getMcCodeByMajorCategory(majorCategory);

const normalizeText = (value?: string | null): string => String(value || '').trim().toUpperCase();

const getDivisionVariants = (value?: string | null): string[] => {
  const n = normalizeText(value);
  if (!n) return [];
  if (n === 'MEN' || n === 'MENS') return ['MEN', 'MENS'];
  if (n === 'LADIES' || n === 'WOMEN' || n === 'WOMAN') return ['LADIES', 'WOMEN'];
  if (n === 'KID' || n === 'KIDS') return ['KID', 'KIDS'];
  return [n];
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

export const SIMPLE_APPROVER_EXPORT_HEADERS = [
    'Article Number', 'Division', 'Sub Division', 'Major Category', 'MC Code', 'Status',
    'Vendor Name', 'Vendor Code', 'Design Number', 'PPT Number', 'Article Description',
    'Reference Article Number', 'Reference Article Description', 'Season', 'HSN Tax Code',
    'Year', 'Article Type',
    'Rate', 'MRP',
    'M_FAB_MAIN_MVGR_1', 'M_FAB_MAIN_MVGR_2', 'M_WEAVE_01', 'M_WEAVE_02', 'M_YARN',
    'M_COMPOSITION', 'M_COUNT', 'M_CONSTRUCTION', 'M_LYCRA', 'M_FINISH', 'M_GSM',
    'M_OUNZ', 'M_WIDTH', 'M_FAB_DIV', 'M_FAB_VDR', 'SHADE', 'WEIGHT',
    'M_BODY_STYLE', 'M_COLLAR_TYPE', 'M_COLLAR_STYLE', 'M_NECK_TYPE', 'M_NECK_STYLE',
    'M_PLACKET', 'M_BLT_TYPE', 'M_BLT_STYLE', 'M_SLEEVES_MAIN_STYLE', 'M_SLEEVE_FOLD',
    'M_BTM_FOLD', 'M_NO_OF_POCKET', 'M_POCKET', 'M_EXTRA_POCKET', 'M_FIT', 'M_LENGTH',
    'M_DC_STYLE', 'M_DC_SHAPE', 'M_BTN_TYPE', 'M_BTN_CLR', 'M_ZIP_TYPE', 'M_ZIP_COL',
    'M_PATCH_STYLE', 'M_PATCHE_TYPE', 'M_HTRF_TYPE', 'M_HTRF_STYLE',
    'M_PRINT_TYPE', 'M_PRINT_STYLE', 'M_PRINT_PLACEMENT', 'M_EMB_TYPE',
    'M_EMBROIDERY_STYLE', 'M_EMB_PLACEMENT', 'M_WASH',
    'M_IMP_ATBT', 'M_AGE_GROUP', 'ARTICLE FASHION TYPE', 'SEGMENT',
    'Extracted By', 'Created Date',
] as const;

const VARIANT_EXTRA_HEADERS = ['Row Type', 'Parent Article Number', 'Variant Size', 'Variant Color', 'SAP Article ID'] as const;

function mapVariantExportRow(row: any): Record<string, string | number | undefined> {
  const rawDate = row.approvedAt ? new Date(row.approvedAt) : null;
  const formattedDate = rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate.toLocaleDateString('en-GB') : '';
  return {
    'Article Number': row.articleNumber || '',
    Division: row.division || '',
    'Sub Division': row.subDivision || '',
    'Major Category': row.majorCategory || '',
    'MC Code': row.mcCode || '',
    Status: row.approvalStatus || '',
    'Vendor Name': row.vendorName || '',
    'Vendor Code': row.vendorCode || '',
    'Design Number': row.designNumber || '',
    'PPT Number': row.pptNumber || '',
    'Article Description': row.articleDescription || '',
    'Reference Article Number': row.referenceArticleNumber || '',
    'Reference Article Description': row.referenceArticleDescription || '',
    Season: row.season || '',
    'HSN Tax Code': row.hsnTaxCode || '',
    Year: row.year || '',
    'Article Type': row.articleType || '',
    Rate: row.rate == null ? undefined : Number(row.rate),
    MRP: row.mrp == null ? undefined : Number(row.mrp),
    M_FAB_MAIN_MVGR_1: row.mainMvgr || '',
    M_FAB_MAIN_MVGR_2: row.fabricMainMvgr || '',
    M_WEAVE_01: row.weave || '',
    M_WEAVE_02: row.mFab2 || '',
    M_YARN: row.yarn1 || '',
    M_COMPOSITION: row.composition || '',
    M_COUNT: row.fCount || '',
    M_CONSTRUCTION: row.fConstruction || '',
    M_LYCRA: row.lycra || '',
    M_FINISH: row.finish || '',
    M_GSM: row.gsm || '',
    M_OUNZ: row.fOunce || '',
    M_WIDTH: row.fWidth || '',
    M_FAB_DIV: row.fabDiv || '',
    M_FAB_VDR: row.fabVdr || '',
    SHADE: row.shade || '',
    WEIGHT: row.weight || '',
    M_BODY_STYLE: row.pattern || '',
    M_COLLAR_TYPE: row.collar || '',
    M_COLLAR_STYLE: row.collarStyle || '',
    M_NECK_TYPE: row.neck || '',
    M_NECK_STYLE: row.neckDetails || '',
    M_PLACKET: row.placket || '',
    M_BLT_TYPE: row.fatherBelt || '',
    M_BLT_STYLE: row.childBelt || '',
    M_SLEEVES_MAIN_STYLE: row.sleeve || '',
    M_SLEEVE_FOLD: row.sleeveFold || '',
    M_BTM_FOLD: row.bottomFold || '',
    M_NO_OF_POCKET: row.noOfPocket || '',
    M_POCKET: row.pocketType || '',
    M_EXTRA_POCKET: row.extraPocket || '',
    M_FIT: row.fit || '',
    M_LENGTH: row.length || '',
    M_DC_STYLE: row.drawcord || '',
    M_DC_SHAPE: row.dcShape || '',
    M_BTN_TYPE: row.button || '',
    M_BTN_CLR: row.btnColour || '',
    M_ZIP_TYPE: row.zipper || '',
    M_ZIP_COL: row.zipColour || '',
    M_PATCH_STYLE: row.patchesType || '',
    M_PATCHE_TYPE: row.patches || '',
    M_HTRF_TYPE: row.htrfType || '',
    M_HTRF_STYLE: row.htrfStyle || '',
    M_PRINT_TYPE: row.printType || '',
    M_PRINT_STYLE: row.printStyle || '',
    M_PRINT_PLACEMENT: row.printPlacement || '',
    M_EMB_TYPE: row.embroidery || '',
    M_EMBROIDERY_STYLE: row.embroideryType || '',
    M_EMB_PLACEMENT: row.embPlacement || '',
    M_WASH: row.wash || '',
    M_IMP_ATBT: row.impAtrbt2 || '',
    M_AGE_GROUP: row.ageGroup || '',
    'ARTICLE FASHION TYPE': row.articleFashionType || '',
    SEGMENT: row.segment || '',
    'Extracted By': row.userName || '',
    'Created Date': formattedDate,
    'Approved By Name': row.approver?.name || '',
    'Approved By Email': row.approver?.email || '',
    'Row Type': row._rowType || '',
    'Parent Article Number': row._parentArticleNumber || '',
    'Variant Size': row.variantSize || '',
    'Variant Color': row.variantColor || '',
    'SAP Article ID': row.sapArticleId || '',
  };
}

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
    searchParams.get(key) ?? restoredFilters?.[key] ?? fallback;

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState(() => seed('search', ''));
  const [divisionFilter, setDivisionFilter] = useState<string>(() => seed('division', 'ALL'));
  const [subDivisionFilter, setSubDivisionFilter] = useState<string>(() => seed('subDivision', 'ALL'));
  const [majorCategoryFilter, setMajorCategoryFilter] = useState<string>(() => seed('majorCategory', ''));
  const [sourceFilter, setSourceFilter] = useState<string>(() => seed('source', 'ALL'));
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
  const showDivisionFilter = !isUnscoped && userAssignedDivisions.length > 1;
  const showSubDivisionFilter = !isUnscoped && userAssignedSubDivisions.length > 1;

  useEffect(() => {
    const str = localStorage.getItem('user');
    if (str) { try { setUser(JSON.parse(str)); } catch { /* skip */ } }
  }, []);

  useEffect(() => {
    if (pathType === 'created') setStatusFilter('APPROVED');
  }, [pathType]);

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
        const effectiveStatus =
          pathType === 'new' ? 'PENDING'
          : pathType === 'rejected' ? 'REJECTED'
          : pathType === 'created' ? 'APPROVED'
          : statusFilter;
        params.set('status', effectiveStatus);
        if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
        if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
        if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
        if (sourceFilter !== 'ALL') params.set('source', sourceFilter);
        if (sapSyncFilter !== 'ALL') params.set('sapSyncStatus', sapSyncFilter);
        if (searchText) params.set('search', searchText);
        if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
        if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
        if (pathType) params.set('pathType', pathType);

        const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items?${params}`, {
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
    [statusFilter, divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, sapSyncFilter, searchText, dateRangeFilter, pathType],
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
      setOrDel('source', sourceFilter !== 'ALL' ? sourceFilter : '');
      setOrDel('startDate', dateRangeFilter?.[0]?.toISOString());
      setOrDel('endDate', dateRangeFilter?.[1]?.toISOString());
      return p;
    }, { replace: true });
  // setSearchParams is stable; these drive the sync
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchText, divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, dateRangeFilter]);

  // ─── Export ──────────────────────────────────────────────────────────────────

  const buildApproverExportData = useCallback((rows: ApproverItem[]) => {
    // The "Created Date" column must use the SAME field the backend filters on for
    // this tab — approvedAt (when the article was approved) on the Created tab, createdAt
    // (extraction date) everywhere else — so an export only contains the filtered range.
    const dateSource: 'createdAt' | 'approvedAt' = pathType === 'created' ? 'approvedAt' : 'createdAt';
    return rows.map((row) => {
      const rawDate = (row as any)[dateSource];
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const formattedDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString('en-GB') : '';
      return {
        'Article Number': row.articleNumber || '', Division: row.division || '',
        'Sub Division': row.subDivision || '', 'Major Category': row.majorCategory || '',
        'MC Code': row.mcCode || '', Status: row.approvalStatus || '',
        'Vendor Name': row.vendorName || '', 'Vendor Code': row.vendorCode || '',
        'Design Number': row.designNumber || '', 'PPT Number': row.pptNumber || '',
        'Article Description': row.articleDescription || '',
        'Reference Article Number': row.referenceArticleNumber || '',
        'Reference Article Description': row.referenceArticleDescription || '',
        Season: row.season || '', 'HSN Tax Code': row.hsnTaxCode || '',
        Year: row.year || '', 'Article Type': row.articleType || '',
        Rate: row.rate == null ? undefined : Number(row.rate),
        MRP: row.mrp == null ? undefined : Number(row.mrp),
        M_FAB_MAIN_MVGR_1: row.mainMvgr || '', M_FAB_MAIN_MVGR_2: row.fabricMainMvgr || '',
        M_WEAVE_01: row.weave || '', M_WEAVE_02: row.mFab2 || '', M_YARN: row.yarn1 || '',
        M_COMPOSITION: row.composition || '', M_COUNT: row.fCount || '',
        M_CONSTRUCTION: row.fConstruction || '', M_LYCRA: row.lycra || '',
        M_FINISH: row.finish || '', M_GSM: row.gsm || '', M_OUNZ: row.fOunce || '',
        M_WIDTH: row.fWidth || '', M_FAB_DIV: row.fabDiv || '', M_FAB_VDR: (row as any).fabVdr || '',
        SHADE: row.shade || '', WEIGHT: row.weight || '',
        M_BODY_STYLE: row.pattern || '', M_COLLAR_TYPE: row.collar || '',
        M_COLLAR_STYLE: row.collarStyle || '', M_NECK_TYPE: row.neck || '',
        M_NECK_STYLE: row.neckDetails || '', M_PLACKET: row.placket || '',
        M_BLT_TYPE: row.fatherBelt || '', M_BLT_STYLE: row.childBelt || '',
        M_SLEEVES_MAIN_STYLE: row.sleeve || '', M_SLEEVE_FOLD: row.sleeveFold || '',
        M_BTM_FOLD: row.bottomFold || '', M_NO_OF_POCKET: row.noOfPocket || '',
        M_POCKET: row.pocketType || '', M_EXTRA_POCKET: row.extraPocket || '',
        M_FIT: row.fit || '', M_LENGTH: row.length || '',
        M_DC_STYLE: row.drawcord || '', M_DC_SHAPE: row.dcShape || '',
        M_BTN_TYPE: row.button || '', M_BTN_CLR: row.btnColour || '',
        M_ZIP_TYPE: row.zipper || '', M_ZIP_COL: row.zipColour || '',
        M_PATCH_STYLE: row.patchesType || '', M_PATCHE_TYPE: row.patches || '',
        M_HTRF_TYPE: row.htrfType || '', M_HTRF_STYLE: row.htrfStyle || '',
        M_PRINT_TYPE: row.printType || '', M_PRINT_STYLE: row.printStyle || '',
        M_PRINT_PLACEMENT: row.printPlacement || '', M_EMB_TYPE: row.embroidery || '',
        M_EMBROIDERY_STYLE: row.embroideryType || '', M_EMB_PLACEMENT: row.embPlacement || '',
        M_WASH: row.wash || '', M_IMP_ATBT: row.impAtrbt2 || '',
        M_AGE_GROUP: row.ageGroup || '', 'ARTICLE FASHION TYPE': row.articleFashionType || '',
        SEGMENT: row.segment || '', 'Extracted By': row.userName || '',
        'Created Date': formattedDate,
        // Created Articles tab only: who approved the article
        ...(pathType === 'created' ? {
          'Approved By Name': row.approver?.name || '',
          'Approved By Email': row.approver?.email || '',
        } : {}),
      } as Record<string, string | number | undefined>;
    });
  }, [pathType]);

  // Created tab appends the two approver columns; every other tab uses the base set.
  const exportHeaders = useMemo(
    () => pathType === 'created'
      ? [...SIMPLE_APPROVER_EXPORT_HEADERS, 'Approved By Name', 'Approved By Email']
      : [...SIMPLE_APPROVER_EXPORT_HEADERS],
    [pathType],
  );

  const handleExportAll = useCallback(async () => {
    setExportingAll(true);
    const loadingId = message.loading('Fetching all records for export…');
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams();
      const effectiveStatus =
        pathType === 'new' ? 'PENDING' : pathType === 'rejected' ? 'REJECTED'
        : pathType === 'created' ? 'APPROVED' : statusFilter;
      params.set('status', effectiveStatus);
      if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
      if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
      if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter);
      if (searchText) params.set('search', searchText);
      if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
      if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
      if (pathType) params.set('pathType', pathType);

      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/export-all?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const result = await response.json();
      const allRows = (result.data || []).map((item: ApproverItem) => ({
        ...item, mcCode: item.mcCode || inferMcCode(item.majorCategory),
      }));
      if (allRows.length === 0) {
        message.dismiss(loadingId);
        message.warning('No records found for the current filters');
        return;
      }
      const exportData = buildApproverExportData(allRows);
      const fileName =
        pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles'
        : pathType === 'rejected' ? 'Rejected Articles' : 'Articles';
      const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
      await exportToExcel(exportData, exportHeaders, [], `${fileName}${divLabel}`);
      message.dismiss(loadingId);
      message.success(`Exported ${allRows.length} records`);
    } catch {
      message.dismiss(loadingId);
      message.error('Export failed. Please try again.');
    } finally {
      setExportingAll(false);
    }
  }, [statusFilter, divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, searchText, dateRangeFilter, pathType, buildApproverExportData, exportHeaders]);

  // ─── Export with variants (Created tab only) ──────────────────────────────────

  const handleExportWithVariants = useCallback(async () => {
    setExportingWithVariants(true);
    const loadingId = message.loading('Fetching articles with variants…');
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams();
      params.set('status', 'APPROVED');
      if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
      if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
      if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter);
      if (searchText) params.set('search', searchText);
      if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
      if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
      params.set('pathType', 'created');

      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/export-all-with-variants?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const result = await response.json();
      const allRows: any[] = result.data || [];
      if (allRows.length === 0) {
        message.dismiss(loadingId);
        message.warning('No records found for the current filters');
        return;
      }

      const variantHeaders = [...exportHeaders, ...VARIANT_EXTRA_HEADERS];
      const exportData = allRows.map(mapVariantExportRow);

      const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
      await exportToExcel(exportData, variantHeaders, [], `Created Articles - Variants${divLabel}`);
      message.dismiss(loadingId);
      message.success(`Exported ${allRows.length} rows`);
    } catch {
      message.dismiss(loadingId);
      message.error('Export failed. Please try again.');
    } finally {
      setExportingWithVariants(false);
    }
  }, [divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, searchText, dateRangeFilter, exportHeaders]);

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

  const allOnPageSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((i) => prev.has(i.id));
      return allSelected ? new Set() : new Set(items.map((i) => i.id));
    });
  }, [items]);

  const handleExportSelected = useCallback(async () => {
    const rows = items.filter((i) => selectedIds.has(i.id));
    if (rows.length === 0) {
      message.warning('No cards selected');
      return;
    }

    // Created tab: fetch and include variants for each selected article
    if (pathType === 'created') {
      const loadingId = message.loading('Fetching variants for selected articles…');
      try {
        const token = localStorage.getItem('authToken');
        const params = new URLSearchParams();
        params.set('pathType', 'created');
        params.set('status', 'APPROVED');
        params.set('ids', rows.map((r) => r.id).join(','));

        const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/export-all-with-variants?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Export failed');
        const result = await response.json();
        const allRows: any[] = result.data || [];
        if (allRows.length === 0) {
          message.dismiss(loadingId);
          message.warning('No data found for selected articles');
          return;
        }

        const variantHeaders = [...exportHeaders, ...VARIANT_EXTRA_HEADERS];
        const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
        await exportToExcel(allRows.map(mapVariantExportRow), variantHeaders, [], `Created Articles${divLabel} - Selected`);
        message.dismiss(loadingId);
        message.success(`Exported ${allRows.length} rows (${rows.length} articles)`);
      } catch {
        message.dismiss(loadingId);
        message.error('Export failed. Please try again.');
      }
      return;
    }

    // All other tabs: export generics only (existing behaviour)
    const exportData = buildApproverExportData(rows);
    const fileName =
      pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles'
      : pathType === 'rejected' ? 'Rejected Articles' : 'Articles';
    const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
    await exportToExcel(exportData, exportHeaders, [], `${fileName}${divLabel} - Selected`);
    message.success(`Exported ${rows.length} selected records`);
  }, [items, selectedIds, buildApproverExportData, pathType, divisionFilter, exportHeaders]);

  // ─── Card click ───────────────────────────────────────────────────────────────

  // Keep the ref pointed at the latest values every render (cheap, render-safe).
  cardClickDataRef.current = {
    items, currentPage, totalCount, statusFilter, divisionFilter, subDivisionFilter,
    majorCategoryFilter, sourceFilter, searchText, dateRangeFilter, pathType,
  };

  // Stable handler (deps: [navigate]) so memoized ArticleCards never re-render
  // just because this callback's identity changed.
  const handleCardClick = useCallback((item: ApproverItem, index: number) => {
    const d = cardClickDataRef.current;
    const effectiveStatus =
      d.pathType === 'new' ? 'PENDING' : d.pathType === 'rejected' ? 'REJECTED'
      : d.pathType === 'created' ? 'APPROVED' : d.statusFilter;
    const filters: DetailFilters = {
      status: effectiveStatus,
      division: d.divisionFilter,
      subDivision: d.subDivisionFilter,
      majorCategory: d.majorCategoryFilter,
      source: d.sourceFilter,
      search: d.searchText,
      startDate: d.dateRangeFilter?.[0]?.toISOString(),
      endDate: d.dateRangeFilter?.[1]?.toISOString(),
      pathType: d.pathType,
    };
    const basePath =
      d.pathType === 'old' ? '/approver/old-articles'
      : d.pathType === 'rejected' ? '/approver/rejected'
      : d.pathType === 'created' ? '/approver/created'
      : d.pathType === 'failed' ? '/approver/failed'
      : '/approver';
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
          {/* Brand strip */}
          <div
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-white"
            style={{ background: 'linear-gradient(90deg, #1f2937 0%, #334155 100%)' }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FF6F61]/90">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="font-display truncate text-[13px] font-semibold leading-tight tracking-tight">
                  {pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles'
                    : pathType === 'rejected' ? 'Rejected Articles'
                    : pathType === 'created' ? 'Created Articles'
                    : pathType === 'failed' ? 'Failed Creations' : 'Approver Dashboard'}
                </div>
                {user?.division && (
                  <div className="truncate text-[10px] font-medium text-white/65">
                    {formatDivisionLabel(user.division)}{user.subDivision ? ` · ${user.subDivision}` : ''}
                  </div>
                )}
              </div>
              {totalCount > 0 && (
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                  {totalCount} articles
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {selectedIds.size > 0 && (
                <>
                  <span className="rounded-md bg-[#FF6F61]/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                    {selectedIds.size} selected
                  </span>
                  <Button size="sm" variant="outline" onClick={handleExportSelected}
                    className="h-7 border-white/30 bg-white/10 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white">
                    <Download /> Export Selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}
                    className="h-7 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white">
                    Clear
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => fetchItems(currentPage)}
                className="h-7 border-white/30 bg-white/10 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white">
                <RotateCw /> Refresh
              </Button>
              {pathType === 'created' && (
                <Button size="sm" variant="outline" onClick={handleExportWithVariants} disabled={exportingWithVariants}
                  className="h-7 border-white/30 bg-white/10 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white disabled:opacity-50">
                  <Download /> Export Variants
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleExportAll} disabled={exportingAll}
                className="h-7 border-white/30 bg-white/10 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white disabled:opacity-50">
                <Download /> Export ({totalCount})
              </Button>
            </div>
          </div>

          {/* Filter row */}
          <div className="border-t border-border/60 bg-gradient-to-b from-slate-50/40 to-transparent px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                placeholder="Search article, vendor, design, PPT no..."
                defaultValue={searchText}
                onChange={handleSearchChange}
                allowClear
                onClear={() => setSearchText('')}
                className="!h-7 w-full text-[12px] sm:w-[240px]"
              />
              {pathType !== 'rejected' && pathType !== 'created' && pathType !== 'new' && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="!h-7 w-[130px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {(showDivisionFilter || isUnscoped) && (
                <Select value={divisionFilter} onValueChange={(v) => { setDivisionFilter(v); setSubDivisionFilter('ALL'); }}>
                  <SelectTrigger className="!h-7 w-[130px] text-[12px]"><SelectValue placeholder="Division" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Divisions</SelectItem>
                    {isUnscoped ? (
                      <>
                        <SelectItem value="MEN">MENS</SelectItem>
                        <SelectItem value="LADIES">LADIES</SelectItem>
                        <SelectItem value="KIDS">KIDS</SelectItem>
                      </>
                    ) : (
                      userAssignedDivisions.map(d => <SelectItem key={d} value={d}>{formatDivisionLabel(d)}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              )}
              {(showSubDivisionFilter || isUnscoped) && (
                <Popover
                  open={subDivOpen}
                  onOpenChange={(o) => { setSubDivOpen(o); if (!o) setSubDivSearch(''); }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-[130px] items-center justify-between rounded border border-input bg-background px-2 text-[12px] hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                      {(['ALL'] as string[])
                        .concat(
                          isUnscoped
                            ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter).length > 0
                              ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter)
                              : [...SIMPLIFIED_HIERARCHY['MENS'], ...SIMPLIFIED_HIERARCHY['Ladies'], ...SIMPLIFIED_HIERARCHY['Kids']]
                            : userAssignedSubDivisions,
                        )
                        .filter((sd) => sd === 'ALL' || sd.toLowerCase().includes(subDivSearch.toLowerCase()))
                        .map((sd) => (
                          <button
                            key={sd}
                            type="button"
                            onClick={() => {
                              setSubDivisionFilter(sd);
                              setMajorCategoryFilter('');
                              setSubDivOpen(false);
                              setSubDivSearch('');
                            }}
                            className={cn(
                              'w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                              subDivisionFilter === sd && 'bg-accent font-medium',
                            )}
                          >
                            {sd === 'ALL' ? 'All Sub-Divs' : sd}
                          </button>
                        ))}
                      {(['ALL'] as string[])
                        .concat(
                          isUnscoped
                            ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter).length > 0
                              ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter)
                              : [...SIMPLIFIED_HIERARCHY['MENS'], ...SIMPLIFIED_HIERARCHY['Ladies'], ...SIMPLIFIED_HIERARCHY['Kids']]
                            : userAssignedSubDivisions,
                        )
                        .filter((sd) => sd === 'ALL' || sd.toLowerCase().includes(subDivSearch.toLowerCase()))
                        .length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
                      )}
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
                    className="flex h-7 w-[170px] items-center justify-between rounded border border-input bg-background px-2 text-[12px] hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                      const div = divisionFilter === 'ALL' ? '' : divisionFilter;
                      let prefixRegex: RegExp | null = null;
                      if (div.match(/MEN/i)) prefixRegex = /^M|^MW/i;
                      else if (div.match(/LADIES|WOMEN/i)) prefixRegex = /^L|^LW/i;
                      else if (div.match(/KIDS/i)) prefixRegex = /^(K|I|J|Y|G)/i;
                      const filtered = MAJOR_CATEGORY_ALLOWED_VALUES
                        .filter((v) => !prefixRegex || v.shortForm.match(prefixRegex))
                        .filter((v) => v.shortForm.toLowerCase().includes(majCatSearch.toLowerCase()));
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
                              key={v.shortForm}
                              type="button"
                              onClick={() => { setMajorCategoryFilter(v.shortForm); setMajCatOpen(false); setMajCatSearch(''); }}
                              className={cn(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                                majorCategoryFilter === v.shortForm && 'bg-accent font-medium',
                              )}
                            >
                              {v.shortForm}
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
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="!h-7 w-[110px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Sources</SelectItem>
                  <SelectItem value="SRM">SRM</SelectItem>
                  <SelectItem value="WATCHER">Watcher</SelectItem>
                  <SelectItem value="USER">User</SelectItem>
                </SelectContent>
              </Select>
              {pathType === 'created' && (
                <Select value={sapSyncFilter} onValueChange={setSapSyncFilter}>
                  <SelectTrigger className="!h-7 w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All SAP Sync</SelectItem>
                    <SelectItem value="SYNCED">SAP ✓ Synced</SelectItem>
                    <SelectItem value="PENDING">SAP … Queued</SelectItem>
                    <SelectItem value="FAILED">SAP ✗ Failed</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <RangePicker
                value={dateRangeFilter}
                onChange={setDateRangeFilter}
                placeholder={pathType === 'created' ? ['Updated From', 'Updated To'] : ['Created From', 'Created To']}
              />
              {items.length > 0 && (
                <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-input bg-background px-2 text-[12px] text-muted-foreground hover:border-ring">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                  Select page
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
          <span className="text-4xl">📭</span>
          <span className="text-sm">No articles found</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((item, index) => (
              <ArticleCard key={item.id} item={item} index={index} onClick={handleCardClick} dateField={pathType === 'created' ? 'approvedAt' : 'createdAt'} selected={selectedIds.has(item.id)} onToggleSelect={toggleSelect} />
            ))}
          </div>
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
