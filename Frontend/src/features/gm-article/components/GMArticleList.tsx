import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FileText,
  LayoutGrid,
  Rocket,
  Info,
  Users,
  Copy,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Plus,
  Minus,
  RotateCw,
  Search,
  Wand2,
  X,
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
import type { ApproverItem, MasterAttribute } from './GMArticleTable';
import {
  SCHEMA_KEY_TO_EXCEL_ATTR,
  SCHEMA_KEY_TO_DB_FIELD,
  SAP_NAME_TO_SCHEMA_KEY,
  normalizeMajorCategory,
} from '../../../data/majCatAttributeMap';
import { getMajorCategoriesByDivision, getMcCodeByMajorCategory } from '../../../data/majorCategoryMcCodeMap';
import {
  preloadAttributeValues,
  getCachedValues,
  isValuesCached,
  preloadAttributeGroups,
  getCachedAttributeGroups,
  preloadCategoryAttributes,
  getCachedCategoryAttributes,
  invalidateValuesCache,
  preloadMajCatGridFor,
  isMajCatGridLoadedFor,
  getMajCatGridEntry,
  isMajCatInGrid,
  preloadMandatoryGridFor,
  isMandatoryGridLoadedFor,
  isMandatoryGridFieldActive,
  isMajCatInMandatoryGrid,
  preloadGMGridFor,
  getCachedGMGrid,
  type GmGridAttr,
} from '../../../services/articleConfigService';
import { getImageUrl } from '../../../shared/utils/common/helpers';
import { APP_CONFIG } from '../../../constants/app/config';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import GMVariantSubTable from './GMVariantSubTable';
import GMArticleVariantSubTable from './GMArticleVariantSubTable';

// Module-level BOM cache (shared across card instances)
const bomCache = new Map<string, Promise<Record<string, Record<string, string>>>>();

// Module-level fabric grid values cache — fetched once for all cards
// Shape: { [excelAttrName: string]: { code: string; fullForm: string }[] }
// e.g. { M_FAB_DIV: [{code:'K', fullForm:'KNIT'}, ...], M_YARN: [...], ... }
type FabGridValues = Record<string, { code: string; fullForm: string }[]>;
let fabricGridPromise: Promise<FabGridValues> | null = null;
const fetchFabricGridValues = (): Promise<FabGridValues> => {
  if (!fabricGridPromise) {
    const token = localStorage.getItem('authToken');
    fabricGridPromise = fetch(`${APP_CONFIG.api.baseURL}/approver/fabric-grid-values`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((res) => (res?.data as FabGridValues) ?? {})
      .catch(() => ({}));
  }
  return fabricGridPromise;
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

const fetchBomMap = (category: string): Promise<Record<string, Record<string, string>>> => {
  const existing = bomCache.get(category);
  if (existing) return existing;
  const token = localStorage.getItem('authToken');
  const p = fetch(`${APP_CONFIG.api.baseURL}/approver/bom-art-numbers/${encodeURIComponent(category)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((r) => r.json())
    .then((res) => (res?.data as Record<string, Record<string, string>>) ?? {})
    .catch(() => ({}));
  bomCache.set(category, p);
  return p;
};

const f = (schemaKey: string) => SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey] ?? schemaKey;

type GmFamilyAttr = { code: string; name: string; values: string[]; mandatory: boolean };

const gmGridAttrToFamilyAttr = (a: GmGridAttr): GmFamilyAttr => ({
  code: a.familyCode,
  name: a.familyName,
  values: a.values,
  mandatory: a.mandatory,
});

// GM grid attributes are dynamic per major category. When the grid has no
// readable family name, derive one from the code: GM_LENGTH_CM → "Length (cm)".
const UNIT_SUFFIX: Record<string, string> = { CM: '(cm)', MM: '(mm)', G: '(g)', KG: '(kg)', ML: '(ml)' };
const labelFromCode = (code: string): string => {
  const parts = code.replace(/^GM_/i, '').split('_').filter(Boolean);
  const unit = parts.length > 1 ? UNIT_SUFFIX[parts[parts.length - 1].toUpperCase()] : undefined;
  const text = (unit ? parts.slice(0, -1) : parts)
    .map((w) => (w.toUpperCase() === 'UOM' ? 'UOM' : w.toLowerCase()))
    .join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) + (unit ? ` ${unit}` : '') : code;
};
const gmAttrLabel = (a: GmFamilyAttr): string =>
  a.name && a.name.trim() && a.name !== a.code ? a.name : labelFromCode(a.code);

const RequiredMark = () => <span className="ml-0.5 text-red-500">*</span>;


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
]);

// Schema keys hidden from the article card entirely (display-only — the values
// are still extracted, stored, and sent to SAP). Shade & Weight were removed
// from the card on all approver pages by request.
const HIDDEN_CARD_SCHEMA_KEYS = new Set([
  'shade',
  'weight',
]);

const ATTRIBUTE_GROUPS: { group: string; color: string; fields: { field: string; schemaKey: string; freeText?: boolean }[] }[] = [
  {
    group: 'FAB',
    color: '#e6f4ff',
    fields: [
      { field: 'fabDiv', schemaKey: 'fab_div' },
      { field: 'yarn1', schemaKey: 'yarn_01' },
      { field: 'mainMvgr', schemaKey: 'main_mvgr' },
      { field: 'fabricMainMvgr', schemaKey: 'fabric_main_mvgr' },
      { field: 'fConstruction', schemaKey: 'f_construction' },
      { field: 'fWidth', schemaKey: 'f_width' },
      { field: 'mFab2', schemaKey: 'm_fab2' },
      { field: 'fCount', schemaKey: 'f_count' },
      { field: 'weave', schemaKey: 'weave' },
      { field: 'composition', schemaKey: 'composition' },
      { field: 'finish', schemaKey: 'finish' },
      { field: 'gsm', schemaKey: 'gsm' },
      { field: 'lycra', schemaKey: 'lycra_non_lycra' },
      { field: 'fabVdr', schemaKey: 'fab_vdr' },
      { field: 'fOunce', schemaKey: 'f_ounce' },
      { field: 'shade', schemaKey: 'shade', freeText: true },
      { field: 'weight', schemaKey: 'weight', freeText: true },
    ],
  },
];

// REFERENCE ARTICLE DESC source fields, in the user-confirmed sequence.
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

const GROUP_COLORS: Record<string, string> = {
  FAB: '#e6f4ff',
};
const GROUP_ORDER = ['FAB'];

// Construction & Fabric (FAB): full canonical field order — matches FG Articles
// New Articles page so every user sees the same sequence regardless of backend order.
const FAB_PRIORITY_KEYS = [
  'fab_div',          // M_FAB_DIV
  'yarn_01',          // M_YARN
  'main_mvgr',        // M_FAB_MAIN_MVGR_1
  'fabric_main_mvgr', // M_FAB_MAIN_MVGR_2
  'f_construction',   // M_CONSTRUCTION
  'f_width',          // M_WIDTH
  'm_fab2',           // M_WEAVE_02
  'f_count',          // M_COUNT
  'weave',            // M_WEAVE_01
  'composition',      // M_COMPOSITION
  'finish',           // M_FINISH
  'gsm',              // M_GSM
  'lycra_non_lycra',  // M_LYCRA
];

type CardGroup = typeof ATTRIBUTE_GROUPS[number];

function buildCardGroups(entries: { key: string; type: string; group: string }[]): CardGroup[] {
  const map = new Map<string, CardGroup['fields']>();
  for (const e of entries) {
    if (BOM_ONLY_SCHEMA_KEYS.has(e.key)) continue; // belongs to BOM, not attribute groups
    if (HIDDEN_CARD_SCHEMA_KEYS.has(e.key)) continue; // hidden from card (e.g. shade, weight)
    const dbField = SCHEMA_KEY_TO_DB_FIELD[e.key];
    if (!dbField) continue;
    if (!map.has(e.group)) map.set(e.group, []);
    map.get(e.group)!.push({ field: dbField, schemaKey: e.key, freeText: e.type === 'TEXT' ? true : undefined });
  }
  const built = GROUP_ORDER.filter((g) => map.has(g)).map((g) => {
    let fields = map.get(g)!;
    if (g === 'FAB' || g === 'FABRIC') {
      // Pin the priority keys to the top in FAB_PRIORITY_KEYS order; all other
      // fields keep their existing relative order (Array.sort is stable).
      const rank = (k: string) => {
        const i = FAB_PRIORITY_KEYS.indexOf(k);
        return i === -1 ? FAB_PRIORITY_KEYS.length : i;
      };
      fields = [...fields].sort((a, b) => rank(a.schemaKey) - rank(b.schemaKey));
    }
    return {
      group: g,
      color: GROUP_COLORS[g] || '#f0f0f0',
      fields,
    };
  });
  return built.length > 0 ? built : ATTRIBUTE_GROUPS.filter((g) => GROUP_ORDER.includes(g.group));
}

export interface ApproverArticleListProps {
  items: ApproverItem[];
  majorCategory: string;
  loading: boolean;
  selectedRowKeys: React.Key[];
  onSelectionChange: (keys: React.Key[]) => void;
  onEdit: (item: ApproverItem) => void;
  onSave: (item: ApproverItem, updates: Record<string, unknown>, options?: { silent?: boolean }) => void;
  onCreateFabricArticle: (item: ApproverItem) => void;
  onCreateBodyArticle: (item: ApproverItem) => void;
  onProceedFGArticle: (item: ApproverItem) => void;
  onDuplicate: (item: ApproverItem) => Promise<void>;
  /**
   * Modify an already-created (SAP-synced) article. Receives only the changed
   * fields. Used by the "Modify" button on the Created Articles page; pushes to
   * SAP first and persists locally only on success. Optional — pages that don't
   * support modify (new/old/rejected) simply omit it and the button is hidden.
   */
  onModify?: (item: ApproverItem, changes: Record<string, unknown>) => Promise<void>;
  attributes: MasterAttribute[];
  onRefresh: () => void;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
  hideGroups?: string[];
  fabHierarchy?: {
    divisions: string[];
    subDivsByDiv: Record<string, string[]>;
    majCatsBySubDiv: Record<string, string[]>;
    mcDesByMajCat: Record<string, string[]>;
  };
  /** When true, always use the static ATTRIBUTE_GROUPS definition instead of the API-built card groups. */
  forceStaticGroups?: boolean;
  /** When true, hides the "Create Body Article" button (e.g. on the Body Article detail page) */
  hideCreateBody?: boolean;
  /** When true, hides reference/article-desc fields and renames Article Number to Fabric Article Number. */
  isFGMode?: boolean;
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
    attributes,
    onRefresh,
    cardGroups,
    pathType,
    hideGroups,
    isFGMode,
    fabHierarchy,
  }: {
    item: ApproverItem;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    onSave: (item: ApproverItem, updates: Record<string, unknown>, options?: { silent?: boolean }) => void;
    onCreateFabricArticle: (item: ApproverItem) => void;
    onCreateBodyArticle: (item: ApproverItem) => void;
    onProceedFGArticle: (item: ApproverItem) => void;
    onDuplicate: (item: ApproverItem) => Promise<void>;
    onModify?: (item: ApproverItem, changes: Record<string, unknown>) => Promise<void>;
    attributes: MasterAttribute[];
    onRefresh: () => void;
    cardGroups: CardGroup[];
    pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
    hideGroups?: string[];
    isFGMode?: boolean;
    fabHierarchy?: {
      divisions: string[];
      subDivsByDiv: Record<string, string[]>;
      majCatsBySubDiv: Record<string, string[]>;
      mcDesByMajCat: Record<string, string[]>;
    };
  }) => {
    const [showVariants, setShowVariants] = useState(item.source === 'SRM');
    const [imgModalOpen, setImgModalOpen] = useState(false);
    const [localValues, setLocalValues] = useState<Record<string, string | null>>({});
    const [dupConfirmOpen, setDupConfirmOpen] = useState(false);
    const autoSavedFabDescRef = useRef<string | null>(null);
    const [duplicating, setDuplicating] = useState(false);
    const [imgZoom, setImgZoom] = useState(1);
    const [imgRotation, setImgRotation] = useState(0);
    // Search term for every dropdown on the card. A single shared term is
    // enough because only one dropdown (editingField) is open at a time.
    const [attrSearch, setAttrSearch] = useState('');

    // ── Created-page "Modify" flow ──────────────────────────────────────────
    // On the Created page, articles are already APPROVED + SAP-synced. We keep
    // them editable, but stage edits as `pendingChanges` instead of auto-saving;
    // the user then clicks "Modify" to push the diff to SAP (and only then the DB).
    const isModifyMode = pathType === 'created' && !!onModify;
    const [pendingChanges, setPendingChanges] = useState<Record<string, string | null>>({});
    const [modifying, setModifying] = useState(false);

    const resetImageView = useCallback(() => {
      setImgZoom(1);
      setImgRotation(0);
    }, []);

    const prevItemRef = React.useRef<ApproverItem>(item);
    React.useEffect(() => {
      const prev = prevItemRef.current;
      prevItemRef.current = item;
      if (prev === item) return;
      setLocalValues((local) => {
        const next: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(local)) {
          const itemVal = (item as any)[k] ?? null;
          const strItemVal = itemVal === null ? null : String(itemVal);
          if (strItemVal !== (v === null ? null : String(v ?? ''))) {
            // server wins
          } else {
            next[k] = v;
          }
        }
        return next;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item]);

    const effectiveMajCat = useMemo(() => {
      const raw = (localValues['majorCategory'] !== undefined ? localValues['majorCategory'] : item.majorCategory) || '';
      return normalizeMajorCategory(raw, item.division);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localValues['majorCategory'], item.majorCategory, item.division]);

    // Segment ranges for the current major category — auto-filled when MRP or MC changes
    const [segmentRanges, setSegmentRanges] = useState<SegmentRange[]>([]);
    const segmentRangesRef = useRef<SegmentRange[]>([]);
    segmentRangesRef.current = segmentRanges;

    useEffect(() => {
      if (!effectiveMajCat) return;
      fetchSegmentRangesFor(effectiveMajCat).then((ranges) => setSegmentRanges(ranges));
    }, [effectiveMajCat]);

    // Auto-correct segment when ranges first load (fixes articles saved before this feature)
    useEffect(() => {
      if (segmentRanges.length === 0) return;
      if (item.approvalStatus !== 'PENDING') return;
      const mrpVal = String((localValues['rate'] !== undefined ? localValues['rate'] : item.rate) ?? '');
      const expected = computeSegmentFromMrp(mrpVal, segmentRanges);
      if (!expected) return;
      const current = String((localValues['segment'] !== undefined ? localValues['segment'] : item.segment) ?? '');
      if (expected === current) return;
      setLocalValues((prev) => ({ ...prev, segment: expected }));
      if (!isModifyMode) {
        onSave({ ...item, segment: expected } as ApproverItem, { segment: expected } as Record<string, unknown>, { silent: true });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segmentRanges]);

    const [cacheReady, setCacheReady] = useState(false);
    const [catConfigReady, setCatConfigReady] = useState(false);
    // Tracks when the major-category grid JSON (for THIS article's category) has loaded
    const [gridReady, setGridReady] = useState(() => isMajCatGridLoadedFor(effectiveMajCat));
    // Tracks when the mandatory grid (for THIS article's category) has loaded
    const [mandatoryGridReady, setMandatoryGridReady] = useState(() => isMandatoryGridLoadedFor(effectiveMajCat));
    // Fabric attribute grid values from fabric_maj_cat_grid_values table
    const [fabricGrid, setFabricGrid] = useState<FabGridValues>({});
    const [fabricGridReady, setFabricGridReady] = useState(false);

    // GM attribute grid values for this article's major category
    const [gmFamilyAttrs, setGmFamilyAttrs] = useState<GmFamilyAttr[]>([]);
    const [gmGridLoaded, setGmGridLoaded] = useState(false);
    useEffect(() => {
      if (!effectiveMajCat) { setGmFamilyAttrs([]); setGmGridLoaded(true); return; }
      setGmGridLoaded(false);
      preloadGMGridFor(effectiveMajCat)
        .then((attrs) => setGmFamilyAttrs(attrs.map(gmGridAttrToFamilyAttr)))
        .catch(() => setGmFamilyAttrs([]))
        .finally(() => setGmGridLoaded(true));
    }, [effectiveMajCat]);

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
      if (!effectiveMajCat) return { visibleAttrs: [], mandatoryKeys: new Set<string>() };

      const visible: Array<{
        field: string;
        label: string;
        schemaKey: string;
        group: string;
        groupColor: string;
        values: AttrValue[];
        freeText: boolean;
        isMandatory: boolean;
      }> = [];
      const mandatory = new Set<string>();

      // At least one grid must be ready before we apply filtering.
      const gridsReady = gridReady || mandatoryGridReady;

      // Graceful degradation: if the major category has NO entries in EITHER grid
      // (e.g. not yet configured in the admin panel), fall back to showing ALL fields.
      // Uses direct category key-existence checks — reliable regardless of field name variations.
      const catHasAnyGridData =
        gridsReady &&
        ((mandatoryGridReady && isMajCatInMandatoryGrid(effectiveMajCat)) ||
          (gridReady && isMajCatInGrid(effectiveMajCat)));

      for (const af of attributeFields) {
        // BOM-only fields never appear in attribute groups
        if (BOM_ONLY_SCHEMA_KEYS.has(af.schemaKey)) continue;
        // Fields explicitly hidden from the card (shade, weight)
        if (HIDDEN_CARD_SCHEMA_KEYS.has(af.schemaKey)) continue;

        // freeText fields (shade, weight, segment…) are always visible.
        // They CAN be mandatory if the mandatory grid marks them as active — check the grid.
        if (af.freeText) {
          const sapKeys = SCHEMA_KEY_TO_ALL_SAP_KEYS[af.schemaKey] ?? [];
          const isMandatory =
            gridsReady &&
            !!catHasAnyGridData &&
            mandatoryGridReady &&
            sapKeys.some((sk) => isMandatoryGridFieldActive(effectiveMajCat, sk) === true);
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
          });
          continue;
        }

        // Dropdown values come STRICTLY from the Maj-Cat Grid (maj_cat_grid_values).
        // No global / division-level (attribute_allowed_values) fallback — if the
        // grid has no values for this category+attribute the dropdown stays empty
        // (and the field is hidden unless the mandatory grid forces it).
        const gridExcelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[af.schemaKey];
        // FAB group: values come from fabric_maj_cat_grid_values (universal, not per-major-category)
        // Other groups: values come from the garment maj_cat_grid per major category
        const fabGridVals = af.group === 'FAB' && gridExcelAttr && fabricGridReady
          ? (fabricGrid[gridExcelAttr] ?? null)
          : null;
        const gridOnlyVals = fabGridVals ?? (gridExcelAttr ? getMajCatGridEntry(effectiveMajCat, gridExcelAttr) : null);
        const values: AttrValue[] = fabGridVals
          ? fabGridVals.map((v) => ({ shortForm: v.code, fullForm: v.fullForm }))
          : (gridOnlyVals ?? []).map((v) => ({ shortForm: v as string, fullForm: v as string }));

        if (gridsReady && catHasAnyGridData) {
          // ── Grids loaded AND category is configured: apply 3-tier filtering ──
          // Check ALL SAP key aliases — uploaded Excel may use any variant
          const sapKeys = SCHEMA_KEY_TO_ALL_SAP_KEYS[af.schemaKey] ?? [];
          const isActiveMandatory =
            mandatoryGridReady &&
            sapKeys.some((sk) => isMandatoryGridFieldActive(effectiveMajCat, sk) === true);

          const excelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[af.schemaKey];
          const hasDropdownValues =
            gridReady && excelAttr ? (getMajCatGridEntry(effectiveMajCat, excelAttr)?.length ?? 0) > 0 : false;

          if (isActiveMandatory) {
            // TIER 1: Mandatory — bold + * in card, required for approve
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
            });
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
            });
          }
          // TIER 3: Neither → skip (completely hidden for configured categories)
        } else {
          // ── Grids not yet loaded OR category has no grid data: graceful fallback ──
          visible.push({
            field: af.field,
            label: af.label,
            schemaKey: af.schemaKey,
            group: af.group,
            groupColor: af.groupColor,
            values,
            freeText: false,
            isMandatory: false,
          });
        }
      }

      return { visibleAttrs: visible, mandatoryKeys: mandatory };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveMajCat, cacheReady, catConfigReady, gridReady, mandatoryGridReady, attributeFields, localValues, fabricGrid, fabricGridReady]);

    const [editingField, setEditingField] = useState<string | null>(null);

    // Vendor autocomplete state
    const [vendorQuery, setVendorQuery] = useState('');
    const [vendorOptions, setVendorOptions] = useState<AutocompleteOption[]>([]);
    const [vendorSearching, setVendorSearching] = useState(false);
    const vendorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [attrArticleNums, setAttrArticleNums] = useState<Record<string, string>>(() => {
      try {
        return JSON.parse((item as any).attrArticleNums || '{}');
      } catch {
        return {};
      }
    });
    const [bomMap, setBomMap] = useState<Record<string, Record<string, string>>>({});

    useEffect(() => {
      if (!item.division) return;
      if (isValuesCached(item.division) && getCachedValues(item.division, 'impAtrbt2') === null) {
        invalidateValuesCache(item.division);
      }
      preloadAttributeValues(item.division)
        .then(() => setCacheReady(true))
        .catch(() => setCacheReady(true));
    }, [item.division]);

    useEffect(() => {
      if (!effectiveMajCat) return;
      if (getCachedCategoryAttributes(effectiveMajCat)) {
        setCatConfigReady(true);
        return;
      }
      preloadCategoryAttributes(effectiveMajCat)
        .then(() => setCatConfigReady(true))
        .catch(() => setCatConfigReady(true));
    }, [effectiveMajCat]);

    // Fetch fabric attribute grid values (M_FAB_DIV, M_YARN, etc.) from fabric_maj_cat_grid_values
    useEffect(() => {
      fetchFabricGridValues().then((grid) => {
        setFabricGrid(grid);
        setFabricGridReady(true);
      });
    }, []);

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

    useEffect(() => {
      if (!effectiveMajCat) return;
      let cancelled = false;
      fetchBomMap(effectiveMajCat).then((data) => {
        if (!cancelled) setBomMap(data);
      });
      return () => {
        cancelled = true;
      };
    }, [effectiveMajCat]);

    const getArtNum = useCallback(
      (schemaKey: string, field: string, currentValue: string | null): string => {
        const excelAttrName = SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey];
        if (excelAttrName && currentValue && bomMap[excelAttrName]?.[currentValue]) {
          return bomMap[excelAttrName][currentValue];
        }
        return attrArticleNums[field] || '';
      },
      [bomMap, attrArticleNums],
    );

    const saveAttrArticleNum = (field: string, val: string) => {
      const updated = { ...attrArticleNums, [field]: val };
      setAttrArticleNums(updated);
      const attrUpdates = { attrArticleNums: JSON.stringify(updated) };
      if (isModifyMode) {
        setPendingChanges((prev) => ({ ...prev, ...attrUpdates }));
        return;
      }
      onSave({ ...item, ...attrUpdates } as any, attrUpdates);
    };

    const [failedImg, setFailedImg] = useState(false);
    const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);
    const refreshAttempted = React.useRef(false);

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
    const getFieldVal = useCallback(
      (field: string) => {
        const v = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
        return v ? String(v).trim() : null;
      },
      [localValues, item],
    );

    // Reactively rebuild fabric/body descriptions whenever visible fields or item changes.
    React.useEffect(() => {
      if (item.approvalStatus !== 'PENDING') return;
      setLocalValues((prev) => {
        const getVal = (field: string) => {
          const v = prev[field] !== undefined ? prev[field] : (item as any)[field];
          return v ? String(v).trim() : null;
        };
        const fabParts = FAB_FIELDS.map((f) => getVal(f.field)).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
        const fabJoined = fabParts.length > 0 ? fabParts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '') : null;
        const newFabDesc = fabJoined;
        const updates: Record<string, string | null> = {};
        if (newFabDesc !== null && newFabDesc !== prev['fabricArticleDescription']) updates['fabricArticleDescription'] = newFabDesc;
        return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
      });
    }, [item, FAB_FIELDS]);

    // Auto-save the computed fabric description to DB whenever it differs from the DB value.
    // FG mode: only fires when DB value is empty (first-time fill).
    // SRM mode: fires whenever any fabric attribute changes and description drifts from DB.
    React.useEffect(() => {
      if (item.approvalStatus !== 'PENDING') return;
      if (isFGMode && item.fabricArticleDescription) return; // FG: don't overwrite existing
      // Use ATTRIBUTE_GROUPS FAB fields as fallback if cardGroups didn't populate FAB_FIELDS
      const effectiveFabFields = FAB_FIELDS.length > 0
        ? FAB_FIELDS
        : (ATTRIBUTE_GROUPS.find((g) => g.group === 'FAB')?.fields ?? []).filter(
            (f) => !f.freeText && f.field !== 'mainMvgr',
          );
      const fabParts = effectiveFabFields.map((f) => {
        const v = (localValues[f.field] !== undefined ? localValues[f.field] : (item as any)[f.field]);
        return v ? String(v).trim() : null;
      }).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
      if (fabParts.length === 0) return;
      const computed = fabParts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '');
      if (computed === item.fabricArticleDescription) return; // already in DB
      if (autoSavedFabDescRef.current === computed) return; // already queued this save
      autoSavedFabDescRef.current = computed;
      onSave({ ...item, fabricArticleDescription: computed } as ApproverItem, { fabricArticleDescription: computed }, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id, item.fabricArticleDescription, FAB_FIELDS, isFGMode, localValues]);

    // APPROVED/REJECTED articles are normally read-only. EXCEPTION: on the
    // Created page (modify mode) we keep them editable so the user can stage
    // changes and push them to SAP via the "Modify" button.
    const isLocked = (item.approvalStatus === 'APPROVED' || item.approvalStatus === 'REJECTED') && !isModifyMode;
    const status = getDisplayStatus(item);

    // Created-article identity/price fields are LOCKED even in modify mode — they
    // are fixed at creation time and must never be edited afterward (so they can
    // neither reach SAP nor change the local DB). The user cannot open these fields.
    const MODIFY_LOCKED_FIELDS = new Set<string>([
      'vendorCode', 'vendorName', 'mrp', 'rate', 'colour',
      'designNumber', 'division', 'subDivision', 'majorCategory', 'segment',
    ]);
    const isFieldLocked = (field: string) =>
      isLocked || (isModifyMode && MODIFY_LOCKED_FIELDS.has(field));

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

    const searchVendors = (q: string) => {
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
            `${APP_CONFIG.api.baseURL}/approver/vendor-search?q=${encodeURIComponent(q.trim())}`,
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
              label: (
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{v.vendorName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {v.vendorCode}
                    {v.vendorCity ? ` · ${v.vendorCity}` : ''}
                  </span>
                </div>
              ),
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
      const updates: Record<string, string | null> = { [field]: value };
      if (field === 'rate') {
        const rate = parseFloat(String(value ?? ''));
        if (!isNaN(rate) && rate > 0) {
          // Auto-calculate MRP only if user hasn't manually set one (≤1 = placeholder)
          const existingMrp = parseFloat(String(getValue('mrp') ?? ''));
          if (isNaN(existingMrp) || existingMrp <= 1) {
            updates['mrp'] = String(calcMrpFromRate(rate));
          }
        }
        const seg = computeSegmentFromMrp(value, segmentRangesRef.current);
        if (seg) updates['segment'] = seg;
      }
      if (field === 'majorCategory' && value) {
        const newMcCode = getMcCodeByMajorCategory(value);
        if (newMcCode) updates['mcCode'] = newMcCode;
        const mcDesOptions = fabHierarchy?.mcDesByMajCat[value] ?? [];
        if (mcDesOptions.length > 0) updates['mcDescription'] = mcDesOptions[0];
        const currentMrp = getValue('rate');
        fetchSegmentRangesFor(value).then((ranges) => {
          setSegmentRanges(ranges);
          const seg = computeSegmentFromMrp(currentMrp, ranges);
          if (seg) {
            setLocalValues((prev) => ({ ...prev, segment: seg }));
            onSave({ ...item, segment: seg } as ApproverItem, { segment: seg } as Record<string, unknown>);
          }
        });
        // Null only attributes that belong to the OLD category but NOT the new one.
        // Attributes shared between both categories keep their values.
        const applyAttrNulls = (newCatAttrs: { familyCode: string }[]) => {
          const newFamilyCodes = new Set(newCatAttrs.map((a) => a.familyCode));
          const nulls: Record<string, null> = {};
          for (const attr of gmFamilyAttrs) {
            if (!newFamilyCodes.has(attr.code)) {
              nulls[attr.code] = null;
            }
          }
          return nulls;
        };
        const cached = getCachedGMGrid(value);
        if (cached !== null) {
          Object.assign(updates, applyAttrNulls(cached));
        } else {
          // Grid not cached yet — fetch async then send a follow-up save
          const oldAttrs = [...gmFamilyAttrs];
          preloadGMGridFor(value).then((newCatAttrs) => {
            const newFamilyCodes = new Set(newCatAttrs.map((a) => a.familyCode));
            const nullUpdates: Record<string, null> = {};
            for (const attr of oldAttrs) {
              if (!newFamilyCodes.has(attr.code)) nullUpdates[attr.code] = null;
            }
            if (Object.keys(nullUpdates).length > 0) {
              onSave({ ...item, ...nullUpdates } as ApproverItem, nullUpdates as Record<string, unknown>, { silent: true });
            }
          });
        }
      }
      // When a Construction & Fabric attribute changes, recompute fabricArticleDescription
      // and bundle it into the same save so the DB value stays in sync with the UI.
      const fabFieldKeys = new Set(FAB_FIELDS.map((ff) => ff.field));
      if (fabFieldKeys.has(field)) {
        const getVal = (f: string) => {
          const v = updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]);
          return v ? String(v).trim() : null;
        };
        const fabParts = FAB_FIELDS.map((f) => getVal(f.field)).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
        const newFabDesc = fabParts.length > 0 ? fabParts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '') : null;
        if (newFabDesc) updates['fabricArticleDescription'] = newFabDesc;
      }
      setLocalValues((prev) => ({ ...prev, ...updates }));
      setEditingField(null);
      if (isModifyMode) {
        // Stage the edit; it is pushed to SAP + DB only when the user clicks "Modify".
        setPendingChanges((prev) => ({ ...prev, ...updates }));
        return;
      }
      onSave({ ...item, ...updates } as ApproverItem, updates as Record<string, unknown>);
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
    const rateNum = parseFloat(String(getValue('rate') ?? ''));
    const mrpNum  = parseFloat(String(getValue('mrp')  ?? ''));
    const markdown =
      !isNaN(rateNum) && !isNaN(mrpNum) && mrpNum > 0
        ? (((mrpNum - rateNum) / mrpNum) * 100).toFixed(1) + '%'
        : '—';
    const afterTax =
      !isNaN(rateNum) && !isNaN(mrpNum) && mrpNum > 0
        ? (((mrpNum - rateNum * 1.05) / mrpNum) * 100).toFixed(1) + '%'
        : '—';

    // ─── Card layout (design H) ─────────────────────────────────────────────────
    // Left rail: photo + "Article details" (all identity fields as real inputs).
    // Right: GM grid (dynamic per major category, Required / Optional), then a
    // separate BOM card, then colour variants. Every state colour is slate.

    const FIELD_LABEL = 'flex min-w-0 flex-col gap-[3px] text-[12px] font-semibold text-slate-600';
    const FIELD_INPUT =
      'h-[34px] rounded-lg border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-900 shadow-none ' +
      'hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-slate-400/25 ' +
      'disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-100';
    const FIELD_BOX =
      'flex h-[34px] w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 ' +
      'text-left text-[13px] font-medium text-slate-900 transition-colors hover:border-slate-400 ' +
      'focus:outline-none focus-visible:border-slate-500 focus-visible:ring-[3px] focus-visible:ring-slate-400/25 ' +
      'data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25 ' +
      'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:hover:border-slate-200';
    const OPTION_ROW = 'flex w-full flex-col px-3 py-1.5 text-left text-[12px] hover:bg-slate-100';

    const readField = (field: string): string => String(getValue(field) ?? '').trim();

    // Text input that saves on blur / Enter, and only when the value changed.
    // Keyed on the current value so a server or auto-calculated change (e.g. MRP
    // from rate) re-seeds the box.
    const renderTextField = (
      field: string,
      label: React.ReactNode,
      opts: { value?: string; disabled?: boolean; placeholder?: string; mono?: boolean; invalid?: boolean } = {},
    ) => {
      const current = opts.value ?? readField(field);
      return (
        <label key={field} className={FIELD_LABEL}>
          <span>{label}</span>
          <Input
            key={`${field}:${current}`}
            defaultValue={current}
            disabled={opts.disabled}
            placeholder={opts.disabled ? '—' : opts.placeholder}
            invalid={opts.invalid}
            className={cn(FIELD_INPUT, opts.mono && 'font-mono text-[12.5px]')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === current) return;
              if (field === 'vendorCode' && next && !/^\d{6}$/.test(next)) {
                message.error('Vendor Code must be exactly 6 digits');
                e.target.value = current;
                return;
              }
              handleSave(field, next || null);
            }}
          />
        </label>
      );
    };

    // Searchable single-select shown as a normal field box.
    const renderPickField = (opts: {
      id: string;
      label: React.ReactNode;
      value: string;
      placeholder: string;
      options: string[];
      onPick: (v: string | null) => void;
      disabled?: boolean;
      invalid?: boolean;
      emptyText?: string;
      allowClear?: boolean;
      optionLabel?: (v: string) => string;
    }) => {
      const open = editingField === `pick_${opts.id}`;
      const show = (v: string) => opts.optionLabel?.(v) ?? v;
      const q = attrSearch.trim().toLowerCase();
      const filtered = opts.options.filter((o) => o.toLowerCase().includes(q) || show(o).toLowerCase().includes(q));
      return (
        <div key={opts.id} className={FIELD_LABEL}>
          <span>{opts.label}</span>
          <Popover
            open={open}
            onOpenChange={(o) => {
              setEditingField(o ? `pick_${opts.id}` : null);
              setAttrSearch('');
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={opts.disabled}
                className={cn(FIELD_BOX, opts.invalid && 'border-red-300 bg-red-50/60')}
              >
                <span className={cn('truncate', !opts.value && 'font-normal text-slate-400')}>
                  {opts.value ? show(opts.value) : opts.disabled ? '—' : opts.placeholder}
                </span>
                {!opts.disabled && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0" align="start">
              <div className="flex items-center border-b px-2 py-1.5">
                <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={attrSearch}
                  onChange={(e) => setAttrSearch(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              {opts.allowClear && opts.value && (
                <button
                  type="button"
                  onClick={() => opts.onPick(null)}
                  className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[12px] font-medium text-red-600 hover:bg-red-50"
                >
                  <X className="h-3 w-3 shrink-0" />
                  Clear selection
                </button>
              )}
              <div className="max-h-60 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">{opts.emptyText ?? 'No options found'}</div>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => opts.onPick(o)}
                      className={cn(OPTION_ROW, o === opts.value && 'bg-slate-100 font-semibold')}
                    >
                      {show(o)}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    };

    // ── Article details: option lists from the hierarchy ──
    const currentDivision = readField('division');
    const currentSubDiv = readField('subDivision');
    const currentMajCat = effectiveMajCat || readField('majorCategory');
    const divisionOptions = fabHierarchy?.divisions ?? [];
    const subDivOptions =
      currentDivision && fabHierarchy?.subDivsByDiv[currentDivision]
        ? fabHierarchy.subDivsByDiv[currentDivision]
        : Object.values(fabHierarchy?.subDivsByDiv ?? {}).flat();
    const majCatOptions = (() => {
      let cats: string[];
      if (currentSubDiv && fabHierarchy?.majCatsBySubDiv[currentSubDiv]) {
        cats = fabHierarchy.majCatsBySubDiv[currentSubDiv];
      } else if (currentDivision && fabHierarchy?.subDivsByDiv[currentDivision]) {
        cats = fabHierarchy.subDivsByDiv[currentDivision].flatMap((sd) => fabHierarchy!.majCatsBySubDiv[sd] ?? []);
      } else {
        cats = Object.values(fabHierarchy?.majCatsBySubDiv ?? {}).flat();
      }
      return Array.from(new Set(cats)).sort();
    })();
    const mcDesOptions = fabHierarchy?.mcDesByMajCat[readField('majorCategory') || currentMajCat] ?? [];

    const saveDivision = (val: string | null) => {
      // Changing division resets subDivision (no longer valid)
      const updates = { division: val || null, subDivision: null as string | null };
      setLocalValues((prev) => ({ ...prev, ...updates }));
      setEditingField(null);
      setAttrSearch('');
      if (isModifyMode) {
        setPendingChanges((prev) => ({ ...prev, ...updates }));
      } else {
        onSave({ ...item, ...updates } as ApproverItem, updates as Record<string, unknown>);
      }
    };
    const pickAndSave = (field: string) => (v: string | null) => {
      handleSave(field, v);
      setAttrSearch('');
    };

    const designLocked = item.approvalStatus !== 'PENDING' && item.sapSyncStatus !== 'FAILED';
    const articleNumberEditable = !item.sapArticleId && !item.fabricArticleNumber && !isFieldLocked('articleNumber');
    const vendorCodeVal = readField('vendorCode');
    const vendorNameVal = readField('vendorName');
    const createdAtRaw = (pathType === 'created' ? item.updatedAt : item.createdAt) || item.updatedAt || item.createdAt;

    // ── GM grid: attributes come from the major category, never hard-coded ──
    const gmRows = gmFamilyAttrs.map((attr) => ({ attr, value: readField(attr.code) }));
    const gmRequiredRows = gmRows.filter((r) => r.attr.mandatory);
    const gmOptionalRows = gmRows.filter((r) => !r.attr.mandatory);
    const gmFilledCount = gmRows.filter((r) => r.value).length;
    const gmRequiredDone = gmRequiredRows.filter((r) => r.value).length;

    const renderGmRow = ({ attr, value }: { attr: GmFamilyAttr; value: string }) => {
      const locked = isFieldLocked(attr.code);
      const isEditing = editingField === attr.code;
      const missing = attr.mandatory && !value && !isLocked;
      const freeText = attr.values.length === 0;
      const q = attrSearch.trim().toLowerCase();
      return (
        <div
          key={attr.code}
          className="grid min-h-[48px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2.5 border-b border-slate-100 px-4 py-1.5 @2xl:border-r @2xl:even:border-r-0"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-[13px] font-semibold leading-[18px] text-slate-900">
              {gmAttrLabel(attr)}
              {attr.mandatory && <RequiredMark />}
            </span>
            <span className="truncate font-mono text-[11px] leading-[14px] text-slate-500">{attr.code}</span>
          </span>
          {freeText ? (
            <Input
              key={`${attr.code}:${value}`}
              defaultValue={value}
              disabled={locked}
              placeholder={locked ? '—' : 'Type value'}
              invalid={missing}
              className={cn(FIELD_INPUT, 'h-8')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== value) handleSave(attr.code, next || null);
              }}
            />
          ) : (
            <Popover
              open={isEditing}
              onOpenChange={(o) => {
                setEditingField(o ? attr.code : null);
                setAttrSearch('');
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={locked}
                  className={cn(
                    FIELD_BOX,
                    'h-8',
                    !value && 'border-dashed border-slate-300 bg-slate-50 font-normal text-slate-400',
                    missing && 'border-red-300 bg-red-50/60 text-red-600',
                  )}
                >
                  <span className="truncate">{value || (locked ? '—' : missing ? 'Required — choose…' : 'Choose…')}</span>
                  {!locked && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0" align="end">
                <div className="flex items-center border-b px-2 py-1.5">
                  <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    value={attrSearch}
                    onChange={(e) => setAttrSearch(e.target.value)}
                    placeholder="Search..."
                    className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {value && (
                  <button
                    type="button"
                    onClick={() => {
                      handleSave(attr.code, null);
                      setAttrSearch('');
                    }}
                    className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[12px] font-medium text-red-600 hover:bg-red-50"
                  >
                    <X className="h-3 w-3 shrink-0" />
                    Clear selection
                  </button>
                )}
                <div className="max-h-60 overflow-y-auto py-1">
                  {(() => {
                    const matches = attr.values.filter((v) => v.toLowerCase().includes(q));
                    if (matches.length === 0) {
                      return <div className="px-3 py-2 text-[12px] text-muted-foreground">No options found</div>;
                    }
                    return matches.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          handleSave(attr.code, v);
                          setAttrSearch('');
                        }}
                        className={cn(OPTION_ROW, v === value && 'bg-slate-100 font-semibold')}
                      >
                        {v}
                      </button>
                    ));
                  })()}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      );
    };

    // ── BOM card fields ──
    type BomField = {
      label: string;
      field: string;
      mandatory: boolean;
      kind: 'text' | 'pick' | 'colour' | 'markdown' | 'afterTax';
      options?: string[];
    };
    const BOM_FIELDS: BomField[] = [
      ...(!isFGMode
        ? ([
            { label: 'Cost / rate', field: 'rate', mandatory: true, kind: 'text' },
            { label: 'MRP', field: 'mrp', mandatory: true, kind: 'text' },
            { label: 'Markdown', field: '_markdown', mandatory: false, kind: 'markdown' },
            { label: 'After tax', field: '_afterTax', mandatory: false, kind: 'afterTax' },
            ...(item.source !== 'SRM' ? [{ label: 'Base colour', field: 'colour', mandatory: false, kind: 'colour' }] : []),
          ] as BomField[])
        : []),
      { label: 'Fashion type', field: 'articleFashionType', mandatory: true, kind: 'pick', options: ['C'] },
      ...(!isFGMode ? ([{ label: 'Segment', field: 'segment', mandatory: true, kind: 'text' }] as BomField[]) : []),
      ...(isFGMode
        ? ([
            { label: 'Vendor fabric rate', field: 'fabricRate', mandatory: false, kind: 'text' },
            { label: 'V2 fabric rate', field: 'v2FabricRate', mandatory: false, kind: 'text' },
            { label: 'Value add acc. cost', field: 'valueAddCost', mandatory: false, kind: 'text' },
          ] as BomField[])
        : []),
    ];
    const bomRequired = BOM_FIELDS.filter((b) => b.mandatory);
    const bomRequiredDone = bomRequired.filter((b) => readField(b.field)).length;
    const colourName = (code: string) => {
      const c = masterColors.find((m) => m.code === code);
      return c ? `${c.name} · ${c.code}` : code;
    };

    const renderBomField = (bom: BomField) => {
      const label = (
        <>
          {bom.label}
          {bom.mandatory && <RequiredMark />}
        </>
      );
      if (bom.kind === 'markdown' || bom.kind === 'afterTax') {
        return (
          <div key={bom.field} className={FIELD_LABEL}>
            <span>{label}</span>
            <span className="flex h-[34px] items-center rounded-lg bg-slate-100 px-2.5 text-[13px] font-semibold tabular-nums text-slate-900">
              {bom.kind === 'markdown' ? markdown : afterTax}
            </span>
          </div>
        );
      }
      const value = readField(bom.field);
      const locked = isFieldLocked(bom.field);
      const missing = bom.mandatory && !value && !isLocked;
      if (bom.kind === 'colour' || bom.kind === 'pick') {
        return renderPickField({
          id: `bom_${bom.field}`,
          label,
          value,
          placeholder: 'Choose…',
          options: bom.kind === 'colour' ? masterColors.map((c) => c.code) : bom.options ?? [],
          optionLabel: bom.kind === 'colour' ? colourName : undefined,
          onPick: pickAndSave(bom.field),
          disabled: locked,
          invalid: missing,
        });
      }
      return renderTextField(bom.field, label, { value, disabled: locked, invalid: missing, placeholder: 'Type value' });
    };

    const CARD = 'overflow-hidden rounded-xl border border-slate-200 bg-white';
    const countPill = (done: number, total: number) => (
      <span
        className={cn(
          'shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold tabular-nums',
          done === total ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
        )}
      >
        Required {done}/{total}
      </span>
    );

    return (
      <>
        <div
          key={item.id}
          className="animate-in flex flex-col overflow-hidden rounded-xl border bg-slate-50/70 shadow-sm transition-all fade-in-50 slide-in-from-bottom-1 duration-300"
          style={{ borderColor }}
        >
          {/* ─── Header strip: selection, status, title, per-article actions ─── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-slate-800 px-4 py-2.5 text-white">
            <Checkbox
              checked={isSelected}
              disabled={item.approvalStatus === 'REJECTED'}
              onCheckedChange={() => onToggleSelect(item.id)}
              className="border-white/60 bg-white/10 data-[state=checked]:bg-white data-[state=checked]:text-slate-800"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <strong className="truncate text-[14px] font-semibold">
                {[currentMajCat, readField('designNumber')].filter(Boolean).join(' · ') || 'Untitled article'}
              </strong>
              <span className="truncate text-[12px] text-slate-300">
                {[vendorNameVal, item.pptNumber ? `PPT ${item.pptNumber}` : null, item.sapArticleId || item.articleNumber]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </div>
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
            {isModifyMode && (
              <Button
                size="sm"
                onClick={handleModify}
                disabled={Object.keys(pendingChanges).length === 0 || modifying}
                className="h-8 border-none bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-100 disabled:bg-white/20 disabled:text-white/50"
              >
                {modifying ? <Spinner size="sm" /> : <Wand2 />}
                {modifying ? 'Modifying…' : 'Modify'}
                {Object.keys(pendingChanges).length > 0 && !modifying && (
                  <span className="ml-1 rounded-full bg-slate-800/10 px-1.5 text-[10px] tabular-nums">
                    {Object.keys(pendingChanges).length}
                  </span>
                )}
              </Button>
            )}
            {pathType === 'new' && item.approvalStatus === 'PENDING' && item.division?.toUpperCase() === 'KIDS' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDupConfirmOpen(true)}
                className="h-8 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Copy />
                Duplicate
              </Button>
            )}
          </div>

          {/* ─── Body: details rail | GM grid + BOM + variants ─── */}
          <div className="grid items-start gap-3 p-3 lg:grid-cols-[clamp(360px,42%,560px)_minmax(0,1fr)]">
            <aside className="flex min-w-0 flex-col gap-3">
              {/* Photo */}
              <div className="group relative aspect-[5/4] w-full overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    className="block h-full w-full cursor-zoom-in object-contain p-3"
                    onError={handleImgError}
                    onClick={() => setImgModalOpen(true)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">No Image</div>
                )}
                <span className="absolute bottom-2.5 left-3 rounded-md bg-white/85 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">
                  Article photo · 1 of 1
                </span>
                {imgUrl && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="absolute bottom-2 right-2 h-8 w-8 bg-white/90 shadow-[var(--shadow-md)] backdrop-blur"
                    onClick={() => setImgModalOpen(true)}
                    aria-label="Open photo full screen"
                  >
                    <Maximize2 />
                  </Button>
                )}
              </div>

              {/* Article details */}
              <section className={cn(CARD, 'flex flex-col gap-2.5 px-3.5 pb-3 pt-3')}>
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <h2 className="m-0 text-[14px] font-bold text-slate-900">Article details</h2>
                  <span className="text-[12px] text-slate-500">
                    {pathType === 'created' ? 'Last updated' : 'Created'}{' '}
                    {createdAtRaw
                      ? new Date(createdAtRaw as string).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </div>
                {/* Paired fields, two per line; description spans both columns. */}
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
                  {renderPickField({
                    id: 'division',
                    label: 'Division',
                    value: currentDivision,
                    placeholder: 'Choose division',
                    options: divisionOptions,
                    optionLabel: (d) => formatDivisionLabel(d) || d,
                    onPick: saveDivision,
                    disabled: !canEditDivision,
                  })}
                  {renderPickField({
                    id: 'subDivision',
                    label: 'Sub-division',
                    value: currentSubDiv,
                    placeholder: 'Choose sub-division',
                    options: subDivOptions,
                    onPick: pickAndSave('subDivision'),
                    disabled: isFieldLocked('subDivision'),
                    allowClear: true,
                  })}
                {renderPickField({
                  id: 'majorCategory',
                  label: 'Major category',
                  value: currentMajCat,
                  placeholder: 'Choose major category',
                  options: majCatOptions,
                  emptyText: 'No categories found',
                  onPick: (v) => v && pickAndSave('majorCategory')(v),
                  disabled: isFieldLocked('majorCategory'),
                })}
                {renderPickField({
                  id: 'mcDescription',
                  label: 'MC description',
                  value: readField('mcDescription'),
                  placeholder: 'Choose MC description',
                  options: mcDesOptions,
                  emptyText: currentMajCat ? 'No descriptions found' : 'Select a major category first',
                  onPick: (v) => v && pickAndSave('mcDescription')(v),
                  disabled: isFieldLocked('mcDescription'),
                })}
                {renderTextField('designNumber', 'Design number', {
                  disabled: designLocked,
                  placeholder: 'Type design number',
                  mono: true,
                })}
                {renderTextField('articleNumber', isFGMode ? 'Fabric article number' : 'Article number', {
                  value: String(item.sapArticleId || getValue('articleNumber') || '').trim(),
                  disabled: !articleNumberEditable,
                  placeholder: 'Type article number',
                })}
                {/* GM description rule is pending from the business — manual text for now. */}
                <div className="col-span-2 min-w-0">
                  {renderTextField('fabricArticleDescription', 'Article description', {
                    disabled: isFieldLocked('fabricArticleDescription'),
                    placeholder: 'Type article description',
                  })}
                </div>
                {renderTextField(
                  'vendorCode',
                  <>
                    Vendor code
                    <RequiredMark />
                  </>,
                  {
                    value: vendorCodeVal,
                    disabled: isFieldLocked('vendorCode'),
                    invalid: !vendorCodeVal && !isLocked,
                    placeholder: '6-digit vendor code',
                  },
                )}
                <div className={FIELD_LABEL}>
                  <span>
                    Vendor name
                    <RequiredMark />
                  </span>
                  {editingField === 'hdr_vendorName' ? (
                    <Autocomplete
                      autoFocus
                      value={vendorQuery || vendorNameVal}
                      onChange={searchVendors}
                      options={vendorOptions}
                      notFoundContent={vendorSearching ? <Spinner size="sm" /> : null}
                      placeholder="Search vendor"
                      onSelect={(val, option) => {
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
                        setEditingField(null);
                        setVendorOptions([]);
                        setVendorQuery('');
                      }}
                      onBlur={(e) => {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val && val !== vendorNameVal) handleSave('vendorName', val);
                        else setEditingField(null);
                        setVendorOptions([]);
                        setVendorQuery('');
                      }}
                      className={FIELD_INPUT}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={isFieldLocked('vendorName')}
                      onClick={() => setEditingField('hdr_vendorName')}
                      className={cn(FIELD_BOX, !vendorNameVal && !isLocked && 'border-red-300 bg-red-50/60')}
                    >
                      <span className={cn('truncate', !vendorNameVal && 'font-normal text-slate-400')}>
                        {vendorNameVal || (isFieldLocked('vendorName') ? '—' : 'Search vendor')}
                      </span>
                      {!isFieldLocked('vendorName') && <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    </button>
                  )}
                </div>
                </div>
              </section>
            </aside>

            <div className="flex min-w-0 flex-col gap-3">
              {/* GM grid — rows come from this major category's grid; two per line when wide */}
              <section className={cn(CARD, '@container')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2 className="m-0 text-[16px] font-bold text-slate-900">General merchandise grid</h2>
                    <span className="text-[12.5px] text-slate-500">
                      {gmRows.length > 0
                        ? `${gmRows.length} attributes for ${currentMajCat} · ${gmFilledCount} filled`
                        : currentMajCat || 'No major category set'}
                    </span>
                  </div>
                  {gmRequiredRows.length > 0 && countPill(gmRequiredDone, gmRequiredRows.length)}
                </div>
                {gmRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-slate-500">
                    {!currentMajCat ? (
                      'Choose a major category to load its grid.'
                    ) : !gmGridLoaded ? (
                      <Spinner size="sm" />
                    ) : (
                      `No GM attributes are set up for ${currentMajCat}.`
                    )}
                  </div>
                ) : (
                  [
                    { title: 'Required', rows: gmRequiredRows },
                    { title: 'Optional', rows: gmOptionalRows },
                  ]
                    .filter((s) => s.rows.length > 0)
                    .map((s) => (
                      <div key={s.title}>
                        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                          <strong className="text-[12px] uppercase tracking-[0.06em] text-slate-700">{s.title}</strong>
                          <span className="text-[12.5px] text-slate-500">{s.rows.length}</span>
                        </div>
                        <div className="grid @2xl:grid-cols-2">{s.rows.map(renderGmRow)}</div>
                      </div>
                    ))
                )}
              </section>

              {/* BOM — its own card, never mixed into the grid */}
              <section className={CARD}>
                <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3.5">
                  <h2 className="m-0 text-[16px] font-bold text-slate-900">BOM</h2>
                  {bomRequired.length > 0 && countPill(bomRequiredDone, bomRequired.length)}
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-3 gap-y-3 px-4 py-3.5">
                  {BOM_FIELDS.map(renderBomField)}
                </div>
              </section>

              {/* Proceed for FG Article Creation — hidden on New Articles and Failed Creations */}
              {!item.articleNumber && pathType !== 'new' && pathType !== 'failed' && (
                <Tooltip title={!vendorCodeVal ? 'Vendor Code is required before proceeding' : undefined}>
                  <span className="block">
                    <Button
                      disabled={!vendorCodeVal}
                      onClick={() => onProceedFGArticle(item)}
                      className="h-9 w-full border-none bg-slate-800 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <Rocket />
                      Proceed for FG Article Creation
                    </Button>
                  </span>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Colour variants — generic articles only; full width under both columns */}
          {item.isGeneric && (
            <section className={cn(CARD, 'mx-3 mb-3')}>
              <button
                type="button"
                onClick={() => setShowVariants((v) => !v)}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left hover:bg-slate-50"
              >
                <Users className="h-4 w-4 text-slate-500" />
                <h2 className="m-0 flex-1 text-[15px] font-bold text-slate-900">Colour variants</h2>
                <span className="text-[12.5px] text-slate-500">{showVariants ? 'Hide' : 'Show'}</span>
                {showVariants ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>
              {showVariants && (
                <div className="border-t border-slate-100">
                  {item.source === 'SRM' ? (
                    <GMArticleVariantSubTable genericId={item.id} genericRecord={item} pathType={pathType} />
                  ) : (
                    <GMVariantSubTable
                      genericId={item.id}
                      genericRecord={item}
                      attributes={attributes}
                      onRefresh={onRefresh}
                      pathType={pathType}
                    />
                  )}
                </div>
              )}
            </section>
          )}

          {/* ─── Tip footer ─── */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500">
            <Info className="h-3 w-3 text-slate-400" />
            <span>
              {isModifyMode
                ? 'Edit any field, then press “Modify” to push your changes to SAP. Use ‹ / › to move between articles.'
                : 'Every field saves as soon as you leave it. Use ‹ / › to move between articles.'}
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
            <div className="flex items-center justify-center overflow-auto p-4" style={{ maxHeight: '80vh' }}>
              <img
                src={imgUrl || ''}
                alt={item.imageName || 'preview'}
                className="block transition-transform duration-200 will-change-transform"
                style={{
                  maxWidth: '85vw',
                  maxHeight: '75vh',
                  objectFit: 'contain',
                  transform: `scale(${imgZoom}) rotate(${imgRotation}deg)`,
                  transformOrigin: 'center',
                }}
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Duplicate confirmation */}
        <Dialog open={dupConfirmOpen} onOpenChange={(o) => !duplicating && setDupConfirmOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Duplicate</DialogTitle>
            </DialogHeader>
            <p className="m-0">A new copy of this article will be created with all the same values. Do you want to continue?</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDupConfirmOpen(false)} disabled={duplicating}>
                Cancel
              </Button>
              <Button
                disabled={duplicating}
                onClick={async () => {
                  setDuplicating(true);
                  try {
                    await onDuplicate(item);
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : 'Failed to duplicate article');
                  } finally {
                    setDuplicating(false);
                    setDupConfirmOpen(false);
                  }
                }}
              >
                {duplicating ? 'Duplicating…' : 'Continue'}
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
export const GMArticleList: React.FC<ApproverArticleListProps> = ({
  items,
  loading,
  selectedRowKeys,
  onSelectionChange,
  onEdit: _onEdit,
  onSave,
  onCreateFabricArticle,
  onCreateBodyArticle,
  onProceedFGArticle,
  onModify,
  attributes,
  onRefresh,
  pathType,
  hideGroups,
  isFGMode,
  forceStaticGroups,
  serverPagination,
  fabHierarchy,
}) => {
  const [cardGroups, setCardGroups] = useState<CardGroup[]>(() => {
    if (forceStaticGroups) return ATTRIBUTE_GROUPS;
    const cached = getCachedAttributeGroups();
    return cached && cached.length > 0 ? buildCardGroups(cached) : ATTRIBUTE_GROUPS;
  });

  useEffect(() => {
    if (forceStaticGroups) return;
    preloadAttributeGroups()
      .then((entries) => {
        if (entries.length > 0) setCardGroups(buildCardGroups(entries));
      })
      .catch(() => {
        /* keep hardcoded fallback */
      });
  }, []);

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
    async (item: ApproverItem): Promise<void> => {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${item.id}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
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
          attributes={attributes}
          onRefresh={onRefresh}
          cardGroups={cardGroups}
          pathType={pathType}
          hideGroups={hideGroups}
          isFGMode={isFGMode}
          fabHierarchy={fabHierarchy}
        />
      ))}
    </div>
  );
};
