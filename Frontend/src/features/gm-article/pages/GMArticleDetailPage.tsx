import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  CheckCircle2, XCircle, FileText, LayoutGrid, Sparkles,
  ChevronLeft, ChevronRight, ArrowLeft, Loader2, RotateCw,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { GMArticleList, type ApproverArticleListProps } from '../components/GMArticleList';
import type { ApproverItem } from '../types';
import { APP_CONFIG } from '../../../constants/app/config';
import { getMcCodeByMajorCategory } from '../../../data/majorCategoryMcCodeMap';
import {
  SAP_NAME_TO_SCHEMA_KEY,
  SCHEMA_KEY_TO_DB_FIELD,
  SCHEMA_KEY_TO_EXCEL_ATTR,
} from '../../../data/majCatAttributeMap';
import {
  preloadMandatoryGridFor,
  isMandatoryGridFieldActive,
  getMandatoryGridFieldLabel,
  getMajCatGridEntry,
  preloadGMGridFor,
  getCachedGMGrid,
} from '../../../services/articleConfigService';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inferMcCode = (majorCategory?: string | null) => getMcCodeByMajorCategory(majorCategory);

// Maps schemaKey → all SAP key aliases for mandatory-grid lookups
const SCHEMA_KEY_TO_ALL_SAP_KEYS: Record<string, string[]> = Object.entries(SAP_NAME_TO_SCHEMA_KEY).reduce(
  (acc, [sapKey, schemaKey]) => {
    if (!acc[schemaKey]) acc[schemaKey] = [];
    acc[schemaKey].push(sapKey);
    return acc;
  },
  {} as Record<string, string[]>,
);

function hasGridDropdownValues(majorCat: string, schemaKey: string): boolean {
  const excelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey];
  if (!excelAttr) return false;
  return (getMajCatGridEntry(majorCat, excelAttr)?.length ?? 0) > 0;
}

function getMissingMandatoryFields(item: any, isFGMode = false): string[] {
  const missing: string[] = [];
  if (!item.vendorName) missing.push('VENDOR NAME');
  if (!isFGMode && !item.mrp) missing.push('MRP');
  if (isFGMode && !item.articleFashionType) missing.push('ARTICLE FASHION TYPE');
  const majorCat = item.majorCategory || '';
  if (!majorCat) return missing;
  for (const [schemaKey, dbField] of Object.entries(SCHEMA_KEY_TO_DB_FIELD)) {
    const sapKeys = SCHEMA_KEY_TO_ALL_SAP_KEYS[schemaKey] ?? [];
    if (sapKeys.length === 0) continue;
    // Only validate when mandatory in the grid AND has dropdown values (i.e. visible in UI)
    const isActive = sapKeys.some((sk) => isMandatoryGridFieldActive(majorCat, sk) === true);
    if (!isActive) continue;
    if (!hasGridDropdownValues(majorCat, schemaKey)) continue;
    const value = item[dbField as string];
    if (!value) {
      const activeSapKey = sapKeys.find((sk) => isMandatoryGridFieldActive(majorCat, sk) === true)!;
      missing.push(getMandatoryGridFieldLabel(activeSapKey) || activeSapKey);
    }
  }
  return missing;
}

const PAGE_SIZE = 50;

// DB field name → SAP characteristic name for every field visible in the Modify form.
const MODIFY_FIELDS: { field: string; sapName: string }[] = [
  // FAB
  { field: 'fabDiv',             sapName: 'M_FAB_DIV' },
  { field: 'yarn1',              sapName: 'M_YARN' },
  { field: 'mainMvgr',          sapName: 'M_FAB_MAIN_MVGR_1' },
  { field: 'fabricMainMvgr',    sapName: 'M_FAB_MAIN_MVGR_2' },
  { field: 'fabVdr',            sapName: 'M_FAB_VDR' },
  { field: 'weave',             sapName: 'M_WEAVE_01' },
  { field: 'mFab2',             sapName: 'M_WEAVE_02' },
  { field: 'fCount',            sapName: 'M_COUNT' },
  { field: 'gsm',               sapName: 'M_GSM' },
  { field: 'fOunce',            sapName: 'M_OUNZ' },
  { field: 'fConstruction',     sapName: 'M_CONSTRUCTION' },
  { field: 'composition',       sapName: 'M_COMPOSITION' },
  { field: 'finish',            sapName: 'M_FINISH' },
  { field: 'fWidth',            sapName: 'M_WIDTH' },
  { field: 'lycra',             sapName: 'M_LYCRA' },
  // BODY
  { field: 'collar',            sapName: 'M_COLLAR_TYPE' },
  { field: 'collarStyle',       sapName: 'M_COLLAR_STYLE' },
  { field: 'neckDetails',       sapName: 'M_NECK_STYLE' },
  { field: 'neck',              sapName: 'M_NECK_TYPE' },
  { field: 'placket',           sapName: 'M_PLACKET' },
  { field: 'fatherBelt',        sapName: 'M_BLT_TYPE' },
  { field: 'childBelt',         sapName: 'M_BLT_STYLE' },
  { field: 'sleeve',            sapName: 'M_SLEEVES_MAIN_STYLE' },
  { field: 'sleeveFold',        sapName: 'M_SLEEVE_FOLD' },
  { field: 'mSet',              sapName: 'M_SET' },
  { field: 'bottomFold',        sapName: 'M_BTM_FOLD' },
  { field: 'noOfPocket',        sapName: 'M_NO_OF_POCKET' },
  { field: 'pocketType',        sapName: 'M_POCKET' },
  { field: 'extraPocket',       sapName: 'M_EXTRA_POCKET' },
  { field: 'fit',               sapName: 'M_FIT' },
  { field: 'pattern',           sapName: 'M_BODY_STYLE' },
  { field: 'length',            sapName: 'M_LENGTH' },
  // VA ACC.
  { field: 'drawcord',          sapName: 'M_DC_STYLE' },
  { field: 'dcShape',           sapName: 'M_DC_SHAPE' },
  { field: 'button',            sapName: 'M_BTN_TYPE' },
  { field: 'btnColour',         sapName: 'M_BTN_CLR' },
  { field: 'zipper',            sapName: 'M_ZIP_TYPE' },
  { field: 'zipColour',         sapName: 'M_ZIP_COL' },
  { field: 'patchesType',       sapName: 'M_PATCH_STYLE' },
  { field: 'patches',           sapName: 'M_PATCHE_TYPE' },
  { field: 'htrfType',          sapName: 'M_HTRF_TYPE' },
  { field: 'htrfStyle',         sapName: 'M_HTRF_STYLE' },
  // VA PRCS
  { field: 'printType',         sapName: 'M_PRINT_TYPE' },
  { field: 'printStyle',        sapName: 'M_PRINT_STYLE' },
  { field: 'printPlacement',    sapName: 'M_PRINT_PLACEMENT' },
  { field: 'embroidery',        sapName: 'M_EMB_TYPE' },
  { field: 'embroideryType',    sapName: 'M_EMBROIDERY_STYLE' },
  { field: 'embPlacement',      sapName: 'M_EMB_PLACEMENT' },
  { field: 'wash',              sapName: 'M_WASH' },
  // BUSINESS
  { field: 'ageGroup',          sapName: 'M_AGE_GROUP' },
  { field: 'impAtrbt2',         sapName: 'M_IMP_ATBT' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfirmDialog =
  | { kind: 'approve'; count: number }
  | { kind: 'reject'; count: number }
  | { kind: 'createFabric'; item: ApproverItem }
  | { kind: 'createBody'; item: ApproverItem }
  | null;

type InfoDialog =
  | { kind: 'mandatoryMissing'; errors: { articleId: string; missing: string[] }[] }
  | { kind: 'sapSyncFailed'; failures: { id: string; message: string }[]; total: number }
  | { kind: 'sapPartialFailed'; failures: { id: string; message: string }[]; total: number }
  | null;

export interface DetailFilters {
  status: string;
  division: string;
  subDivision: string;
  majorCategory: string;
  source: string;
  search: string;
  startDate?: string;
  endDate?: string;
  pathType?: string;
}

export interface DetailNavigationState {
  items: ApproverItem[];
  currentIndex: number;
  currentPage: number;
  totalCount: number;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
  filters: DetailFilters;
  listPage?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_APPROVE_ROLES = ['ADMIN', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'PO_COMMITTEE', 'PD', 'GM_APPROVER'];

export default function ArticleDetailPage({
  ListComponent = GMArticleList,
  skipMandatoryFieldsCheck = false,
  approveEndpoint = '/approver/gm-articles/submit',
  itemsBaseEndpoint = '/approver/gm-articles',
  rejectEndpoint = '/approver/gm-articles/reject',
  approveRoles = DEFAULT_APPROVE_ROLES,
  isFGMode = false,
}: {
  ListComponent?: React.ComponentType<ApproverArticleListProps>;
  skipMandatoryFieldsCheck?: boolean;
  /** Override the approve POST endpoint. Defaults to /fabric-article/approve. */
  approveEndpoint?: string;
  /** Override the base path for GET/PUT item calls. Defaults to /approver/items. */
  itemsBaseEndpoint?: string;
  /** Override the reject POST endpoint. Defaults to /approver/reject. */
  rejectEndpoint?: string;
  /** Roles that can use the Save & Submit (approve) button. Defaults to standard approver roles. */
  approveRoles?: string[];
  /** When true, hides reference/article-desc fields and renames Article Number to Fabric Article Number. */
  isFGMode?: boolean;
} = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as DetailNavigationState | null;
  // Prefer the nav-state pathType; fall back to the URL so a hard refresh of a
  // detail page (esp. the PD page) keeps the correct flow (Save & Submit target).
  const pathFromUrl: DetailNavigationState['pathType'] =
    location.pathname.startsWith('/gm-article/old-articles') ? 'old'
    : location.pathname.startsWith('/gm-article/rejected') ? 'rejected'
    : location.pathname.startsWith('/gm-article/created') ? 'created'
    : location.pathname.startsWith('/gm-article/failed') ? 'failed'
    : location.pathname.startsWith('/gm-article') ? 'new'
    : undefined;
  const pathType = navState?.pathType ?? pathFromUrl;

  const [items, setItems] = useState<ApproverItem[]>(navState?.items ?? []);
  const [currentIndex, setCurrentIndex] = useState(navState?.currentIndex ?? 0);
  const [currentPage, setCurrentPage] = useState(navState?.currentPage ?? 1);
  const [totalCount, setTotalCount] = useState(navState?.totalCount ?? 0);
  const [loadingItem, setLoadingItem] = useState(!navState?.items?.length);
  const [user, setUser] = useState<any>(null);

  // Action state
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null);
  const [infoDialog, setInfoDialog] = useState<InfoDialog>(null);
  const [approving, setApproving] = useState(false);
  const [confirmingCreator, setConfirmingCreator] = useState(false);
  // Bumped once the per-category mandatory grid finishes loading, so the
  // Save & Submit gate recomputes against real grid data (fixes the hard-refresh
  // race where the gate ran before the grid cache was populated).
  const [gridVersion, setGridVersion] = useState(0);

  // Fabric article master hierarchy (div → sub_div → maj_cat)
  const [fabHierarchy, setFabHierarchy] = useState<{
    divisions: string[];
    subDivsByDiv: Record<string, string[]>;
    majCatsBySubDiv: Record<string, string[]>;
    mcDesByMajCat: Record<string, string[]>;
  }>({ divisions: [], subDivsByDiv: {}, majCatsBySubDiv: {}, mcDesByMajCat: {} });

  const canApprove = user?.role != null && approveRoles.includes(user.role);
  const isBodyArticlePage = skipMandatoryFieldsCheck;
  // Confirm button: visible to everyone on body article page EXCEPT BODY_APPROVER
  const canCreatorConfirm = isBodyArticlePage && user?.role !== 'BODY_APPROVER';
  // Save & Submit on body article page: only BODY_APPROVER and ADMIN can submit to SAP
  const canSubmitBodyArticle = !isBodyArticlePage || user?.role === 'BODY_APPROVER' || user?.role === 'ADMIN';
  // Save & Submit on FG New Articles page: only FABRIC_APPROVER and ADMIN can submit fabric articles to SAP
  const canSubmitFabricArticle = !isFGMode || user?.role === 'FABRIC_APPROVER' || user?.role === 'ADMIN';

  // ─── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const str = localStorage.getItem('user');
    if (str) { try { setUser(JSON.parse(str)); } catch { /* skip */ } }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/gm-hierarchy`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setFabHierarchy).catch(() => {});
  }, []);

  // Fetch by ID when opened directly (no navigation state)
  useEffect(() => {
    if (navState?.items?.length) { setLoadingItem(false); return; }
    if (!id) return;
    setLoadingItem(true);
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}${itemsBaseEndpoint}/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(item => {
        const withMc = { ...item, mcCode: item.mcCode || inferMcCode(item.majorCategory) };
        setItems([withMc]);
        setCurrentIndex(0);
        setTotalCount(1);
      })
      .catch(() => message.error('Failed to load article'))
      .finally(() => setLoadingItem(false));
  }, [id]);

  // Ensure the mandatory grid + GM attribute grid for every loaded article's major
  // category is cached, then bump gridVersion so the Save & Submit gate recomputes.
  useEffect(() => {
    const cats = Array.from(
      new Set(items.map(i => (i.majorCategory || '').trim()).filter(Boolean)),
    );
    if (cats.length === 0) return;
    Promise.all([
      ...cats.map(c => preloadMandatoryGridFor(c).catch(() => {})),
      ...cats.map(c => preloadGMGridFor(c).catch(() => {})),
    ]).then(() => setGridVersion(v => v + 1));
  }, [items]);

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const currentItem = items[currentIndex] ?? null;
  // Position within the current loaded batch (max 50 items)
  const globalPosition = items.length === 0 ? 0 : currentIndex + 1;
  const batchSize = items.length;
  const isFirstArticle = currentIndex === 0;
  const isLastArticle = currentIndex >= items.length - 1;

  function getBasePath() {
    const prefix = '/gm-article';
    if (pathType === 'old') return `${prefix}/old-articles`;
    if (pathType === 'rejected') return `${prefix}/rejected`;
    if (pathType === 'created') return `${prefix}/created`;
    if (pathType === 'failed') return `${prefix}/failed`;
    return prefix;
  }

  // Rebuild the list URL with the same filters that were active when the card was
  // opened, so Back returns to an identically-filtered (and identically-paged) list.
  function buildBackUrl() {
    const f = navState?.filters;
    const p = new URLSearchParams();
    p.set('page', String(navState?.listPage ?? 1));
    if (f) {
      if (f.search) p.set('search', f.search);
      if (f.division && f.division !== 'ALL') p.set('division', f.division);
      if (f.subDivision && f.subDivision !== 'ALL') p.set('subDivision', f.subDivision);
      if (f.majorCategory) p.set('majorCategory', f.majorCategory);
      if (f.source && f.source !== 'ALL') p.set('source', f.source);
      if (f.startDate) p.set('startDate', f.startDate);
      if (f.endDate) p.set('endDate', f.endDate);
    }
    return `${getBasePath()}?${p.toString()}`;
  }

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  const goNext = useCallback(() => {
    if (currentIndex < items.length - 1) setCurrentIndex(currentIndex + 1);
  }, [currentIndex, items.length]);

  // Auto-select current item
  useEffect(() => {
    if (currentItem && (currentItem.approvalStatus !== 'REJECTED' || isBodyArticlePage)) {
      setSelectedRowKeys([currentItem.id]);
    } else {
      setSelectedRowKeys([]);
    }
  }, [currentItem?.id]);

  // ─── Action helpers ──────────────────────────────────────────────────────────

  const updateItemInList = (updated: Partial<ApproverItem> & { id: string }) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === updated.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...updated, mcCode: (updated as any).mcCode || inferMcCode((updated as any).majorCategory) || copy[idx].mcCode || '' };
      return copy;
    });
  };

  const refetchCurrentItem = async () => {
    if (!currentItem) return;
    const token = localStorage.getItem('authToken');
    try {
      const r = await fetch(`${APP_CONFIG.api.baseURL}${itemsBaseEndpoint}/${currentItem.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) { const saved = await r.json(); updateItemInList(saved); }
    } catch { message.error('Failed to refresh'); }
  };

  // After an async approval, the SAP create runs in the background worker. Poll the
  // article until its sync resolves so the SAP number / failure shows without a
  // manual refresh. Non-blocking — the user can keep working.
  const pollSyncRef = useRef<number | null>(null);
  const stopSyncPoll = useCallback(() => {
    if (pollSyncRef.current) { window.clearInterval(pollSyncRef.current); pollSyncRef.current = null; }
  }, []);
  const pollUntilSynced = useCallback((id: string) => {
    stopSyncPoll();
    let elapsed = 0;
    pollSyncRef.current = window.setInterval(async () => {
      elapsed += 4;
      const token = localStorage.getItem('authToken');
      try {
        const r = await fetch(`${APP_CONFIG.api.baseURL}${itemsBaseEndpoint}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const saved = await r.json();
          updateItemInList(saved);
          if (saved.sapSyncStatus === 'SYNCED') {
            stopSyncPoll();
            message.success(`SAP article created: ${saved.sapArticleId || saved.articleNumber || ''}`);
          } else if (saved.sapSyncStatus === 'FAILED') {
            stopSyncPoll();
            // Backend reverts a failed article to PENDING (back in New Articles).
            // Show the reason so the approver can fix the flagged fields and resubmit.
            setInfoDialog({
              kind: 'sapSyncFailed',
              failures: [{
                id: saved.articleNumber || saved.designNumber || saved.imageName || saved.id,
                message: saved.sapSyncMessage || 'SAP creation failed',
              }],
              total: 1,
            });
          }
        }
      } catch { /* transient — keep polling */ }
      if (elapsed >= 180) stopSyncPoll(); // give up after 3 min; the status badge still reflects state
    }, 4000);
  }, [stopSyncPoll, updateItemInList]);

  useEffect(() => stopSyncPoll, [stopSyncPoll]); // stop polling on unmount

  // On opening an article, refresh it from the DB (the list's copy can be stale,
  // e.g. the SAP number filled in after the list loaded) and resume polling if
  // it's still being created in SAP. This is why a synced article that was opened
  // from a stale list now shows its SAP article number instead of "Creating in SAP…".
  useEffect(() => {
    if (!currentItem) return;
    void refetchCurrentItem();
    if (currentItem.approvalStatus === 'APPROVED' && currentItem.sapSyncStatus === 'PENDING') {
      pollUntilSynced(currentItem.id);
    } else {
      stopSyncPoll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.id]);

  const pendingSelectedKeys = useMemo(
    () => selectedRowKeys.filter(key => {
      const status = items.find(i => i.id === key)?.approvalStatus;
      return status === 'PENDING' || (skipMandatoryFieldsCheck && status === 'REJECTED');
    }),
    [selectedRowKeys, items, skipMandatoryFieldsCheck],
  );

  const approveBlockedReasons = useMemo(() => {
    if (skipMandatoryFieldsCheck) return [];
    const pendingItems = items.filter(i => pendingSelectedKeys.includes(i.id));
    return pendingItems.reduce<{ articleId: string; missing: string[] }[]>((acc, item) => {
      const missing: string[] = [];
      if (!item.vendorCode) missing.push('VENDOR CODE');
      // Color is mandatory on New Articles — skipped in FG and SRM Fabric Article mode.
      if (pathType === 'new' && !isFGMode && item.source !== 'SRM' && !item.colour) missing.push('COLOUR');
      // Fabric Article Desc and MC Description are mandatory in FG mode.
      if (isFGMode) {
        if (!(item.fabricArticleDescription || '').trim()) missing.push('FABRIC ARTICLE DESC.');
        if (!(item.mcDescription || '').trim()) missing.push('MC DESCRIPTION');
      }
      // Segment and Article Fashion Type are mandatory for SRM Fabric Articles.
      if (item.source === 'SRM') {
        if (!item.segment) missing.push('SEGMENT');
        if (!item.articleFashionType) missing.push('ARTICLE FASHION TYPE');
      }
      missing.push(...getMissingMandatoryFields(item, isFGMode));
      // GM attribute mandatory check — uses gm_major_category_grid_values mandatory flag
      const gmAttrs = getCachedGMGrid(item.majorCategory || '');
      if (gmAttrs) {
        for (const attr of gmAttrs) {
          if (attr.mandatory && !(item as any)[attr.familyCode]) {
            missing.push(attr.familyCode);
          }
        }
      }
      if (missing.length > 0) acc.push({ articleId: item.sapArticleId || item.articleNumber || item.imageName || item.id, missing });
      return acc;
    }, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelectedKeys, items, gridVersion, pathType, skipMandatoryFieldsCheck, isFGMode]);

  const handleApproveClick = () => {
    if (pendingSelectedKeys.length === 0) return;
    if (approveBlockedReasons.length > 0) { setInfoDialog({ kind: 'mandatoryMissing', errors: approveBlockedReasons }); return; }
    setConfirmDialog({ kind: 'approve', count: pendingSelectedKeys.length });
  };

  const doApprove = async () => {
    const endpoint = approveEndpoint;
    setApproving(true);
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: pendingSelectedKeys }),
      });
      if (!r.ok) {
        const errPayload = await r.json().catch(() => null);
        throw new Error(errPayload?.detail || errPayload?.error || 'Approval failed');
      }
      const payload = await r.json();
      setConfirmDialog(null);

      // Body article submit returns { results: [{ success, message }] } — check for failures
      if (Array.isArray(payload?.results)) {
        const failed = payload.results.filter((res: any) => !res.success);
        const succeeded = payload.results.filter((res: any) => res.success);
        if (failed.length > 0) {
          failed.forEach((res: any) => message.error(res.message || 'Submission failed'));
        }
        if (succeeded.length > 0) {
          message.success(`${succeeded.length} article(s) submitted to SAP successfully`);
        }
        setSelectedRowKeys([]);
        await refetchCurrentItem();
        return;
      }

      // Async approval: /approve returns 202 immediately and the SAP create runs in
      // the background worker. Inform the user, free the UI, and poll for completion
      // so the SAP article number fills in (or a failure popup shows) without blocking.
      const approvedId = currentItem?.id;
      const approvedCount = payload?.count ?? payload?.queued ?? pendingSelectedKeys.length;
      message.success(`Approved ${approvedCount} article(s) — creating in SAP in the background…`);
      setSelectedRowKeys([]);
      await refetchCurrentItem();
      if (approvedId) pollUntilSynced(approvedId);
    } catch (e) {
      setConfirmDialog(null);
      message.error(e instanceof Error ? e.message : 'Failed to approve items');
    }
    finally { setApproving(false); }
  };

  // Re-queue a FAILED generic for the background SAP-sync worker, then resume polling.
  const doRetrySync = async () => {
    if (!currentItem) return;
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/retry-sap-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [currentItem.id] }),
      });
      if (!r.ok) throw new Error('Retry failed');
      message.success('Re-queued — creating in SAP in the background…');
      await refetchCurrentItem();
      pollUntilSynced(currentItem.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to re-queue');
    }
  };

  const doCreatorConfirm = async () => {
    if (!currentItem) return;
    setConfirmingCreator(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/body-articles/${currentItem.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to confirm');
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === updated.id ? { ...i, fgCreatorApproved: updated.fgCreatorApproved } : i));
      message.success('Article confirmed — now visible to Body Approver');
    } catch {
      message.error('Failed to confirm article');
    } finally {
      setConfirmingCreator(false);
    }
  };

  const doReject = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}${rejectEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: pendingSelectedKeys }),
      });
      if (!r.ok) throw new Error('Rejection failed');
      setSelectedRowKeys([]);
      if (isFGMode) {
        message.success('Fabric article deleted');
        navigate(buildBackUrl());
      } else {
        message.success('Items rejected');
        await refetchCurrentItem();
      }
    } catch { message.error(isFGMode ? 'Failed to delete fabric article' : 'Failed to reject items'); }
  };

  const doCreateFabric = async (item: ApproverItem) => {
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/create-fabric-article`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [item.id] }),
      });
      const data = await r.json();
      if (!r.ok) {
        message.error(data.error || 'Failed to create fabric article');
        return;
      }
      message.success('Fabric article creation initiated');
      await refetchCurrentItem();
    } catch { message.error('Failed to create fabric article'); }
  };

  const doCreateBody = async (item: ApproverItem) => {
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/create-body-article`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [item.id] }),
      });
      if (!r.ok) throw new Error('Request failed');
      message.success('Body article creation initiated');
      await refetchCurrentItem();
    } catch { message.error('Failed to create body article'); }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 mb-2 -mx-1 px-1 pt-1">
        <div className="overflow-hidden rounded-xl border border-white/60 bg-white/85 shadow-[var(--shadow-md)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-white"
            style={{ background: 'linear-gradient(90deg, #1f2937 0%, #334155 100%)' }}>
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Back button */}
              <Button size="sm" variant="ghost" onClick={() => navigate(buildBackUrl(), {
                  state: navState?.filters ? { restoreFilters: navState.filters } : undefined,
                })}
                className="h-7 px-1.5 text-white hover:bg-white/15 hover:text-white">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FF6F61]/90">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="font-display truncate text-[13px] font-semibold leading-tight tracking-tight">
                  {isFGMode
                    ? (pathType === 'created' ? 'FG Created Articles' : 'FG New Articles')
                    : pathType === 'old' ? 'Old Articles' : pathType === 'new' ? 'New Articles'
                    : pathType === 'rejected' ? 'Rejected Articles'
                    : pathType === 'created' ? 'Created Articles'
                    : 'Article Detail'}
                </div>
                {user?.division && (
                  <div className="truncate text-[10px] font-medium text-white/65">
                    {formatDivisionLabel(user.division)}{user.subDivision ? ` · ${user.subDivision}` : ''}
                  </div>
                )}
              </div>
              {/* Prev / Next nav */}
              {totalCount > 0 && (
                <div className="ml-1.5 flex items-center gap-0.5 rounded-md bg-white/10 px-0.5 py-0.5">
                  <Button size="sm" variant="ghost" onClick={goPrev} disabled={isFirstArticle}
                    className="h-6 px-1.5 text-white hover:bg-white/15 hover:text-white disabled:opacity-30">
                    <ChevronLeft />
                  </Button>
                  <span className="px-0.5 text-[11px] font-semibold tabular-nums">{globalPosition} / {batchSize}</span>
                  <Button size="sm" variant="ghost" onClick={goNext} disabled={isLastArticle}
                    className="h-6 px-1.5 text-white hover:bg-white/15 hover:text-white disabled:opacity-30">
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {currentItem?.approvalStatus === 'APPROVED' && (
                <>
                  <span
                    className={
                      'mr-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ' +
                      (currentItem.sapSyncStatus === 'SYNCED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : currentItem.sapSyncStatus === 'FAILED'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-100 text-amber-700')
                    }
                    title="SAP creation status"
                  >
                    {currentItem.sapSyncStatus === 'SYNCED'
                      ? `SAP ✓ ${currentItem.sapArticleId || currentItem.articleNumber || ''}`
                      : currentItem.sapSyncStatus === 'FAILED'
                      ? 'SAP sync failed'
                      : 'Creating in SAP…'}
                  </span>
                  {currentItem.sapSyncStatus === 'FAILED' && !currentItem.sapArticleId && (
                    <Button size="sm" variant="outline" onClick={doRetrySync} className="mr-1 h-7 px-2 text-[12px]">
                      <RotateCw className="h-3.5 w-3.5" /> Retry SAP
                    </Button>
                  )}
                </>
              )}
              {canCreatorConfirm && currentItem?.fgCreatorApproved !== 'APPROVED' && (
                <Button size="sm" variant="outline"
                  onClick={doCreatorConfirm}
                  disabled={confirmingCreator}
                  className="h-7 px-2.5 text-[12px] border-green-500 text-green-700 hover:bg-green-50">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {confirmingCreator ? 'Confirming…' : 'Confirm'}
                </Button>
              )}
              {canCreatorConfirm && currentItem?.fgCreatorApproved === 'APPROVED' && (
                <span className="flex h-7 items-center gap-1 rounded-md bg-green-100 px-2.5 text-[12px] font-medium text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
                </span>
              )}
              <Tooltip title={!canApprove ? 'Only Approver, Sub-Division Head, Category Head or Admin can reject articles' : undefined}>
                {/* span wrapper: disabled <button> swallows pointer events; span keeps hover alive */}
                <span className="inline-block">
                  <Button size="sm" variant="outline"
                    onClick={() => { if (pendingSelectedKeys.length > 0) setConfirmDialog({ kind: 'reject', count: pendingSelectedKeys.length }); }}
                    disabled={!canApprove || pendingSelectedKeys.length === 0}
                    className="h-7 border-white/35 bg-transparent px-2.5 text-[12px] font-semibold text-white hover:bg-white/15 hover:text-white disabled:opacity-40">
                    <XCircle /> Reject
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                side="bottom"
                contentClassName="bg-white text-foreground border border-border p-0 max-w-xs shadow-lg"
                title={
                  !canApprove
                    ? 'Only Approver, Sub-Division Head, Category Head or Admin can approve articles'
                    : approveBlockedReasons.length > 0
                    ? (
                      <div className="p-3 text-xs leading-relaxed">
                        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-red-600">
                          <span>⚠</span> Fill required fields first:
                        </div>
                        {approveBlockedReasons.slice(0, 5).map(({ articleId, missing }) => (
                          <div key={articleId} className="mb-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5">
                            <div className="mb-0.5 truncate text-[11px] font-semibold text-amber-800">{articleId}</div>
                            <div className="text-red-700">{missing.join(', ')}</div>
                          </div>
                        ))}
                        {approveBlockedReasons.length > 5 && (
                          <div className="mt-1 text-muted-foreground">…and {approveBlockedReasons.length - 5} more</div>
                        )}
                      </div>
                    )
                    : undefined
                }
              >
                {/* span wrapper: disabled <button> swallows pointer events; span keeps hover alive */}
                <span className="inline-block">
                  <Button size="sm" onClick={handleApproveClick}
                    disabled={!canApprove || !canSubmitBodyArticle || !canSubmitFabricArticle || pendingSelectedKeys.length === 0 || approveBlockedReasons.length > 0}
                    className="h-7 border-none bg-white px-3 text-[12px] font-bold text-slate-800 shadow-sm hover:bg-slate-100 disabled:bg-white/20 disabled:text-white/50">
                    <CheckCircle2 /> Save &amp; Submit
                    {approveBlockedReasons.length > 0 && <span className="ml-1 text-[10px] text-amber-200">⚠ {approveBlockedReasons.length}</span>}
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Article detail */}
      {loadingItem ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ListComponent
          items={currentItem ? [currentItem] : []}
          majorCategory={currentItem?.majorCategory || ''}
          loading={false}
          selectedRowKeys={selectedRowKeys}
          onSelectionChange={setSelectedRowKeys}
          onCreateFabricArticle={item => setConfirmDialog({ kind: 'createFabric', item })}
          onCreateBodyArticle={item => setConfirmDialog({ kind: 'createBody', item })}
          onDuplicate={async () => {}}
          onModify={async (row, changes) => {
            if (!changes || Object.keys(changes).length === 0) return;

            // Run the same mandatory-field validation as Save & Submit.
            const mergedItem = { ...row, ...(changes as any) };
            const missing = getMissingMandatoryFields(mergedItem, isFGMode);
            if (!mergedItem.vendorCode) missing.unshift('VENDOR CODE');
            if (missing.length > 0) {
              const articleId = mergedItem.sapArticleId || mergedItem.articleNumber || mergedItem.id;
              setInfoDialog({ kind: 'mandatoryMissing', errors: [{ articleId, missing }] });
              throw new Error('Mandatory fields missing');
            }

            const ivMatnr = String(row.articleNumber ?? '').padStart(18, '0');
            const ivChanges = MODIFY_FIELDS
              .map(({ field, sapName }) => {
                const val = field in changes ? changes[field] : (row as any)[field];
                return `${sapName}=${val != null ? String(val) : ''}`;
              })
              .join('|');
            try {
              // National Grid validation — must pass before SAP is touched.
              const token = localStorage.getItem('authToken');
              const valRes = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${row.id}/validate-modify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ changes }),
              });
              if (!valRes.ok) {
                let errMsg = 'Validation failed';
                try {
                  const p = await valRes.json();
                  if (p?.error) errMsg = p.error;
                  if (p?.details?.length) {
                    errMsg += ': ' + (p.details as any[]).map((d: any) => d.message).join('; ');
                  }
                } catch { /* skip */ }
                message.error(errMsg);
                throw new Error(errMsg);
              }

              const r = await fetch('https://sap-api.v2retail.net/api/rfc/proxy?env=prod', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-RFC-Key': 'v2-rfc-proxy-2026',
                },
                body: JSON.stringify({
                  bapiname: 'Z_ART_PATCH_RFC_V69',
                  IV_MATNR: ivMatnr,
                  IV_CHANGES: ivChanges,
                  IV_TEST_MODE: '',
                }),
              });
              if (!r.ok) {
                let errMsg = 'Failed to modify article in SAP';
                try { const p = await r.json(); if (p?.error) errMsg = p.error; } catch { /* skip */ }
                message.error(errMsg);
                throw new Error(errMsg);
              }
              const body = await r.json();
              let evJson: any = body.EV_JSON ?? {};
              if (typeof evJson === 'string') {
                try { evJson = JSON.parse(evJson); } catch { evJson = {}; }
              }
              const exReturn = body.EX_RETURN ?? {};
              if (evJson.ok === false || exReturn.TYPE === 'E' || exReturn.TYPE === 'A') {
                const errMsg = exReturn.MESSAGE || 'SAP modification failed';
                message.error(errMsg);
                throw new Error(errMsg);
              }
              // SAP succeeded via RFC proxy — now persist the changes to the DB only.
              const dbRes = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${row.id}/modify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ changes, skipSap: true }),
              });
              if (!dbRes.ok) {
                let errMsg = 'SAP updated but failed to save to database';
                try { const p = await dbRes.json(); if (p?.error) errMsg = p.error; } catch { /* skip */ }
                message.error(errMsg);
                throw new Error(errMsg);
              }
              const saved = await dbRes.json();
              setItems(prev => {
                const idx = prev.findIndex(i => i.id === row.id);
                if (idx === -1) return prev;
                const copy = [...prev];
                copy[idx] = { ...copy[idx], ...saved, mcCode: saved.mcCode || inferMcCode(saved.majorCategory) || copy[idx].mcCode || '' };
                return copy;
              });
              message.success('Article modified in SAP and database');
            } catch (err) {
              throw err instanceof Error ? err : new Error('Failed to modify');
            }
          }}
          onRefresh={refetchCurrentItem}
          pathType={pathType}
          fabHierarchy={fabHierarchy}
          isFGMode={isFGMode}
          serverPagination={{ total: totalCount, current: currentPage, pageSize: PAGE_SIZE, onChange: () => {} }}
          onSave={async (row, directUpdates, options) => {
            const prevItems = [...items];
            const newData = [...items];
            const index = newData.findIndex(i => i.id === row.id);
            let updatePayload: Record<string, unknown> = {};
            if (index > -1) {
              const item = newData[index];
              updatePayload = Object.fromEntries(
                Object.entries(directUpdates || {}).map(([k, v]) => [k, v === undefined ? null : v]),
              );
              if (Object.keys(updatePayload).length === 0) {
                updatePayload = Object.fromEntries(
                  Object.entries(row).filter(([k, v]) => (item as any)[k] !== v).map(([k, v]) => [k, v === undefined ? null : v]),
                );
              }
              if (updatePayload.majorCategory && !updatePayload.mcCode) {
                updatePayload.mcCode = inferMcCode(updatePayload.majorCategory as string) || undefined;
              }
              newData.splice(index, 1, { ...item, ...updatePayload });
              setItems(newData);
            }
            if (Object.keys(updatePayload).length === 0) return;
            try {
              const token = localStorage.getItem('authToken');
              const r = await fetch(`${APP_CONFIG.api.baseURL}${itemsBaseEndpoint}/${row.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(updatePayload),
              });
              if (!r.ok) {
                let errMsg = 'Failed to save';
                try { const p = await r.json(); if (p?.error) errMsg = p.error; } catch { /* skip */ }
                setItems(prevItems);
                message.error(errMsg);
                return;
              }
              const saved = await r.json();
              setItems(prev => {
                const idx = prev.findIndex(i => i.id === saved.id);
                if (idx === -1) return prev;
                const copy = [...prev];
                copy[idx] = { ...copy[idx], ...saved, mcCode: saved.mcCode || inferMcCode(saved.majorCategory) || copy[idx].mcCode || '' };
                return copy;
              });
              if (!options?.silent) message.success('Saved');
            } catch {
              setItems(prevItems);
              message.error('Failed to save. Please check your connection.');
            }
          }}
        />
      )}

      {/* Confirm dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={o => !o && setConfirmDialog(null)}>
        <DialogContent>
          {confirmDialog?.kind === 'approve' && (
            <>
              <DialogHeader><DialogTitle>Confirm Approval</DialogTitle></DialogHeader>
              <p className="m-0">Are you sure you want to approve {confirmDialog.count} items? This action cannot be undone.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={approving}>Cancel</Button>
                <Button disabled={approving} onClick={doApprove}>
                  {approving ? <><Loader2 className="h-4 w-4 animate-spin" /> Approving…</> : 'Approve'}
                </Button>
              </DialogFooter>
            </>
          )}
          {confirmDialog?.kind === 'reject' && (
            <>
              <DialogHeader><DialogTitle>{isFGMode ? 'Confirm Deletion' : 'Confirm Rejection'}</DialogTitle></DialogHeader>
              <p className="m-0">{isFGMode ? `Delete ${confirmDialog.count} fabric article${confirmDialog.count > 1 ? 's' : ''} from the system?` : `Are you sure you want to reject ${confirmDialog.count} items?`}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
                <Button variant="destructive" onClick={async () => { setConfirmDialog(null); await doReject(); }}>Reject</Button>
              </DialogFooter>
            </>
          )}
          {confirmDialog?.kind === 'createFabric' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-sky-500" /> Create Fabric Article</DialogTitle>
              </DialogHeader>
              <p className="m-0">Create fabric article for "{confirmDialog.item.articleNumber || confirmDialog.item.imageName || confirmDialog.item.id}"?</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
                <Button onClick={async () => { const item = confirmDialog.item; setConfirmDialog(null); await doCreateFabric(item); }}>Create Fabric Article</Button>
              </DialogFooter>
            </>
          )}
          {confirmDialog?.kind === 'createBody' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-purple-500" /> Create Body Article</DialogTitle>
              </DialogHeader>
              <p className="m-0">Create body article for "{confirmDialog.item.articleNumber || confirmDialog.item.imageName || confirmDialog.item.id}"?</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
                <Button onClick={async () => { const item = confirmDialog.item; setConfirmDialog(null); await doCreateBody(item); }}>Create Body Article</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Info dialog */}
      <Dialog open={!!infoDialog} onOpenChange={o => !o && setInfoDialog(null)}>
        <DialogContent className="max-w-[600px]">
          {infoDialog?.kind === 'mandatoryMissing' && (
            <>
              <DialogHeader><DialogTitle>Cannot Approve — Mandatory Fields Missing</DialogTitle></DialogHeader>
              <div className="max-h-[400px] overflow-y-auto">
                {infoDialog.errors.map(({ articleId, missing }) => (
                  <div key={articleId} className="mb-3">
                    <div className="mb-1 text-[13px] font-semibold">{articleId}</div>
                    <div className="flex flex-wrap gap-1">
                      {missing.map(f => (
                        <span key={f} className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">{f}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter><Button onClick={() => setInfoDialog(null)}>OK</Button></DialogFooter>
            </>
          )}
          {infoDialog?.kind === 'sapSyncFailed' && (
            <>
              <DialogHeader><DialogTitle>SAP Sync Failed ({infoDialog.total} article{infoDialog.total > 1 ? 's' : ''})</DialogTitle></DialogHeader>
              <div className="max-h-[300px] overflow-y-auto">
                {infoDialog.failures.length > 0
                  ? infoDialog.failures.map((f, i) => <div key={i} className="mb-2 rounded bg-red-50 px-2 py-1.5 text-[13px] text-red-700">{f.message}</div>)
                  : <div className="rounded bg-red-50 px-2 py-1.5 text-[13px] text-red-700">SAP rejected the article. Check the ⚠ SAP Error banner on the article card below.</div>
                }
                <div className="mt-3 text-xs text-muted-foreground">Please fix the highlighted field{infoDialog.total > 1 ? 's' : ''} and try approving again.</div>
              </div>
              <DialogFooter><Button onClick={() => setInfoDialog(null)}>OK</Button></DialogFooter>
            </>
          )}
          {infoDialog?.kind === 'sapPartialFailed' && (
            <>
              <DialogHeader><DialogTitle>{infoDialog.total} Article{infoDialog.total > 1 ? 's' : ''} Failed SAP Sync</DialogTitle></DialogHeader>
              <div className="max-h-[300px] overflow-y-auto">
                {infoDialog.failures.map((f, i) => <div key={i} className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[13px] text-amber-700">{f.message}</div>)}
              </div>
              <DialogFooter><Button onClick={() => setInfoDialog(null)}>OK</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
