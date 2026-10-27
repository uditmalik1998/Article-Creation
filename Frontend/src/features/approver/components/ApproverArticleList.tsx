import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FileText,
  LayoutGrid,
  Info,
  Users,
  Copy,
  Maximize2,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Shirt,
  User as UserIcon,
  Hash,
  Wand2,
  Briefcase,
  DollarSign,
  Plus,
  Minus,
  RotateCw,
  Search,
  X,
  Upload,
  ChevronLeft,
  ChevronRight,
  Tag as TagIcon,
} from 'lucide-react';
import {
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tag,
  Tooltip,
  type AutocompleteOption,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import { useDragToPan } from '@/shared/hooks/ui/useDragToPan';
import type { ApproverItem } from '../types';
import CostingGridCard, { BTRIM_CONFIG, VADD_CONFIG, gridFields } from './CostingGridCard';
import PkgCostCard, { PKG_RATE_FIELDS } from './PkgCostCard';
import CmpCostCard, { PR_VAL_FIELD } from './CmpCostCard';
import { CARD_ACTION_BTN, CARD_THEME } from './cardTheme';

// FG cards rendered as a costing grid instead of the numbered attribute list.
const COSTING_GRID_CONFIGS: Record<string, { config: typeof BTRIM_CONFIG; fields: Set<string> }> = {
  'VA ACC.': { config: BTRIM_CONFIG, fields: gridFields(BTRIM_CONFIG) },
  'VA PRCS': { config: VADD_CONFIG, fields: gridFields(VADD_CONFIG) },
};
import {
  SCHEMA_KEY_TO_EXCEL_ATTR,
  SAP_NAME_TO_SCHEMA_KEY,
  normalizeMajorCategory,
} from '../../../data/majCatAttributeMap';
import { getMcCodeByMajorCategory } from '../../../data/majorCategoryMcCodeMap';
import {
  preloadMajCatGridFor,
  isMajCatGridLoadedFor,
  getMajCatGridEntry,
  isMajCatInGrid,
  preloadMandatoryGridFor,
  isMandatoryGridLoadedFor,
  isMandatoryGridFieldActive,
  isMajCatInMandatoryGrid,
} from '../../../services/articleConfigService';
import { getImageUrl } from '../../../shared/utils/common/helpers';
import { APP_CONFIG } from '../../../constants/app/config';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import VariantSubTable from './VariantSubTable';
import { variantCreatingIds } from '../../fabric-article/variantCreationState';

// Alias so the combobox trigger can use a distinct name from the plain icon
const ChevronDownIcon = ChevronDown;

// Module-level national grid cache — body article dropdown values from national_grid_master
type NationalGridValues = Record<string, { code: string; fullForm: string }[]>;
let nationalGridPromise: Promise<NationalGridValues> | null = null;

// Module-level major category cache keyed by normalised division (e.g. "MENS")
const majorCatByDivision = new Map<string, string[]>();
const majorCatPromises = new Map<string, Promise<string[]>>();
const fetchMajorCategoriesByDivision = (division: string): Promise<string[]> => {
  const div = (division || '').trim().toUpperCase() === 'MEN' ? 'MENS' : (division || '').trim().toUpperCase();
  if (majorCatByDivision.has(div)) return Promise.resolve(majorCatByDivision.get(div)!);
  if (majorCatPromises.has(div)) return majorCatPromises.get(div)!;
  const token = localStorage.getItem('authToken');
  const url = div
    ? `${APP_CONFIG.api.baseURL}/approver/major-categories?division=${encodeURIComponent(div)}`
    : `${APP_CONFIG.api.baseURL}/approver/major-categories`;
  const promise = fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.json())
    .then((res: any) => {
      const list: string[] = Array.isArray(res?.data) ? res.data : [];
      majorCatByDivision.set(div, list);
      return list;
    })
    .catch(() => []);
  majorCatPromises.set(div, promise);
  return promise;
};
const fetchNationalGridValues = (): Promise<NationalGridValues> => {
  if (!nationalGridPromise) {
    const token = localStorage.getItem('authToken');
    nationalGridPromise = fetch(`${APP_CONFIG.api.baseURL}/approver/national-grid-values`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((res) => res?.data ?? {})
      .catch(() => ({}));
  }
  return nationalGridPromise;
};

// Module-level segment range cache (shared across card instances, keyed by UPPER major category)
type SegmentRange = { segment_type: string; min: number; max: number };
const segmentRangeCache = new Map<string, SegmentRange[]>();

const fetchSegmentRangesFor = async (mc: string): Promise<SegmentRange[]> => {
  const key = (mc || '').trim().toUpperCase();
  if (!key) return [];
  if (segmentRangeCache.has(key)) return segmentRangeCache.get(key)!;
  try {
    const token = localStorage.getItem('authToken');
    const r = await fetch(
      `${APP_CONFIG.api.baseURL}/article-config/segment-ranges?majorCategory=${encodeURIComponent(mc)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (r.ok) {
      const json = await r.json();
      const data: SegmentRange[] = (json.data ?? []).map((row: any) => ({
        segment_type: String(row.segment_type),
        min: Number(row.min),
        max: Number(row.max),
      }));
      segmentRangeCache.set(key, data);
      return data;
    }
  } catch { /* ignore */ }
  segmentRangeCache.set(key, []);
  return [];
};

const computeSegmentFromMrp = (mrp: string | null | undefined, ranges: SegmentRange[]): string | null => {
  const m = parseFloat(String(mrp ?? ''));
  if (isNaN(m) || ranges.length === 0) return null;
  const match = ranges.find((r) => m >= r.min && m <= r.max);
  return match ? match.segment_type : null;
};

const f = (schemaKey: string) => SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey] ?? schemaKey;

const SCHEMA_KEY_TO_ALL_SAP_KEYS: Record<string, string[]> = Object.entries(SAP_NAME_TO_SCHEMA_KEY).reduce(
  (acc, [sapKey, schemaKey]) => {
    if (!acc[schemaKey]) acc[schemaKey] = [];
    acc[schemaKey].push(sapKey);
    return acc;
  },
  {} as Record<string, string[]>,
);

// Schema keys that live in the BOM section only — never shown in attribute card groups
// even if they appear in the DB admin attribute list with a group assigned.
const BOM_ONLY_SCHEMA_KEYS = new Set([
  'macro_mvgr', // IMP_ATBT-1 / macroMvgr  → BOM field
  // imp_atrbt2 used to live here but main moved it to the BUSINESS group
  // (4ec4bac "fields added"). Keeping it out so it renders in BUSINESS.
]);

// Schema keys hidden from the article card entirely (display-only — the values
// are still extracted, stored, and sent to SAP). Shade & Weight were removed
// from the card on all approver pages by request.
const HIDDEN_CARD_SCHEMA_KEYS = new Set([
  'shade',
  'weight',
]);

const ATTRIBUTE_GROUPS: { group: string; color: string; fields: { field: string; schemaKey: string; freeText?: boolean; mandatory?: boolean }[] }[] = [
  {
    group: 'FAB',
    color: '#e6f4ff',
    fields: [
      { field: 'fabDiv', schemaKey: 'fab_div' },
      { field: 'yarn1', schemaKey: 'yarn_01' },
      { field: 'mainMvgr', schemaKey: 'main_mvgr' },
      { field: 'fabricMainMvgr', schemaKey: 'fabric_main_mvgr' },
      { field: 'fabVdr', schemaKey: 'fab_vdr' },
      { field: 'weave', schemaKey: 'weave' },
      { field: 'mFab2', schemaKey: 'm_fab2' },
      { field: 'fCount', schemaKey: 'f_count' },
      { field: 'gsm', schemaKey: 'gsm' },
      { field: 'fOunce', schemaKey: 'f_ounce' },
      { field: 'fConstruction', schemaKey: 'f_construction' },
      { field: 'composition', schemaKey: 'composition' },
      { field: 'finish', schemaKey: 'finish' },
      { field: 'fWidth', schemaKey: 'f_width' },
      { field: 'lycra', schemaKey: 'lycra_non_lycra' },
      { field: 'shade', schemaKey: 'shade', freeText: true },
      { field: 'autoBgt', schemaKey: 'auto_bgt', freeText: true },
      { field: 'roughV2', schemaKey: 'rough_v2', freeText: true },
      { field: 'vendorFabricRate', schemaKey: 'vendor_fabric_rate', freeText: true, mandatory: true },
      { field: 'finalCost', schemaKey: 'final_cost', freeText: true },
    ],
  },
  {
    group: 'BODY',
    color: '#f6ffed',
    fields: [
      { field: 'collar', schemaKey: 'collar' },
      { field: 'collarStyle', schemaKey: 'collar_style' },
      { field: 'neckDetails', schemaKey: 'neck_details' },
      { field: 'neck', schemaKey: 'neck' },
      { field: 'placket', schemaKey: 'placket' },
      { field: 'fatherBelt', schemaKey: 'father_belt' },
      { field: 'childBelt', schemaKey: 'child_belt' },
      { field: 'sleeve', schemaKey: 'sleeve' },
      { field: 'sleeveFold', schemaKey: 'sleeve_fold' },
      { field: 'mSet', schemaKey: 'set' },
      { field: 'bottomFold', schemaKey: 'bottom_fold' },
      { field: 'noOfPocket', schemaKey: 'no_of_pocket' },
      { field: 'pocketType', schemaKey: 'pocket_type' },
      { field: 'extraPocket', schemaKey: 'extra_pocket' },
      { field: 'fit', schemaKey: 'fit' },
      { field: 'pattern', schemaKey: 'body_style' },
      { field: 'length', schemaKey: 'length' },
    ],
  },
  {
    group: 'VA ACC.',
    color: '#fff7e6',
    fields: [
      { field: 'drawcord', schemaKey: 'drawcord' },
      { field: 'dcShape', schemaKey: 'dc_shape' },
      { field: 'button', schemaKey: 'button' },
      { field: 'btnColour', schemaKey: 'btn_colour' },
      { field: 'zipper', schemaKey: 'zipper' },
      { field: 'zipColour', schemaKey: 'zip_colour' },
      { field: 'patchesType', schemaKey: 'patches_type' },
      { field: 'patches', schemaKey: 'patches' },
      { field: 'htrfType', schemaKey: 'htrf_type' },
      { field: 'htrfStyle', schemaKey: 'htrf_style' },
    ],
  },
  {
    group: 'VA PRCS',
    color: '#fff0f6',
    fields: [
      { field: 'printType', schemaKey: 'print_type' },
      { field: 'printStyle', schemaKey: 'print_style' },
      { field: 'printPlacement', schemaKey: 'print_placement' },
      { field: 'embroidery', schemaKey: 'embroidery' },
      { field: 'embroideryType', schemaKey: 'embroidery_type' },
      { field: 'embPlacement', schemaKey: 'emb_placement' },
      { field: 'wash', schemaKey: 'wash' },
    ],
  },
  {
    group: 'BUSINESS',
    color: '#f9f0ff',
    fields: [
      { field: 'ageGroup', schemaKey: 'age_group' },
      { field: 'articleFashionType', schemaKey: 'article_fashion_type', mandatory: true },
      { field: 'mNoOfSize', schemaKey: 'no_of_size' },
      { field: 'mNoOfClr', schemaKey: 'no_of_clr' },
      { field: 'impAtrbt2', schemaKey: 'imp_atrbt2' },
      { field: 'segment', schemaKey: 'segment', freeText: true, mandatory: true },
      { field: 'weight', schemaKey: 'fab_weight', freeText: true },
    ],
  },
];

// REFERENCE ARTICLE DESC source fields, in the user-confirmed sequence.
// These item keys span several cards (FAB / BODY / VA PRCS):
//   M_FAB_MAIN_MVGR_2 → M_WEAVE_02 → M_BLT_TYPE → M_BLT_STYLE →
//   M_FIT → M_BODY_STYLE → M_PRINT_PLACEMENT → M_WASH
const REF_DESC_FIELDS = [
  'fabricMainMvgr', // M_FAB_MAIN_MVGR_2
  'mFab2',          // M_WEAVE_02
  'fatherBelt',     // M_BLT_TYPE
  'childBelt',      // M_BLT_STYLE
  'fit',            // M_FIT
  'pattern',        // M_BODY_STYLE
  'printPlacement', // M_PRINT_PLACEMENT
  'wash',           // M_WASH
];
// color_master options for the BOM Colour dropdown — fetched once, cached across cards.
let _masterColorsCache: { code: string; name: string }[] | null = null;

// Searchable single-select for the BOM Colour field (color_master can be long).
const ColorSelect: React.FC<{
  value: string | null;
  options: { code: string; name: string }[];
  onPick: (code: string) => void;
  onClose: () => void;
}> = ({ value, options, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const lower = q.trim().toLowerCase();
  const filtered = lower
    ? options.filter((c) => c.code.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower))
    : options;
  return (
    <Popover defaultOpen onOpenChange={(o) => { if (!o) onClose(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-full items-center justify-between rounded border border-input bg-background px-1.5 text-[11px]"
        >
          <span className="truncate">{value || 'Select…'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[230px] p-0">
        <div className="border-b border-border p-1.5">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search colors…"
            className="h-7 text-[12px]"
          />
        </div>
        <div className="max-h-[240px] overflow-y-auto py-1">
          {filtered.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onPick(c.code)}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-[12px] transition-colors hover:bg-primary/5',
                value === c.code && 'bg-primary/10 font-medium',
              )}
            >
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.code}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2.5 py-2 text-[12px] text-muted-foreground">No colors match.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// FG OTH GRID-1 card: BUSINESS attrs shown under Rate/MRP/Colours in this order
// (M_AGE_GROUP → M_IMP_ATBT → ARTICLE FASHION TYPE → SEGMENT), rest after.
const OTH_GRID_1_ORDER = ['age_group', 'imp_atrbt2', 'article_fashion_type', 'segment'];

// Hidden from the FG cards only (UI). The attrs still exist in the DB/admin
// fab_weight is hidden from the FG card grid (OTH GRID-1 card).
const FG_CARD_HIDDEN_SCHEMA_KEYS = new Set(['fab_weight']);

// ─── Redesign tokens — header/icon palette per group ──────────────────────────
const GROUP_LABELS: Record<string, string> = {
  FAB: 'FAB',
  BODY: 'BODY',
  'VA ACC.': 'B TRIM',
  'VA PRCS': 'V. ADD',
  BUSINESS: 'OTH GRID-1',
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  FAB: <Shirt className="h-3.5 w-3.5" />,
  BODY: <UserIcon className="h-3.5 w-3.5" />,
  'VA ACC.': <Hash className="h-3.5 w-3.5" />,
  'VA PRCS': <Wand2 className="h-3.5 w-3.5" />,
  BUSINESS: <Briefcase className="h-3.5 w-3.5" />,
};

// Every group card shares one theme (CARD_THEME, "Ink Header"); the per-group
// colors (amber/emerald/yellow/rose/slate) were retired 2026-10-12.
const GROUP_HEADER_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  FAB: CARD_THEME,
  BODY: CARD_THEME,
  'VA ACC.': CARD_THEME,
  'VA PRCS': CARD_THEME,
  BUSINESS: CARD_THEME,
};

type CardGroup = typeof ATTRIBUTE_GROUPS[number];

export interface ApproverArticleListProps {
  items: ApproverItem[];
  majorCategory: string;
  loading: boolean;
  selectedRowKeys: React.Key[];
  onSelectionChange: (keys: React.Key[]) => void;
  onSave: (item: ApproverItem, updates: Record<string, unknown>, options?: { silent?: boolean }) => void;
  onCreateFabricArticle: (item: ApproverItem) => void;
  onCreateBodyArticle: (item: ApproverItem) => void;
  onProceedFGArticle: (item: ApproverItem) => void;
  onDuplicate: (item: ApproverItem, designNumber: string) => Promise<void>;
  /**
   * Modify an already-created (SAP-synced) article. Receives only the changed
   * fields. Used by the "Modify" button on the Created Articles page; pushes to
   * SAP first and persists locally only on success. Optional — pages that don't
   * support modify (new/old/rejected) simply omit it and the button is hidden.
   */
  onModify?: (item: ApproverItem, changes: Record<string, unknown>) => Promise<void>;
  onRefresh: () => void;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
  /** When set, only these attribute group names are shown in article cards. */
  allowGroups?: string[];
  /** When true, hides the "Create Body Article" button (used by BodyArticleList). */
  hideCreateBody?: boolean;
  /** Detail page (design "Option A"): the card's top strip continues the page's ink
   *  header as one block — square top corners, no top border, divider line. */
  joinTop?: boolean;
  /** When true, cards are display-only (e.g. a combo/set parent derived from its pieces). */
  readOnly?: boolean;
  /** Set parent: take attribute visibility / required fields from this category (its Top part). */
  attributeMajorCategory?: string;
  serverPagination: {
    total: number;
    current: number;
    pageSize: number;
    onChange: (page: number) => void;
  };
}

const getDisplayStatus = (item: ApproverItem) => {
  if (item.approvalStatus === 'REJECTED') return { label: 'REJECTED', color: '#ff4d4f' };
  if (item.sapSyncStatus === 'FAILED') return { label: 'FAILED', color: '#ff4d4f' };
  if (item.approvalStatus === 'APPROVED' && item.sapSyncStatus === 'SYNCED')
    return { label: 'DONE', color: '#52c41a' };
  return { label: 'PENDING', color: '#faad14' };
};

// ── Single article card ───────────────────────────────────────────────────────
const ArticleCard = React.memo(
  ({
    item,
    isSelected,
    onToggleSelect,
    onSave,
    onCreateFabricArticle,
    onCreateBodyArticle,
    onProceedFGArticle,
    onDuplicate,
    onModify,
    onRefresh,
    cardGroups,
    pathType,
    allowGroups,
    hideCreateBody,
    joinTop,
    readOnly,
    attributeMajorCategory,
  }: {
    item: ApproverItem;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    onSave: (item: ApproverItem, updates: Record<string, unknown>, options?: { silent?: boolean }) => void;
    onCreateFabricArticle: (item: ApproverItem) => void;
    onCreateBodyArticle: (item: ApproverItem) => void;
    onProceedFGArticle: (item: ApproverItem) => void;
    onDuplicate: (item: ApproverItem, designNumber: string) => Promise<void>;
    onModify?: (item: ApproverItem, changes: Record<string, unknown>) => Promise<void>;
    onRefresh: () => void;
    cardGroups: CardGroup[];
    pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
    allowGroups?: string[];
    hideCreateBody?: boolean;
    joinTop?: boolean;
    readOnly?: boolean;
    attributeMajorCategory?: string;
  }) => {
    const [showVariants, setShowVariants] = useState(true);
    const [imgModalOpen, setImgModalOpen] = useState(false);
    const [creatingVariants, setCreatingVariants] = useState(false);
    const [variantRefreshKey, setVariantRefreshKey] = useState(0);
    const [localValues, setLocalValues] = useState<Record<string, string | null>>({});
    const [dupConfirmOpen, setDupConfirmOpen] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [dupDesignNo, setDupDesignNo] = useState('');
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    // FG left rail: Article Information / Reference & Vendor start closed.
    const [openLeftCards, setOpenLeftCards] = useState<Set<string>>(new Set());
    const [fabNoQuery, setFabNoQuery] = useState('');
    const [fabNoResults, setFabNoResults] = useState<{
      fabricArticleNumber: string;
      fabricArticleDescription: string | null;
      mFabDiv: string | null; mYarn: string | null;
      mFabMainMvgr1: string | null; mFabMainMvgr2: string | null;
      mConstruction: string | null; mOunz: string | null; mWidth: string | null;
      mWeave01: string | null; mWeave02: string | null; mCount: string | null;
      mComposition: string | null; mFinish: string | null; mGsm: string | null; mLycra: string | null;
    }[]>([]);
    const [fabNoLoading, setFabNoLoading] = useState(false);
    const [cmpActPreset, setCmpActPreset] = useState<Record<string, string>>({});
    const [cmpBgtPreset, setCmpBgtPreset] = useState<Record<string, string>>({});
    const [cmpPresetUnsaved, setCmpPresetUnsaved] = useState(false);
    const cmpSavedPrVals = useMemo<Record<string, string>>(() => {
      const fmt = (v: unknown) => (v != null && v !== '' ? String(v) : '');
      return {
        'CUTTING|BGT|PR VAL':      fmt(item.cuttingBgtPrVal),
        'CUTTING|ACT|PR VAL':      fmt(item.cuttingActPrVal),
        'CUTTING|VENDOR|PR VAL':   fmt(item.cuttingVendorPrVal),
        'CUTTING|FINAL|PR VAL':    fmt(item.cuttingFinalPrVal),
        'STITCHING|BGT|PR VAL':    fmt(item.stitchingBgtPrVal),
        'STITCHING|ACT|PR VAL':    fmt(item.stitchingActPrVal),
        'STITCHING|VENDOR|PR VAL': fmt(item.stitchingVendorPrVal),
        'STITCHING|FINAL|PR VAL':  fmt(item.stitchingFinalPrVal),
        'IRONING|BGT|PR VAL':      fmt(item.ironingBgtPrVal),
        'IRONING|ACT|PR VAL':      fmt(item.ironingActPrVal),
        'IRONING|VENDOR|PR VAL':   fmt(item.ironingVendorPrVal),
        'IRONING|FINAL|PR VAL':    fmt(item.ironingFinalPrVal),
        'FINISHING|BGT|PR VAL':    fmt(item.finishingBgtPrVal),
        'FINISHING|ACT|PR VAL':    fmt(item.finishingActPrVal),
        'FINISHING|VENDOR|PR VAL': fmt(item.finishingVendorPrVal),
        'FINISHING|FINAL|PR VAL':  fmt(item.finishingFinalPrVal),
        'TOTAL|BGT|PR VAL':        fmt(item.totalBgtPrVal),
        'TOTAL|ACT|PR VAL':        fmt(item.totalActPrVal),
        'TOTAL|VENDOR|PR VAL':     fmt(item.totalVendorPrVal),
        'TOTAL|FINAL|PR VAL':      fmt(item.totalFinalPrVal),
      };
    }, [item.totalBgtPrVal, item.totalActPrVal, item.totalVendorPrVal, item.totalFinalPrVal,
        item.cuttingBgtPrVal, item.cuttingActPrVal, item.cuttingVendorPrVal, item.cuttingFinalPrVal,
        item.stitchingBgtPrVal, item.stitchingActPrVal, item.stitchingVendorPrVal, item.stitchingFinalPrVal,
        item.ironingBgtPrVal, item.ironingActPrVal, item.ironingVendorPrVal, item.ironingFinalPrVal,
        item.finishingBgtPrVal, item.finishingActPrVal, item.finishingVendorPrVal, item.finishingFinalPrVal]);
    const [preciseBodyResults, setPreciseBodyResults] = useState<{ macroBodyDescription: string | null; microBodyArticleNumber: string | null }[]>([]);
    const [preciseBodyLoading, setPreciseBodyLoading] = useState(false);
    const [preciseBodySearched, setPreciseBodySearched] = useState(false);
    const [preciseBodyNoQuery, setPreciseBodyNoQuery] = useState('');
    const [preciseBodyNoResults, setPreciseBodyNoResults] = useState<{ macroBodyDescription: string | null; microBodyArticleNumber: string | null }[]>([]);
    const [preciseBodyNoLoading, setPreciseBodyNoLoading] = useState(false);
    const [preciseBodyNoSearched, setPreciseBodyNoSearched] = useState(false);
    const [bodyNoQuery, setBodyNoQuery] = useState('');
    const [bodyNoResults, setBodyNoResults] = useState<{
      bodyArticleNumber: string | null;
      bodyArticleDescription: string | null;
      mCollarType: string | null; mCollarStyle: string | null;
      mNeckType: string | null; mNeckStyle: string | null;
      mPlacket: string | null; mBltType: string | null; mBltStyle: string | null;
      mSleevesMainStyle: string | null; mSleeveFold: string | null; mBtmFold: string | null;
      mNoOfPocket: string | null; mPocket: string | null; mExtraPocket: string | null;
      mFit: string | null; mBodyStyle: string | null; mLength: string | null; mSet: string | null;
      width: string | number | null;
    }[]>([]);
    const [bodyNoLoading, setBodyNoLoading] = useState(false);
    const [bodyNoSearched, setBodyNoSearched] = useState(false);
    const [fabDescQuery, setFabDescQuery] = useState('');
    const [fabDescResults, setFabDescResults] = useState<{
      fabricArticleNumber: string | null;
      fabricArticleDescription: string | null;
      fabricRate: number | null;
      mFabDiv: string | null; mYarn: string | null;
      mFabMainMvgr1: string | null; mFabMainMvgr2: string | null;
      mConstruction: string | null; mOunz: string | null; mWidth: string | null;
      mWeave01: string | null; mWeave02: string | null; mCount: string | null;
      mComposition: string | null; mFinish: string | null; mGsm: string | null; mLycra: string | null;
    }[]>([]);
    const [fabDescLoading, setFabDescLoading] = useState(false);
    const [fabDescSearched, setFabDescSearched] = useState(false);
    const [roughV2Loading, setRoughV2Loading] = useState(false);
    const roughV2FetchedRef = React.useRef(false);

    // Automatic fills (MRP from rate, ROUGH V2 / AUTO BGT, segment, descriptions,
    // consumption) are merged and sent as ONE silent save shortly after the last
    // one (1.5 s), instead of one PUT per field. Flushed early if the card unmounts.
    const latestItemRef = React.useRef(item);
    latestItemRef.current = item;
    const latestOnSaveRef = React.useRef(onSave);
    latestOnSaveRef.current = onSave;
    const autoSaveRef = React.useRef<{ updates: Record<string, unknown>; timer: ReturnType<typeof setTimeout> | null }>({
      updates: {},
      timer: null,
    });
    const flushAutoSave = useCallback(() => {
      const pending = autoSaveRef.current;
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = null;
      const updates = pending.updates;
      pending.updates = {};
      if (Object.keys(updates).length === 0) return;
      latestOnSaveRef.current({ ...latestItemRef.current, ...updates } as ApproverItem, updates, { silent: true });
    }, []);
    const queueAutoSave = useCallback(
      (updates: Record<string, unknown>) => {
        const pending = autoSaveRef.current;
        pending.updates = { ...pending.updates, ...updates };
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(flushAutoSave, 1500);
      },
      [flushAutoSave],
    );
    useEffect(() => flushAutoSave, [flushAutoSave]);

    // Auto-fill Rough-V2 on mount if not already set — exact match on 5 attrs
    useEffect(() => {
      const existingRoughV2 = (item as any).roughV2;
      if (existingRoughV2 != null && String(existingRoughV2).trim() !== '') return;
      if (roughV2FetchedRef.current) return;
      roughV2FetchedRef.current = true;
      const getV = (key: string) => String((item as any)[key] ?? '').trim();
      const params = new URLSearchParams({
        mYarn:         getV('yarn1'),
        mFabDiv:       getV('fabDiv'),
        mFabMainMvgr1: getV('mainMvgr'),
        mWeave01:      getV('weave'),
        mLycra:        getV('lycra'),
      });
      setRoughV2Loading(true);
      const token = localStorage.getItem('authToken');
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/fabric-article-data/rough-v2-rate?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.rate != null) {
            const rateStr = String(d.rate);
            setLocalValues((prev) => ({ ...prev, roughV2: rateStr }));
            if (isModifyMode) {
              setPendingChanges((prev) => ({ ...prev, roughV2: rateStr }));
            } else {
              queueAutoSave({ roughV2: rateStr });
            }
          }
        })
        .catch(() => {})
        .finally(() => setRoughV2Loading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Vendor-cost fallback: whenever VENDOR COST gets a value, fill any of
    // ROUGH-V2 / AUTO-BGT that are still empty (independently of each other).
    const currentVendorRate = String(
      (localValues['vendorFabricRate'] !== undefined ? localValues['vendorFabricRate'] : (item as any).vendorFabricRate) ?? '',
    ).trim();
    useEffect(() => {
      if (currentVendorRate === '') return;
      const roughV2Val = String(
        (localValues['roughV2'] !== undefined ? localValues['roughV2'] : (item as any).roughV2) ?? '',
      ).trim();
      const autoBgtVal = String(
        (localValues['autoBgt'] !== undefined ? localValues['autoBgt'] : (item as any).autoBgt) ?? '',
      ).trim();
      const updates: Record<string, string> = {};
      if (roughV2Val === '') updates['roughV2'] = currentVendorRate;
      if (autoBgtVal === '') updates['autoBgt'] = currentVendorRate;
      if (Object.keys(updates).length === 0) return;
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) {
        setPendingChanges((prev) => ({ ...prev, ...updates }));
      } else {
        queueAutoSave(updates);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentVendorRate]);

    const autoSavedFabDescRef = React.useRef<string | null>(null);
    const [imgZoom, setImgZoom] = useState(1);
    const [imgRotation, setImgRotation] = useState(0);
    // The image's real (natural) pixel size, captured on load. `transform: scale()`
    // alone is purely visual — it never grows the parent's scrollable area, which is
    // why zooming in previously left no real room to scroll/drag to the far edges.
    // Sizing the <img> with actual width/height (computed from this) instead makes
    // the browser's own overflow/scroll math account for the true zoomed size.
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [catOpen, setCatOpen] = useState(false);
    const [catSearch, setCatSearch] = useState('');
    // Search term for the attribute-value dropdown. A single shared term is
    // enough because only one attribute (editingField) is open at a time.
    const [attrSearch, setAttrSearch] = useState('');

    // ── Group-tab visibility filter (FG articles only) ──────────────────────
    // Keys: FAB | BODY | VA ACC. | VA PRCS | BOM | PKG  (BUSINESS is merged into BOM)
    const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(
      () => new Set(['FAB']),
    );
    const toggleGroupTab = (key: string) => {
      setSelectedGroupKeys((prev) => {
        if (prev.has(key) && prev.size === 1) return prev; // keep at least 1
        const next = new Set(prev);
        if (next.has(key)) { next.delete(key); } else { next.add(key); }
        return next;
      });
    };

    // ── Major categories from DB (major_category_details table) ─────────────
    const [dbMajorCategories, setDbMajorCategories] = useState<string[]>([]);
    useEffect(() => {
      fetchMajorCategoriesByDivision(item.division || '').then(setDbMajorCategories);
    }, [item.division]);

    // ── National grid values for Body Article dropdowns ─────────────────────
    const [nationalGrid, setNationalGrid] = useState<NationalGridValues>({});
    const [nationalGridReady, setNationalGridReady] = useState(false);
    const [fabricCreating, setFabricCreating] = useState(false);
    const [fabConfirmItem, setFabConfirmItem] = useState<ApproverItem | null>(null);
    useEffect(() => {
      if (!allowGroups) return;
      fetchNationalGridValues().then((data) => {
        setNationalGrid(data);
        setNationalGridReady(true);
      });
    }, [allowGroups]);

    const isBodyArticle = allowGroups?.includes('BODY') ?? false;

    // ── Created-page "Modify" flow ──────────────────────────────────────────
    // On the Created page, articles are already APPROVED + SAP-synced. We keep
    // them editable, but stage edits as `pendingChanges` instead of auto-saving;
    // the user then clicks "Modify" to push the diff to SAP (and only then the DB).
    const isModifyMode = pathType === 'created' && !!onModify && !isBodyArticle;
    const [pendingChanges, setPendingChanges] = useState<Record<string, string | null>>({});
    const [modifying, setModifying] = useState(false);

    const resetImageView = useCallback(() => {
      setImgZoom(1);
      setImgRotation(0);
    }, []);

    // Click-and-drag panning once zoomed in — an alternative to relying on the
    // mouse wheel/scrollbars to see different parts of a zoomed-in image.
    const { containerRef: panRef, onMouseDown: onPanMouseDown, isDragging: isImgPanning } = useDragToPan<HTMLDivElement>(imgZoom > 1);

    const [imgViewportSize, setImgViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
    useEffect(() => {
      if (!imgModalOpen) return;
      const onResize = () => setImgViewportSize({ w: window.innerWidth, h: window.innerHeight });
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, [imgModalOpen]);

    const prevItemRef = React.useRef<ApproverItem>(item);
    // Set when Create Body / Create Fabric Article is clicked: the next number the
    // server returns for that field is adopted even if it equals the old one.
    const awaitingLinkRef = React.useRef<Set<string>>(new Set());
    const pendingChangesRef = React.useRef(pendingChanges);
    pendingChangesRef.current = pendingChanges;
    React.useEffect(() => {
      const prev = prevItemRef.current;
      prevItemRef.current = item;
      if (prev === item) return;
      // Linked article numbers the server fills in itself (Create Body / Fabric Article,
      // or "already exists" auto-fill). Editing a BODY / FAB attribute stages them as
      // null, so a newly arrived number must replace that staged null — otherwise the
      // card stays empty and "Modify" would wipe the number again.
      const arrived: Record<string, string> = {};
      for (const k of ['bodyArticle', 'fabricArticleNumber']) {
        const now = String((item as any)[k] ?? '').trim();
        const before = String((prev as any)[k] ?? '').trim();
        if (now && (now !== before || awaitingLinkRef.current.has(k))) {
          arrived[k] = now;
          awaitingLinkRef.current.delete(k);
        }
      }
      if (Object.keys(arrived).length > 0) {
        setPendingChanges((p) => {
          const hit = Object.keys(arrived).filter((k) => k in p);
          return hit.length ? { ...p, ...Object.fromEntries(hit.map((k) => [k, arrived[k]])) } : p;
        });
      }
      setLocalValues((local) => {
        const next: Record<string, string | null> = {};
        const staged = pendingChangesRef.current;
        for (const [k, v] of Object.entries(local)) {
          if (k in arrived) { next[k] = arrived[k]; continue; }
          // Always keep keys that the user has staged — they haven't been saved yet
          if (k in staged || k in autoSaveRef.current.updates) { next[k] = v; continue; }
          const itemVal = (item as any)[k] ?? null;
          const strItemVal = itemVal === null ? null : String(itemVal);
          if (strItemVal !== (v === null ? null : String(v ?? ''))) {
            // server wins (field not staged, item has a different value)
          } else {
            next[k] = v;
          }
        }
        return next;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item]);

    // Auto-persist MRP when null in DB but rate is present
    React.useEffect(() => {
      if (item.approvalStatus === 'APPROVED' || item.approvalStatus === 'REJECTED') return;
      try {
        const raw = localStorage.getItem('user');
        if (raw) {
          const u = JSON.parse(raw);
          if (u.role !== 'ADMIN' && u.division && item.division && u.division !== item.division) return;
        }
      } catch {
        /* ignore */
      }
      const storedMrp = parseFloat(String((item as any).mrp ?? ''));
      const rate = parseFloat(String((item as any).rate ?? ''));
      if (isNaN(rate) || rate <= 0) return;
      const calculatedMrp = Math.ceil((rate * 1.47) / 50) * 50;
      // Skip if MRP is already saved and matches what we'd calculate — no API call needed
      if (!isNaN(storedMrp) && storedMrp > 0 && storedMrp === calculatedMrp) return;
      // Skip if MRP is already saved as any valid positive number (user may have set it manually)
      if (!isNaN(storedMrp) && storedMrp > 0) return;
      const calculated = String(calculatedMrp);
      setLocalValues((prev) => ({ ...prev, mrp: calculated }));
      queueAutoSave({ mrp: calculated });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]);

    const effectiveMajCat = useMemo(() => {
      const raw = (localValues['majorCategory'] !== undefined ? localValues['majorCategory'] : item.majorCategory) || '';
      return normalizeMajorCategory(raw, item.division);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localValues['majorCategory'], item.majorCategory, item.division]);

    // A set (parent) article shows and requires the attributes of its Top part,
    // whose values it mirrors — not its own set category's grid, which also
    // carries lower-garment fields (e.g. M_BLT_STYLE).
    const attrMajCat = useMemo(
      () => (attributeMajorCategory ? normalizeMajorCategory(attributeMajorCategory, item.division) : effectiveMajCat),
      [attributeMajorCategory, item.division, effectiveMajCat],
    );

    // Segment ranges for the current major category — auto-filled when MRP or MC changes
    const [segmentRanges, setSegmentRanges] = useState<SegmentRange[]>([]);
    const segmentRangesRef = useRef<SegmentRange[]>([]);
    segmentRangesRef.current = segmentRanges;

    useEffect(() => {
      if (!effectiveMajCat) return;
      fetchSegmentRangesFor(effectiveMajCat).then((ranges) => setSegmentRanges(ranges));
    }, [effectiveMajCat]);

    // Body fabric consumption options (width → consumption meter) — drives the width dropdown
    const [fabricConsumptionOptions, setFabricConsumptionOptions] = useState<
      { fabWidth: number; fabConsumption: number }[]
    >([]);
    useEffect(() => {
      if (!isBodyArticle || !effectiveMajCat) return;
      const token = localStorage.getItem('authToken');
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/body-fabric-consumption?majorCategory=${encodeURIComponent(effectiveMajCat)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json())
        .then((d: { fabWidth: number; fabConsumption: number }[]) => setFabricConsumptionOptions(d ?? []))
        .catch(() => setFabricConsumptionOptions([]));
    }, [isBodyArticle, effectiveMajCat]);

    // Auto-fill consumptionMeter from body_fabric_consumption using M_WIDTH (fWidth).
    // On load: only fills when consumptionMeter is null. On fWidth change: always fills.
    const currentFWidth = String(
      (localValues['fWidth'] !== undefined ? localValues['fWidth'] : (item as any).fWidth) ?? '',
    ).trim().replace(/"/g, '');
    const fWidthMountRef = React.useRef(true);
    useEffect(() => {
      if (!isBodyArticle || !effectiveMajCat || !currentFWidth) return;
      // On mount: skip if consumptionMeter already has a value
      if (fWidthMountRef.current) {
        fWidthMountRef.current = false;
        const existingMeter = String(
          (localValues['consumptionMeter'] !== undefined ? localValues['consumptionMeter'] : (item as any).consumptionMeter) ?? '',
        ).trim();
        if (existingMeter !== '') return;
      }
      const token = localStorage.getItem('authToken');
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/body-fabric-consumption/by-width?majorCategory=${encodeURIComponent(effectiveMajCat)}&fabWidth=${encodeURIComponent(currentFWidth)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json())
        .then((d: { fabConsumption: number | null }) => {
          if (d.fabConsumption == null) return;
          const updates: Record<string, string> = {
            width: currentFWidth,
            consumptionMeter: String(d.fabConsumption),
          };
          setLocalValues((prev) => ({ ...prev, ...updates }));
          if (isModifyMode) {
            setPendingChanges((prev) => ({ ...prev, ...updates }));
          } else {
            queueAutoSave(updates);
          }
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFWidth, isBodyArticle, effectiveMajCat]);

    // Auto-fill roughConsumptionMeter/Kg for FG articles when M_WIDTH (fWidth) changes.
    // gsm on FG items is stored as field "gsm" (Prisma maps db column gsm → mGsm, but item prop is "gsm").
    // gsmStr is optional: when omitted, reads current gsm from localValues/item.
    const currentGsm = String(
      (localValues['gsm'] !== undefined ? localValues['gsm'] : (item as any).gsm) ?? '',
    ).trim();
    const computeRoughKg = (meter: number, widthStr: string, gsmStr?: string) => {
      const w = parseFloat(widthStr) || 0;
      const rawGsm = gsmStr !== undefined ? gsmStr : currentGsm;
      const gsmMid = (() => {
        if (rawGsm.includes('-')) {
          const parts = rawGsm.split('-').map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] + parts[1]) / 2;
        }
        return parseFloat(rawGsm) || 0;
      })();
      return w > 0 && gsmMid > 0 ? ((w * gsmMid * meter * 2.54) / 100000).toFixed(4) : null;
    };
    const applyRoughUpdates = (meter: number, widthStr: string, gsmStr?: string) => {
      const kg = computeRoughKg(meter, widthStr, gsmStr);
      const updates: Record<string, string> = {
        roughConsumptionMeter: String(meter),
        ...(kg != null ? { roughConsumptionKg: kg } : {}),
      };
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
      else queueAutoSave(updates);
    };

    // `item` can be stale (the detail page restores it from navigation state on reload),
    // so read the stage's PR VALs straight from the DB before deciding anything.
    // Returns cell key → saved value ('' when null in DB).
    const loadFreshItem = async (): Promise<Record<string, unknown> | null> => {
      try {
        const token = localStorage.getItem('authToken');
        const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };

    const fetchDbPrVals = async (stage: 'BGT' | 'ACT'): Promise<Record<string, string> | null> => {
      try {
        const fresh = await loadFreshItem();
        if (!fresh) return null;
        const out: Record<string, string> = {};
        for (const p of ['CUTTING', 'STITCHING', 'IRONING', 'FINISHING']) {
          const key = `${p}|${stage}|PR VAL`;
          const v = fresh[PR_VAL_FIELD[key]];
          out[key] = v != null && v !== '' ? String(Number(v)) : '';
        }
        return out;
      } catch {
        return null;
      }
    };

    // Shows DB values in the card and fills only the PR VALs that are null in the DB.
    // Nothing is saved here — filled values wait for the card's Save button.
    const applyCmpPreset = (
      preset: Record<string, string>,
      dbVals: Record<string, string>,
      setPreset: (p: Record<string, string>) => void,
    ) => {
      let filled = false;
      const merged = { ...preset };
      for (const [key, dbV] of Object.entries(dbVals)) {
        if (dbV !== '') merged[key] = dbV;
        else if (preset[key]) filled = true;
      }
      setPreset(merged);
      if (filled) setCmpPresetUnsaved(true);
    };

    // Runs the preset API only when at least one of the stage's PR VALs is null in the DB.
    const loadCmpStage = async (
      stage: 'BGT' | 'ACT',
      fetchPreset: () => Promise<Record<string, string> | null>,
      setPreset: (p: Record<string, string>) => void,
    ) => {
      const dbVals = await fetchDbPrVals(stage);
      if (!dbVals) return;
      if (Object.values(dbVals).every((v) => v !== '')) {
        setPreset(dbVals);
        return;
      }
      const preset = await fetchPreset();
      if (preset) applyCmpPreset(preset, dbVals, setPreset);
    };

    // ACT preset from precise_body_article_consumption (by body article).
    const fetchCmpActPreset = async (bodyArticleNumber: string): Promise<Record<string, string> | null> => {
      try {
        const token = localStorage.getItem('authToken');
        const r = await fetch(
          `${APP_CONFIG.api.baseURL}/approver/precise-body-article/cmp-data?microBodyArticleNumber=${encodeURIComponent(bodyArticleNumber)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const d: { found: boolean; cuttingValue: number | null; stitchingSam: number | null; samVal: number | null; ironingSam: number | null; finishingSam: number | null } = await r.json();
        if (!d.found) return null;
        const fmt = (v: number | null) => (v != null ? String(v) : '');
        const stSam = d.stitchingSam ?? 0;
        const stVal = d.samVal ?? 0;
        const irSam = d.ironingSam ?? 0;
        const finSam = d.finishingSam ?? 0;
        return {
          'CUTTING|ACT|PR VAL':    fmt(d.cuttingValue),
          'STITCHING|ACT|SAM':     fmt(d.stitchingSam),
          'STITCHING|ACT|SAM VAL': fmt(d.samVal),
          'STITCHING|ACT|PR VAL':  stSam && stVal ? (stSam * stVal).toFixed(4) : '',
          'IRONING|ACT|SAM':       fmt(d.ironingSam),
          'IRONING|ACT|SAM VAL':   '2.5',
          'IRONING|ACT|PR VAL':    irSam ? (irSam * 2.5).toFixed(4) : '',
          'FINISHING|ACT|SAM':     fmt(d.finishingSam),
          'FINISHING|ACT|SAM VAL': '3',
          'FINISHING|ACT|PR VAL':  finSam ? (finSam * 3).toFixed(4) : '',
        };
      } catch {
        return null;
      }
    };

    // BGT preset from rough_cmp_cost_master (by major category).
    const fetchCmpBgtPreset = async (majCat: string): Promise<Record<string, string> | null> => {
      try {
        const token = localStorage.getItem('authToken');
        const r = await fetch(
          `${APP_CONFIG.api.baseURL}/approver/rough-cmp-cost?majorCategory=${encodeURIComponent(majCat)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const d: {
          cmpCost: number | null;
          cuttingSam: number | null; cuttingVal: number | null;
          stitchingSam: number | null; stitchingVal: number | null;
          ironingSam: number | null; ironingVal: number | null;
          finishingSam: number | null; finishingVal: number | null;
        } = await r.json();
        if (!d.cuttingVal && !d.stitchingSam && !d.ironingSam && !d.finishingSam) return null;
        const fmt = (v: number | null) => (v != null ? String(v) : '');
        const rate = (val: number | null, sam: number | null) =>
          val != null && sam != null && sam !== 0 ? (val / sam).toFixed(4) : '';
        return {
          'CUTTING|BGT|PR VAL':    fmt(d.cuttingVal),
          'STITCHING|BGT|SAM':     fmt(d.stitchingSam),
          'STITCHING|BGT|SAM VAL': rate(d.stitchingVal, d.stitchingSam),
          'STITCHING|BGT|PR VAL':  fmt(d.stitchingVal),
          'IRONING|BGT|SAM':       fmt(d.ironingSam),
          'IRONING|BGT|SAM VAL':   rate(d.ironingVal, d.ironingSam),
          'IRONING|BGT|PR VAL':    fmt(d.ironingVal),
          'FINISHING|BGT|SAM':     fmt(d.finishingSam),
          'FINISHING|BGT|SAM VAL': rate(d.finishingVal, d.finishingSam),
          'FINISHING|BGT|PR VAL':  fmt(d.finishingVal),
        };
      } catch {
        return null;
      }
    };

    // User explicitly picked a new body article — its ACT values replace the saved ones.
    const refreshCmpAct = async (bodyArticleNumber: string) => {
      const preset = await fetchCmpActPreset(bodyArticleNumber);
      if (!preset) return;
      const allEmpty = Object.fromEntries(
        ['CUTTING', 'STITCHING', 'IRONING', 'FINISHING'].map((p) => [`${p}|ACT|PR VAL`, '']),
      );
      applyCmpPreset(preset, allEmpty, setCmpActPreset);
    };

    // Auto-fill CMP ACT column when body article number is set or changes.
    const currentBodyArticle = String(localValues['bodyArticle'] ?? item.bodyArticle ?? '').trim();
    const cmpActFetchedRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !currentBodyArticle) return;
      if (cmpActFetchedRef.current === currentBodyArticle) return;
      cmpActFetchedRef.current = currentBodyArticle;
      loadCmpStage('ACT', () => fetchCmpActPreset(currentBodyArticle), setCmpActPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentBodyArticle, isBodyArticle]);

    // Auto-fill CMP COST card BGT column from rough_cmp_cost_master by major category.
    // Fires once per unique major category (FG articles only).
    const cmpBgtFetchedRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !effectiveMajCat) return;
      if (cmpBgtFetchedRef.current === effectiveMajCat) return;
      cmpBgtFetchedRef.current = effectiveMajCat;
      loadCmpStage('BGT', () => fetchCmpBgtPreset(effectiveMajCat), setCmpBgtPreset);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBodyArticle, effectiveMajCat]);

    // fWidth effect: fetches on every genuine M_WIDTH change for rough consumption.
    // Uses a "last applied" ref so re-renders from onSave don't re-trigger the fetch.
    // On first run: skips fetch if meter exists, backfills Kg only if missing.
    // Fallback: if no exact width match, uses the lowest fab_consumption for that major category.
    const roughAppliedKeyRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !effectiveMajCat || !currentFWidth) return;
      const key = `${effectiveMajCat}:${currentFWidth}`;
      const isFirstRun = roughAppliedKeyRef.current === '';
      if (isFirstRun) {
        roughAppliedKeyRef.current = key;
        // On mount: if meter already saved, only backfill Kg if it's missing
        const existingMeter = String(
          (localValues['roughConsumptionMeter'] !== undefined
            ? localValues['roughConsumptionMeter']
            : (item as any).roughConsumptionMeter) ?? '',
        ).trim();
        if (existingMeter !== '') {
          const existingKg = String(
            (localValues['roughConsumptionKg'] !== undefined
              ? localValues['roughConsumptionKg']
              : (item as any).roughConsumptionKg) ?? '',
          ).trim();
          if (existingKg !== '') return;
          const kg = computeRoughKg(parseFloat(existingMeter), currentFWidth);
          if (kg == null) return;
          const updates: Record<string, string> = { roughConsumptionKg: kg };
          setLocalValues((prev) => ({ ...prev, ...updates }));
          if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
          else queueAutoSave(updates);
          return;
        }
      } else {
        // Subsequent runs: only fetch if the key actually changed (real fWidth change)
        if (roughAppliedKeyRef.current === key) return;
        roughAppliedKeyRef.current = key;
      }
      const token = localStorage.getItem('authToken');
      const headers = { Authorization: `Bearer ${token}` };
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/body-fabric-consumption/by-width?majorCategory=${encodeURIComponent(effectiveMajCat)}&fabWidth=${encodeURIComponent(currentFWidth)}`,
        { headers },
      )
        .then((r) => r.json())
        .then((d: { fabConsumption: number | null }) => {
          if (d.fabConsumption != null) {
            applyRoughUpdates(d.fabConsumption, currentFWidth);
            return;
          }
          // No exact width match — fall back to lowest fab_consumption for this major category
          fetch(
            `${APP_CONFIG.api.baseURL}/approver/body-fabric-consumption?majorCategory=${encodeURIComponent(effectiveMajCat)}`,
            { headers },
          )
            .then((r2) => r2.json())
            .then((opts: { fabWidth: number; fabConsumption: number }[]) => {
              const valid = opts.filter((o) => o.fabConsumption != null);
              if (valid.length === 0) return;
              const lowest = valid.reduce((min, o) => o.fabConsumption < min.fabConsumption ? o : min, valid[0]);
              applyRoughUpdates(lowest.fabConsumption, currentFWidth);
            })
            .catch(() => {});
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFWidth, isBodyArticle, effectiveMajCat]);

    // When M_GSM changes on an FG article, recompute roughConsumptionKg using existing meter.
    // Skips first mount (fWidth effect handles initial Kg); only fires on genuine GSM changes.
    const roughGsmMountRef = React.useRef(true);
    const roughGsmAppliedRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !currentGsm) return;
      if (roughGsmMountRef.current) { roughGsmMountRef.current = false; return; }
      if (roughGsmAppliedRef.current === currentGsm) return;
      roughGsmAppliedRef.current = currentGsm;
      const existingMeter = String(
        (localValues['roughConsumptionMeter'] !== undefined
          ? localValues['roughConsumptionMeter']
          : (item as any).roughConsumptionMeter) ?? '',
      ).trim();
      if (!existingMeter || !currentFWidth) return;
      const kg = computeRoughKg(parseFloat(existingMeter), currentFWidth, currentGsm);
      if (kg == null) return;
      const updates: Record<string, string> = { roughConsumptionKg: kg };
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
      else queueAutoSave(updates);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentGsm, isBodyArticle]);

    // ── PRECISE CONSUMPTION (FG articles) ─────────────────────────────────────
    // Mirrors rough consumption logic but reads from precise_body_article_consumption.
    // Table stores consumption as width columns (width66, width58, …) per major category.
    const computePreciseKg = (meter: number, widthStr: string, gsmStr?: string) => {
      const w = parseFloat(widthStr) || 0;
      const rawGsm = gsmStr !== undefined ? gsmStr : currentGsm;
      const gsmMid = (() => {
        if (rawGsm.includes('-')) {
          const parts = rawGsm.split('-').map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] + parts[1]) / 2;
        }
        return parseFloat(rawGsm) || 0;
      })();
      return w > 0 && gsmMid > 0 ? ((w * gsmMid * meter * 2.54) / 100000).toFixed(4) : null;
    };
    const applyPreciseUpdates = (meter: number, widthStr: string, gsmStr?: string) => {
      const kg = computePreciseKg(meter, widthStr, gsmStr);
      const updates: Record<string, string> = {
        preciseConsumptionMeter: String(meter),
        ...(kg != null ? { preciseConsumptionKg: kg } : {}),
      };
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
      else queueAutoSave(updates);
    };

    // fWidth effect: fetches on every genuine M_WIDTH change for precise consumption.
    // Uses a "last applied" ref so re-renders from onSave don't re-trigger the fetch.
    const preciseAppliedKeyRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !effectiveMajCat || !currentFWidth) return;
      const key = `${effectiveMajCat}:${currentFWidth}`;
      const isFirstRun = preciseAppliedKeyRef.current === '';
      if (isFirstRun) {
        preciseAppliedKeyRef.current = key;
        const existingMeter = String(
          (localValues['preciseConsumptionMeter'] !== undefined
            ? localValues['preciseConsumptionMeter']
            : (item as any).preciseConsumptionMeter) ?? '',
        ).trim();
        if (existingMeter !== '') {
          const existingKg = String(
            (localValues['preciseConsumptionKg'] !== undefined
              ? localValues['preciseConsumptionKg']
              : (item as any).preciseConsumptionKg) ?? '',
          ).trim();
          if (existingKg !== '') return;
          const kg = computePreciseKg(parseFloat(existingMeter), currentFWidth);
          if (kg == null) return;
          const updates: Record<string, string> = { preciseConsumptionKg: kg };
          setLocalValues((prev) => ({ ...prev, ...updates }));
          if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
          else queueAutoSave(updates);
          return;
        }
      } else {
        if (preciseAppliedKeyRef.current === key) return;
        preciseAppliedKeyRef.current = key;
      }
      const token = localStorage.getItem('authToken');
      const headers = { Authorization: `Bearer ${token}` };
      const bodyArticleNo = String(
        (localValues['bodyArticle'] !== undefined ? localValues['bodyArticle'] : (item as any).bodyArticle) ?? '',
      ).trim();
      // Base is needed in production, where baseURL is the relative '/api'.
      const preciseUrl = new URL(`${APP_CONFIG.api.baseURL}/approver/precise-body-article/by-width`, window.location.origin);
      preciseUrl.searchParams.set('majorCategory', effectiveMajCat);
      preciseUrl.searchParams.set('fabWidth', currentFWidth);
      if (bodyArticleNo) preciseUrl.searchParams.set('microBodyArticleNumber', bodyArticleNo);
      fetch(preciseUrl.toString(), { headers })
        .then((r) => r.json())
        .then((d: { consumption: number | null }) => {
          if (d.consumption != null) {
            applyPreciseUpdates(d.consumption, currentFWidth);
          }
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFWidth, isBodyArticle, effectiveMajCat]);

    // When M_GSM changes on an FG article, recompute preciseConsumptionKg using existing meter.
    const preciseGsmMountRef = React.useRef(true);
    const preciseGsmAppliedRef = React.useRef('');
    useEffect(() => {
      if (isBodyArticle || !currentGsm) return;
      if (preciseGsmMountRef.current) { preciseGsmMountRef.current = false; return; }
      if (preciseGsmAppliedRef.current === currentGsm) return;
      preciseGsmAppliedRef.current = currentGsm;
      const existingMeter = String(
        (localValues['preciseConsumptionMeter'] !== undefined
          ? localValues['preciseConsumptionMeter']
          : (item as any).preciseConsumptionMeter) ?? '',
      ).trim();
      if (!existingMeter || !currentFWidth) return;
      const kg = computePreciseKg(parseFloat(existingMeter), currentFWidth, currentGsm);
      if (kg == null) return;
      const updates: Record<string, string> = { preciseConsumptionKg: kg };
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
      else queueAutoSave(updates);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentGsm, isBodyArticle]);
    // ── END PRECISE CONSUMPTION ───────────────────────────────────────────────

    // Auto-fill GSM (Rough Consumption) from body_fabric_consumption — only
    // when gsm is genuinely unset in the DB (item.gsm === null) and the master
    // table actually has a value for this major category. Never runs again
    // once a value exists.
    useEffect(() => {
      if (!isBodyArticle || !effectiveMajCat) return;
      if ((item as any).gsm != null) return;
      const token = localStorage.getItem('authToken');
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/body-fabric-consumption/gsm?majorCategory=${encodeURIComponent(effectiveMajCat)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json())
        .then((d: { gsm: number | null }) => {
          if (d.gsm == null) return;
          const updates: Record<string, string> = { gsm: String(d.gsm) };
          setLocalValues((prev) => ({ ...prev, ...updates }));
          queueAutoSave(updates);
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBodyArticle, effectiveMajCat, item.id]);

    // Auto-correct segment when ranges first load (fixes articles saved before this feature)
    useEffect(() => {
      if (segmentRanges.length === 0) return;
      if (item.approvalStatus === 'APPROVED' || item.approvalStatus === 'REJECTED') return;
      const mrpVal = String((localValues['mrp'] !== undefined ? localValues['mrp'] : item.mrp) ?? '');
      const expected = computeSegmentFromMrp(mrpVal, segmentRanges);
      if (!expected) return;
      const current = String((localValues['segment'] !== undefined ? localValues['segment'] : item.segment) ?? '');
      if (expected === current) return;
      setLocalValues((prev) => ({ ...prev, segment: expected }));
      if (!isModifyMode) {
        queueAutoSave({ segment: expected });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segmentRanges]);

    // Tracks when the major-category grid JSON (for THIS article's category) has loaded
    const [gridReady, setGridReady] = useState(() => isMajCatGridLoadedFor(effectiveMajCat));
    // Tracks when the mandatory grid (for THIS article's category) has loaded
    const [mandatoryGridReady, setMandatoryGridReady] = useState(() => isMandatoryGridLoadedFor(effectiveMajCat));

    const attributeFields = useMemo(
      () =>
        cardGroups.flatMap((g) =>
          g.fields.map((a) => ({ ...a, label: f(a.schemaKey), group: g.group, groupColor: g.color, freeText: a.freeText ?? false })),
        ),
      [cardGroups],
    );

    // Compute attributes per-card from this article's own majorCategory.
    //
    // 3-tier visibility (applied once either grid is loaded AND the major category
    // has any grid data):
    //   MANDATORY  — Mandatory Grid = 1   → shown with bold label + * (required for approve)
    //   OPTIONAL   — Maj-Cat Grid has dropdown values for this major category → shown plain
    //   HIDDEN     — neither grid has this field for this major category → not shown at all
    //
    // While grids are still loading OR category has no grid data: show all fields as
    // graceful fallback so the card doesn't look broken.
    type AttrValue = { shortForm: string; fullForm: string };
    const { visibleAttrs, mandatoryKeys } = useMemo(() => {
      if (!attrMajCat) return { visibleAttrs: [], mandatoryKeys: new Set<string>() };

      const visible: Array<{
        field: string;
        label: string;
        schemaKey: string;
        group: string;
        groupColor: string;
        values: AttrValue[];
        freeText: boolean;
        isMandatory: boolean;
        mandatory?: boolean;
      }> = [];
      const mandatory = new Set<string>();

      // At least one grid must be ready before we apply filtering.
      const gridsReady = gridReady || mandatoryGridReady;

      // Graceful degradation: if the major category has NO entries in EITHER grid
      // (e.g. not yet configured in the admin panel), fall back to showing ALL fields.
      // Uses direct category key-existence checks — reliable regardless of field name variations.
      const catHasAnyGridData =
        gridsReady &&
        ((mandatoryGridReady && isMajCatInMandatoryGrid(attrMajCat)) ||
          (gridReady && isMajCatInGrid(attrMajCat)));

      for (const af of attributeFields) {
        // BOM-only fields never appear in attribute groups
        if (BOM_ONLY_SCHEMA_KEYS.has(af.schemaKey)) continue;
        // Fields explicitly hidden from the card (shade, weight)
        if (HIDDEN_CARD_SCHEMA_KEYS.has(af.schemaKey)) continue;

        // Compute whether this field has a value (used to gate mandatory-but-empty visibility)
        const curVal = localValues[af.field] !== undefined ? localValues[af.field] : (item as any)[af.field];
        const hasValue = curVal != null && String(curVal).trim() !== '' && !/^-+$/.test(String(curVal).trim());

        // freeText fields (vendor fabric rate, segment…) are always visible — user can type into them.
        if (af.freeText) {
          const sapKeys = SCHEMA_KEY_TO_ALL_SAP_KEYS[af.schemaKey] ?? [];
          const gridMandatory =
            gridsReady &&
            !!catHasAnyGridData &&
            mandatoryGridReady &&
            sapKeys.some((sk) => isMandatoryGridFieldActive(attrMajCat, sk) === true);
          const isMandatory = af.mandatory === true || gridMandatory;
          if (isMandatory) mandatory.add(af.schemaKey);
          visible.push({
            field: af.field,
            label: af.label,
            schemaKey: af.schemaKey,
            group: af.group,
            groupColor: af.groupColor,
            values: [],
            freeText: true,
            isMandatory,
            mandatory: af.mandatory,
          });
          continue;
        }

        // Static-options fields — always visible, values hardcoded (not from grid)
        if (af.schemaKey === 'value_add_acc_cost_type') {
          visible.push({
            field: af.field,
            label: af.label,
            schemaKey: af.schemaKey,
            group: af.group,
            groupColor: af.groupColor,
            values: [
              { shortForm: 'Rough', fullForm: 'Rough' },
              { shortForm: 'Precise', fullForm: 'Precise' },
            ],
            freeText: false,
            isMandatory: false,
            mandatory: af.mandatory,
          });
          continue;
        }

        const gridExcelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[af.schemaKey];

        // Body Article: source dropdown values from national_grid_master instead of maj_cat_grid_values
        const nationalVals = allowGroups && nationalGridReady && gridExcelAttr
          ? (nationalGrid[gridExcelAttr] ?? null)
          : null;

        // Garment grid fallback (used for FG articles and Body Article when national grid has no entry)
        const gridOnlyVals = gridExcelAttr ? getMajCatGridEntry(attrMajCat, gridExcelAttr) : null;

        const values: AttrValue[] = nationalVals
          ? nationalVals.map((v) => ({ shortForm: v.code, fullForm: v.fullForm }))
          : (gridOnlyVals ?? []).map((v) => ({ shortForm: v, fullForm: v }));

        if (gridsReady && catHasAnyGridData) {
          // ── Grids loaded AND category is configured: apply 3-tier filtering ──
          // Check ALL SAP key aliases — uploaded Excel may use any variant
          const sapKeys = SCHEMA_KEY_TO_ALL_SAP_KEYS[af.schemaKey] ?? [];
          const isActiveMandatory =
            mandatoryGridReady &&
            sapKeys.some((sk) => isMandatoryGridFieldActive(attrMajCat, sk) === true);

          const excelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[af.schemaKey];
          // Attribute visibility always driven by maj_cat_grid_values (same as FG articles)
          const hasDropdownValues =
            gridReady && excelAttr ? (getMajCatGridEntry(attrMajCat, excelAttr)?.length ?? 0) > 0 : false;

          const forceMandatory = af.mandatory === true;
          if (isActiveMandatory || forceMandatory) {
            // TIER 1: Mandatory — shown if field has a value OR has dropdown options.
            // Hidden only when no value AND no dropdown options (un-fillable); those
            // hidden fields are not tracked in mandatoryKeys so they don't block submit.
            if (hasValue || hasDropdownValues) {
              mandatory.add(af.schemaKey);
              visible.push({
                field: af.field,
                label: af.label,
                schemaKey: af.schemaKey,
                group: af.group,
                groupColor: af.groupColor,
                values,
                freeText: false,
                isMandatory: true,
                mandatory: af.mandatory,
              });
            }
          } else if (hasDropdownValues) {
            // TIER 2: Optional — has dropdown values but not mandatory
            visible.push({
              field: af.field,
              label: af.label,
              schemaKey: af.schemaKey,
              group: af.group,
              groupColor: af.groupColor,
              values,
              freeText: false,
              isMandatory: false,
              mandatory: af.mandatory,
            });
          } else if (forceMandatory && (hasValue || hasDropdownValues)) {
            // Force-show when mandatory override is set AND field has a value or dropdown options
            visible.push({
              field: af.field,
              label: af.label,
              schemaKey: af.schemaKey,
              group: af.group,
              groupColor: af.groupColor,
              values,
              freeText: false,
              isMandatory: true,
              mandatory: true,
            });
          }
          // TIER 3: Neither → skip (completely hidden for configured categories)
        } else {
          // ── Grids not yet loaded OR category has no grid data: graceful fallback ──
          const isMandatoryFallback = af.mandatory === true;
          if (!isMandatoryFallback || hasValue) {
            if (isMandatoryFallback) mandatory.add(af.schemaKey);
            visible.push({
              field: af.field,
              label: af.label,
              schemaKey: af.schemaKey,
              group: af.group,
              groupColor: af.groupColor,
              values,
              freeText: false,
              isMandatory: isMandatoryFallback,
              mandatory: af.mandatory,
            });
          }
        }
      }

      return { visibleAttrs: visible, mandatoryKeys: mandatory };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attrMajCat, gridReady, mandatoryGridReady, attributeFields, localValues, nationalGrid, nationalGridReady, allowGroups]);

    const [editingField, setEditingField] = useState<string | null>(null);

    // Vendor autocomplete state
    // null = not typed yet (show the saved name); '' = the user cleared the box.
    const [vendorQuery, setVendorQuery] = useState<string | null>(null);
    const [vendorOptions, setVendorOptions] = useState<AutocompleteOption[]>([]);
    const [vendorSearching, setVendorSearching] = useState(false);
    const vendorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Preload the major-category grid (dropdown values) for THIS article's
    // category only — not the entire grid. Re-runs if the category changes.
    useEffect(() => {
      if (!effectiveMajCat) return;
      if (isMajCatGridLoadedFor(effectiveMajCat)) {
        setGridReady(true);
        return;
      }
      setGridReady(false);
      preloadMajCatGridFor(effectiveMajCat)
        .then(() => setGridReady(true))
        .catch(() => setGridReady(true));
    }, [effectiveMajCat]);

    // Preload the mandatory grid (field visibility / required) for THIS
    // article's category only — not the entire grid. Re-runs on category change.
    useEffect(() => {
      if (!effectiveMajCat) return;
      if (isMandatoryGridLoadedFor(effectiveMajCat)) {
        setMandatoryGridReady(true);
        return;
      }
      setMandatoryGridReady(false);
      preloadMandatoryGridFor(effectiveMajCat)
        .then(() => setMandatoryGridReady(true))
        .catch(() => setMandatoryGridReady(true));
    }, [effectiveMajCat]);

    const [failedImg, setFailedImg] = useState(false);
    const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);
    const refreshAttempted = React.useRef(false);

    // FG Created tab, vendors starting "V2 S": replace the image (backend keeps the
    // first one as <article>_OLD.jpg / old_image_url) and arrow between new and old.
    const canReplaceImage =
      pathType === 'created' && !allowGroups && !readOnly && String(item.vendorName ?? '').trim().toUpperCase().startsWith('V2 S');
    // Photo views shown with the arrows: front, then back (SRM back photo), then old (replace).
    const [imgViewIdx, setImgViewIdx] = useState(0);
    const [oldImgFailed, setOldImgFailed] = useState(false);
    const [backImgFailed, setBackImgFailed] = useState(false);
    useEffect(() => {
      setImgViewIdx(0);
      setBackImgFailed(false);
    }, [item.id]);
    const [localOldImageUrl, setLocalOldImageUrl] = useState<string | null>(null);
    const [replaceOpen, setReplaceOpen] = useState(false);
    const [replaceFile, setReplaceFile] = useState<File | null>(null);
    const [replacePreview, setReplacePreview] = useState<string | null>(null);
    const [replaceProgress, setReplaceProgress] = useState<number | null>(null);
    const [replaceDragOver, setReplaceDragOver] = useState(false);

    // color_master colors for the BOM Colour dropdown (fetched once, cached).
    const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>(_masterColorsCache ?? []);
    useEffect(() => {
      if (_masterColorsCache) { setMasterColors(_masterColorsCache); return; }
      const token = localStorage.getItem('authToken');
      fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((r) => (r.ok ? r.json() : { colors: [] }))
        .then((d) => {
          const c = Array.isArray(d?.colors) ? d.colors : [];
          _masterColorsCache = c;
          setMasterColors(c);
        })
        .catch(() => setMasterColors([]));
    }, []);

    const FAB_FIELDS = useMemo(
      () =>
        (cardGroups.find((g) => g.group === 'FAB' || g.group === 'FABRIC')?.fields ?? []).filter(
          (f) => !f.freeText && f.field !== 'mainMvgr',
        ),
      [cardGroups],
    );
    const BODY_FIELDS = useMemo(
      () => (cardGroups.find((g) => g.group === 'BODY')?.fields ?? []).filter((f) => !f.freeText),
      [cardGroups],
    );
    // Canonical BODY ARTICLE DESC format: every filled Body & Construction field,
    // in card order, joined with '-' and capped at 40 chars. Shared by the live
    // rebuild effect below and by the search-select autofill, so the field always
    // ends up in the same format regardless of how it was filled — which is also
    // what makes searching by partial description meaningful (master rows are
    // expected to follow this same convention).
    const buildBodyDescription = useCallback(
      (getVal: (field: string) => string | null) => {
        const parts = BODY_FIELDS
          .map((f) => getVal(f.field))
          .filter((v): v is string => !!v && !/^-+$/.test(v.trim()));
        return parts.length > 0 ? parts.join('-').replace(/-{2,}/g, '-') : null;
      },
      [BODY_FIELDS],
    );

    const getFieldVal = useCallback(
      (field: string) => {
        const v = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
        return v ? String(v).trim() : null;
      },
      [localValues, item],
    );

    // Reactively rebuild fabric/body descriptions whenever visible fields or item changes.
    // Also persists bodyArticleDescription to DB when it's missing (null in DB but computable
    // from the current body attribute values).
    React.useEffect(() => {
      if (item.approvalStatus !== 'PENDING') return;
      setLocalValues((prev) => {
        const getVal = (field: string) => {
          const v = prev[field] !== undefined ? prev[field] : (item as any)[field];
          return v ? String(v).trim() : null;
        };
        const fabParts = FAB_FIELDS.map((f) => getVal(f.field)).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
        const newFabDesc = fabParts.length > 0 ? fabParts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '') : null;
        const newBodyDesc = buildBodyDescription(getVal);
        // REFERENCE ARTICLE DESC = FABRIC ARTICLE DESC + BODY ARTICLE DESC joined by '-'
        const refParts = [newFabDesc, newBodyDesc].filter(Boolean) as string[];
        const newRefDesc = refParts.length > 0 ? refParts.join('-') : null;
        const updates: Record<string, string | null> = {};
        if (newFabDesc !== null && newFabDesc !== prev['fabricArticleDescription']) updates['fabricArticleDescription'] = newFabDesc;
        if (newBodyDesc !== null && newBodyDesc !== prev['bodyArticleDescription']) updates['bodyArticleDescription'] = newBodyDesc;
        if (newRefDesc !== null && newRefDesc !== prev['referenceArticleDescription']) updates['referenceArticleDescription'] = newRefDesc;
        // Persist bodyArticleDescription to DB when it was missing (null) but is now computable.
        if (newBodyDesc && !item.bodyArticleDescription) {
          setTimeout(() => {
            queueAutoSave({ bodyArticleDescription: newBodyDesc });
          }, 0);
        }
        // Persist fabricArticleDescription to DB whenever the computed value differs from what's
        // stored — guards against stale Gemini-extracted strings that don't match the joined fields.
        if (newFabDesc && newFabDesc !== item.fabricArticleDescription && autoSavedFabDescRef.current !== newFabDesc) {
          autoSavedFabDescRef.current = newFabDesc;
          setTimeout(() => {
            queueAutoSave({ fabricArticleDescription: newFabDesc });
          }, 0);
        }
        return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
      });
    }, [item, FAB_FIELDS, buildBodyDescription]);

    // APPROVED/REJECTED articles are normally read-only. EXCEPTION: on the
    // Created page (modify mode) we keep them editable so the user can stage
    // changes and push them to SAP via the "Modify" button.
    const isLocked = readOnly || ((item.approvalStatus === 'APPROVED' || item.approvalStatus === 'REJECTED') && !isModifyMode);
    // Body articles on the Created page: consumption sections (Rough + Precise) stay editable
    // even though the article is APPROVED — no SAP re-sync needed for these local fields.
    const isBodyCreatedPage = !readOnly && isBodyArticle && pathType === 'created';
    const status = getDisplayStatus(item);

    // Created-article identity/price fields are LOCKED even in modify mode — they
    // are fixed at creation time and must never be edited afterward (so they can
    // neither reach SAP nor change the local DB). The user cannot open these fields.
    // Exception: ADMIN users may change the vendor (EXTWG in SAP) — picking a vendor
    // name sets both code and name from the vendor master.
    const isAdminUser = useMemo(() => {
      try {
        return JSON.parse(localStorage.getItem('user') || '{}')?.role === 'ADMIN';
      } catch {
        return false;
      }
    }, []);
    const MODIFY_LOCKED_FIELDS = new Set<string>([
      ...(isAdminUser ? [] : ['vendorCode', 'vendorName']),
      'mrp', 'rate', 'colour',
      'designNumber', 'division', 'subDivision', 'majorCategory', 'segment',
    ]);
    // Body & Construction fields are read-only in FG article context — values
   const isFieldLocked = (field: string) =>
    field === 'segment' ||
    isLocked ||
    (isModifyMode && MODIFY_LOCKED_FIELDS.has(field));

    // Division is non-editable for APPROVER/CATEGORY_HEAD users locked to a specific division
    const canEditDivision = useMemo(() => {
      if (isLocked) return false;
      if (isModifyMode) return false; // locked on the Created page
      try {
        const raw = localStorage.getItem('user');
        if (raw) {
          const u = JSON.parse(raw);
          if ((u.role === 'APPROVER' || u.role === 'CATEGORY_HEAD') && !!u.division) return false;
        }
      } catch {
        /* ignore */
      }
      return true;
    }, [isLocked, isModifyMode]);

    const imgSrc = refreshedUrl || item.imageUrl;
    const imgUrl = imgSrc && !failedImg ? getImageUrl(imgSrc) : null;

    const handleImgError = useCallback(async () => {
      if (refreshAttempted.current) {
        setFailedImg(true);
        return;
      }
      refreshAttempted.current = true;
      setFailedImg(true);
      try {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/image/${item.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.url) {
          const base = data.url as string;
          const freshUrl = base.includes('X-Amz-Signature')
            ? base
            : base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
          setRefreshedUrl(freshUrl);
          setFailedImg(false);
        }
      } catch {
        /* ignore */
      }
    }, [item.id]);

    const oldImgSrc = canReplaceImage ? localOldImageUrl || item.oldImageUrl || null : null;
    const oldImgUrl = oldImgSrc ? getImageUrl(oldImgSrc) : null;
    const hasOldImage = !!oldImgUrl;
    const fileNameFromUrl = (u: string | null | undefined) => {
      if (!u) return '';
      try {
        return decodeURIComponent(new URL(u, window.location.origin).pathname.split('/').pop() || '');
      } catch {
        return '';
      }
    };
    const newImgName = item.imageName || fileNameFromUrl(imgSrc);
    const oldImgName = fileNameFromUrl(oldImgSrc);
    const backImgUrl = item.backImageUrl ? getImageUrl(item.backImageUrl) : null;
    const imgViews: { key: 'front' | 'back' | 'old'; label: string; url: string | null; name: string; note: string }[] = [
      {
        key: 'front',
        label: hasOldImage ? 'New' : 'Front',
        url: imgUrl,
        name: newImgName,
        note: hasOldImage ? ' · current' : ' · front',
      },
      ...(backImgUrl
        ? [{ key: 'back' as const, label: 'Back', url: backImgFailed ? null : backImgUrl, name: fileNameFromUrl(item.backImageUrl), note: ' · back' }]
        : []),
      ...(hasOldImage
        ? [{ key: 'old' as const, label: 'Old', url: oldImgFailed ? null : oldImgUrl, name: oldImgName, note: ' · original' }]
        : []),
    ];
    const activeImgIdx = Math.min(imgViewIdx, imgViews.length - 1);
    const activeImgView = imgViews[activeImgIdx];
    const viewingOldImg = activeImgView.key === 'old';
    const shownImgUrl = activeImgView.url;
    const imgStem = (fileNameFromUrl(imgSrc) || 'article.jpg').replace(/\.[^.]+$/, '');

    const clearReplace = () => {
      setReplaceFile(null);
      setReplacePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
    const pickReplaceFile = (f: File | null | undefined) => {
      if (!f) return;
      if (!/^image\/(jpeg|jpg|png|webp)$/.test(f.type)) {
        message.error('Use a JPG, PNG or WebP image');
        return;
      }
      if (f.size > 15 * 1024 * 1024) {
        message.error('Image must be 15 MB or smaller');
        return;
      }
      setReplaceFile(f);
      setReplacePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
    };
    const cancelReplace = () => {
      if (replaceProgress !== null) return;
      setReplaceOpen(false);
      clearReplace();
    };
    const submitReplace = () => {
      if (!replaceFile || replaceProgress !== null) return;
      const form = new FormData();
      form.append('image', replaceFile);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${APP_CONFIG.api.baseURL}/approver/items/${item.id}/replace-image`);
      const token = localStorage.getItem('authToken');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // Upload is ~90% of the wait; the rest is the R2 copy + watermark.
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setReplaceProgress(Math.round((e.loaded / e.total) * 90));
      };
      xhr.onload = () => {
        let body: { imageUrl?: string; oldImageUrl?: string | null; error?: string } | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error page */
        }
        setReplaceProgress(null);
        if (xhr.status >= 200 && xhr.status < 300 && body?.imageUrl) {
          refreshAttempted.current = false;
          setFailedImg(false);
          setRefreshedUrl(body.imageUrl);
          setLocalOldImageUrl(body.oldImageUrl ?? null);
          setOldImgFailed(false);
          setImgViewIdx(0);
          setReplaceOpen(false);
          clearReplace();
          message.success('Image replaced');
        } else {
          message.error(body?.error || 'Failed to replace image');
        }
      };
      xhr.onerror = () => {
        setReplaceProgress(null);
        message.error('Upload failed. Check your connection and try again.');
      };
      setReplaceProgress(0);
      xhr.send(form);
    };

    const calcMrpFromRate = (rate: number): number => Math.ceil((rate * 1.47) / 50) * 50;

    const getValue = (field: string): string | null => {
      if (field in localValues) return localValues[field];
      if (field === 'mrp') {
        const stored = (item as any).mrp;
        const storedNum = parseFloat(String(stored ?? ''));
        if (isNaN(storedNum) || storedNum <= 1) {
          const rate = parseFloat(String((item as any).rate ?? ''));
          if (!isNaN(rate) && rate > 0) return String(calcMrpFromRate(rate));
        }
      }
      return (item as any)[field] ?? null;
    };

    const searchVendors = (q: string, by: 'name' | 'code' = 'name') => {
      setVendorQuery(q);
      if (vendorDebounceRef.current) clearTimeout(vendorDebounceRef.current);
      if (!q || q.trim().length < 2) {
        setVendorOptions([]);
        return;
      }
      vendorDebounceRef.current = setTimeout(async () => {
        setVendorSearching(true);
        try {
          const token = localStorage.getItem('authToken');
          const res = await fetch(
            `${APP_CONFIG.api.baseURL}/approver/vendor-search?q=${encodeURIComponent(q.trim())}${by === 'code' ? '&by=code' : ''}`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} },
          );
          const json = await res.json();
          const opts = (json.data ?? []).map(
            (v: { vendorCode: string; vendorName: string; vendorCity?: string }) => ({
              // Use "NAME||CODE" as value so duplicates with same name are distinguishable.
              // onSelect strips the code suffix before saving the actual vendor name.
              value: `${v.vendorName}||${v.vendorCode}`,
              vendorCode: v.vendorCode,
              vendorName: v.vendorName,
              // Two lines: name (typed text highlighted), then code · city.
              label: (() => {
                const name = String(v.vendorName ?? '');
                const needle = q.trim().toLowerCase();
                const at = needle ? name.toLowerCase().indexOf(needle) : -1;
                return (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-semibold">
                      {at >= 0 ? (
                        <>
                          {name.slice(0, at)}
                          <mark className="rounded-sm bg-amber-100 text-slate-900">{name.slice(at, at + needle.length)}</mark>
                          {name.slice(at + needle.length)}
                        </>
                      ) : (
                        name
                      )}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                      <span className="font-mono">{v.vendorCode}</span>
                      {v.vendorCity && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{v.vendorCity}</span>
                        </>
                      )}
                    </span>
                  </span>
                );
              })(),
            }),
          );
          setVendorOptions(opts);
        } catch {
          setVendorOptions([]);
        } finally {
          setVendorSearching(false);
        }
      }, 300);
    };

    // Picking a vendor from either dropdown (name or code) fills both fields.
    const pickVendor = (val: string, option: AutocompleteOption) => {
      // option.vendorName is the clean name (no code suffix)
      const cleanName = (option as any).vendorName || String(val ?? '').split('||')[0];
      const updates: Record<string, string | null> = { vendorName: cleanName };
      if ((option as any).vendorCode) updates.vendorCode = (option as any).vendorCode;
      setLocalValues((prev) => ({ ...prev, ...updates }));
      if (isModifyMode) {
        setPendingChanges((prev) => ({ ...prev, ...updates }));
      } else {
        onSave({ ...item, ...updates } as ApproverItem, updates as Record<string, unknown>);
      }
      // The pick also fired onChange with the option value — drop that pending search.
      if (vendorDebounceRef.current) clearTimeout(vendorDebounceRef.current);
      setEditingField(null);
      setVendorOptions([]);
      setVendorQuery(null);
    };

    const handleSave = (field: string, value: string | null) => {
      if (field === 'vendorCode' && value) {
        const trimmed = value.trim();
        if (!/^\d{6}$/.test(trimmed)) {
          message.error('Vendor Code must be exactly 6 digits');
          setEditingField(null);
          return;
        }
      }
      if (field === 'vendorName' && !value?.trim()) {
        message.error('Vendor Name is required');
        setEditingField(null);
        return;
      }
      if (field === 'mrp' && value) {
        const mrpNew = parseFloat(value);
        const rateNow = parseFloat(String(getValue('rate') ?? ''));
        if (!isNaN(mrpNew) && mrpNew > 0 && !isNaN(rateNow)) {
          const markdownPct = ((mrpNew - rateNow) / mrpNew) * 100;
          if (markdownPct < 20) {
            message.error('MRP too low — markdown would fall below 20%');
            setEditingField(null);
            return;
          }
        }
      }
      const updates: Record<string, string | null> = { [field]: value };
      // Auto-compute roughConsumptionKg for FG articles when roughConsumptionMeter or gsm is edited.
      // GSM may be a range "140-160" — use midpoint. Width is fWidth (strip trailing ").
      if (!isBodyArticle && (field === 'roughConsumptionMeter' || field === 'gsm')) {
        const getRV = (f: string) => String(updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]) ?? '').trim();
        const w = parseFloat(getRV('fWidth').replace(/"/g, '')) || 0;
        const rawGsm = getRV('gsm');
        const gsmMid = (() => {
          if (rawGsm.includes('-')) {
            const parts = rawGsm.split('-').map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] + parts[1]) / 2;
          }
          return parseFloat(rawGsm) || 0;
        })();
        const m = parseFloat(getRV('roughConsumptionMeter')) || 0;
        if (w > 0 && gsmMid > 0 && m > 0)
          updates['roughConsumptionKg'] = ((w * gsmMid * m * 2.54) / 100000).toFixed(4);
      }
      // Auto-compute preciseConsumptionKg for FG articles when preciseConsumptionMeter or gsm changes.
      if (!isBodyArticle && (field === 'preciseConsumptionMeter' || field === 'gsm')) {
        const getRV = (f: string) => String(updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]) ?? '').trim();
        const w = parseFloat(getRV('fWidth').replace(/"/g, '')) || 0;
        const rawGsm = getRV('gsm');
        const gsmMid = (() => {
          if (rawGsm.includes('-')) {
            const parts = rawGsm.split('-').map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] + parts[1]) / 2;
          }
          return parseFloat(rawGsm) || 0;
        })();
        const m = parseFloat(getRV('preciseConsumptionMeter')) || 0;
        if (w > 0 && gsmMid > 0 && m > 0)
          updates['preciseConsumptionKg'] = ((w * gsmMid * m * 2.54) / 100000).toFixed(4);
      }
      // Auto-compute Consumption in Kg: width x gsm x consumption(meter) x 2.54 / 100000
      if (isBodyArticle && (field === 'gsm' || field === 'consumptionMeter' || field === 'width')) {
        const getRV = (f: string) => parseFloat(String(updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f])) || '') || 0;
        const w = getRV('width'), g = getRV('gsm'), m = getRV('consumptionMeter');
        updates['consumptionKg'] = String(((w * g * m * 2.54) / 100000).toFixed(4));
      }
      // Auto-compute Precise Consumption in Kg: width x gsm x consumption(meter) x 2.54 / 100000
      if (
        isBodyArticle &&
        (field === 'preciseWidth' || field === 'preciseGsm' || field === 'preciseConsumptionMeter')
      ) {
        const getRV = (f: string) =>
          parseFloat(
            String(
              updates[f] !== undefined
                ? updates[f]
                : localValues[f] !== undefined
                ? localValues[f]
                : (item as any)[f],
            ) || '',
          ) || 0;
        const w = getRV('preciseWidth'), g = getRV('preciseGsm'), m = getRV('preciseConsumptionMeter');
        updates['preciseConsumptionKg'] = String(((w * g * m * 2.54) / 100000).toFixed(4));
      }
      if (field === 'rate') {
        const rate = parseFloat(String(value ?? ''));
        if (!isNaN(rate) && rate > 0) updates['mrp'] = String(calcMrpFromRate(rate));
      }
      if (field === 'mrp') {
        const seg = computeSegmentFromMrp(value, segmentRangesRef.current);
        if (seg) updates['segment'] = seg;
      }
      if (field === 'rate') {
        // Rate change also recomputes MRP, so recompute segment from new MRP too
        const newMrp = updates['mrp'];
        if (newMrp) {
          const seg = computeSegmentFromMrp(newMrp, segmentRangesRef.current);
          if (seg) updates['segment'] = seg;
        }
      }
      if (field === 'majorCategory' && value) {
        const newMcCode = getMcCodeByMajorCategory(value);
        if (newMcCode) updates['mcCode'] = newMcCode;
        // Async: fetch ranges for the new major category, then auto-set segment
        const currentMrp = getValue('mrp');
        fetchSegmentRangesFor(value).then((ranges) => {
          setSegmentRanges(ranges);
          const seg = computeSegmentFromMrp(currentMrp, ranges);
          if (seg) {
            setLocalValues((prev) => ({ ...prev, segment: seg }));
            onSave({ ...item, segment: seg } as ApproverItem, { segment: seg } as Record<string, unknown>);
          }
        });
        // Clear body/fabric article number and description only — attributes remain unchanged
        updates['bodyArticle'] = '';
        updates['bodyArticleDescription'] = '';
        updates['fabricArticleNumber'] = '';
        updates['fabricArticleDescription'] = '';
      }
      // When a Body & Construction attribute changes, recompute bodyArticleDescription
      // and bundle it into the same save so the DB value stays in sync with the UI.
      const bodyFieldKeys = new Set(BODY_FIELDS.map((bf) => bf.field));
      if (bodyFieldKeys.has(field)) {
        const getVal = (f: string) => {
          const v = updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]);
          return v ? String(v).trim() : null;
        };
        const newDesc = buildBodyDescription(getVal);
        if (newDesc) updates['bodyArticleDescription'] = newDesc;
        updates['bodyArticle'] = null;
      }
      // When a Construction & Fabric attribute changes, recompute fabricArticleDescription
      // and clear fabricArticleNumber (it was linked to the old description;
      // user must re-create or re-link after modifying fabric attributes).
      const fabFieldKeys = new Set(FAB_FIELDS.map((ff) => ff.field));
      if (fabFieldKeys.has(field)) {
        const getVal = (f: string) => {
          const v = updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]);
          return v ? String(v).trim() : null;
        };
        const fabParts = FAB_FIELDS.map((f) => getVal(f.field)).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
        const newFabDesc = fabParts.length > 0 ? fabParts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '') : null;
        if (newFabDesc) updates['fabricArticleDescription'] = newFabDesc;
        updates['fabricArticleNumber'] = null;
      }
      setLocalValues((prev) => ({ ...prev, ...updates }));
      setEditingField(null);
      if (isModifyMode) {
        // Stage the edit; it is pushed to SAP + DB only when the user clicks "Modify".
        setPendingChanges((prev) => ({ ...prev, ...updates }));
        return;
      }
      onSave({ ...item, ...updates } as ApproverItem, updates as Record<string, unknown>);

      // When Base Color changes, auto-create variants for the new color (idempotent).
      if (field === 'colour' && value && !isModifyMode) {
        const colorCode = value.trim().toUpperCase();
        setCreatingVariants(true);
        variantCreatingIds.add(item.id);
        const loadingToastId = message.loading(`Creating variants for color ${colorCode}…`);
        const token = localStorage.getItem('authToken');
        fetch(`${APP_CONFIG.api.baseURL}/approver/items/${item.id}/ensure-color-variants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ color: colorCode }),
        })
          .then(async (r) => {
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.error || 'Failed to create variants');
            message.dismiss(loadingToastId);
            if ((d.count ?? 0) > 0) {
              message.success(`${d.count} variants created for ${colorCode}`);
              setVariantRefreshKey((k) => k + 1);
            } else {
              message.info(`Variants for ${colorCode} already exist`);
            }
            onRefresh();
          })
          .catch((err) => {
            message.dismiss(loadingToastId);
            message.error(err instanceof Error ? err.message : 'Failed to create variants');
          })
          .finally(() => {
            setCreatingVariants(false);
            variantCreatingIds.delete(item.id);
          });
      }
    };

    const handleModify = async () => {
      if (!onModify || Object.keys(pendingChanges).length === 0) return;
      setModifying(true);
      try {
        await onModify(item, pendingChanges as Record<string, unknown>);
        // Parent refreshes the item on success; clear the staged diff.
        setPendingChanges({});
      } catch {
        // Parent surfaces the error toast; keep pendingChanges so the user can retry.
      } finally {
        setModifying(false);
      }
    };

    const borderColor =
      item.approvalStatus === 'APPROVED' ? '#b7eb8f' : item.approvalStatus === 'REJECTED' ? '#ffa39e' : '#e8e8e8';
    const bgColor =
      item.approvalStatus === 'APPROVED' ? '#f6ffed' : item.approvalStatus === 'REJECTED' ? '#fff1f0' : '#fff';

    // Compute markdown + active groups for render
    const groupMap: Record<string, { color: string; attrs: typeof visibleAttrs }> = {};
    for (const attr of visibleAttrs) {
      if (!groupMap[attr.group]) groupMap[attr.group] = { color: attr.groupColor, attrs: [] };
      groupMap[attr.group].attrs.push(attr);
    }
    const activeGroups = ATTRIBUTE_GROUPS.filter(
      (g) => groupMap[g.group] && (!allowGroups || allowGroups.includes(g.group)),
    );
    // For FG articles: further filter by selected group tabs
    const visibleGroups = allowGroups
      ? activeGroups
      : activeGroups.filter((g) => g.group !== 'BUSINESS' && selectedGroupKeys.has(g.group));
    const showBomCard = allowGroups ? true : selectedGroupKeys.has('BOM');
    const showPkgCard = !allowGroups && selectedGroupKeys.has('PKG');
    // CMP COST has no tab of its own — it shows with the BODY tab (FG articles only).
    const showCmpCard = !allowGroups && !isBodyArticle && selectedGroupKeys.has('BODY');

    const rateVal = String(getValue('rate') ?? '').trim();
    const mrpVal = String(getValue('mrp') ?? '').trim();
    const rateNum = parseFloat(rateVal);
    const mrpNum = parseFloat(mrpVal);
    const markdown =
      !isNaN(rateNum) && !isNaN(mrpNum) && mrpNum > 0 ? (((mrpNum - rateNum) / mrpNum) * 100).toFixed(1) + '%' : '—';
    const afterTax =
      !isNaN(rateNum) && !isNaN(mrpNum) && mrpNum > 0
        ? (((mrpNum - rateNum * 1.05) / mrpNum) * 100).toFixed(1) + '%'
        : '—';

    const renderFabBodyField = (
      field: string,
      label: string,
      autoFillFn?: () => void,
      maxLen?: number,
    ) => {
      const displayVal = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
      const isEditingThis = editingField === `bot_${field}`;
      const saveVal = (raw: string | null) => {
        const v = raw || null;
        handleSave(field, maxLen && v ? v.slice(0, maxLen) : v);
      };
      return (
        <div
          className="cursor-pointer border-t border-border bg-muted/40 px-2 py-1"
          style={{ cursor: isLocked ? 'default' : 'pointer', background: isEditingThis ? '#e6f7ff' : undefined }}
          onClick={() => {
            if (!isLocked && !isEditingThis) setEditingField(`bot_${field}`);
          }}
        >
          <div className="mb-0.5 flex items-center gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            {autoFillFn && !isLocked && (
              <span
                className="cursor-pointer text-[9px] text-slate-700 underline"
                onClick={(e) => {
                  e.stopPropagation();
                  autoFillFn();
                }}
              >
                Auto-fill
              </span>
            )}
          </div>
          {isEditingThis ? (
            <Input
              autoFocus
              defaultValue={displayVal || ''}
              className="h-7 px-1 text-[11px]"
              maxLength={maxLen}
              onKeyDown={(e) => e.key === 'Enter' && saveVal((e.target as HTMLInputElement).value)}
              onBlur={(e) => saveVal(e.target.value)}
            />
          ) : (
            <div className="truncate text-[11px]" style={{ color: displayVal ? '#1a1a1a' : '#bfbfbf' }}>
              {displayVal || (isLocked ? '—' : 'Click to fill')}
            </div>
          )}
        </div>
      );
    };

    // ─── Helper closures used by the new layout ─────────────────────────────────

    // Compute global 1..N numbering across all visible attributes (mockup pattern)
    let _attrCounter = 0;

    const HEADER_FIELDS = [
      { label: 'MAJOR CATEGORY', field: 'majorCategory', editable: true, required: false, color: '#2f54eb' },
      isBodyArticle
        ? { label: 'BODY ARTICLE NUMBER', field: 'bodyArticle', editable: false, required: false, color: '#15803d' }
        : { label: 'ARTICLE NUMBER', field: 'articleNumber', editable: !item.sapArticleId, required: false, color: item.sapArticleId ? '#15803d' : '#FF6F61' },
      { label: 'VENDOR CODE', field: 'vendorCode', editable: true, required: true, color: '#1f2937' },
      { label: 'VENDOR NAME', field: 'vendorName', editable: true, required: true, color: '#1f2937' },
      ...(!isBodyArticle ? [
        { label: 'ARTICLE DESC', field: 'articleDescription', editable: true, required: false, color: '#4b5563' },
        { label: 'REFERENCE ARTICLE', field: 'referenceArticleNumber', editable: true, required: false, color: '#1f2937' },
        { label: 'REFERENCE ARTICLE DESC', field: 'referenceArticleDescription', editable: true, required: false, color: '#1f2937' },
      ] : []),
    ];

    const renderHeaderField = ({
      label,
      field,
      editable,
      required,
      color,
    }: { label: string; field: string; editable: boolean; required: boolean; color: string }) => {
      const baseValue =
        field === 'articleNumber'
          ? item.sapArticleId || (item as any)[field]
          : field === 'bodyArticle'
          ? (item as any)['bodyArticle']
          : field === 'majorCategory'
          ? effectiveMajCat || (item as any)[field]
          : (item as any)[field];
      const displayVal = localValues[field] !== undefined ? localValues[field] : baseValue;
      const isEditingThis = editingField === `hdr_${field}`;
      const canEdit = editable && !isFieldLocked(field);
      const isEmpty = !displayVal;
      const showRequiredError = required && isEmpty && !isLocked;
      // FG pages (design "Option A"): label stacked above a full-width value.
      const isFgCard = !allowGroups;
      const monoField = field === 'majorCategory' || field === 'articleDescription' || field === 'referenceArticleDescription';
      return (
        <div
          key={field}
          data-field-label={typeof label === 'string' ? label : undefined}
          data-item-id={item.id}
          className={isFgCard ? 'border-b border-slate-100 last:border-b-0' : 'border-b border-border last:border-b-0'}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          onClick={() => {
            if (canEdit && !isEditingThis) setEditingField(`hdr_${field}`);
          }}
        >
          <div className={isFgCard ? 'flex flex-col gap-0.5 px-3 py-1.5' : 'flex items-start justify-between gap-2 px-2 py-0.5'}>
            <span
              className={isFgCard ? 'text-[12px] font-semibold uppercase tracking-wider' : 'shrink-0 text-[9px] font-semibold uppercase tracking-wider'}
              style={{ color: showRequiredError ? (isFgCard ? '#c2410c' : '#dc2626') : isFgCard ? '#475569' : '#6b7280' }}
            >
              {label}
              {required && <span className={isFgCard ? 'ml-0.5 text-orange-700' : 'ml-0.5 text-red-500'}>*</span>}
            </span>
            <div className={isFgCard ? 'min-w-0' : 'min-w-0 flex-1 text-right'}>
              {isEditingThis && field === 'majorCategory' ? (
                <Popover
                  open={catOpen}
                  onOpenChange={(o) => {
                    setCatOpen(o);
                    if (!o) setCatSearch('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn('flex h-7 w-full items-center justify-between rounded border border-input bg-background px-2 hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring', isFgCard ? 'text-sm' : 'text-xs')}
                    >
                      <span className="truncate text-left">{displayVal || 'Select...'}</span>
                      <ChevronDownIcon className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" align="start">
                    <div className="flex items-center border-b px-2 py-1.5">
                      <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        value={catSearch}
                        onChange={(e) => setCatSearch(e.target.value)}
                        placeholder="Search category..."
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {dbMajorCategories
                        .filter((cat) =>
                          cat.toLowerCase().includes(catSearch.toLowerCase()),
                        )
                        .map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => {
                              handleSave(field, cat);
                              setCatOpen(false);
                              setCatSearch('');
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          >
                            {cat}
                          </button>
                        ))}
                      {dbMajorCategories.filter((cat) =>
                        cat.toLowerCase().includes(catSearch.toLowerCase()),
                      ).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No categories found
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : isEditingThis && field === 'vendorCode' ? (
                <Autocomplete
                  autoFocus
                  value={vendorQuery ?? displayVal ?? ''}
                  onChange={(q) => searchVendors(q, 'code')}
                  options={vendorOptions}
                  header={`${vendorOptions.length} vendor${vendorOptions.length !== 1 ? 's' : ''} · ↑ ↓ to move, Enter to pick`}
                  placeholder="Type 2+ digits of the vendor code"
                  notFoundContent={vendorSearching ? <span className="flex items-center gap-2"><Spinner size="sm" /> Searching vendors…</span> : null}
                  onSelect={pickVendor}
                  onBlur={(e) => {
                    // A typed code (not picked) is saved as-is; handleSave checks it is 6 digits.
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && val !== (displayVal ?? '')) handleSave('vendorCode', val);
                    else setEditingField(null);
                    setVendorOptions([]);
                    setVendorQuery(null);
                  }}
                  className={isFgCard ? 'text-sm' : 'text-xs'}
                />
              ) : isEditingThis && field === 'vendorName' ? (
                <Autocomplete
                  autoFocus
                  value={vendorQuery ?? displayVal ?? ''}
                  onChange={searchVendors}
                  options={vendorOptions}
                  header={`${vendorOptions.length} vendor${vendorOptions.length !== 1 ? 's' : ''} · ↑ ↓ to move, Enter to pick`}
                  placeholder="Type 2+ letters of the vendor name"
                  notFoundContent={vendorSearching ? <span className="flex items-center gap-2"><Spinner size="sm" /> Searching vendors…</span> : null}
                  onSelect={pickVendor}
                  onBlur={(e) => {
                    const val = (e.target as HTMLInputElement).value;
                    // Modify mode: the vendor must be picked from the list (code + name
                    // from the vendor master) — a typed name alone is not kept.
                    if (val && !isModifyMode) handleSave('vendorName', val);
                    else setEditingField(null);
                    setVendorOptions([]);
                    setVendorQuery(null);
                  }}
                  className={isFgCard ? 'text-sm' : 'text-xs'}
                />
              ) : isEditingThis ? (
                <Input
                  autoFocus
                  defaultValue={displayVal || ''}
                  className={isFgCard ? 'h-8 px-2 text-sm' : 'h-7 px-1 text-xs'}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSave(field, (e.target as HTMLInputElement).value || null)
                  }
                  onBlur={(e) => handleSave(field, e.target.value || null)}
                />
              ) : isFgCard ? (
                <span
                  title={displayVal || undefined}
                  className={`block truncate ${
                    displayVal
                      ? monoField
                        ? 'font-mono text-[13.5px] text-slate-900'
                        : 'text-[14.5px] font-semibold text-slate-900'
                      : showRequiredError
                      ? 'text-sm font-semibold italic text-orange-700'
                      : 'text-sm italic text-slate-500'
                  }`}
                >
                  {displayVal || (showRequiredError ? 'Required' : canEdit ? 'Click to fill' : '—')}
                </span>
              ) : (
                <span
                  className="truncate text-xs"
                  style={{
                    color: displayVal ? color : showRequiredError ? '#ea580c' : '#9ca3af',
                    fontStyle: showRequiredError ? 'italic' : 'normal',
                  }}
                >
                  {displayVal || (showRequiredError ? 'Required' : canEdit ? 'Click to fill' : '—')}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    };

    const renderAttributeRow = (attr: {
      field: string;
      label: string;
      schemaKey: string;
      values: any[];
      freeText: boolean;
      group: string;
      isMandatory?: boolean;
      mandatory?: boolean;
    }, big = false, plus1 = false) => {
      // plus1 = FG OTH GRID-1 / B TRIM extra rows: everything 1 px bigger than the default.
      // big = FG FAB and BODY cards (design "Option A", -1 px): 13 px names, 14 px values, 30 px rows.
      const valueText = big ? 'text-[14px]' : plus1 ? 'text-[12px]' : 'text-[11px]';
      _attrCounter += 1;
      const num = _attrCounter;
      const currentValue = getValue(attr.field);
      const isEffectivelyEmpty = !currentValue || currentValue.trim() === '';
      const isEmpty = isEffectivelyEmpty;
      const isMandatory = attr.mandatory === true || (!attr.freeText && (attr.isMandatory ?? mandatoryKeys.has(attr.schemaKey)));
      const isEditing = editingField === attr.field;
      const isUserEdited = !!localValues[attr.field];
      const attrLocked = isFieldLocked(attr.field);

      return (
        <div
          key={attr.field}
          data-field-label={attr.label}
          data-item-id={item.id}
          className={cn('group flex items-center rounded transition-colors hover:bg-muted/40', big ? 'mb-0.5 min-h-[26px] gap-2 px-2 py-0.5' : 'gap-1.5 px-1 py-0.5')}
          style={{
            cursor: attrLocked ? 'default' : 'pointer',
            background: isEditing
              ? '#e0f2fe'
              : isUserEdited
              ? '#ecfdf5'
              : isEmpty && isMandatory
              ? '#fffbeb'
              : !isEmpty && !isUserEdited
              ? '#eef2ff'
              : undefined,
          }}
          onClick={() => {
            if (!attrLocked && !isEditing) setEditingField(attr.field);
          }}
        >
          <span className={cn('shrink-0 text-right font-bold tabular-nums text-muted-foreground', big ? 'w-6 text-[12px]' : plus1 ? 'w-4 text-[11px]' : 'w-4 text-[10px]')}>{num}.</span>
          <span
            className={cn(
              'flex-1 truncate leading-snug',
              big ? 'text-[13px]' : plus1 ? 'text-[11.5px]' : 'text-[10.5px]',
              isMandatory ? 'key-field text-foreground' : 'font-semibold text-foreground/80',
            )}
          >
            {isMandatory && <span className="mandatory-mark">*</span>}
            {attr.label}
          </span>
          <div className={cn('shrink-0', big ? 'w-[180px]' : 'w-[110px]')}>
            {attr.freeText ? (
              isEditing ? (
                <Input
                  autoFocus
                  defaultValue={isEffectivelyEmpty ? '' : currentValue || ''}
                  className={big ? 'h-7 px-2 text-[13px]' : plus1 ? 'h-6 px-1 text-[12px]' : 'h-6 px-1 text-[11px]'}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSave(attr.field, (e.target as HTMLInputElement).value || null)
                  }
                  onBlur={(e) => handleSave(attr.field, e.target.value || null)}
                />
              ) : (
                <span
                  className={cn('block truncate text-right', valueText)}
                  style={{
                    color: isEffectivelyEmpty ? (isMandatory ? '#dc2626' : '#9ca3af') : '#111827',
                    fontStyle: isEffectivelyEmpty && !isMandatory ? 'italic' : 'normal',
                    fontWeight: isMandatory && isEffectivelyEmpty ? 700 : 600,
                  }}
                >
                  {isEffectivelyEmpty
                    ? isMandatory && !isLocked
                      ? 'Required'
                      : isLocked
                      ? '—'
                      : 'Click'
                    : currentValue}
                </span>
              )
            ) : isEditing ? (
              <Popover
                open
                onOpenChange={(o) => {
                  if (!o) {
                    setEditingField(null);
                    setAttrSearch('');
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between rounded border border-input bg-background hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring',
                      big ? 'h-7 px-2 text-[13px]' : plus1 ? 'h-6 px-1.5 text-[12px]' : 'h-6 px-1.5 text-[11px]',
                    )}
                  >
                    <span className="truncate text-left">
                      {isEffectivelyEmpty ? 'Select' : currentValue}
                    </span>
                    <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-48 p-0"
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center border-b px-2 py-1.5">
                    <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={attrSearch}
                      onChange={(e) => setAttrSearch(e.target.value)}
                      placeholder="Search..."
                      className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  {!isEffectivelyEmpty && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSave(attr.field, null);
                        setAttrSearch('');
                      }}
                      className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                    >
                      <X className="h-3 w-3 shrink-0" />
                      Clear selection
                    </button>
                  )}
                  <div className="max-h-56 overflow-y-auto py-1">
                    {(() => {
                      const q = attrSearch.trim().toLowerCase();
                      const matches = attr.values.filter(
                        (v) =>
                          v.shortForm.toLowerCase().includes(q) ||
                          (v.fullForm ?? '').toLowerCase().includes(q),
                      );
                      if (matches.length === 0) {
                        return (
                          <div className="px-3 py-2 text-[11px] text-muted-foreground">
                            No options found
                          </div>
                        );
                      }
                      return matches.map((v) => (
                        <button
                          key={v.shortForm}
                          type="button"
                          onClick={() => {
                            handleSave(attr.field, v.shortForm);
                            setAttrSearch('');
                          }}
                          className={cn(
                            'flex w-full flex-col px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                            v.shortForm === currentValue && 'bg-accent/60',
                          )}
                        >
                          <span className="font-medium">{v.shortForm}</span>
                          {v.fullForm && v.fullForm !== v.shortForm && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {v.fullForm}
                            </span>
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <span
                className={cn('flex items-center justify-end gap-1 text-right', valueText)}
                style={{
                  color: isEffectivelyEmpty ? (isMandatory ? '#dc2626' : '#9ca3af') : '#111827',
                  fontStyle: isEffectivelyEmpty && !isMandatory ? 'italic' : 'normal',
                  fontWeight: isMandatory && isEffectivelyEmpty ? 700 : 600,
                }}
              >
                <span className="truncate">
                  {isEffectivelyEmpty ? (isMandatory ? 'Required' : '—') : currentValue}
                </span>
                <ChevronDown className={cn('shrink-0 opacity-40', big ? 'h-4 w-4' : 'h-3 w-3')} />
              </span>
            )}
          </div>
        </div>
      );
    };

    const lookupRoughV2Rate = () => {
      const getV = (key: string) =>
        String((localValues[key] !== undefined ? localValues[key] : (item as any)[key]) ?? '').trim();
      const params = new URLSearchParams({
        mYarn:         getV('yarn1'),
        mFabDiv:       getV('fabDiv'),
        mFabMainMvgr1: getV('mainMvgr'),
        mWeave01:      getV('weave'),
        mLycra:        getV('lycra'),
      });
      setRoughV2Loading(true);
      const token = localStorage.getItem('authToken');
      fetch(
        `${APP_CONFIG.api.baseURL}/approver/fabric-article-data/rough-v2-rate?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.rate != null) {
            const rateStr = String(d.rate);
            setLocalValues((prev) => ({ ...prev, roughV2: rateStr }));
            if (isModifyMode) {
              setPendingChanges((prev) => ({ ...prev, roughV2: rateStr }));
            } else {
              onSave({ ...item, roughV2: rateStr } as any, { roughV2: rateStr });
            }
          }
        })
        .catch(() => {})
        .finally(() => setRoughV2Loading(false));
    };

    const toggleGroupCollapse = (g: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(g)) next.delete(g);
        else next.add(g);
        return next;
      });
      setAllCollapsed(false);
    };

    const isGroupCollapsed = (g: string) => allCollapsed || collapsedGroups.has(g);

    // Clickable header for the non-attribute cards (OTH GRID-1, Rough/Precise
    // Consumption) — collapses like the group cards and follows Collapse All.
    const renderCollapsibleHeader = (key: string, title: string) => {
      const collapsed = isGroupCollapsed(key);
      return (
        <button
          type="button"
          onClick={() => toggleGroupCollapse(key)}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-between border-b px-2 py-1.5 transition-colors hover:brightness-110"
          style={{ background: CARD_THEME.bg, borderColor: CARD_THEME.bg, color: CARD_THEME.fg }}
        >
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
            <DollarSign className="h-3 w-3" />
            {title}
          </span>
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
      );
    };

    // AI confidence + heuristic quality breakdown derived from existing data.
    // No backend signal needed — we compute Image / Clarity / Match from
    // what's already on the item.
    const aiConfidence = (item as any).avgConfidence
      ? Math.round(Number((item as any).avgConfidence))
      : 92;

    // Image Quality: have a usable imageUrl?
    const imageQualityLevel = item.imageUrl ? 'High' : 'Low';
    // Product Clarity: do we have a confident major category?
    const productClarityLevel = effectiveMajCat ? 'High' : 'Medium';
    // Attribute Match: ratio of filled visible attrs (with non-null value)
    const filledAttrCount = visibleAttrs.filter((a) => {
      const v = (item as any)[a.field];
      return v !== null && v !== undefined && String(v).trim() !== '';
    }).length;
    const attrMatchRatio = visibleAttrs.length > 0 ? filledAttrCount / visibleAttrs.length : 0;
    const attrMatchLevel = attrMatchRatio >= 0.7 ? 'High' : attrMatchRatio >= 0.4 ? 'Medium' : 'Low';
    const qualityColor = (level: string) =>
      level === 'High' ? 'text-emerald-600' : level === 'Medium' ? 'text-amber-600' : 'text-rose-600';

    // ── FG left rail (design "Option A · Ink headers") ──
    const fgLevelColor = (level: string) =>
      level === 'High' ? 'text-slate-900' : level === 'Medium' ? 'text-orange-700' : 'text-red-700';
    const isLeftCardOpen = (key: string) => openLeftCards.has(key);
    const toggleLeftCard = (key: string) =>
      setOpenLeftCards((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    const createdOrUpdated = (pathType === 'created' ? item.updatedAt : item.createdAt) || item.updatedAt || item.createdAt;
    const createdOrUpdatedLabel = createdOrUpdated
      ? new Date(createdOrUpdated as string).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
    // Required Reference & Vendor fields still empty — shown on the header so a
    // closed card can't hide them.
    const missingRequiredHeaderCount = isLocked
      ? 0
      : HEADER_FIELDS.filter((f) => {
          if (!f.required) return false;
          const v = localValues[f.field] !== undefined ? localValues[f.field] : (item as any)[f.field];
          return !String(v ?? '').trim();
        }).length;
    // Ink header; with `cardKey` it becomes a toggle (closed by default) that
    // shows `summary` while closed.
    const renderInkCardHeader = (title: string, opts: { cardKey?: string; summary?: React.ReactNode; right?: React.ReactNode } = {}) => {
      const content = (
        <>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em]">{title}</span>
          <span className="flex min-w-0 items-center gap-2">
            {opts.cardKey && !isLeftCardOpen(opts.cardKey) && opts.summary}
            {opts.right}
            {opts.cardKey &&
              (isLeftCardOpen(opts.cardKey) ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />)}
          </span>
        </>
      );
      const cls = 'flex w-full items-center justify-between gap-2 px-3 py-2';
      const style = { background: CARD_THEME.bg, color: CARD_THEME.fg };
      if (!opts.cardKey) return <div className={cls} style={style}>{content}</div>;
      const cardKey = opts.cardKey;
      return (
        <button
          type="button"
          onClick={() => toggleLeftCard(cardKey)}
          aria-expanded={isLeftCardOpen(cardKey)}
          className={`${cls} text-left transition-[filter] hover:brightness-125`}
          style={style}
        >
          {content}
        </button>
      );
    };
    const fgInfoRows: { label: string; value: React.ReactNode }[] = [
      {
        label: 'Category',
        value: [formatDivisionLabel(item.division), item.subDivision, effectiveMajCat].filter(Boolean).join(' › ') || '—',
      },
      {
        label: 'AI confidence',
        value: <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white">{aiConfidence}%</span>,
      },
      { label: 'Image quality', value: <span className={fgLevelColor(imageQualityLevel)}>{imageQualityLevel}</span> },
      { label: 'Product clarity', value: <span className={fgLevelColor(productClarityLevel)}>{productClarityLevel}</span> },
      {
        label: 'Attribute match',
        value: (
          <span className={fgLevelColor(attrMatchLevel)}>
            {attrMatchLevel} · {filledAttrCount} / {visibleAttrs.length}
          </span>
        ),
      },
      { label: pathType === 'created' ? 'Last updated' : 'Created', value: createdOrUpdatedLabel },
    ];

    // Base (100%-zoom) display size, fit to the same 85vw/75vh box the old
    // maxWidth/maxHeight CSS used — then scaled up by the zoom factor. Rotation at
    // 90/270° swaps which axis is width vs height so the post-rotation footprint
    // (what the scroll container needs to accommodate) is what actually gets laid out.
    const isImgSideways = imgRotation === 90 || imgRotation === 270;
    // `imgFrame*` is the viewing window: the image's footprint at 100% zoom. It stays put
    // as you zoom so the dialog doesn't grow with every step — only `imgBox*` (the image
    // itself) scales, overflowing the frame and becoming scrollable/draggable.
    const IMG_VIEWER_PADDING = 16; // matches the `p-4` on the preview container
    let imgFrameWidth: number | undefined;
    let imgFrameHeight: number | undefined;
    let imgBoxWidth: number | undefined;
    let imgBoxHeight: number | undefined;
    if (naturalSize) {
      const maxW = imgViewportSize.w * 0.85 - IMG_VIEWER_PADDING * 2;
      const maxH = imgViewportSize.h * 0.75 - IMG_VIEWER_PADDING * 2;
      const fitScale = Math.min(1, maxW / naturalSize.w, maxH / naturalSize.h);
      const baseW = naturalSize.w * fitScale;
      const baseH = naturalSize.h * fitScale;
      imgFrameWidth = isImgSideways ? baseH : baseW;
      imgFrameHeight = isImgSideways ? baseW : baseH;
      imgBoxWidth = imgFrameWidth * imgZoom;
      imgBoxHeight = imgFrameHeight * imgZoom;
    }

    return (
      <>
        <div
          key={item.id}
          className={cn(
            'animate-in flex flex-col border bg-white shadow-sm transition-all fade-in-50 slide-in-from-bottom-1 duration-300',
            joinTop ? 'rounded-b-xl rounded-t-none border-t-0' : 'rounded-xl',
          )}
          style={{ borderColor }}
        >
          {/* ─── TOP HEADER STRIP (slate, matches dashboard) ─── */}
          <div
            className={cn('flex items-center justify-between gap-3 px-4 py-2.5 text-white', joinTop && 'border-t border-white/10')}
            style={{ background: joinTop ? '#1e293b' : 'linear-gradient(90deg, #1f2937 0%, #334155 100%)' }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Checkbox
                checked={isSelected}
                disabled={item.approvalStatus === 'REJECTED' && !hideCreateBody}
                onCheckedChange={() => onToggleSelect(item.id)}
                className="border-white/60 bg-white/10 data-[state=checked]:bg-white data-[state=checked]:text-slate-900"
              />
              <Badge
                style={{ background: status.color + 'cc', color: '#fff', borderColor: status.color }}
                className="border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              >
                {status.label}
              </Badge>
              {item.sapSyncMessage && (
                <Tooltip
                  title={
                    <div className="max-h-[260px] overflow-y-auto text-xs">
                      <div className="mb-1.5 text-[13px] font-bold text-red-700">⚠ SAP Remark</div>
                      <div className="whitespace-pre-wrap leading-relaxed">{item.sapSyncMessage}</div>
                    </div>
                  }
                  side="bottom"
                >
                  <Info className="h-4 w-4 shrink-0 cursor-pointer text-amber-200" />
                </Tooltip>
              )}
              {/* ── Editable Division › SubDivision ── */}
              <span className="flex items-center gap-1 truncate text-[12px] text-white/90">
                {editingField === 'topbar_division' ? (
                  <Select
                    defaultValue={(localValues['division'] ?? item.division) || undefined}
                    onValueChange={(val) => {
                      // Changing division resets subDivision (no longer valid)
                      const updates = { division: val || null, subDivision: null as string | null };
                      setLocalValues((prev) => ({ ...prev, ...updates }));
                      setEditingField(null);
                      if (isModifyMode) {
                        setPendingChanges((prev) => ({ ...prev, ...updates }));
                      } else {
                        onSave({ ...item, ...updates } as ApproverItem, updates as Record<string, unknown>);
                      }
                    }}
                  >
                    <SelectTrigger className="h-6 w-28 border-white/30 bg-white/10 text-[11px] text-white">
                      <SelectValue placeholder="Select division" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LADIES">LADIES</SelectItem>
                      <SelectItem value="MENS">MENS</SelectItem>
                      <SelectItem value="KIDS">KIDS</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span
                    onClick={() => {
                      if (canEditDivision) setEditingField('topbar_division');
                    }}
                    style={{
                      cursor: canEditDivision ? 'pointer' : 'default',
                      borderBottom: canEditDivision ? '1px dashed rgba(255,255,255,0.4)' : 'none',
                      fontStyle: (localValues['division'] ?? item.division) ? 'normal' : 'italic',
                      opacity: (localValues['division'] ?? item.division) ? 1 : 0.7,
                    }}
                  >
                    {formatDivisionLabel(localValues['division'] ?? item.division) ||
                      (canEditDivision ? 'set division' : '—')}
                  </span>
                )}
                <span className="text-white/40">›</span>
                {editingField === 'topbar_subDivision' ? (
                  <Select
                    defaultValue={(localValues['subDivision'] ?? item.subDivision) || undefined}
                    onValueChange={(val) => handleSave('subDivision', val || null)}
                  >
                    <SelectTrigger className="h-6 w-32 border-white/30 bg-white/10 text-[11px] text-white">
                      <SelectValue placeholder="Select sub-division" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const effectiveDiv = (localValues['division'] ?? item.division) || '';
                        let hierKey = '';
                        if (effectiveDiv.match(/LADIES|WOMEN/i)) hierKey = 'Ladies';
                        else if (effectiveDiv.match(/KIDS/i)) hierKey = 'Kids';
                        else if (effectiveDiv.match(/MEN/i)) hierKey = 'MENS';
                        return (SIMPLIFIED_HIERARCHY[hierKey] || []).map((sd: string) => (
                          <SelectItem key={sd} value={sd}>
                            {sd}
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                ) : (
                  <span
                    onClick={() => {
                      if (!isFieldLocked('subDivision')) setEditingField('topbar_subDivision');
                    }}
                    style={{
                      cursor: isFieldLocked('subDivision') ? 'default' : 'pointer',
                      borderBottom: isFieldLocked('subDivision') ? 'none' : '1px dashed rgba(255,255,255,0.4)',
                      fontStyle: (localValues['subDivision'] ?? item.subDivision) ? 'normal' : 'italic',
                      opacity: (localValues['subDivision'] ?? item.subDivision) ? 1 : 0.7,
                    }}
                  >
                    {(localValues['subDivision'] ?? item.subDivision) || (isFieldLocked('subDivision') ? '—' : 'set sub-div')}
                  </span>
                )}
              </span>
              {(item.sapArticleId || item.articleNumber) && (
                <Badge className="bg-white/20 px-2 py-0.5 text-[11px] font-mono text-white">
                  {item.sapArticleId || item.articleNumber}
                </Badge>
              )}
              {/* ── Design + Vendor + Price ── */}
              {(() => {
                const designLocked = item.approvalStatus !== 'PENDING' && item.sapSyncStatus !== 'FAILED';
                return (
              <span className="ml-2 flex flex-wrap items-center gap-1.5 truncate text-[11px] text-white/75">
                <span className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Design:</span>
                  {editingField === 'topbar_designNumber' ? (
                    <input
                      autoFocus
                      defaultValue={(localValues['designNumber'] ?? item.designNumber) || ''}
                      className="h-5 w-24 rounded border border-white/30 bg-white/10 px-1 text-[11px] text-white outline-none"
                      onBlur={(e) => { handleSave('designNumber', e.target.value.trim() || null); setEditingField(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { handleSave('designNumber', (e.target as HTMLInputElement).value.trim() || null); setEditingField(null); }
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                    />
                  ) : (
                    <span
                      onClick={() => { if (!designLocked) setEditingField('topbar_designNumber'); }}
                      style={{
                        cursor: designLocked ? 'default' : 'pointer',
                        borderBottom: designLocked ? 'none' : '1px dashed rgba(255,255,255,0.4)',
                        fontStyle: (localValues['designNumber'] ?? item.designNumber) ? 'normal' : 'italic',
                        opacity: (localValues['designNumber'] ?? item.designNumber) ? 1 : 0.7,
                      }}
                    >
                      {(localValues['designNumber'] ?? item.designNumber) || (designLocked ? '—' : 'set design')}
                    </span>
                  )}
                </span>
                {item.vendorName && <span className="text-white/40">·</span>}
                {item.vendorName}
                {item.rate != null && <>&nbsp;·&nbsp;₹{item.rate}</>}
                {item.mrp != null && Number(item.mrp) > 1 && <> / ₹{item.mrp}</>}
              </span>
                );
              })()}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.pptNumber && (
                <Badge className="gap-1.5 border border-white/15 bg-white/10 font-mono text-[12px] font-semibold text-white">
                  <TagIcon className="h-3.5 w-3.5" />
                  PPT {item.pptNumber}
                </Badge>
              )}
              {isModifyMode && (
                <Button
                  size="sm"
                  onClick={handleModify}
                  disabled={Object.keys(pendingChanges).length === 0 || modifying}
                  className="h-8 border-none bg-[#FF6F61] px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-[#ff5b4d] disabled:bg-white/20 disabled:text-white/50"
                >
                  {modifying ? <Spinner size="sm" /> : <Wand2 />}
                  {modifying ? 'Modifying…' : 'Modify'}
                  {Object.keys(pendingChanges).length > 0 && !modifying && (
                    <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[10px] tabular-nums">
                      {Object.keys(pendingChanges).length}
                    </span>
                  )}
                </Button>
              )}
              {pathType === 'new' &&
                item.approvalStatus === 'PENDING' &&
                item.division?.toUpperCase() === 'KIDS' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDupConfirmOpen(true)}
                    className="h-8 border-white/40 bg-white/10 text-white hover:bg-white/20"
                  >
                    <Copy />
                    Duplicate
                  </Button>
                )}
            </div>
          </div>

          {/* ─── MAIN GRID — image+info | attribute groups ─── */}
          <div className={`grid items-start gap-3 p-3 ${allowGroups ? 'lg:grid-cols-[minmax(320px,40%)_1fr] xl:grid-cols-[minmax(360px,40%)_1fr] 2xl:grid-cols-[minmax(400px,40%)_1fr]' : 'lg:grid-cols-[minmax(320px,28%)_1fr] xl:grid-cols-[minmax(360px,26%)_1fr] 2xl:grid-cols-[minmax(400px,24%)_1fr]'}`}>
            {/* ─── LEFT: Image + Article Info + Reference ───
             *
             * Sticky rail: image + identity stay anchored to the viewport
             * while the attribute groups on the right scroll. Top offset =
             * height of the dashboard's sticky brand+filter chrome (~120px).
             */}
            <aside className="sticky top-[120px] flex min-w-0 flex-col gap-3 self-start">
              {!allowGroups ? (
                <>
                  {/* FG pages — design "Option A": ink headers matching the attribute cards */}
                  <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                    {renderInkCardHeader('Article Image', {
                      right: (
                        <span className="flex items-center gap-1.5">
                          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10.5px] font-semibold">
                            {replaceOpen
                              ? 'Replacing'
                              : imgViews.length > 1
                              ? `${activeImgView.label} · ${activeImgIdx + 1} / ${imgViews.length}`
                              : '1 / 1'}
                          </span>
                          {canReplaceImage && !replaceOpen && (
                            <button
                              type="button"
                              onClick={() => setReplaceOpen(true)}
                              className="flex h-7 items-center gap-1 rounded-md border border-slate-500 px-2 text-[11px] font-semibold text-white hover:bg-slate-700"
                            >
                              <Upload className="h-3.5 w-3.5" />
                              Replace
                            </button>
                          )}
                        </span>
                      ),
                    })}
                    <div className="flex flex-col gap-2 p-3">
                      {replaceOpen ? (
                        <>
                          <label
                            onDragOver={(e) => {
                              e.preventDefault();
                              setReplaceDragOver(true);
                            }}
                            onDragLeave={() => setReplaceDragOver(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setReplaceDragOver(false);
                              if (replaceProgress === null) pickReplaceFile(e.dataTransfer.files?.[0]);
                            }}
                            className={cn(
                              'relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center',
                              replaceDragOver ? 'border-slate-800 bg-slate-100' : 'border-slate-400 bg-slate-50 hover:bg-slate-100',
                            )}
                          >
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              disabled={replaceProgress !== null}
                              onChange={(e) => {
                                pickReplaceFile(e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                            {replacePreview ? (
                              <>
                                <img src={replacePreview} alt="" className="h-40 w-40 rounded-md object-contain shadow" />
                                <span className="max-w-full truncate text-xs font-semibold text-slate-900">
                                  {replaceFile?.name} · {((replaceFile?.size ?? 0) / 1024 / 1024).toFixed(1)} MB
                                </span>
                                <span className="text-xs text-slate-600 underline">Choose another file</span>
                              </>
                            ) : (
                              <>
                                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 text-white">
                                  <Upload className="h-5 w-5" />
                                </span>
                                <span className="text-sm font-semibold text-slate-900">Drop the new photo or browse</span>
                                <span className="text-xs text-slate-600">JPG, PNG or WebP · up to 15 MB</span>
                              </>
                            )}
                          </label>
                          <p className="m-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-700">
                            Saved with the watermark as <span className="font-mono font-semibold">{imgStem}.jpg</span>.{' '}
                            {hasOldImage ? 'The original stays as ' : 'Today’s image is kept as '}
                            <span className="font-mono font-semibold">{imgStem}_OLD.jpg</span>.
                          </p>
                          {replaceProgress !== null && (
                            <div
                              className="h-1.5 overflow-hidden rounded-full bg-slate-200"
                              role="progressbar"
                              aria-label="Upload progress"
                              aria-valuenow={replaceProgress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <span className="block h-1.5 bg-slate-900 transition-[width]" style={{ width: `${Math.max(replaceProgress, 4)}%` }} />
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={cancelReplace} disabled={replaceProgress !== null}>
                              Cancel
                            </Button>
                            <Button
                              className="flex-1 bg-slate-900 text-white hover:bg-slate-800"
                              onClick={submitReplace}
                              disabled={!replaceFile || replaceProgress !== null}
                            >
                              <Upload className="h-4 w-4" />
                              {replaceProgress !== null ? 'Uploading…' : 'Upload & replace'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-100">
                            {shownImgUrl ? (
                              <>
                                <img
                                  src={shownImgUrl}
                                  alt=""
                                  className="block h-full w-full cursor-zoom-in object-contain p-2"
                                  onError={
                                    activeImgView.key === 'old'
                                      ? () => setOldImgFailed(true)
                                      : activeImgView.key === 'back'
                                      ? () => setBackImgFailed(true)
                                      : handleImgError
                                  }
                                  onClick={() => setImgModalOpen(true)}
                                />
                                <button
                                  type="button"
                                  onClick={() => setImgModalOpen(true)}
                                  aria-label="Expand image"
                                  className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900/75 text-white hover:bg-slate-900"
                                >
                                  <Maximize2 className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                                {activeImgView.key === 'front' ? 'No image' : `${activeImgView.label} image unavailable`}
                              </div>
                            )}
                            {imgViews.length > 1 && (
                              <>
                                <span className="absolute left-2.5 top-2.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.06em] text-white">
                                  {activeImgView.label.toUpperCase()}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setImgViewIdx(Math.max(0, activeImgIdx - 1))}
                                  disabled={activeImgIdx === 0}
                                  aria-label="Previous image"
                                  className="absolute left-2.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white disabled:pointer-events-none disabled:opacity-0"
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setImgViewIdx(Math.min(imgViews.length - 1, activeImgIdx + 1))}
                                  disabled={activeImgIdx === imgViews.length - 1}
                                  aria-label="Next image"
                                  className="absolute right-2.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white disabled:pointer-events-none disabled:opacity-0"
                                >
                                  <ChevronRight className="h-5 w-5" />
                                </button>
                              </>
                            )}
                          </div>
                          {imgViews.length > 1 && (
                            <div className="flex justify-center gap-1.5" aria-hidden="true">
                              {imgViews.map((v, i) => (
                                <span
                                  key={v.key}
                                  className={cn('h-1.5 rounded-full', i === activeImgIdx ? 'w-4 bg-slate-900' : 'w-1.5 bg-slate-300')}
                                />
                              ))}
                            </div>
                          )}
                          {activeImgView.name && (
                            <span className="truncate font-mono text-[11px] text-slate-600" title={activeImgView.name}>
                              {activeImgView.name}
                              {imgViews.length > 1 && activeImgView.note}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                    {renderInkCardHeader('Article Information', {
                      cardKey: 'info',
                      summary: (
                        <span className="truncate text-[11px] font-medium text-slate-300">
                          {aiConfidence}% · {attrMatchLevel} {filledAttrCount}/{visibleAttrs.length}
                        </span>
                      ),
                    })}
                    {isLeftCardOpen('info') && (
                      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] px-3 py-1 text-sm">
                        {fgInfoRows.map(({ label, value }, i) => (
                          <React.Fragment key={label}>
                            <dt className={`py-1.5 text-slate-600 ${i < fgInfoRows.length - 1 ? 'border-b border-slate-100' : ''}`}>{label}</dt>
                            <dd
                              className={`m-0 truncate py-1.5 text-right font-semibold text-slate-900 ${
                                i < fgInfoRows.length - 1 ? 'border-b border-slate-100' : ''
                              }`}
                            >
                              {value}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                    {renderInkCardHeader('Reference & Vendor', {
                      cardKey: 'reference',
                      summary:
                        missingRequiredHeaderCount > 0 ? (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10.5px] font-semibold text-orange-800">
                            {missingRequiredHeaderCount} required empty
                          </span>
                        ) : (
                          <span className="truncate text-[11px] font-medium text-slate-300">
                            {(localValues.vendorName !== undefined ? localValues.vendorName : item.vendorName) || ''}
                          </span>
                        ),
                    })}
                    {isLeftCardOpen('reference') && <div className="py-1">{HEADER_FIELDS.map((f) => renderHeaderField(f as any))}</div>}
                  </div>
                </>
              ) : (
                <>
              {/* Article image — dominant focal point, mockup-style */}
              <div className="overflow-hidden rounded-[var(--radius-card)] border-2 border-foreground/20 bg-white shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between border-b-2 border-foreground/15 bg-slate-50 px-2.5 py-1.5">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                    <Info className="h-3 w-3" />
                    Article Image
                  </span>
                  <Badge variant="success" className="text-[9px]">1 / 1</Badge>
                </div>
                <div className="group relative aspect-square w-full bg-gradient-to-br from-slate-50 to-slate-100">
                  {imgUrl ? (
                    <>
                      <img
                        src={imgUrl}
                        alt=""
                        className="block h-full w-full cursor-zoom-in object-contain p-3 transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                        onError={handleImgError}
                        onClick={() => setImgModalOpen(true)}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="absolute right-2 top-2 h-8 w-8 bg-white/90 opacity-0 shadow-[var(--shadow-md)] backdrop-blur transition-opacity duration-200 group-hover:opacity-100"
                        onClick={() => setImgModalOpen(true)}
                        aria-label="Expand image"
                      >
                        <Maximize2 />
                      </Button>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      No Image
                    </div>
                  )}
                </div>
              </div>

              {/* Article information */}
              <div className="overflow-hidden rounded-lg border-2 border-foreground/20 bg-white shadow-[var(--shadow-sm)]">
                <div className="border-b-2 border-foreground/15 bg-slate-50 px-2 py-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700">
                    Article Information
                  </span>
                </div>
                <div className="space-y-0.5 px-2 py-1 text-[10.5px] font-medium">
                  {/* Hidden on every FG Articles page (New, Old, Rejected, Created, Failed) */}
                  {!!allowGroups && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-muted-foreground">Article ID</span>
                      <span className="truncate text-right font-bold text-foreground">
                        {item.sapArticleId || item.articleNumber || item.imageName || '—'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">Category</span>
                    <span className="truncate text-right text-[11px] font-semibold text-foreground">
                      {[formatDivisionLabel(item.division), item.subDivision, effectiveMajCat]
                        .filter(Boolean)
                        .join(' › ') || '—'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">AI Confidence</span>
                    <Badge variant="success">{aiConfidence}%</Badge>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">Image Quality</span>
                    <span className={`font-bold ${qualityColor(imageQualityLevel)}`}>{imageQualityLevel}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">Product Clarity</span>
                    <span className={`font-bold ${qualityColor(productClarityLevel)}`}>{productClarityLevel}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">Attribute Match</span>
                    <span className={`font-bold ${qualityColor(attrMatchLevel)}`}>
                      {attrMatchLevel} ({filledAttrCount}/{visibleAttrs.length})
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">{pathType === 'created' ? 'Last Updated' : 'Created'}</span>
                    <span className="text-[11px] font-semibold text-foreground">
                      {(pathType === 'created' ? item.updatedAt : item.createdAt) || item.updatedAt || item.createdAt
                        ? new Date(((pathType === 'created' ? item.updatedAt : item.createdAt) || item.updatedAt || item.createdAt) as string).toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reference & Vendor — 7 editable fields stacked */}
              <div className="overflow-hidden rounded-lg border-2 border-foreground/20 bg-white shadow-[var(--shadow-sm)]">
                <div className="border-b-2 border-foreground/15 bg-slate-50 px-2 py-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700">
                    Reference &amp; Vendor
                  </span>
                </div>
                <div>{HEADER_FIELDS.map((f) => renderHeaderField(f as any))}</div>
              </div>
                </>
              )}
            </aside>

            {/* ─── RIGHT: Attribute groups + BOM + Fabric/Body + Proceed FG ─── */}
            <section className="flex min-w-0 flex-col">
              <div className="mb-1.5 flex shrink-0 items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-700">
                  <Sparkles className="h-3.5 w-3.5 text-[#FF6F61]" />
                  GARMENT ATTRIBUTES ({visibleAttrs.length})
                  {/* Legend popover */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                        aria-label="Legend"
                      >
                        ?
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Legend
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded border border-slate-400 bg-slate-200" />
                          AI Predicted
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded border border-emerald-300 bg-emerald-100" />
                          User Modified
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50" />
                          Required (Empty)
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-base leading-none text-red-500">*</span>
                          Mandatory Field
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAllCollapsed((c) => !c);
                    setCollapsedGroups(new Set());
                  }}
                  className="h-7 text-xs"
                >
                  {allCollapsed ? <ChevronDown /> : <ChevronUp />}
                  {allCollapsed ? 'Expand All' : 'Collapse All'}
                </Button>
              </div>

              {/* ── Group filter tabs (FG articles only) ── */}
              {!allowGroups && (() => {
                const TAB_DEFS = [
                  { key: 'FAB',      label: 'FAB',        style: GROUP_HEADER_STYLE['FAB'] },
                  { key: 'BODY',     label: 'BODY',       style: GROUP_HEADER_STYLE['BODY'] },
                  { key: 'VA ACC.',  label: 'B TRIM',     style: GROUP_HEADER_STYLE['VA ACC.'] },
                  { key: 'VA PRCS',  label: 'V. ADD',     style: GROUP_HEADER_STYLE['VA PRCS'] },
                  // BUSINESS attrs are merged into the BOM card (OTH GRID-1) for FG articles.
                  { key: 'PKG',      label: 'PKG COST',   style: CARD_THEME },
                  // OTH GRID-1 is always last — matches its card (order-last).
                  { key: 'BOM',      label: 'OTH GRID-1', style: CARD_THEME },
                ];
                return (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {TAB_DEFS.map(({ key, label, style }) => {
                      const active = selectedGroupKeys.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleGroupTab(key)}
                          className="rounded-full border-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all"
                          style={active
                            ? { background: style.bg, color: style.fg, borderColor: style.bg }
                            : { background: 'transparent', color: '#64748b', borderColor: '#cbd5e1' }
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {visibleAttrs.length > 0 ? (
                <div className={`grid auto-rows-min items-start gap-3 ${
                  allowGroups
                    ? 'grid-cols-1'
                    : (() => {
                        // FG: never more than 2 columns. Switching to 3 when a 5th card (V. ADD /
                        // PKG COST) was turned on squeezed FAB and BODY to a third of the width.
                        const visibleCount = visibleGroups.length + (showBomCard ? 1 : 0) + (showPkgCard ? 1 : 0);
                        return visibleCount <= 1 ? 'grid-cols-1' : 'grid-cols-2';
                      })()
                }`}>
                  {visibleGroups.map((g) => {
                    const style = GROUP_HEADER_STYLE[g.group] ?? CARD_THEME;
                    const collapsed = isGroupCollapsed(g.group);
                    // FG articles: B TRIM and V. ADD render as costing grids.
                    const gridCfg = COSTING_GRID_CONFIGS[g.group];
                    if (gridCfg && !allowGroups) {
                      const groupAttrs = groupMap[g.group].attrs;
                      return (
                        <CostingGridCard
                          key={g.group}
                          config={gridCfg.config}
                          icon={GROUP_ICONS[g.group]}
                          style={style}
                          collapsed={collapsed}
                          onToggleCollapse={() => toggleGroupCollapse(g.group)}
                          attrs={groupAttrs}
                          getValue={getValue}
                          onSave={handleSave}
                          isFieldLocked={isFieldLocked}
                          locked={isLocked}
                          extraRows={groupAttrs
                            .filter((a) => !gridCfg.fields.has(a.field) && !FG_CARD_HIDDEN_SCHEMA_KEYS.has(a.schemaKey))
                            .map((a) => renderAttributeRow(a, false, true))}
                          loadSavedRecord={loadFreshItem}
                          onSaveTab={(updates) => {
                            setLocalValues((prev) => ({ ...prev, ...updates }));
                            if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
                            else onSave({ ...item, ...updates } as any, updates);
                          }}
                        />
                      );
                    }
                    return (
                      <div
                        key={g.group}
                        className="overflow-hidden rounded-lg border-2 bg-white shadow-[var(--shadow-sm)]"
                        style={{ borderColor: style.border }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(g.group)}
                          className="flex w-full items-center justify-between border-b-2 px-2 py-1.5 transition-colors hover:brightness-95"
                          style={{ background: style.bg, borderColor: style.bg }}
                        >
                          <span
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: style.fg }}
                          >
                            {GROUP_ICONS[g.group]}
                            {GROUP_LABELS[g.group] ?? g.group}
                          </span>
                          {collapsed ? (
                            <ChevronDown className="h-3 w-3" style={{ color: style.fg }} />
                          ) : (
                            <ChevronUp className="h-3 w-3" style={{ color: style.fg }} />
                          )}
                        </button>
                        {!collapsed && (
                          <div className="space-y-0 p-1">
                            {groupMap[g.group].attrs.map((attr) => renderAttributeRow(attr, !allowGroups && (g.group === 'FAB' || g.group === 'BODY')))}

                            {/* Costing Type, CMP Cost, Basic Trim Cost, CMTP Cost — Body Article only,
                                appended after the 17 Body & Construction attribute rows. */}
                            {g.group === 'BODY' && allowGroups?.includes('BODY') &&
                              (() => {
                                const COSTING_FIELDS: { field: string; label: string; isDropdown?: boolean }[] = [
                                  { field: 'cmpCost',      label: 'CMP COST' },
                                  { field: 'cmtpCost',     label: 'CMTP COST' },
                                ];
                                return COSTING_FIELDS.map(({ field, label, isDropdown }) => {
                                  _attrCounter += 1;
                                  const num = _attrCounter;
                                  const displayVal = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
                                  const isEffectivelyEmpty = !displayVal || String(displayVal).trim() === '';
                                  const isEditingThis = editingField === `costing_${field}`;
                                  const fieldLocked = isFieldLocked(field);
                                  return (
                                    <div
                                      key={field}
                                      className="group flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/40"
                                      style={{ cursor: fieldLocked ? 'default' : 'pointer' }}
                                      onClick={() => {
                                        if (!fieldLocked && !isEditingThis) setEditingField(`costing_${field}`);
                                      }}
                                    >
                                      <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-muted-foreground">{num}.</span>
                                      <span className="flex-1 truncate text-[10.5px] font-semibold leading-snug text-foreground/80">
                                        {label}
                                      </span>
                                      <div className="w-[110px] shrink-0">
                                        {isDropdown ? (
                                          <Popover
                                            open={isEditingThis}
                                            onOpenChange={(o) => { if (!o) setEditingField(null); }}
                                          >
                                            <PopoverAnchor asChild>
                                              <span
                                                className="flex items-center justify-end gap-1 text-right text-[11px]"
                                                style={{
                                                  color: isEffectivelyEmpty ? '#9ca3af' : '#111827',
                                                  fontStyle: isEffectivelyEmpty ? 'italic' : 'normal',
                                                  fontWeight: 600,
                                                }}
                                              >
                                                <span className="truncate">
                                                  {isEffectivelyEmpty ? (fieldLocked ? '—' : 'Click') : String(displayVal)}
                                                </span>
                                                <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
                                              </span>
                                            </PopoverAnchor>
                                            {isEditingThis && (
                                              <PopoverContent
                                                className="w-36 p-0"
                                                align="end"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {!isEffectivelyEmpty && (
                                                  <button
                                                    type="button"
                                                    onClick={() => { handleSave(field, null); setEditingField(null); }}
                                                    className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                                                  >
                                                    <X className="h-3 w-3 shrink-0" />
                                                    Clear selection
                                                  </button>
                                                )}
                                                <div className="py-1">
                                                  {['Rough', 'Precise'].map((opt) => (
                                                    <button
                                                      key={opt}
                                                      type="button"
                                                      onClick={() => { handleSave(field, opt); setEditingField(null); }}
                                                      className={cn(
                                                        'flex w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                                                        String(displayVal) === opt && 'bg-accent/60',
                                                      )}
                                                    >
                                                      <span className="font-medium">{opt}</span>
                                                    </button>
                                                  ))}
                                                </div>
                                              </PopoverContent>
                                            )}
                                          </Popover>
                                        ) : isEditingThis ? (
                                          <Input
                                            autoFocus
                                            defaultValue={isEffectivelyEmpty ? '' : String(displayVal)}
                                            className="h-6 px-1 text-[11px]"
                                            onKeyDown={(e) =>
                                              e.key === 'Enter' && handleSave(field, (e.target as HTMLInputElement).value || null)
                                            }
                                            onBlur={(e) => handleSave(field, e.target.value || null)}
                                          />
                                        ) : (
                                          <span
                                            className="block truncate text-right text-[11px]"
                                            style={{
                                              color: isEffectivelyEmpty ? '#9ca3af' : '#111827',
                                              fontStyle: isEffectivelyEmpty ? 'italic' : 'normal',
                                              fontWeight: 600,
                                            }}
                                          >
                                            {isEffectivelyEmpty ? (fieldLocked ? '—' : 'Click') : String(displayVal)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}

                            {/* FAB: fabric article number + description + button */}
                            {g.group === 'FAB' &&
                              (() => {
                                const renderField = (
                                  field: string,
                                  label: string,
                                  autoFillFn?: () => void,
                                  maxLen?: number,
                                ) => {
                                  const displayVal =
                                    localValues[field] !== undefined ? localValues[field] : (item as any)[field];
                                  const isEditingThis = editingField === `bot_${field}`;
                                  const saveVal = (raw: string | null) => {
                                    const v = raw || null;
                                    handleSave(field, maxLen && v ? v.slice(0, maxLen) : v);
                                  };
                                  return (
                                    <div
                                      key={field}
                                      className="mt-1 border-t border-border bg-muted/30 px-2 py-1.5"
                                      style={{ cursor: isLocked ? 'default' : 'pointer' }}
                                      onClick={() => {
                                        if (!isLocked && !isEditingThis) setEditingField(`bot_${field}`);
                                      }}
                                    >
                                      <div className="mb-0.5 flex items-center justify-between gap-1">
                                        <span className={cn('font-semibold uppercase tracking-wider text-muted-foreground', !allowGroups ? 'text-[11px]' : 'text-[9px]')}>
                                          {label}
                                        </span>
                                        {autoFillFn && !isLocked && (
                                          <button
                                            type="button"
                                            className="text-[9px] text-slate-700 underline hover:text-[#FF6F61]"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              autoFillFn();
                                            }}
                                          >
                                            Auto-fill
                                          </button>
                                        )}
                                      </div>
                                      {isEditingThis ? (
                                        <Input
                                          autoFocus
                                          defaultValue={displayVal || ''}
                                          maxLength={maxLen}
                                          className="h-6 px-1 text-[11px]"
                                          onKeyDown={(e) =>
                                            e.key === 'Enter' && saveVal((e.target as HTMLInputElement).value)
                                          }
                                          onBlur={(e) => saveVal(e.target.value)}
                                        />
                                      ) : (
                                        <div
                                          className={cn('truncate', !allowGroups ? 'text-[14px] font-semibold' : 'text-[11px]')}
                                          style={{ color: displayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {displayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                };
                                const fabAutoFill = () => {
                                  const parts = FAB_FIELDS
                                    .map((ff) => {
                                      const v = localValues[ff.field] !== undefined ? localValues[ff.field] : (item as any)[ff.field];
                                      return v ? String(v).trim() : null;
                                    })
                                    .filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
                                  if (parts.length > 0)
                                    handleSave('fabricArticleDescription', parts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, ''));
                                };
                                const isFabNoEditing = editingField === 'bot_fabricArticleNumber';
                                const fabNoDisplayVal =
                                  localValues['fabricArticleNumber'] !== undefined
                                    ? localValues['fabricArticleNumber']
                                    : (item as any)['fabricArticleNumber'];

                                return (
                                  <>
                                    {/* FABRIC ARTICLE NO. — search dropdown from fabric_article_data */}
                                    <div
                                      key="fabricArticleNumber"
                                      className="mt-1 border-t border-border bg-muted/30 px-2 py-1.5"
                                      style={{ cursor: isLocked ? 'default' : 'pointer' }}
                                      onClick={() => {
                                        if (!isLocked && !isFabNoEditing) {
                                          setEditingField('bot_fabricArticleNumber');
                                          setFabNoQuery(fabNoDisplayVal || '');
                                          setFabNoResults([]);
                                        }
                                      }}
                                    >
                                      <div className="mb-0.5 flex items-center justify-between gap-1">
                                        <span className={cn('font-semibold uppercase tracking-wider text-muted-foreground', !allowGroups ? 'text-[11px]' : 'text-[9px]')}>
                                          FABRIC ARTICLE NO.
                                        </span>
                                      </div>
                                      {isFabNoEditing ? (
                                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                                          <Input
                                            autoFocus
                                            value={fabNoQuery}
                                            placeholder="Search fabric article no…"
                                            className="h-6 px-1 text-[11px]"
                                            onChange={(e) => {
                                              const q = e.target.value;
                                              setFabNoQuery(q);
                                              if (!q.trim()) { setFabNoResults([]); return; }
                                              setFabNoLoading(true);
                                              const token = localStorage.getItem('authToken');
                                              fetch(
                                                `${APP_CONFIG.api.baseURL}/approver/fabric-article-data/search?q=${encodeURIComponent(q)}&type=FG,uploader`,
                                                { headers: { Authorization: `Bearer ${token}` } },
                                              )
                                                .then((r) => r.json())
                                                .then((d) => setFabNoResults(d.results ?? []))
                                                .catch(() => setFabNoResults([]))
                                                .finally(() => setFabNoLoading(false));
                                            }}
                                            onBlur={() => {
                                              setTimeout(() => {
                                                setEditingField(null);
                                                setFabNoResults([]);
                                              }, 150);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                setEditingField(null);
                                                setFabNoResults([]);
                                              }
                                              if (e.key === 'Enter' && fabNoQuery.trim()) {
                                                handleSave('fabricArticleNumber', fabNoQuery.trim() || null);
                                                setEditingField(null);
                                                setFabNoResults([]);
                                              }
                                            }}
                                          />
                                          {(fabNoResults.length > 0 || fabNoLoading) && (
                                            <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded-md border border-border bg-white shadow-lg">
                                              {fabNoLoading ? (
                                                <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching…</div>
                                              ) : (
                                                fabNoResults.map((r) => (
                                                  <button
                                                    key={r.fabricArticleNumber}
                                                    type="button"
                                                    className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-[#FF6F61]/10"
                                                    onMouseDown={(e) => {
                                                      e.preventDefault();
                                                      // Map fabric_article_data fields → article item field names
                                                      // Always include all fields (even null) so existing values are cleared when fabric article has no value
                                                      const gridUpdates: Record<string, string | null> = {
                                                        fabricArticleNumber:    r.fabricArticleNumber,
                                                        fabricArticleDescription: r.fabricArticleDescription,
                                                        fabDiv:                 r.mFabDiv,
                                                        yarn1:                  r.mYarn,
                                                        mainMvgr:               r.mFabMainMvgr1,
                                                        fabricMainMvgr:         r.mFabMainMvgr2,
                                                        fConstruction:          r.mConstruction,
                                                        fOunce:                 r.mOunz,
                                                        fWidth:                 r.mWidth,
                                                        weave:                  r.mWeave01,
                                                        mFab2:                  r.mWeave02,
                                                        fCount:                 r.mCount,
                                                        composition:            r.mComposition,
                                                        finish:                 r.mFinish,
                                                        gsm:                    r.mGsm,
                                                        lycra:                  r.mLycra,
                                                      };
                                                      setLocalValues((prev) => ({ ...prev, ...gridUpdates }));
                                                      setEditingField(null);
                                                      setFabNoResults([]);
                                                      if (isModifyMode) {
                                                        setPendingChanges((prev) => ({ ...prev, ...gridUpdates }));
                                                      } else {
                                                        onSave({ ...item, ...gridUpdates } as any, gridUpdates);
                                                      }
                                                    }}
                                                  >
                                                    <span className="text-[11px] font-medium text-gray-900">{r.fabricArticleNumber}</span>
                                                    {r.fabricArticleDescription && (
                                                      <span className="truncate text-[10px] text-muted-foreground">{r.fabricArticleDescription}</span>
                                                    )}
                                                  </button>
                                                ))
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div
                                          className={cn('truncate', !allowGroups ? 'text-[14px] font-semibold' : 'text-[11px]')}
                                          style={{
                                            color: fabNoDisplayVal ? '#111827' : '#9ca3af',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {fabNoDisplayVal || '—'}
                                        </div>
                                      )}
                                    </div>
                                    {/* FABRIC ARTICLE DESC — search dropdown from fabric_article_data (no category filter) */}
                                    {(() => {
                                      const isFabDescEditing = editingField === 'bot_fabricArticleDescription';
                                      const fabDescDisplayVal =
                                        localValues['fabricArticleDescription'] !== undefined
                                          ? localValues['fabricArticleDescription']
                                          : (item as any)['fabricArticleDescription'];
                                      const runFabDescSearch = (q: string, withAttrFallback = false) => {
                                        if (!q.trim()) { setFabDescResults([]); setFabDescSearched(false); return; }
                                        setFabDescLoading(true);
                                        setFabDescSearched(false);
                                        const token = localStorage.getItem('authToken');
                                        const getVal = (key: string) =>
                                          (localValues[key] !== undefined ? localValues[key] : (item as any)[key]) ?? '';
                                        const params: Record<string, string> = { q };
                                        if (withAttrFallback) {
                                          params.mFabDiv       = getVal('fabDiv');
                                          params.mYarn         = getVal('yarn1');
                                          params.mFabMainMvgr1 = getVal('mainMvgr');
                                          params.mConstruction = getVal('fConstruction');
                                          params.mWidth        = getVal('fWidth');
                                          params.mWeave01      = getVal('weave');
                                          params.mComposition  = getVal('composition');
                                          params.mLycra        = getVal('lycra');
                                        }
                                        fetch(
                                          `${APP_CONFIG.api.baseURL}/approver/fabric-article-data/search?${new URLSearchParams(params).toString()}`,
                                          { headers: { Authorization: `Bearer ${token}` } },
                                        )
                                          .then((r) => r.json())
                                          .then((d) => {
                                            const hits = d.results ?? [];
                                            setFabDescResults(hits);
                                            setFabDescSearched(true);
                                            // Attribute fallback: desc had no match but rate resolved → auto-fill AUTO-BGT and close
                                            if (hits.length === 0 && d.attributeFallbackRate != null) {
                                              const rateStr = String(d.attributeFallbackRate);
                                              setLocalValues((prev) => ({ ...prev, autoBgt: rateStr }));
                                              setEditingField(null);
                                              setFabDescResults([]);
                                              setFabDescSearched(false);
                                              if (isModifyMode) {
                                                setPendingChanges((prev) => ({ ...prev, autoBgt: rateStr }));
                                              } else {
                                                onSave({ ...item, autoBgt: rateStr } as any, { autoBgt: rateStr });
                                              }
                                            }
                                          })
                                          .catch(() => { setFabDescResults([]); setFabDescSearched(true); })
                                          .finally(() => setFabDescLoading(false));
                                      };
                                      return (
                                        <div
                                          key="fabricArticleDescription"
                                          className="mt-1 border-t border-border bg-muted/30 px-2 py-1.5"
                                          style={{ cursor: isLocked ? 'default' : 'pointer' }}
                                          onClick={() => {
                                            if (!isLocked && !isFabDescEditing) {
                                              setEditingField('bot_fabricArticleDescription');
                                              setFabDescQuery(fabDescDisplayVal || '');
                                              setFabDescSearched(false);
                                              if (fabDescDisplayVal) runFabDescSearch(fabDescDisplayVal);
                                              else setFabDescResults([]);
                                            }
                                          }}
                                        >
                                          <div className="mb-0.5 flex items-center justify-between gap-1">
                                            <span className={cn('font-semibold uppercase tracking-wider text-muted-foreground', !allowGroups ? 'text-[11px]' : 'text-[9px]')}>
                                              FABRIC ARTICLE DESC
                                            </span>
                                            {!isFabDescEditing && !isLocked && (
                                              <button
                                                type="button"
                                                className="text-[9px] text-slate-700 underline hover:text-[#FF6F61]"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  fabAutoFill();
                                                }}
                                              >
                                                Auto-fill
                                              </button>
                                            )}
                                          </div>
                                          {isFabDescEditing ? (
                                            <Popover
                                              open
                                              onOpenChange={(o) => {
                                                if (!o) {
                                                  setEditingField(null);
                                                  setFabDescResults([]);
                                                  setFabDescSearched(false);
                                                }
                                              }}
                                            >
                                              <PopoverAnchor asChild>
                                                <Input
                                                  autoFocus
                                                  value={fabDescQuery}
                                                  placeholder="Search fabric article desc…"
                                                  className="h-6 px-1 text-[11px]"
                                                  onClick={(e) => e.stopPropagation()}
                                                  onChange={(e) => {
                                                    const q = e.target.value;
                                                    setFabDescQuery(q);
                                                    // Desc-only while typing; attribute fallback runs on Enter/blur
                                                    runFabDescSearch(q, false);
                                                  }}
                                                  onBlur={() => {
                                                    if (fabDescLoading) return;
                                                    const trimmed = fabDescQuery.trim();
                                                    if (!trimmed) { setEditingField(null); setFabDescResults([]); return; }
                                                    // If no desc results yet, try attribute fallback before closing
                                                    if (fabDescResults.length === 0) {
                                                      runFabDescSearch(trimmed, true);
                                                    } else {
                                                      setEditingField(null);
                                                      setFabDescResults([]);
                                                    }
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Escape') {
                                                      setEditingField(null);
                                                      setFabDescResults([]);
                                                    }
                                                    if (e.key === 'Enter' && fabDescQuery.trim()) {
                                                      // Run with attribute fallback on explicit Enter
                                                      runFabDescSearch(fabDescQuery.trim(), true);
                                                    }
                                                  }}
                                                />
                                              </PopoverAnchor>
                                              {(fabDescResults.length > 0 || fabDescLoading || fabDescSearched) && (
                                                <PopoverContent
                                                  align="start"
                                                  sideOffset={2}
                                                  className="w-[260px] p-0"
                                                  onOpenAutoFocus={(e) => e.preventDefault()}
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <div className="max-h-56 overflow-y-auto py-1">
                                                    {fabDescLoading ? (
                                                      <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching…</div>
                                                    ) : fabDescResults.length === 0 ? (
                                                      <div className="px-3 py-2 text-[11px] text-muted-foreground">No Fabric Article found</div>
                                                    ) : (
                                                      fabDescResults.map((r, i) => (
                                                        <button
                                                          key={r.fabricArticleNumber + i}
                                                          type="button"
                                                          className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-[#FF6F61]/10"
                                                          onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            const gridUpdates: Record<string, string | null> = {
                                                              fabricArticleNumber:      r.fabricArticleNumber,
                                                              fabricArticleDescription: r.fabricArticleDescription,
                                                              autoBgt:                  r.fabricRate != null ? String(r.fabricRate) : null,
                                                              fabDiv:                   r.mFabDiv,
                                                              yarn1:                    r.mYarn,
                                                              mainMvgr:                 r.mFabMainMvgr1,
                                                              fabricMainMvgr:           r.mFabMainMvgr2,
                                                              fConstruction:            r.mConstruction,
                                                              fOunce:                   r.mOunz,
                                                              fWidth:                   r.mWidth,
                                                              weave:                    r.mWeave01,
                                                              mFab2:                    r.mWeave02,
                                                              fCount:                   r.mCount,
                                                              composition:              r.mComposition,
                                                              finish:                   r.mFinish,
                                                              gsm:                      r.mGsm,
                                                              lycra:                    r.mLycra,
                                                            };
                                                            setLocalValues((prev) => ({ ...prev, ...gridUpdates }));
                                                            setEditingField(null);
                                                            setFabDescResults([]);
                                                            setFabDescSearched(false);
                                                            if (isModifyMode) {
                                                              // Stage ALL fields atomically — bypasses handleSave so the
                                                              // FAB-field side-effect (clearing fabricArticleNumber) doesn't
                                                              // overwrite the number we just selected from the dropdown.
                                                              setPendingChanges((prev) => ({ ...prev, ...gridUpdates }));
                                                            } else {
                                                              onSave({ ...item, ...gridUpdates } as any, gridUpdates);
                                                            }
                                                          }}
                                                        >
                                                          <span className="text-[11px] font-medium text-gray-900">{r.fabricArticleDescription || '—'}</span>
                                                          {r.fabricArticleNumber && (
                                                            <span className="truncate text-[10px] text-muted-foreground">{r.fabricArticleNumber}</span>
                                                          )}
                                                        </button>
                                                      ))
                                                    )}
                                                  </div>
                                                </PopoverContent>
                                              )}
                                            </Popover>
                                          ) : (
                                            <div
                                              className={cn('truncate', !allowGroups ? 'text-[14px] font-semibold' : 'text-[11px]')}
                                              style={{ color: fabDescDisplayVal ? '#111827' : '#9ca3af' }}
                                            >
                                              {fabDescDisplayVal || (isLocked ? '—' : 'Click to fill')}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                    <div className="border-t border-border px-2 py-1.5">
                                      <Button
                                        size="sm"
                                        disabled={fabricCreating}
                                        onClick={() => {
                                          if (fabricCreating) return;
                                          const mergedItem = {
                                            ...item,
                                            ...Object.fromEntries(
                                              Object.entries(localValues).filter(([, v]) => v !== null && v !== undefined)
                                            ),
                                          } as ApproverItem;

                                          if (isModifyMode) {
                                            // Validate required fields against the merged (UI) values
                                            const missing: string[] = [];
                                            if (!mergedItem.fabricArticleDescription) missing.push('FABRIC ARTICLE DESC');
                                            if (!mergedItem.vendorFabricRate) missing.push('VENDOR COST');
                                            if (missing.length > 0) {
                                              message.error(`Fill mandatory fields before creating Fabric Article: ${missing.join(', ')}`);
                                              return;
                                            }
                                            // Open confirm dialog — actual creation runs on confirm
                                            setFabConfirmItem(mergedItem);
                                            return;
                                          }

                                          // Non-modify mode: use the standard parent flow (modal in parent)
                                          awaitingLinkRef.current.add('fabricArticleNumber');
                                          onCreateFabricArticle(mergedItem);
                                        }}
                                        className={CARD_ACTION_BTN}
                                      >
                                        <FileText />
                                        {fabricCreating ? 'Creating...' : 'Create Fabric Article'}
                                      </Button>
                                    </div>
                                  </>
                                );
                              })()}

                            {/* BODY: body article + description + button */}
                            {g.group === 'BODY' &&
                              (() => {
                                const bodyAutoFill = () => {
                                  const desc = buildBodyDescription(getFieldVal);
                                  if (desc) handleSave('bodyArticleDescription', desc);
                                };
                                const isBodyNoEditing = editingField === 'bot_bodyArticle';
                                const bodyNoDisplayVal =
                                  localValues['bodyArticle'] !== undefined ? localValues['bodyArticle'] : (item as any)['bodyArticle'];
                                const isBodyDescEditing = editingField === 'bot_bodyArticleDescription';
                                const bodyDescDisplayVal =
                                  localValues['bodyArticleDescription'] !== undefined
                                    ? localValues['bodyArticleDescription']
                                    : (item as any)['bodyArticleDescription'];
                                // Fires the search for both boxes below — pulled out so opening the DESC
                                // box can search immediately using whatever's already filled, instead of
                                // waiting for the user to type another character.
                                // Scoped to this article's own major category (shown as the last segment
                                // of "Category" under Article Information) so results never include body
                                // articles that belong to a different major category.
                                const runBodySearch = (q: string) => {
                                  if (!q.trim()) { setBodyNoResults([]); setBodyNoSearched(false); return; }
                                  setBodyNoLoading(true);
                                  setBodyNoSearched(false);
                                  const token = localStorage.getItem('authToken');
                                  const params = new URLSearchParams({ q });
                                  if (effectiveMajCat) params.set('majorCategory', effectiveMajCat);
                                  fetch(
                                    `${APP_CONFIG.api.baseURL}/approver/body-article-data/search?${params.toString()}`,
                                    { headers: { Authorization: `Bearer ${token}` } },
                                  )
                                    .then((r) => r.json())
                                    .then((d) => { setBodyNoResults(d.results ?? []); setBodyNoSearched(true); })
                                    .catch(() => { setBodyNoResults([]); setBodyNoSearched(true); })
                                    .finally(() => setBodyNoLoading(false));
                                };
                                // Smart search: queries precise_body_article_consumption filtered by active grid attributes.
                                // Fires immediately on box click — no text input. Only fills bodyArticle on apply.
                                const SMART_ATTR_PARAM_MAP: Record<string, string> = {
                                  collar:           'm_collar_type',
                                  collarStyle:      'm_collar_style',
                                  neckDetails:      'm_neck_style',
                                  neck:             'm_neck_type',
                                  placket:          'm_placket',
                                  fatherBelt:       'm_blt_type',
                                  childBelt:        'm_blt_style',
                                  sleeve:           'm_sleeves_main_style',
                                  sleeveFold:       'm_sleeve_fold',
                                  bottomFold:       'm_btm_fold',
                                  pocketType:       'm_pocket',
                                  noOfPocket:       'm_no_of_pocket',
                                  extraPocket:      'm_extra_pocket',
                                  fit:              'm_fit',
                                  pattern:          'body_style',
                                  length:           'm_length',
                                };
                                const runPreciseBodySearch = () => {
                                  setPreciseBodyLoading(true);
                                  setPreciseBodySearched(false);
                                  const token = localStorage.getItem('authToken');
                                  const params = new URLSearchParams();
                                  if (effectiveMajCat) params.set('majorCategory', effectiveMajCat);
                                  // An empty attribute is sent as '-' so it must also be empty on the match.
                                  Object.entries(SMART_ATTR_PARAM_MAP).forEach(([field, paramKey]) => {
                                    params.set(paramKey, getFieldVal(field) || '-');
                                  });
                                  fetch(
                                    `${APP_CONFIG.api.baseURL}/approver/precise-body-article/search?${params.toString()}`,
                                    { headers: { Authorization: `Bearer ${token}` } },
                                  )
                                    .then((r) => r.json())
                                    .then((d) => { setPreciseBodyResults(d.results ?? []); setPreciseBodySearched(true); })
                                    .catch(() => { setPreciseBodyResults([]); setPreciseBodySearched(true); })
                                    .finally(() => setPreciseBodyLoading(false));
                                };
                                const applyPreciseBodyResult = (r: { macroBodyDescription: string | null; microBodyArticleNumber: string | null }) => {
                                  const updates: Record<string, string> = {
                                    bodyArticle: r.microBodyArticleNumber || '',
                                  };
                                  setLocalValues((prev) => ({ ...prev, ...updates }));
                                  setEditingField(null);
                                  setPreciseBodyResults([]);
                                  setPreciseBodySearched(false);
                                  if (r.microBodyArticleNumber) {
                                    cmpActFetchedRef.current = r.microBodyArticleNumber;
                                    refreshCmpAct(r.microBodyArticleNumber);
                                  }
                                  if (isModifyMode) {
                                    setPendingChanges((prev) => ({ ...prev, ...updates }));
                                  } else {
                                    onSave({ ...item, ...updates } as any, updates);
                                  }
                                };
                                // Smart search for NO. field — text search on micro_body_article_number in precise table.
                                const runPreciseBodyNoSearch = (q: string) => {
                                  if (!q.trim()) { setPreciseBodyNoResults([]); setPreciseBodyNoSearched(false); return; }
                                  setPreciseBodyNoLoading(true);
                                  setPreciseBodyNoSearched(false);
                                  const token = localStorage.getItem('authToken');
                                  const params = new URLSearchParams({ q });
                                  if (effectiveMajCat) params.set('majorCategory', effectiveMajCat);
                                  fetch(
                                    `${APP_CONFIG.api.baseURL}/approver/precise-body-article/search?${params.toString()}`,
                                    { headers: { Authorization: `Bearer ${token}` } },
                                  )
                                    .then((r) => r.json())
                                    .then((d) => { setPreciseBodyNoResults(d.results ?? []); setPreciseBodyNoSearched(true); })
                                    .catch(() => { setPreciseBodyNoResults([]); setPreciseBodyNoSearched(true); })
                                    .finally(() => setPreciseBodyNoLoading(false));
                                };
                                const applyPreciseBodyNoResult = (r: { macroBodyDescription: string | null; microBodyArticleNumber: string | null }) => {
                                  const updates: Record<string, string> = {
                                    bodyArticle: r.microBodyArticleNumber || '',
                                  };
                                  setLocalValues((prev) => ({ ...prev, ...updates }));
                                  setEditingField(null);
                                  setPreciseBodyNoResults([]);
                                  setPreciseBodyNoSearched(false);
                                  if (r.microBodyArticleNumber) {
                                    cmpActFetchedRef.current = r.microBodyArticleNumber;
                                    refreshCmpAct(r.microBodyArticleNumber);
                                  }
                                  if (isModifyMode) {
                                    setPendingChanges((prev) => ({ ...prev, ...updates }));
                                  } else {
                                    onSave({ ...item, ...updates } as any, updates);
                                  }
                                };
                                // Selecting a search result (by number or by description) fills every
                                // mapped field from that body_article_data row — shared by both search boxes below.
                                // BODY ARTICLE DESC is recomputed via buildBodyDescription from the fields
                                // this row just filled, rather than pasted verbatim from the row's own
                                // description — so it always ends up in the same canonical format as when
                                // each field is picked by hand (and stays a meaningful search key later).
                                const applyBodyArticleRow = (r: (typeof bodyNoResults)[number]) => {
                                  // Body attribute fields: always overwrite (even with null/empty) so that
                                  // fields absent in body_article_data don't inherit stale FG article values.
                                  const bodyAttrMap: Record<string, string | null | undefined> = {
                                    collar:        r.mCollarType,
                                    collarStyle:   r.mCollarStyle,
                                    neckDetails:   r.mNeckStyle,
                                    neck:          r.mNeckType,
                                    placket:       r.mPlacket,
                                    fatherBelt:    r.mBltType,
                                    childBelt:     r.mBltStyle,
                                    sleeve:        r.mSleevesMainStyle,
                                    sleeveFold:    r.mSleeveFold,
                                    mSet:          r.mSet,
                                    bottomFold:    r.mBtmFold,
                                    noOfPocket:    r.mNoOfPocket,
                                    pocketType:    r.mPocket,
                                    extraPocket:   r.mExtraPocket,
                                    fit:           r.mFit,
                                    pattern:       r.mBodyStyle,
                                    length:        r.mLength,
                                  };
                                  // BOM cost fields: only overwrite when the body article has a value.
                                  const bomMap: Record<string, string | number | null | undefined> = {
                                    width: r.width,
                                  };
                                  const gridUpdates: Record<string, string> = { bodyArticle: r.bodyArticleNumber || '' };
                                  // Always write body attributes — clear old values when body_article_data has null
                                  Object.entries(bodyAttrMap).forEach(([field, v]) => {
                                    const str = (v !== null && v !== undefined) ? String(v).trim() : '';
                                    gridUpdates[field] = str;
                                  });
                                  // BOM: only overwrite if non-empty
                                  Object.entries(bomMap).forEach(([field, v]) => {
                                    if (v !== null && v !== undefined && String(v).trim() !== '') {
                                      gridUpdates[field] = String(v).trim();
                                    }
                                  });
                                  const composedDesc = buildBodyDescription((field) => {
                                    const v = gridUpdates[field] !== undefined
                                      ? gridUpdates[field]
                                      : (localValues[field] !== undefined ? localValues[field] : (item as any)[field]);
                                    return v ? String(v).trim() : null;
                                  });
                                  gridUpdates.bodyArticleDescription = composedDesc || r.bodyArticleDescription || '';
                                  setLocalValues((prev) => ({ ...prev, ...gridUpdates }));
                                  setEditingField(null);
                                  setBodyNoResults([]);
                                  setBodyNoSearched(false);
                                  if (isModifyMode) {
                                    setPendingChanges((prev) => ({ ...prev, ...gridUpdates }));
                                  } else {
                                    onSave({ ...item, ...gridUpdates } as any, gridUpdates);
                                  }
                                };
                                return (
                                  <>
                                    {/* BODY ARTICLE NO. — Smart search (precise_body_article_consumption) */}
                                    <div
                                      key="bodyArticle"
                                      className="mt-1 border-t border-border bg-muted/30 px-2 py-1.5"
                                      style={{ cursor: isLocked ? 'default' : 'pointer' }}
                                      onClick={() => {
                                        if (!isLocked && !isBodyNoEditing) {
                                          setEditingField('bot_bodyArticle');
                                          setPreciseBodyNoQuery('');
                                          setPreciseBodyNoResults([]);
                                          setPreciseBodyNoSearched(false);
                                        }
                                      }}
                                    >
                                      <div className="mb-0.5 flex items-center justify-between gap-1">
                                        <span className={cn('font-semibold uppercase tracking-wider text-muted-foreground', !allowGroups ? 'text-[11px]' : 'text-[9px]')}>
                                          BODY ARTICLE NO.
                                        </span>
                                      </div>
                                      {isBodyNoEditing ? (
                                          /* ── Smart mode: text search from precise_body_article_consumption ── */
                                          <Popover
                                            open
                                            onOpenChange={(o) => {
                                              if (!o) {
                                                setEditingField(null);
                                                setPreciseBodyNoResults([]);
                                                setPreciseBodyNoSearched(false);
                                              }
                                            }}
                                          >
                                            <PopoverAnchor asChild>
                                              <Input
                                                autoFocus
                                                value={preciseBodyNoQuery}
                                                placeholder="Search precise article no…"
                                                className="h-6 px-1 text-[11px]"
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => {
                                                  const q = e.target.value;
                                                  setPreciseBodyNoQuery(q);
                                                  runPreciseBodyNoSearch(q);
                                                }}
                                                onBlur={() => {
                                                  if (preciseBodyNoLoading || preciseBodyNoSearched) return;
                                                  setEditingField(null);
                                                  setPreciseBodyNoResults([]);
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Escape') {
                                                    setEditingField(null);
                                                    setPreciseBodyNoResults([]);
                                                  }
                                                  if (e.key === 'Enter' && preciseBodyNoQuery.trim()) {
                                                    handleSave('bodyArticle', preciseBodyNoQuery.trim() || null);
                                                    setEditingField(null);
                                                    setPreciseBodyNoResults([]);
                                                  }
                                                }}
                                              />
                                            </PopoverAnchor>
                                            {(preciseBodyNoResults.length > 0 || preciseBodyNoLoading || preciseBodyNoSearched) && (
                                              <PopoverContent
                                                align="start"
                                                sideOffset={2}
                                                className="w-[280px] p-0"
                                                onOpenAutoFocus={(e) => e.preventDefault()}
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <div className="border-b border-border bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                  Smart match — fills article no. only
                                                </div>
                                                <div className="max-h-56 overflow-y-auto py-1">
                                                  {preciseBodyNoLoading ? (
                                                    <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching…</div>
                                                  ) : preciseBodyNoResults.length === 0 ? (
                                                    <div className="px-3 py-2 text-[11px] text-muted-foreground">No match found</div>
                                                  ) : (
                                                    preciseBodyNoResults.map((r, i) => (
                                                      <button
                                                        key={r.microBodyArticleNumber ?? i}
                                                        type="button"
                                                        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-slate-800/10"
                                                        onMouseDown={(e) => {
                                                          e.preventDefault();
                                                          applyPreciseBodyNoResult(r);
                                                        }}
                                                      >
                                                        <span className="text-[11px] font-medium text-gray-900">{r.microBodyArticleNumber || '—'}</span>
                                                        {r.macroBodyDescription && (
                                                          <span className="truncate text-[10px] text-muted-foreground">{r.macroBodyDescription}</span>
                                                        )}
                                                      </button>
                                                    ))
                                                  )}
                                                </div>
                                              </PopoverContent>
                                            )}
                                          </Popover>
                                      ) : (
                                        <div
                                          className={cn('truncate', !allowGroups ? 'text-[14px] font-semibold' : 'text-[11px]')}
                                          style={{ color: bodyNoDisplayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {bodyNoDisplayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                    {/* BODY ARTICLE DESC — Smart (attribute-based) */}
                                    <div
                                      key="bodyArticleDescription"
                                      className="mt-1 border-t border-border bg-muted/30 px-2 py-1.5"
                                      style={{ cursor: isLocked ? 'default' : 'pointer' }}
                                      onClick={() => {
                                        if (!isLocked && !isBodyDescEditing) {
                                          setEditingField('bot_bodyArticleDescription');
                                          setPreciseBodyResults([]);
                                          setPreciseBodySearched(false);
                                          runPreciseBodySearch();
                                        }
                                      }}
                                    >
                                      <div className="mb-0.5 flex items-center justify-between gap-1">
                                        <span className={cn('font-semibold uppercase tracking-wider text-muted-foreground', !allowGroups ? 'text-[11px]' : 'text-[9px]')}>
                                          BODY ARTICLE DESC
                                        </span>
                                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                          {!isBodyDescEditing && !isLocked && (
                                            <button
                                              type="button"
                                              className="text-[9px] text-slate-700 underline hover:text-[#FF6F61]"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                bodyAutoFill();
                                              }}
                                            >
                                              Auto-fill
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {isBodyDescEditing ? (
                                          /* ── Smart mode: attribute-based, no text input ── */
                                          <Popover
                                            open
                                            onOpenChange={(o) => {
                                              if (!o) {
                                                setEditingField(null);
                                                setPreciseBodyResults([]);
                                                setPreciseBodySearched(false);
                                              }
                                            }}
                                          >
                                            <PopoverAnchor asChild>
                                              <div
                                                className="flex h-6 items-center rounded border border-input bg-white px-1 text-[11px] text-muted-foreground"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {preciseBodyLoading ? 'Searching…' : 'Matching by active grid attributes'}
                                              </div>
                                            </PopoverAnchor>
                                            {(preciseBodyResults.length > 0 || preciseBodyLoading || preciseBodySearched) && (
                                              <PopoverContent
                                                align="start"
                                                sideOffset={2}
                                                className="w-[280px] p-0"
                                                onOpenAutoFocus={(e) => e.preventDefault()}
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <div className="border-b border-border bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                  Smart match — fills article no. only
                                                </div>
                                                <div className="max-h-56 overflow-y-auto py-1">
                                                  {preciseBodyLoading ? (
                                                    <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching…</div>
                                                  ) : preciseBodyResults.length === 0 ? (
                                                    <div className="px-3 py-2 text-[11px] text-muted-foreground">No match found</div>
                                                  ) : (
                                                    preciseBodyResults.map((r, i) => (
                                                      <button
                                                        key={r.microBodyArticleNumber ?? i}
                                                        type="button"
                                                        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-slate-800/10"
                                                        onMouseDown={(e) => {
                                                          e.preventDefault();
                                                          applyPreciseBodyResult(r);
                                                        }}
                                                      >
                                                        <span className="text-[11px] font-medium text-gray-900">{r.microBodyArticleNumber || '—'}</span>
                                                        {r.macroBodyDescription && (
                                                          <span className="truncate text-[10px] text-muted-foreground">{r.macroBodyDescription}</span>
                                                        )}
                                                      </button>
                                                    ))
                                                  )}
                                                </div>
                                              </PopoverContent>
                                            )}
                                          </Popover>
                                      ) : (
                                        <div
                                          className={cn('truncate', !allowGroups ? 'text-[14px] font-semibold' : 'text-[11px]')}
                                          style={{ color: bodyDescDisplayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {bodyDescDisplayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                    {!hideCreateBody && (
                                    <div className="border-t border-border px-2 py-1.5">
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          // Merge unsaved localValues so backend gets current attribute values,
                                          // not the stale DB values (important on Created page before Modify is clicked).
                                          awaitingLinkRef.current.add('bodyArticle');
                                          onCreateBodyArticle({ ...item, ...localValues } as typeof item);
                                        }}
                                        className={CARD_ACTION_BTN}
                                      >
                                        <LayoutGrid />
                                        Create Body Article
                                      </Button>
                                    </div>
                                    )}
                                  </>
                                );
                              })()}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* BOM / Consumption card */}
                  {/* FG: OTH GRID-1 is always the last card (order-last) */}
                  {showBomCard && <div
                    className={cn('overflow-hidden rounded-lg border bg-white', !allowGroups && 'order-last')}
                    style={{ borderColor: CARD_THEME.border }}
                  >
                    {renderCollapsibleHeader('BOM', isBodyArticle ? 'ROUGH CONSUMPTION' : 'OTH GRID-1')}
                    <div className={cn('space-y-0 p-1', isGroupCollapsed('BOM') && 'hidden')}>
                      {(allowGroups?.includes('BODY')
                        ? [
                            { label: 'Gsm',               field: 'gsm',              editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                            { label: 'Ratio',                 field: 'ratio',               editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                            { label: 'Consumption in Kg',      field: 'consumptionKg',       editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                            { label: 'Consumption in Meter',  field: 'consumptionMeter',    editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                          ]
                        : [
                            { label: 'RATE / COST', field: 'rate', editable: true, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false },
                            { label: 'MRP', field: 'mrp', editable: true, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false },
                            { label: 'Base Color', field: 'colour', editable: true, mandatory: true, isDropdown: true, isColor: true, isMarkdown: false },
                            { label: 'Secondary Color', field: 'secondaryColour', editable: true, mandatory: false, isDropdown: true, isColor: true, isMarkdown: false },
                            { label: 'MARKDOWN', field: '_markdown', editable: false, mandatory: false, isDropdown: false, isColor: false, isMarkdown: true, isAfterTax: false },
                            { label: 'AFTER TAX', field: '_afterTax', editable: false, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false, isAfterTax: true },
                          ]
                      ).map((bom) => {
                        const isEditingBom = editingField === `bom_${bom.field}`;
                        // Consumption in Kg is always derived, same as the precise section:
                        // width x gsm x consumption(meter) x 2.54 / 100000. Deriving it on every
                        // render (rather than only when an input changes) keeps rows saved under
                        // the old formula from showing a stale figure.
                        const isDerivedBomKg = bom.field === 'consumptionKg';
                        const bomLocked = (!isBodyCreatedPage && isFieldLocked(bom.field)) || isDerivedBomKg;
                        let val = bom.isMarkdown
                          ? markdown
                          : bom.isAfterTax
                          ? afterTax
                          : String(getValue(bom.field) ?? '').trim() || '—';
                        if (isDerivedBomKg) {
                          const num = (f: string) => parseFloat(String(getValue(f) ?? '')) || 0;
                          const kg = (num('width') * num('gsm') * num('consumptionMeter') * 2.54) / 100000;
                          val = kg > 0 ? kg.toFixed(4) : '—';
                        }
                        const isEmpty = val === '—';
                        const dropdownOptions: string[] = bom.isDropdown
                          ? bom.field === 'bodyConsumptionType'
                            ? ['Rough', 'Actual']
                            : []
                          : [];
                        return (
                          <div
                            key={bom.field}
                            data-field-label={bom.label}
                            data-item-id={item.id}
                            className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/40"
                            style={{
                              cursor: bom.editable && !bomLocked ? 'pointer' : 'default',
                              background: isEditingBom
                                ? '#e0f2fe'
                                : bom.mandatory && isEmpty && !bomLocked
                                ? '#fffbeb'
                                : undefined,
                            }}
                            onClick={() => {
                              if (bom.editable && !bomLocked && !isEditingBom) setEditingField(`bom_${bom.field}`);
                            }}
                          >
                            <span
                              className={cn('flex-1 truncate', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}
                              style={{
                                color: bom.mandatory && isEmpty && !isLocked ? '#dc2626' : '#374151',
                                fontWeight: bom.mandatory ? 600 : 400,
                              }}
                            >
                              {bom.mandatory && <span className="mr-0.5 text-red-500">*</span>}
                              {bom.label}
                            </span>
                            <div className="w-[100px] shrink-0 text-right">
                              {bom.field === 'width' && isBodyArticle && fabricConsumptionOptions.length > 0 ? (
                                <Popover
                                  open={isEditingBom}
                                  onOpenChange={(o) => { if (!o) setEditingField(null); }}
                                >
                                  <PopoverAnchor asChild>
                                    <span
                                      className={cn('flex items-center justify-end gap-1 text-right', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}
                                      style={{
                                        color: isEmpty ? '#9ca3af' : '#111827',
                                        fontStyle: isEmpty ? 'italic' : 'normal',
                                        fontWeight: 600,
                                      }}
                                    >
                                      <span className="truncate">{isEmpty ? (bomLocked ? '—' : 'Click') : val}</span>
                                      <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
                                    </span>
                                  </PopoverAnchor>
                                  {isEditingBom && (
                                    <PopoverContent
                                      className="w-44 p-0"
                                      align="end"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {!isEmpty && (
                                        <button
                                          type="button"
                                          onClick={() => { handleSave('width', null); setEditingField(null); }}
                                          className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                                        >
                                          <X className="h-3 w-3 shrink-0" />
                                          Clear selection
                                        </button>
                                      )}
                                      <div className="max-h-48 overflow-y-auto py-1">
                                        {fabricConsumptionOptions.map((opt) => (
                                          <button
                                            key={opt.fabWidth}
                                            type="button"
                                            onClick={() => {
                                              const w = opt.fabWidth ?? 0;
                                              const m = opt.fabConsumption ?? 0;
                                              const g = parseFloat(String(localValues['gsm'] !== undefined ? localValues['gsm'] : (item as any)['gsm']) || '') || 0;
                                              const updates: Record<string, string | null> = {
                                                width: String(w),
                                                consumptionMeter: String(m),
                                                consumptionKg: String(((w * g * m * 2.54) / 100000).toFixed(4)),
                                              };
                                              setLocalValues((prev) => ({ ...prev, ...updates }));
                                              setEditingField(null);
                                              onSave({ ...item, ...updates } as any, updates);
                                            }}
                                            className={cn(
                                              'flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                                              val === String(opt.fabWidth) && 'bg-accent/60',
                                            )}
                                          >
                                            <span className="font-medium">{opt.fabWidth}</span>
                                            <span className="text-[10px] text-muted-foreground">→ {opt.fabConsumption}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  )}
                                </Popover>
                              ) : bom.field === 'bodyConsumptionType' ? (
                                <Popover
                                  open={isEditingBom}
                                  onOpenChange={(o) => { if (!o) setEditingField(null); }}
                                >
                                  <PopoverAnchor asChild>
                                    <span
                                      className={cn('flex items-center justify-end gap-1 text-right', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}
                                      style={{
                                        color: isEmpty ? '#9ca3af' : '#111827',
                                        fontStyle: isEmpty ? 'italic' : 'normal',
                                        fontWeight: 600,
                                      }}
                                    >
                                      <span className="truncate">{isEmpty ? (bomLocked ? '—' : 'Click') : val}</span>
                                      <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
                                    </span>
                                  </PopoverAnchor>
                                  {isEditingBom && (
                                    <PopoverContent
                                      className="w-36 p-0"
                                      align="end"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {!isEmpty && (
                                        <button
                                          type="button"
                                          onClick={() => { handleSave(bom.field, null); setEditingField(null); }}
                                          className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                                        >
                                          <X className="h-3 w-3 shrink-0" />
                                          Clear selection
                                        </button>
                                      )}
                                      <div className="py-1">
                                        {dropdownOptions.map((opt) => (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => { handleSave(bom.field, opt); setEditingField(null); }}
                                            className={cn(
                                              'flex w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                                              val === opt && 'bg-accent/60',
                                            )}
                                          >
                                            <span className="font-medium">{opt}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  )}
                                </Popover>
                              ) : isEditingBom && bom.isColor ? (
                                <ColorSelect
                                  value={val === '—' ? null : val}
                                  options={masterColors}
                                  onPick={(code) => handleSave('colour', code)}
                                  onClose={() => setEditingField(null)}
                                />
                              ) : isEditingBom && bom.isDropdown ? (
                                <Select
                                  defaultValue={val === '—' ? undefined : val}
                                  onValueChange={(v) => handleSave(bom.field, v ?? null)}
                                >
                                  <SelectTrigger className={cn('h-6 w-full', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dropdownOptions.map((v) => (
                                      <SelectItem key={v} value={v}>
                                        {v}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : isEditingBom ? (
                                <Input
                                  autoFocus
                                  defaultValue={val === '—' ? '' : val}
                                  className={cn('h-6 px-1', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}
                                  onKeyDown={(e) =>
                                    e.key === 'Enter' &&
                                    handleSave(bom.field, (e.target as HTMLInputElement).value || null)
                                  }
                                  onBlur={(e) => handleSave(bom.field, e.target.value || null)}
                                />
                              ) : (
                                <span
                                  className={cn('block truncate', isBodyArticle ? 'text-[11px]' : 'text-[12px]')}
                                  style={{
                                    color: bom.isMarkdown
                                      ? '#7c3aed'
                                      : bom.mandatory && isEmpty && !isLocked
                                      ? '#ea580c'
                                      : isEmpty
                                      ? '#9ca3af'
                                      : '#111827',
                                    fontWeight: bom.isMarkdown ? 700 : 400,
                                    fontStyle: bom.mandatory && isEmpty && !isLocked ? 'italic' : 'normal',
                                  }}
                                >
                                  {bom.mandatory && isEmpty && !isLocked ? 'Required' : val}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* FG: the former BUSINESS card's attrs live here (OTH GRID-1),
                          led by Age Group → IMP ATBT → Fashion Type → Segment. */}
                      {!allowGroups && groupMap['BUSINESS'] &&
                        groupMap['BUSINESS'].attrs
                          .filter((a) => !FG_CARD_HIDDEN_SCHEMA_KEYS.has(a.schemaKey))
                          .sort((a, b) => {
                            const rank = (k: string) => {
                              const i = OTH_GRID_1_ORDER.indexOf(k);
                              return i === -1 ? OTH_GRID_1_ORDER.length : i;
                            };
                            return rank(a.schemaKey) - rank(b.schemaKey);
                          })
                          .map((a) => renderAttributeRow(a, false, true))}

                      {/* FG: cost summary under SEGMENT — read-only, from each card's saved values.
                          BODY = the CMP COST TOTAL row (BGT / ACT / VENDOR / FINAL PR VAL);
                          PKG COST = sum of its saved NET RATEs, in AUTO-BGT and ROUGH-V2 only. */}
                      {!allowGroups && (() => {
                        const COST_SOURCES: { label: string; title: string; fields: [string, string, string, string] }[] = [
                          { label: 'FAB', title: 'FAB card: AUTO-BGT / ROUGH-V2 / VENDOR COST / FINAL COST', fields: ['autoBgt', 'roughV2', 'vendorFabricRate', 'finalCost'] },
                          { label: 'BODY', title: 'CMP COST total: BGT / ACT / VENDOR / FINAL PR VAL', fields: ['totalBgtPrVal', 'totalActPrVal', 'totalVendorPrVal', 'totalFinalPrVal'] },
                          { label: 'B TRIM', title: 'B TRIM card TOTAL', fields: ['bTrimTotalAutoBgt', 'bTrimTotalRoughV2', 'bTrimTotalVdrCost', 'bTrimTotalFinalCost'] },
                          { label: 'V. ADD', title: 'V. ADD card TOTAL', fields: ['vaddTotalAutoBgt', 'vaddTotalRoughV2', 'vaddTotalVendorCost', 'vaddTotalFinalCost'] },
                        ];
                        const numOf = (field: string) => {
                          const v = getFieldVal(field);
                          const n = v == null ? NaN : Number(v);
                          return Number.isFinite(n) ? n : null;
                        };
                        const fmt = (n: number | null) =>
                          n == null ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        const rows = COST_SOURCES.map((s) => ({ label: s.label, title: s.title, vals: s.fields.map(numOf) }));
                        // PKG COST: saved NET RATE total goes to AUTO-BGT and ROUGH-V2; no VDR / FINAL.
                        const pkgRates = Object.values(PKG_RATE_FIELDS).map(numOf).filter((v): v is number => v != null);
                        const pkgTotal = pkgRates.length ? pkgRates.reduce((a, b) => a + b, 0) : null;
                        rows.push({ label: 'PKG COST', title: 'PKG COST: TOTAL NET RATE (saved tab)', vals: [pkgTotal, pkgTotal, null, null] });
                        const totals = [0, 1, 2, 3].map((i) => {
                          const vs = rows.map((r) => r.vals[i]).filter((v): v is number => v != null);
                          return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
                        });
                        const COLS = 'grid grid-cols-[110px_repeat(4,minmax(0,1fr))] gap-2';
                        return (
                          <div className="mx-1 mb-1 mt-2 overflow-hidden rounded-lg border border-slate-200" role="table" aria-label="Cost summary">
                            <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-extrabold tracking-[0.08em] text-slate-800">
                              COST SUMMARY
                            </div>
                            <div role="row" className={cn(COLS, 'px-2.5 py-1.5 text-[11px] font-bold tracking-wider text-slate-500')}>
                              <span role="columnheader">COST SOURCE</span>
                              {['AUTO-BGT', 'ROUGH-V2', 'VDR COST', 'FINAL COST'].map((h) => (
                                <span key={h} role="columnheader" className="text-right">{h}</span>
                              ))}
                            </div>
                            {rows.map((r) => (
                              <div key={r.label} role="row" className={cn(COLS, 'items-center border-t border-slate-100 px-2.5 py-1.5')} title={r.title}>
                                <span role="rowheader" className="text-[13px] font-bold text-slate-900">{r.label}</span>
                                {r.vals.map((v, i) => (
                                  <span key={i} role="cell" className={cn('text-right font-mono text-[13px] font-semibold tabular-nums', v == null ? 'text-slate-400' : 'text-slate-900')}>
                                    {fmt(v)}
                                  </span>
                                ))}
                              </div>
                            ))}
                            <div role="row" className={cn(COLS, 'items-center bg-[#1e293b] px-2.5 py-2 text-white')}>
                              <span role="rowheader" className="text-[13px] font-extrabold tracking-wider">TOTAL</span>
                              {totals.map((v, i) => (
                                <span key={i} role="cell" className="text-right font-mono text-[13.5px] font-extrabold tabular-nums">{fmt(v)}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>}

                  {/* PKG COST card — FG Articles, PKG tab only */}
                  {showPkgCard && (
                    <PkgCostCard
                      collapsed={isGroupCollapsed('PKG')}
                      onToggleCollapse={() => toggleGroupCollapse('PKG')}
                      locked={isLocked}
                      loadSavedRecord={loadFreshItem}
                      onSaveTab={(updates) => {
                        setLocalValues((prev) => ({ ...prev, ...updates }));
                        if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
                        else onSave({ ...item, ...updates } as any, updates);
                      }}
                    />
                  )}

                  {/* CMP COST card — FG Articles, BODY tab only */}
                  {showCmpCard && (
                    <CmpCostCard
                      collapsed={isGroupCollapsed('CMP')}
                      onToggleCollapse={() => toggleGroupCollapse('CMP')}
                      locked={isLocked}
                      bgtPreset={cmpBgtPreset}
                      actPreset={cmpActPreset}
                      savedPrVals={cmpSavedPrVals}
                      hasUnsavedPreset={cmpPresetUnsaved}
                      onSave={(updates) => {
                        setLocalValues((prev) => ({ ...prev, ...updates }));
                        if (isModifyMode) setPendingChanges((prev) => ({ ...prev, ...updates }));
                        else onSave({ ...item, ...updates } as any, updates);
                        setCmpPresetUnsaved(false);
                      }}
                    />
                  )}

                  {/* ROUGH CONSUMPTION card — FG Articles, BODY tab only */}
                  {!isBodyArticle && selectedGroupKeys.has('BODY') && (
                    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: CARD_THEME.border }}>
                      {renderCollapsibleHeader('ROUGH', 'ROUGH CONSUMPTION')}
                      <div className={cn('space-y-0 p-1', isGroupCollapsed('ROUGH') && 'hidden')}>
                        {([
                          { label: 'Ratio',               field: 'roughRatio' },
                          { label: 'Consumption in Kg',   field: 'roughConsumptionKg' },
                          { label: 'Consumption in Meter', field: 'roughConsumptionMeter' },
                        ] as { label: string; field: string }[]).map(({ label, field }) => {
                          const isEditingR = editingField === `rough_${field}`;
                          const rawVal = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
                          const displayVal = rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '' ? String(rawVal) : '—';
                          const isEmpty = displayVal === '—';
                          return (
                            <div
                              key={field}
                              className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 hover:bg-muted/40"
                              onClick={() => { if (!isEditingR) setEditingField(`rough_${field}`); }}
                            >
                              <span className="text-[12.5px] text-slate-600">{label}</span>
                              {isEditingR ? (
                                <input
                                  autoFocus
                                  type="number"
                                  className="w-24 rounded border border-border px-1 text-right text-[12.5px]"
                                  defaultValue={isEmpty ? '' : displayVal}
                                  onBlur={(e) => { handleSave(field, e.target.value || null); setEditingField(null); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingField(null); }}
                                />
                              ) : (
                                <span className="text-[12.5px]" style={{ color: isEmpty ? '#9ca3af' : '#111827' }}>{displayVal}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* PRECISE CONSUMPTION card — FG Articles, BODY tab only */}
                  {!isBodyArticle && selectedGroupKeys.has('BODY') && (
                    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: CARD_THEME.border }}>
                      {renderCollapsibleHeader('PRECISE', 'PRECISE CONSUMPTION')}
                      <div className={cn('space-y-0 p-1', isGroupCollapsed('PRECISE') && 'hidden')}>
                        {([
                          { label: 'Ratio',               field: 'preciseRatio' },
                          { label: 'Consumption in Kg',   field: 'preciseConsumptionKg' },
                          { label: 'Consumption in Meter', field: 'preciseConsumptionMeter' },
                        ] as { label: string; field: string }[]).map(({ label, field }) => {
                          const isEditingP = editingField === `fgprecise_${field}`;
                          const rawVal = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
                          const displayVal = rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '' ? String(rawVal) : '—';
                          const isEmpty = displayVal === '—';
                          return (
                            <div
                              key={field}
                              className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 hover:bg-muted/40"
                              onClick={() => { if (!isEditingP) setEditingField(`fgprecise_${field}`); }}
                            >
                              <span className="text-[12.5px] text-slate-600">{label}</span>
                              {isEditingP ? (
                                <input
                                  autoFocus
                                  type="number"
                                  className="w-24 rounded border border-border px-1 text-right text-[12.5px]"
                                  defaultValue={isEmpty ? '' : displayVal}
                                  onBlur={(e) => { handleSave(field, e.target.value || null); setEditingField(null); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingField(null); }}
                                />
                              ) : (
                                <span className="text-[12.5px]" style={{ color: isEmpty ? '#9ca3af' : '#111827' }}>{displayVal}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* PRECISE CONSUMPTION card — Body Articles only */}
                  {isBodyArticle && (
                    <div
                      className="overflow-hidden rounded-lg border bg-white"
                      style={{ borderColor: CARD_THEME.border }}
                    >
                      {renderCollapsibleHeader('PRECISE', 'PRECISE CONSUMPTION')}
                      <div className={cn('space-y-0 p-1', isGroupCollapsed('PRECISE') && 'hidden')}>
                        {(
                          [
                            { label: 'Width',            field: 'preciseWidth' },
                            { label: 'Gsm',              field: 'preciseGsm' },
                            { label: 'Ratio',            field: 'preciseRatio' },
                            { label: 'Consumption in Kg',     field: 'preciseConsumptionKg' },
                            { label: 'Consumption in Meter', field: 'preciseConsumptionMeter' },
                          ] as { label: string; field: string }[]
                        ).map(({ label, field }) => {
                          const isEditingPrecise = editingField === `precise_${field}`;
                          // Consumption in Kg is always derived:
                          // width x gsm x consumption(meter) x 2.54 / 100000
                          const isDerivedKg = field === 'preciseConsumptionKg';
                          const preciseLocked = (!isBodyCreatedPage && isFieldLocked(field)) || isDerivedKg;
                          let preciseVal = String(getValue(field) ?? '').trim() || '—';
                          if (isDerivedKg) {
                            const num = (f: string) => parseFloat(String(getValue(f) ?? '')) || 0;
                            const kg =
                              (num('preciseWidth') * num('preciseGsm') * num('preciseConsumptionMeter') * 2.54) /
                              100000;
                            preciseVal = kg > 0 ? kg.toFixed(4) : '—';
                          }
                          const preciseEmpty = preciseVal === '—';
                          return (
                            <div
                              key={field}
                              className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/40"
                              style={{ cursor: preciseLocked ? 'default' : 'pointer' }}
                              onClick={() => {
                                if (!preciseLocked && !isEditingPrecise) setEditingField(`precise_${field}`);
                              }}
                            >
                              <span className="flex-1 truncate text-[11px]" style={{ color: '#374151' }}>
                                {label}
                              </span>
                              <div className="w-[100px] shrink-0 text-right">
                                {isEditingPrecise ? (
                                  <Input
                                    autoFocus
                                    defaultValue={preciseEmpty ? '' : preciseVal}
                                    className="h-6 px-1 text-[11px]"
                                    onKeyDown={(e) =>
                                      e.key === 'Enter' &&
                                      handleSave(field, (e.target as HTMLInputElement).value || null)
                                    }
                                    onBlur={(e) => handleSave(field, e.target.value || null)}
                                  />
                                ) : (
                                  <span
                                    className="block truncate text-[11px]"
                                    style={{ color: preciseEmpty ? '#9ca3af' : '#111827' }}
                                  >
                                    {preciseVal}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  {effectiveMajCat ? `No attributes defined for ${effectiveMajCat}` : 'No major category set.'}
                </div>
              )}
            </section>

          </div>

          {/* ─── Variants section ─── */}
          {item.isGeneric && (
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => setShowVariants((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-1.5 transition-colors hover:brightness-95"
                style={{ background: showVariants ? '#e2e8f0' : '#f8fafc' }}
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <Users className="h-3.5 w-3.5" />
                  Variants
                </span>
                <span className="text-[11px] text-muted-foreground">{showVariants ? '▲ Hide' : '▼ Show'}</span>
              </button>
              {showVariants && (
                <VariantSubTable
                  genericId={item.id}
                  genericRecord={item}
                  onRefresh={onRefresh}
                  pathType={pathType}
                  refreshKey={variantRefreshKey}
                />
              )}
            </div>
          )}

          {/* ─── Tip footer ─── */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-slate-50/70 px-3 py-1 text-[10.5px] text-slate-500">
            <Info className="h-3 w-3 text-amber-500" />
            <span>
              {isModifyMode
                ? 'Click any value to edit, then press “Modify” to push your changes to SAP. Use ◀ / ▶ to move between articles.'
                : 'Click any value to edit — all changes are saved automatically. Use ◀ / ▶ to move between articles.'}
            </span>
          </div>
        </div>

        {/* Image preview */}
        <Dialog
          open={imgModalOpen}
          onOpenChange={(o) => {
            setImgModalOpen(o);
            if (!o) resetImageView();
          }}
        >
          <DialogContent className="w-auto max-w-[92vw] p-0">
            <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-2">
              <DialogTitle className="truncate text-sm">{item.imageName || 'Image Preview'}</DialogTitle>
              {/* Zoom + rotate controls */}
              <div className="mr-8 flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                  aria-label="Zoom out"
                  disabled={imgZoom <= 0.25}
                >
                  <Minus />
                </Button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                  {Math.round(imgZoom * 100)}%
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setImgZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                  aria-label="Zoom in"
                  disabled={imgZoom >= 4}
                >
                  <Plus />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="ml-1 h-7 w-7"
                  onClick={() => setImgRotation((r) => (r + 90) % 360)}
                  aria-label="Rotate 90°"
                >
                  <RotateCw />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-1 h-7 px-2 text-xs"
                  onClick={resetImageView}
                  disabled={imgZoom === 1 && imgRotation === 0}
                >
                  Reset
                </Button>
              </div>
            </DialogHeader>
            <div
              ref={panRef}
              onMouseDown={onPanMouseDown}
              className={`flex overflow-auto p-4 ${
                imgZoom > 1 ? (isImgPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
              // Fixed to the image's 100%-zoom footprint (plus padding, via border-box)
              // so the dialog stays the same size at every zoom level — zooming scrolls
              // within this frame instead of growing it.
              //
              // "safe center" degrades to plain "center" in browsers that don't support
              // it — but plain centering of overflowing flex content can make the start
              // edge unreachable by scroll, which is the other half of the "can't reach
              // the top" bug. "safe" keeps it centered until it overflows, then falls
              // back to start-aligned so every edge stays reachable.
              style={{
                width: imgFrameWidth ? imgFrameWidth + IMG_VIEWER_PADDING * 2 : undefined,
                height: imgFrameHeight ? imgFrameHeight + IMG_VIEWER_PADDING * 2 : undefined,
                maxWidth: '85vw',
                maxHeight: '80vh',
                alignItems: 'safe center',
                justifyContent: 'safe center',
              } as React.CSSProperties}
            >
              <img
                src={shownImgUrl || ''}
                alt={item.imageName || 'preview'}
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
                }}
                className="block shrink-0 transition-[width,height,transform] duration-200 will-change-transform"
                style={
                  imgBoxWidth && imgBoxHeight
                    ? {
                        width: imgBoxWidth,
                        height: imgBoxHeight,
                        // Tailwind Preflight sets `img { max-width: 100% }`, which would
                        // cap the zoomed width at the dialog's width while the height grew
                        // freely — distorting the box so `object-fit: contain` letterboxed
                        // the image with empty bands instead of actually zooming it.
                        maxWidth: 'none',
                        maxHeight: 'none',
                        objectFit: 'contain',
                        transform: `rotate(${imgRotation}deg)`,
                        transformOrigin: 'center',
                      }
                    : {
                        maxWidth: '85vw',
                        maxHeight: '75vh',
                        objectFit: 'contain',
                        transform: `scale(${imgZoom}) rotate(${imgRotation}deg)`,
                        transformOrigin: 'center',
                      }
                }
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Duplicate — asks for Design Number before creating the copy */}
        <Dialog open={dupConfirmOpen} onOpenChange={(o) => { if (!duplicating) { setDupConfirmOpen(o); if (!o) setDupDesignNo(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate Article</DialogTitle>
            </DialogHeader>
            <p className="m-0 text-sm text-muted-foreground">
              A new copy of this article will be created with all the same values.
              Enter a Design Number for the duplicate article.
            </p>
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Design Number <span className="text-red-500">*</span>
              </label>
              <Input
                autoFocus
                placeholder="Enter design number…"
                value={dupDesignNo}
                onChange={(e) => setDupDesignNo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !duplicating && dupDesignNo.trim() && (async () => {
                  setDuplicating(true);
                  try { await onDuplicate(item, dupDesignNo.trim()); }
                  catch (err) { message.error(err instanceof Error ? err.message : 'Failed to duplicate article'); }
                  finally { setDuplicating(false); setDupConfirmOpen(false); setDupDesignNo(''); }
                })()}
                disabled={duplicating}
              />
              {dupDesignNo.trim() === '' && dupConfirmOpen && (
                <p className="text-xs text-red-500">Design Number is required.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDupConfirmOpen(false); setDupDesignNo(''); }} disabled={duplicating}>
                Cancel
              </Button>
              <Button
                disabled={duplicating || dupDesignNo.trim() === ''}
                onClick={async () => {
                  setDuplicating(true);
                  try {
                    await onDuplicate(item, dupDesignNo.trim());
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : 'Failed to duplicate article');
                  } finally {
                    setDuplicating(false);
                    setDupConfirmOpen(false);
                    setDupDesignNo('');
                  }
                }}
              >
                {duplicating ? 'Duplicating…' : 'Duplicate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Fabric Article confirmation (modify mode) */}
        <Dialog open={!!fabConfirmItem && !fabricCreating} onOpenChange={(o) => { if (!o && !fabricCreating) setFabConfirmItem(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-sky-500" />
                Create Fabric Article
              </DialogTitle>
            </DialogHeader>
            <p className="m-0">
              Create fabric article for &quot;{fabConfirmItem?.articleNumber || fabConfirmItem?.imageName || fabConfirmItem?.id}&quot;?
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFabConfirmItem(null)} disabled={fabricCreating}>
                Cancel
              </Button>
              <Button
                disabled={fabricCreating}
                className="bg-[#FF6F61] hover:bg-[#e85d50] text-white"
                onClick={async () => {
                  if (!fabConfirmItem) return;
                  const mergedItem = fabConfirmItem;
                  setFabricCreating(true);
                  try {
                    const token = localStorage.getItem('authToken');
                    // Send current UI values as overrides so the backend builds the fabric
                    // article from the screen values, not the (potentially stale) DB row.
                    // Keys match extraction_results_flat column names.
                    const overrides: Record<string, unknown> = {
                      fabricArticleDescription: mergedItem.fabricArticleDescription ?? null,
                      vendorFabricRate:         mergedItem.vendorFabricRate ?? null,
                      fabDiv:                   (mergedItem as any).fabDiv ?? null,
                      yarn1:                    (mergedItem as any).yarn1 ?? null,
                      mainMvgr:                 (mergedItem as any).mainMvgr ?? null,
                      fabricMainMvgr:           (mergedItem as any).fabricMainMvgr ?? null,
                      fConstruction:            (mergedItem as any).fConstruction ?? null,
                      fOunce:                   (mergedItem as any).fOunce ?? null,
                      fWidth:                   (mergedItem as any).fWidth ?? null,
                      mFab2:                    (mergedItem as any).mFab2 ?? null,
                      fCount:                   (mergedItem as any).fCount ?? null,
                      weave:                    (mergedItem as any).weave ?? null,
                      composition:              (mergedItem as any).composition ?? null,
                      finish:                   (mergedItem as any).finish ?? null,
                      gsm:                      (mergedItem as any).gsm ?? null,
                      lycra:                    (mergedItem as any).lycra ?? null,
                    };
                    // Create fabric article; skipFlatUpdate so fabricArticleNumber is NOT
                    // written to DB yet — it is staged here and saved only when Modify is clicked.
                    const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/create-fabric-article`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ ids: [item.id], submitNow: true, skipFlatUpdate: true, overrides }),
                    });
                    const data = await r.json();
                    if (!r.ok) {
                      if (data.fabricArticleNumber) {
                        handleSave('fabricArticleNumber', String(data.fabricArticleNumber));
                        message.success(`Fabric Article already exists: ${data.fabricArticleNumber} — auto-filled. Click Modify to save.`);
                      } else {
                        message.error(data.error || 'Failed to create fabric article');
                      }
                      return;
                    }
                    const result = data.results?.[0];
                    if (result?.success && result?.sapArticleNumber) {
                      handleSave('fabricArticleNumber', result.sapArticleNumber);
                      message.success(`Fabric article created: ${result.sapArticleNumber}. Click Modify to save.`);
                    } else if (result && !result.success) {
                      message.error(`Fabric article created but SAP sync failed: ${result.message || 'Unknown error'}`);
                    }
                  } finally {
                    setFabricCreating(false);
                    setFabConfirmItem(null);
                  }
                }}
              >
                {fabricCreating ? 'Creating...' : 'Create Fabric Article'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);

ArticleCard.displayName = 'ArticleCard';

// ── List ─────────────────────────────────────────────────────────────────────
export const ApproverArticleList: React.FC<ApproverArticleListProps> = ({
  items,
  loading,
  selectedRowKeys,
  onSelectionChange,
  onSave,
  onCreateFabricArticle,
  onCreateBodyArticle,
  onProceedFGArticle,
  onModify,
  onRefresh,
  pathType,
  allowGroups,
  hideCreateBody,
  joinTop,
  readOnly,
  attributeMajorCategory,
  serverPagination,
}) => {
  const visibleCardGroups = allowGroups
    ? ATTRIBUTE_GROUPS.filter((g) => allowGroups.includes(g.group))
    : ATTRIBUTE_GROUPS;

  const handleToggleSelect = useCallback(
    (id: string) => {
      onSelectionChange(
        selectedRowKeys.includes(id) ? selectedRowKeys.filter((k) => k !== id) : [...selectedRowKeys, id],
      );
    },
    [selectedRowKeys, onSelectionChange],
  );

  const handleToggleAll = useCallback(() => {
    const ids = items.filter((i) => i.approvalStatus !== 'REJECTED').map((i) => i.id);
    const allOn = ids.every((id) => selectedRowKeys.includes(id));
    onSelectionChange(allOn ? [] : ids);
  }, [items, selectedRowKeys, onSelectionChange]);

  const handleDuplicate = useCallback(
    async (item: ApproverItem, designNumber: string): Promise<void> => {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${item.id}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ designNumber }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to duplicate article');
      }
      message.success('Article duplicated successfully');
      onRefresh();
    },
    [onRefresh],
  );

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (items.length === 0) {
    return <div className="py-16 text-center text-muted-foreground">No articles found.</div>;
  }

  const eligibleIds = items.filter((i) => i.approvalStatus !== 'REJECTED').map((i) => i.id);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedRowKeys.includes(id));

  return (
    <div>
      {items.map((item) => (
        <ArticleCard
          key={item.id}
          item={item}
          isSelected={selectedRowKeys.includes(item.id)}
          onToggleSelect={handleToggleSelect}
          onSave={onSave}
          onCreateFabricArticle={onCreateFabricArticle}
          onCreateBodyArticle={onCreateBodyArticle}
          onProceedFGArticle={onProceedFGArticle}
          onDuplicate={handleDuplicate}
          onModify={onModify}
          onRefresh={onRefresh}
          cardGroups={visibleCardGroups}
          pathType={pathType}
          allowGroups={allowGroups}
          hideCreateBody={hideCreateBody}
          joinTop={joinTop}
          readOnly={readOnly}
          attributeMajorCategory={attributeMajorCategory}
        />
      ))}
    </div>
  );
};
