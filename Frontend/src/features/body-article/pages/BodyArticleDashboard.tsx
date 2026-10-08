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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import type { ApproverItem } from '../components/BodyArticleTable';
import { ArticleSpecCard } from '@/shared/components/articles/ArticleSpecCard';
import { ArticleCardGrid, ARTICLE_CARD_GRID_CLASS, GroupByControl, useArticleGroupBy } from '@/shared/components/articles/ArticleCardGrid';
import { DatePresetFilter, DivisionTabs, divisionOption, ResetFiltersButton, SapSyncChips } from '@/shared/components/articles/ArticleFilters';
import { APP_CONFIG } from '../../../constants/app/config';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import { getMcCodeByMajorCategory, MAJOR_CATEGORY_ALLOWED_VALUES } from '../../../data/majorCategoryMcCodeMap';
import { exportToExcel } from '../../../shared/utils/export/extractionExport';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import type { DetailFilters, DetailNavigationState } from './BodyArticleDetailPage';

const PRESENTATIONS_TYPE = 'FG Article';

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

export const SIMPLE_BODY_EXPORT_HEADERS = [
  'Body Article Number', 'Body Article Description',
  'Division', 'Sub Division', 'Major Category', 'MC Code',
  'Status', 'SAP Sync Status',
  'Vendor Name', 'Vendor Code', 'Design Number',
  'Season', 'Year', 'HSN Tax Code',
  'M_COLLAR_TYPE', 'M_COLLAR_STYLE', 'M_NECK_TYPE', 'M_NECK_STYLE',
  'M_PLACKET', 'M_BLT_TYPE', 'M_BLT_STYLE',
  'M_SLEEVES_MAIN_STYLE', 'M_SLEEVE_FOLD', 'M_BTM_FOLD',
  'M_NO_OF_POCKET', 'M_POCKET', 'M_EXTRA_POCKET',
  'M_FIT', 'M_BODY_STYLE', 'M_LENGTH', 'M_SET',
  'CMTP Cost', 'CMP Cost', 'Fab Cost', 'Fab Cons', 'Width',
  'Basic Trim Cost', 'Rough CMP Cost',
  'Created Date',
] as const;

const VARIANT_EXTRA_HEADERS = ['Row Type', 'Parent Article Number', 'Variant Size', 'Variant Color', 'SAP Article ID'] as const;

function mapExportRow(row: any): Record<string, string | number | undefined> {
  const rawDate = row.approvedAt ? new Date(row.approvedAt) : null;
  const formattedDate = rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate.toLocaleDateString('en-GB') : '';
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
    M_WIDTH: row.fWidth || '', M_FAB_DIV: row.fabDiv || '', M_FAB_VDR: row.fabVdr || '',
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

interface BodyArticleDashboardProps {
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
}

export default function BodyArticleDashboard({ pathType }: BodyArticleDashboardProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const restoredFilters = (location.state as { restoreFilters?: DetailFilters } | null)?.restoreFilters;

  const [items, setItems] = useState<ApproverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(searchParams.get('page') || '1', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [totalCount, setTotalCount] = useState(0);
  const [user, setUser] = useState<any>(null);

  const seed = (key: keyof DetailFilters, fallback: string) =>
    searchParams.get(key as string) ?? restoredFilters?.[key] ?? fallback;

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState(() => seed('search', ''));
  const [divisionFilter, setDivisionFilter] = useState<string>(() => seed('division', 'ALL'));
  const [subDivisionFilter, setSubDivisionFilter] = useState<string>(() => seed('subDivision', 'ALL'));
  const [majorCategoryFilter, setMajorCategoryFilter] = useState<string>(() => seed('majorCategory', ''));
  const [sourceFilter, setSourceFilter] = useState<string>(() => seed('source', 'ALL'));
  const [sapSyncFilter, setSapSyncFilter] = useState<string>('ALL');
  const [dateRangeFilter, setDateRangeFilter] = useState<[Dayjs | null, Dayjs | null] | null>(() => {
    const start = searchParams.get('startDate') ?? restoredFilters?.startDate;
    const end = searchParams.get('endDate') ?? restoredFilters?.endDate;
    return start || end ? [start ? dayjs(start) : null, end ? dayjs(end) : null] : null;
  });
  const [exportingAll, setExportingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useArticleGroupBy('articleGroupBy:body', searchParams.get('groupBy'));
  // Bumped by Reset to remount the (uncontrolled) search input empty.
  const [searchKey, setSearchKey] = useState(0);

  const [subDivOpen, setSubDivOpen] = useState(false);
  const [subDivSearch, setSubDivSearch] = useState('');
  const [majCatOpen, setMajCatOpen] = useState(false);
  const [majCatSearch, setMajCatSearch] = useState('');

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialFetch = useRef(true);
  const cardClickDataRef = useRef<any>(null);

  const userAssignedDivisions = useMemo(() => getDivisionVariants(user?.division), [user]);
  const userAssignedSubDivisions = useMemo(() => getSubDivisionVariants(user?.subDivision), [user]);
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
      setSelectedIds(new Set());
      try {
        const token = localStorage.getItem('authToken');
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(PAGE_SIZE));
        if (groupBy !== 'none') params.set('groupBy', groupBy);

        let url: string;
        if (pathType === 'new' || pathType === 'created') {
          // Both New and Created tabs source from body_article_data via /approver/body-articles
          const effectiveStatus = pathType === 'created' ? 'APPROVED' : 'PENDING,REJECTED';
          params.set('status', effectiveStatus);
          if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
          if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
          if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
          if (searchText) params.set('search', searchText);
          if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
          if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
          url = `${APP_CONFIG.api.baseURL}/approver/body-articles?${params}`;
        } else {
          const effectiveStatus =
            pathType === 'rejected' ? 'REJECTED'
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
          params.set('presentationsType', PRESENTATIONS_TYPE);
          url = `${APP_CONFIG.api.baseURL}/approver/items?${params}`;
        }

        const response = await fetch(url, {
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
    [statusFilter, divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, sapSyncFilter, searchText, dateRangeFilter, pathType, groupBy],
  );

  useEffect(() => {
    if (isInitialFetch.current) {
      isInitialFetch.current = false;
      fetchItems(currentPage);
    } else {
      fetchItems(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchItems]);

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
      setOrDel('groupBy', groupBy !== 'none' ? groupBy : '');
      return p;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchText, divisionFilter, subDivisionFilter, majorCategoryFilter, sourceFilter, dateRangeFilter, groupBy]);

  const buildExportData = useCallback((rows: ApproverItem[]) => {
    return rows.map((row: any) => {
      const rawDate = row.createdAt;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const formattedDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString('en-GB') : '';
      return {
        'Body Article Number':      row.bodyArticle || '',
        'Body Article Description': row.bodyArticleDescription || '',
        Division:                   row.division || '',
        'Sub Division':             row.subDivision || '',
        'Major Category':           row.majorCategory || '',
        'MC Code':                  row.mcCode || '',
        Status:                     row.approvalStatus || '',
        'SAP Sync Status':          row.sapSyncStatus || '',
        'Vendor Name':              row.vendorName || '',
        'Vendor Code':              row.vendorCode || '',
        'Design Number':            row.designNumber || '',
        Season:                     row.season || '',
        Year:                       row.year || '',
        'HSN Tax Code':             row.hsnTaxCode || '',
        M_COLLAR_TYPE:              row.collar || '',
        M_COLLAR_STYLE:             row.collarStyle || '',
        M_NECK_TYPE:                row.neck || '',
        M_NECK_STYLE:               row.neckDetails || '',
        M_PLACKET:                  row.placket || '',
        M_BLT_TYPE:                 row.fatherBelt || '',
        M_BLT_STYLE:                row.childBelt || '',
        M_SLEEVES_MAIN_STYLE:       row.sleeve || '',
        M_SLEEVE_FOLD:              row.sleeveFold || '',
        M_BTM_FOLD:                 row.bottomFold || '',
        M_NO_OF_POCKET:             row.noOfPocket || '',
        M_POCKET:                   row.pocketType || '',
        M_EXTRA_POCKET:             row.extraPocket || '',
        M_FIT:                      row.fit || '',
        M_BODY_STYLE:               row.pattern || '',
        M_LENGTH:                   row.length || '',
        M_SET:                      row.mSet || '',
        'CMTP Cost':                row.cmtpCost == null ? undefined : Number(row.cmtpCost),
        'CMP Cost':                 row.cmpCost  == null ? undefined : Number(row.cmpCost),
        'Fab Cost':                 row.fabCost  == null ? undefined : Number(row.fabCost),
        'Fab Cons':                 row.fabCons  == null ? undefined : Number(row.fabCons),
        Width:                      row.bodyWidth == null ? undefined : Number(row.bodyWidth),
        'Basic Trim Cost':          row.basicTrimCost == null ? undefined : Number(row.basicTrimCost),
        'Rough CMP Cost':           row.roughCmpCost  == null ? undefined : Number(row.roughCmpCost),
        'Created Date':             formattedDate,
      } as Record<string, string | number | undefined>;
    });
  }, []);

  const exportHeaders = useMemo(() => [...SIMPLE_BODY_EXPORT_HEADERS], []);

  const handleExportAll = useCallback(async () => {
    setExportingAll(true);
    const loadingId = message.loading('Fetching all records for export…');
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams();
      const effectiveStatus =
        pathType === 'new' ? 'PENDING,REJECTED' : pathType === 'rejected' ? 'REJECTED'
        : pathType === 'created' ? 'APPROVED' : statusFilter;
      params.set('status', effectiveStatus);
      if (divisionFilter !== 'ALL') params.set('division', divisionFilter);
      if (subDivisionFilter !== 'ALL') params.set('subDivision', subDivisionFilter);
      if (majorCategoryFilter) params.set('majorCategory', majorCategoryFilter);
      if (searchText) params.set('search', searchText);
      if (dateRangeFilter?.[0]) params.set('startDate', dateRangeFilter[0].startOf('day').toISOString());
      if (dateRangeFilter?.[1]) params.set('endDate', dateRangeFilter[1].endOf('day').toISOString());
      params.set('limit', '9999');

      // Always export from body_article_data (not extraction_results_flat)
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/body-articles?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const result = await response.json();
      const allRows = (result.data || []).map((item: ApproverItem) => ({
        ...item, mcCode: item.mcCode || inferMcCode(item.majorCategory),
      }));
      if (allRows.length === 0) {
        message.dismiss(loadingId); message.warning('No records found for the current filters'); return;
      }
      const exportData = buildExportData(allRows);
      const fileName = pathType === 'new' ? 'Body New Articles'
        : pathType === 'rejected' ? 'Body Rejected Articles'
        : pathType === 'created' ? 'Body Created Articles' : 'Body Articles';
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
  }, [statusFilter, divisionFilter, subDivisionFilter, majorCategoryFilter, searchText, dateRangeFilter, pathType, buildExportData, exportHeaders]);

  const toggleSelect = useCallback((item: ApproverItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
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
    || sourceFilter !== 'ALL'
    || (pathType !== 'created' && statusFilter !== 'ALL')
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
    setSourceFilter('ALL');
    if (pathType !== 'created') setStatusFilter('ALL');
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
    const rows = items.filter((i) => selectedIds.has(i.id));
    if (rows.length === 0) { message.warning('No cards selected'); return; }

    if (pathType === 'created') {
      const loadingId = message.loading('Fetching variants for selected articles…');
      try {
        const token = localStorage.getItem('authToken');
        const params = new URLSearchParams();
        params.set('pathType', 'created');
        params.set('presentationsType', PRESENTATIONS_TYPE);
        params.set('status', 'APPROVED');
        params.set('ids', rows.map((r) => r.id).join(','));
        const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/export-all-with-variants?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Export failed');
        const result = await response.json();
        const allRows: any[] = result.data || [];
        if (allRows.length === 0) {
          message.dismiss(loadingId); message.warning('No data found'); return;
        }
        const variantHeaders = [...exportHeaders, ...VARIANT_EXTRA_HEADERS];
        const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
        await exportToExcel(allRows.map(mapExportRow), variantHeaders, [], `Body Created Articles${divLabel} - Selected`);
        message.dismiss(loadingId);
        message.success(`Exported ${allRows.length} rows (${rows.length} articles)`);
      } catch {
        message.dismiss(loadingId);
        message.error('Export failed.');
      }
      return;
    }

    const exportData = buildExportData(rows);
    const fileName = pathType === 'old' ? 'Body Old Articles' : pathType === 'new' ? 'Body New Articles'
      : pathType === 'rejected' ? 'Body Rejected Articles' : 'Body Articles';
    const divLabel = divisionFilter !== 'ALL' ? ` - ${divisionFilter}` : '';
    await exportToExcel(exportData, exportHeaders, [], `${fileName}${divLabel} - Selected`);
    message.success(`Exported ${rows.length} selected records`);
  }, [items, selectedIds, buildExportData, pathType, divisionFilter, exportHeaders]);

  cardClickDataRef.current = {
    items, currentPage, totalCount, statusFilter, divisionFilter, subDivisionFilter,
    majorCategoryFilter, sourceFilter, searchText, dateRangeFilter, pathType,
  };

  const handleCardClick = useCallback((item: ApproverItem, index: number) => {
    const d = cardClickDataRef.current;
    const effectiveStatus =
      d.pathType === 'new' ? 'PENDING,REJECTED' : d.pathType === 'rejected' ? 'REJECTED'
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
      d.pathType === 'old' ? '/body-article/old-articles'
      : d.pathType === 'rejected' ? '/body-article/rejected'
      : d.pathType === 'created' ? '/body-article/created'
      : d.pathType === 'failed' ? '/body-article/failed'
      : '/body-article';
    const state: DetailNavigationState = {
      items: d.items, currentIndex: index, currentPage: d.currentPage,
      totalCount: d.totalCount, pathType: d.pathType, filters,
      listPage: d.currentPage,
    };
    navigate(`${basePath}/${item.id}`, { state });
  }, [navigate]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 mb-2 -mx-1 px-1 pt-1">
        <div className="overflow-hidden rounded-xl border border-white/60 bg-white/85 shadow-[var(--shadow-md)] backdrop-blur">
          <div
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-white"
            style={{ background: 'linear-gradient(90deg, #1e3a5f 0%, #2d5986 100%)' }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-400/90">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="font-display truncate text-[13px] font-semibold leading-tight tracking-tight">
                  Body Article —{' '}
                  {pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles'
                    : pathType === 'rejected' ? 'Rejected Articles'
                    : pathType === 'created' ? 'Created Articles'
                    : pathType === 'failed' ? 'Failed Creations' : 'Dashboard'}
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
                  <span className="rounded-md bg-blue-400/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
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
              <Button size="sm" variant="outline" onClick={handleExportAll} disabled={exportingAll}
                className="h-7 border-white/30 bg-white/10 px-2.5 text-[12px] text-white hover:bg-white/20 hover:text-white disabled:opacity-50">
                <Download /> Export ({totalCount})
              </Button>
            </div>
            {(showDivisionFilter || isUnscoped) && (
              <DivisionTabs
                value={divisionFilter}
                onChange={(v) => { setDivisionFilter(v); setSubDivisionFilter('ALL'); }}
                options={isUnscoped ? ['MEN', 'LADIES', 'KIDS'].map(divisionOption) : userAssignedDivisions.map(divisionOption)}
              />
            )}
          </div>

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
              {pathType !== 'rejected' && pathType !== 'created' && pathType !== 'new' && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="!h-9 w-[130px] text-[13px] hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {(showSubDivisionFilter || isUnscoped) && (
                <Popover open={subDivOpen} onOpenChange={(o) => { setSubDivOpen(o); if (!o) setSubDivSearch(''); }}>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex h-9 w-[130px] items-center justify-between rounded-md border border-input bg-background px-2.5 text-[13px] hover:border-slate-400 focus-visible:outline-none focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25">
                      <span className="truncate text-left">{subDivisionFilter === 'ALL' ? 'All Sub-Divs' : subDivisionFilter}</span>
                      <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-0" align="start">
                    <div className="flex items-center border-b px-2 py-1.5">
                      <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input autoFocus value={subDivSearch} onChange={(e) => setSubDivSearch(e.target.value)}
                        placeholder="Search sub-division..." className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {(['ALL'] as string[]).concat(
                        isUnscoped
                          ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter).length > 0
                            ? getSubDivisionOptions(divisionFilter === 'ALL' ? undefined : divisionFilter)
                            : [...SIMPLIFIED_HIERARCHY['MENS'], ...SIMPLIFIED_HIERARCHY['Ladies'], ...SIMPLIFIED_HIERARCHY['Kids']]
                          : userAssignedSubDivisions,
                      ).filter((sd) => sd === 'ALL' || sd.toLowerCase().includes(subDivSearch.toLowerCase()))
                        .map((sd) => (
                          <button key={sd} type="button"
                            onClick={() => { setSubDivisionFilter(sd); setMajorCategoryFilter(''); setSubDivOpen(false); setSubDivSearch(''); }}
                            className={cn('w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground', subDivisionFilter === sd && 'bg-accent font-medium')}>
                            {sd === 'ALL' ? 'All Sub-Divs' : sd}
                          </button>
                        ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Popover open={majCatOpen} onOpenChange={(o) => { setMajCatOpen(o); if (!o) setMajCatSearch(''); }}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex h-9 w-[170px] items-center justify-between rounded-md border border-input bg-background px-2.5 text-[13px] hover:border-slate-400 focus-visible:outline-none focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25">
                    <span className="truncate text-left">{majorCategoryFilter || 'All Major Categories'}</span>
                    <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <div className="flex items-center border-b px-2 py-1.5">
                    <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input autoFocus value={majCatSearch} onChange={(e) => setMajCatSearch(e.target.value)}
                      placeholder="Search category..." className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
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
                            <button type="button"
                              onClick={() => { setMajorCategoryFilter(''); setMajCatOpen(false); setMajCatSearch(''); }}
                              className={cn('w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground', !majorCategoryFilter && 'bg-accent font-medium')}>
                              All Major Categories
                            </button>
                          )}
                          {filtered.map((v) => (
                            <button key={v.shortForm} type="button"
                              onClick={() => { setMajorCategoryFilter(v.shortForm); setMajCatOpen(false); setMajCatSearch(''); }}
                              className={cn('w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground', majorCategoryFilter === v.shortForm && 'bg-accent font-medium')}>
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
                <SelectTrigger className="!h-9 w-[110px] text-[13px] hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Sources</SelectItem>
                  <SelectItem value="SRM">SRM</SelectItem>
                  <SelectItem value="WATCHER">Watcher</SelectItem>
                  <SelectItem value="USER">User</SelectItem>
                </SelectContent>
              </Select>
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
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage}
                      className="h-4 w-4 cursor-pointer accent-slate-800" />
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
          <span className="text-sm">No body articles found</span>
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
                onClick={() => fetchItems(currentPage - 1)} className="h-7 px-3 text-[12px]">
                ← Prev
              </Button>
              <span className="text-[12px] text-muted-foreground">
                Page {currentPage} of {Math.ceil(totalCount / PAGE_SIZE)} · {totalCount} articles
              </span>
              <Button size="sm" variant="outline" disabled={currentPage * PAGE_SIZE >= totalCount}
                onClick={() => fetchItems(currentPage + 1)} className="h-7 px-3 text-[12px]">
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
