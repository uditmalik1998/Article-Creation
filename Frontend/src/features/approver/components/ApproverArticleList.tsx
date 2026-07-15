import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FileText,
  LayoutGrid,
  Rocket,
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
import type { ApproverItem, MasterAttribute } from './ApproverTable';
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
} from '../../../services/articleConfigService';
import { getImageUrl } from '../../../shared/utils/common/helpers';
import { APP_CONFIG } from '../../../constants/app/config';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import VariantSubTable from './VariantSubTable';

// Alias so the combobox trigger can use a distinct name from the plain icon
const ChevronDownIcon = ChevronDown;

// Module-level BOM cache (shared across card instances)
const bomCache = new Map<string, Promise<Record<string, Record<string, string>>>>();

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

const ATTRIBUTE_GROUPS: { group: string; color: string; fields: { field: string; schemaKey: string; freeText?: boolean }[] }[] = [
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
      { field: 'weight', schemaKey: 'weight', freeText: true },
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
      { field: 'articleFashionType', schemaKey: 'article_fashion_type' },
      { field: 'mNoOfSize', schemaKey: 'no_of_size' },
      { field: 'mNoOfClr', schemaKey: 'no_of_clr' },
      { field: 'impAtrbt2', schemaKey: 'imp_atrbt2' },
      { field: 'segment', schemaKey: 'segment', freeText: true },
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

const GROUP_COLORS: Record<string, string> = {
  FAB: '#e6f4ff',
  BODY: '#f6ffed',
  'VA ACC.': '#fff7e6',
  'VA PRCS': '#fff0f6',
  BUSINESS: '#f9f0ff',
};
const GROUP_ORDER = ['FAB', 'BODY', 'VA ACC.', 'VA PRCS', 'BUSINESS'];

// Construction & Fabric (FAB): these attributes must appear first, in this
// exact order, regardless of the order the backend returns them in. Everything
// else in the group keeps its existing relative order below them.
//   fab_div          → M_FAB_DIV
//   yarn_01          → M_YARN
//   main_mvgr        → M_FAB_MAIN_MVGR_1
//   fabric_main_mvgr → M_FAB_MAIN_MVGR_2
const FAB_PRIORITY_KEYS = ['fab_div', 'yarn_01', 'main_mvgr', 'fabric_main_mvgr'];

// ─── Redesign tokens — header/icon palette per group ──────────────────────────
const GROUP_LABELS: Record<string, string> = {
  FAB: 'Construction & Fabric',
  BODY: 'Body & Construction',
  'VA ACC.': 'Trims & Accessories',
  'VA PRCS': 'Finishing & Process',
  BUSINESS: 'Business & Misc',
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  FAB: <Shirt className="h-3.5 w-3.5" />,
  BODY: <UserIcon className="h-3.5 w-3.5" />,
  'VA ACC.': <Hash className="h-3.5 w-3.5" />,
  'VA PRCS': <Wand2 className="h-3.5 w-3.5" />,
  BUSINESS: <Briefcase className="h-3.5 w-3.5" />,
};

// Group surfaces use saturated 400-tier border stops so the card edges
// read confidently against the page. BUSINESS shifted from purple
// (palette violation) to slate to fit the locked slate+coral palette.
const GROUP_HEADER_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  FAB: { bg: '#fff7ed', fg: '#9a3412', border: '#fb923c' },        // amber
  BODY: { bg: '#ecfdf5', fg: '#065f46', border: '#34d399' },       // emerald
  'VA ACC.': { bg: '#fef3c7', fg: '#854d0e', border: '#facc15' },  // yellow
  'VA PRCS': { bg: '#fff1f2', fg: '#9f1239', border: '#fb7185' },  // rose
  BUSINESS: { bg: '#f1f5f9', fg: '#1e293b', border: '#64748b' },   // slate (was purple)
};

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
  return built.length > 0 ? built : ATTRIBUTE_GROUPS;
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
  }) => {
    const [showVariants, setShowVariants] = useState(false);
    const [imgModalOpen, setImgModalOpen] = useState(false);
    const [localValues, setLocalValues] = useState<Record<string, string | null>>({});
    const [dupConfirmOpen, setDupConfirmOpen] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [imgZoom, setImgZoom] = useState(1);
    const [imgRotation, setImgRotation] = useState(0);
    const [catOpen, setCatOpen] = useState(false);
    const [catSearch, setCatSearch] = useState('');
    // Search term for the attribute-value dropdown. A single shared term is
    // enough because only one attribute (editingField) is open at a time.
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
      onSave({ ...item, mrp: calculated } as ApproverItem, { mrp: calculated }, { silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]);

    const effectiveMajCat = useMemo(() => {
      const raw = (localValues['majorCategory'] !== undefined ? localValues['majorCategory'] : item.majorCategory) || '';
      return normalizeMajorCategory(raw, item.division);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localValues['majorCategory'], item.majorCategory, item.division]);

    const [cacheReady, setCacheReady] = useState(false);
    const [catConfigReady, setCatConfigReady] = useState(false);
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
        const gridOnlyVals = gridExcelAttr ? getMajCatGridEntry(effectiveMajCat, gridExcelAttr) : null;
        const values: AttrValue[] = (gridOnlyVals ?? []).map((v) => ({ shortForm: v, fullForm: v }));

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
    }, [effectiveMajCat, cacheReady, catConfigReady, gridReady, mandatoryGridReady, attributeFields, localValues]);

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
          (f) => !f.freeText,
        ),
      [cardGroups],
    );
    const BODY_FIELDS = useMemo(
      () => (cardGroups.find((g) => g.group === 'BODY')?.fields ?? []).filter((f) => !f.freeText),
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
        const fabParts = FAB_FIELDS.map((f) => getVal(f.field)).filter(Boolean) as string[];
        const bodyParts = BODY_FIELDS.map((f) => getVal(f.field)).filter(Boolean) as string[];
        const newFabDesc = fabParts.length > 0 ? fabParts.join('-').slice(0, 40) : null;
        const newBodyDesc = bodyParts.length > 0 ? bodyParts.join('-').slice(0, 40) : null;
        // REFERENCE ARTICLE DESC — built like ARTICLE DESC but from a fixed,
        // user-confirmed sequence spanning multiple cards:
        //   M_FAB_MAIN_MVGR_2 → M_WEAVE_02 → M_BLT_TYPE → M_BLT_STYLE →
        //   M_FIT → M_BODY_STYLE → M_PRINT_PLACEMENT → M_WASH
        const refParts = REF_DESC_FIELDS.map((f) => getVal(f)).filter(Boolean) as string[];
        const newRefDesc = refParts.length > 0 ? refParts.join('-').slice(0, 40) : null;
        const updates: Record<string, string | null> = {};
        if (newFabDesc !== null && newFabDesc !== prev['fabricArticleDescription']) updates['fabricArticleDescription'] = newFabDesc;
        if (newBodyDesc !== null && newBodyDesc !== prev['bodyArticleDescription']) updates['bodyArticleDescription'] = newBodyDesc;
        if (newRefDesc !== null && newRefDesc !== prev['referenceArticleDescription']) updates['referenceArticleDescription'] = newRefDesc;
        return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
      });
    }, [item, FAB_FIELDS, BODY_FIELDS]);

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
        if (!isNaN(rate) && rate > 0) updates['mrp'] = String(calcMrpFromRate(rate));
      }
      if (field === 'majorCategory' && value) {
        const newMcCode = getMcCodeByMajorCategory(value);
        if (newMcCode) updates['mcCode'] = newMcCode;
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
    const groupMap: Record<string, { color: string; attrs: typeof visibleAttrs }> = {};
    for (const attr of visibleAttrs) {
      if (!groupMap[attr.group]) groupMap[attr.group] = { color: attr.groupColor, attrs: [] };
      groupMap[attr.group].attrs.push(attr);
    }
    const activeGroups = ATTRIBUTE_GROUPS.filter((g) => groupMap[g.group]);

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
      {
        label: 'ARTICLE NUMBER',
        field: 'articleNumber',
        editable: !item.sapArticleId,
        required: false,
        color: item.sapArticleId ? '#15803d' : '#FF6F61',
      },
      { label: 'VENDOR CODE', field: 'vendorCode', editable: true, required: true, color: '#1f2937' },
      { label: 'VENDOR NAME', field: 'vendorName', editable: true, required: true, color: '#1f2937' },
      { label: 'ARTICLE DESC', field: 'articleDescription', editable: true, required: false, color: '#4b5563' },
      { label: 'REFERENCE ARTICLE', field: 'referenceArticleNumber', editable: true, required: false, color: '#1f2937' },
      { label: 'REFERENCE ARTICLE DESC', field: 'referenceArticleDescription', editable: true, required: false, color: '#1f2937' },
    ] as const;

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
          : field === 'majorCategory'
          ? effectiveMajCat || (item as any)[field]
          : (item as any)[field];
      const displayVal = localValues[field] !== undefined ? localValues[field] : baseValue;
      const isEditingThis = editingField === `hdr_${field}`;
      const canEdit = editable && !isFieldLocked(field);
      const isEmpty = !displayVal;
      const showRequiredError = required && isEmpty && !isLocked;
      return (
        <div
          key={field}
          className="border-b border-border last:border-b-0"
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          onClick={() => {
            if (canEdit && !isEditingThis) setEditingField(`hdr_${field}`);
          }}
        >
          <div className="flex items-start justify-between gap-2 px-2 py-0.5">
            <span
              className="shrink-0 text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: showRequiredError ? '#dc2626' : '#6b7280' }}
            >
              {label}
              {required && <span className="ml-0.5 text-red-500">*</span>}
            </span>
            <div className="min-w-0 flex-1 text-right">
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
                      className="flex h-7 w-full items-center justify-between rounded border border-input bg-background px-2 text-xs hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                      {getMajorCategoriesByDivision(item.division || '')
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
                      {getMajorCategoriesByDivision(item.division || '').filter((cat) =>
                        cat.toLowerCase().includes(catSearch.toLowerCase()),
                      ).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No categories found
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : isEditingThis && field === 'vendorName' ? (
                <Autocomplete
                  autoFocus
                  value={vendorQuery || displayVal || ''}
                  onChange={searchVendors}
                  options={vendorOptions}
                  notFoundContent={vendorSearching ? <Spinner size="sm" /> : null}
                  onSelect={(val, option) => {
                    // option.vendorName is the clean name (no code suffix)
                    const cleanName = (option as any).vendorName || String(val ?? '').split('||')[0];
                    const updates: Record<string, string | null> = { vendorName: cleanName };
                    if ((option as any).vendorCode) updates.vendorCode = (option as any).vendorCode;
                    setLocalValues((prev) => ({ ...prev, ...updates }));
                    if (isModifyMode) {
                      setPendingChanges((prev) => ({ ...prev, ...updates }));
                    } else {
                      onSave(
                        { ...item, ...updates } as ApproverItem,
                        updates as Record<string, unknown>,
                      );
                    }
                    setEditingField(null);
                    setVendorOptions([]);
                    setVendorQuery('');
                  }}
                  onBlur={(e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val) handleSave('vendorName', val);
                    else setEditingField(null);
                    setVendorOptions([]);
                    setVendorQuery('');
                  }}
                  className="text-xs"
                />
              ) : isEditingThis ? (
                <Input
                  autoFocus
                  defaultValue={displayVal || ''}
                  className="h-7 px-1 text-xs"
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSave(field, (e.target as HTMLInputElement).value || null)
                  }
                  onBlur={(e) => handleSave(field, e.target.value || null)}
                />
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
    }) => {
      _attrCounter += 1;
      const num = _attrCounter;
      const currentValue = getValue(attr.field);
      const isEffectivelyEmpty = !currentValue || currentValue.trim() === '';
      const isEmpty = isEffectivelyEmpty;
      const isMandatory = !attr.freeText && (attr.isMandatory ?? mandatoryKeys.has(attr.schemaKey));
      const isEditing = editingField === attr.field;
      const isUserEdited = !!localValues[attr.field];
      const attrLocked = isFieldLocked(attr.field);

      return (
        <div
          key={attr.field}
          className="group flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/40"
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
          <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-muted-foreground">{num}.</span>
          <span
            className={cn(
              'flex-1 truncate text-[10.5px] leading-snug',
              isMandatory ? 'key-field text-foreground' : 'font-semibold text-foreground/80',
            )}
          >
            {isMandatory && <span className="mandatory-mark">*</span>}
            {attr.label}
          </span>
          <div className="w-[110px] shrink-0">
            {attr.freeText ? (
              isEditing ? (
                <Input
                  autoFocus
                  defaultValue={isEffectivelyEmpty ? '' : currentValue || ''}
                  className="h-6 px-1 text-[11px]"
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSave(attr.field, (e.target as HTMLInputElement).value || null)
                  }
                  onBlur={(e) => handleSave(attr.field, e.target.value || null)}
                />
              ) : (
                <span
                  className="block truncate text-right text-[11px]"
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
                    className="flex h-6 w-full items-center justify-between rounded border border-input bg-background px-1.5 text-[11px] hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="flex items-center justify-end gap-1 text-right text-[11px]"
                style={{
                  color: isEffectivelyEmpty ? (isMandatory ? '#dc2626' : '#9ca3af') : '#111827',
                  fontStyle: isEffectivelyEmpty && !isMandatory ? 'italic' : 'normal',
                  fontWeight: isMandatory && isEffectivelyEmpty ? 700 : 600,
                }}
              >
                <span className="truncate">
                  {isEffectivelyEmpty ? (isMandatory ? 'Required' : '—') : currentValue}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
              </span>
            )}
          </div>
        </div>
      );
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

    return (
      <>
        <div
          key={item.id}
          className="animate-in flex flex-col rounded-xl border bg-white shadow-sm transition-all fade-in-50 slide-in-from-bottom-1 duration-300"
          style={{ borderColor }}
        >
          {/* ─── TOP HEADER STRIP (slate, matches dashboard) ─── */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 text-white"
            style={{ background: 'linear-gradient(90deg, #1f2937 0%, #334155 100%)' }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Checkbox
                checked={isSelected}
                disabled={item.approvalStatus === 'REJECTED'}
                onCheckedChange={() => onToggleSelect(item.id)}
                className="border-white/60 bg-white/10 data-[state=checked]:bg-white data-[state=checked]:text-[#FF6F61]"
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
              {/* ── Editable Design + Vendor + Price + Date ── */}
              <span className="ml-2 flex flex-wrap items-center gap-1.5 truncate text-[11px] text-white/75">
                <span className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Design:</span>
                  {editingField === 'topbar_designNumber' ? (
                    <Input
                      autoFocus
                      defaultValue={(localValues['designNumber'] ?? item.designNumber) || ''}
                      className="h-5 w-24 border-white/30 bg-white/10 px-1 text-[11px] text-white"
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        handleSave('designNumber', (e.target as HTMLInputElement).value || null)
                      }
                      onBlur={(e) => handleSave('designNumber', e.target.value || null)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      onClick={() => {
                        if (!isFieldLocked('designNumber')) setEditingField('topbar_designNumber');
                      }}
                      style={{
                        cursor: isFieldLocked('designNumber') ? 'default' : 'pointer',
                        borderBottom: isFieldLocked('designNumber') ? 'none' : '1px dashed rgba(255,255,255,0.4)',
                      }}
                    >
                      {(localValues['designNumber'] ?? item.designNumber) || (isFieldLocked('designNumber') ? '—' : 'Click to fill')}
                    </span>
                  )}
                </span>
                {item.vendorName && <span className="text-white/40">·</span>}
                {item.vendorName}
                {item.rate != null && <>&nbsp;·&nbsp;₹{item.rate}</>}
                {item.mrp != null && Number(item.mrp) > 1 && <> / ₹{item.mrp}</>}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.pptNumber && (
                <Badge className="bg-amber-300 text-amber-950">PPT: {item.pptNumber}</Badge>
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
          <div className="grid items-start gap-3 p-3 lg:grid-cols-[minmax(320px,28%)_1fr] xl:grid-cols-[minmax(360px,26%)_1fr] 2xl:grid-cols-[minmax(400px,24%)_1fr]">
            {/* ─── LEFT: Image + Article Info + Reference ───
             *
             * Sticky rail: image + identity stay anchored to the viewport
             * while the attribute groups on the right scroll. Top offset =
             * height of the dashboard's sticky brand+filter chrome (~120px).
             */}
            <aside className="sticky top-[120px] flex min-w-0 flex-col gap-3 self-start">
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
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-muted-foreground">Article ID</span>
                    <span className="truncate text-right font-bold text-foreground">
                      {item.sapArticleId || item.articleNumber || item.imageName || '—'}
                    </span>
                  </div>
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

              {visibleAttrs.length > 0 ? (
                <div className="grid auto-rows-min grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {activeGroups.map((g) => {
                    const style = GROUP_HEADER_STYLE[g.group] ?? { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' };
                    const collapsed = isGroupCollapsed(g.group);
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
                          style={{ background: style.bg, borderColor: style.border }}
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
                            {groupMap[g.group].attrs.map((attr) => renderAttributeRow(attr))}

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
                                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                                          className="truncate text-[11px]"
                                          style={{ color: displayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {displayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                };
                                const fabAutoFill = () => {
                                  const parts = FAB_FIELDS.filter((ff) => mandatoryKeys.has(ff.schemaKey))
                                    .map((ff) => {
                                      const v = localValues[ff.field] !== undefined ? localValues[ff.field] : (item as any)[ff.field];
                                      return v ? String(v).trim() : null;
                                    })
                                    .filter(Boolean);
                                  if (parts.length > 0)
                                    handleSave('fabricArticleDescription', parts.join('-').slice(0, 40));
                                };
                                return (
                                  <>
                                    {renderField('fabricArticleNumber', 'FABRIC ARTICLE NO.')}
                                    {renderField('fabricArticleDescription', 'FABRIC ARTICLE DESC', fabAutoFill, 40)}
                                    <div className="border-t border-border px-2 py-1.5">
                                      <Button
                                        size="sm"
                                        onClick={() => onCreateFabricArticle(item)}
                                        className="h-7 w-full border border-slate-300 bg-slate-50 text-[11px] font-medium text-slate-700 hover:bg-[#FF6F61]/10 hover:border-[#FF6F61]/40 hover:text-[#FF6F61]"
                                      >
                                        <FileText />
                                        Create Fabric Article
                                      </Button>
                                    </div>
                                  </>
                                );
                              })()}

                            {/* BODY: body article + description + button */}
                            {g.group === 'BODY' &&
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
                                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                                          className="truncate text-[11px]"
                                          style={{ color: displayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {displayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                };
                                const bodyAutoFill = () => {
                                  const parts = BODY_FIELDS.filter((bf) => mandatoryKeys.has(bf.schemaKey))
                                    .map((bf) => {
                                      const v = localValues[bf.field] !== undefined ? localValues[bf.field] : (item as any)[bf.field];
                                      return v ? String(v).trim() : null;
                                    })
                                    .filter(Boolean);
                                  if (parts.length > 0)
                                    handleSave('bodyArticleDescription', parts.join('-').slice(0, 40));
                                };
                                return (
                                  <>
                                    {renderField('bodyArticle', 'BODY ARTICLE NO.')}
                                    {renderField('bodyArticleDescription', 'BODY ARTICLE DESC', bodyAutoFill, 40)}
                                    <div className="border-t border-border px-2 py-1.5">
                                      <Button
                                        size="sm"
                                        onClick={() => onCreateBodyArticle(item)}
                                        className="h-7 w-full border border-purple-300 bg-purple-50 text-[11px] font-medium text-purple-700 hover:bg-purple-100"
                                      >
                                        <LayoutGrid />
                                        Create Body Article
                                      </Button>
                                    </div>
                                  </>
                                );
                              })()}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* BOM card */}
                  <div
                    className="overflow-hidden rounded-lg border bg-white"
                    style={{ borderColor: '#fde68a' }}
                  >
                    <div
                      className="flex items-center justify-between border-b px-2 py-1"
                      style={{ background: '#fffbeb', borderColor: '#fde68a' }}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        <DollarSign className="h-3 w-3" />
                        BOM
                      </span>
                    </div>
                    <div className="space-y-0 p-1">
                      {[
                        { label: 'RATE / COST', field: 'rate', editable: true, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false },
                        { label: 'MRP', field: 'mrp', editable: true, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false },
                        { label: 'COLOUR', field: 'colour', editable: true, mandatory: true, isDropdown: true, isColor: true, isMarkdown: false },
                        { label: 'MARKDOWN', field: '_markdown', editable: false, mandatory: false, isDropdown: false, isColor: false, isMarkdown: true, isAfterTax: false },
                        { label: 'AFTER TAX', field: '_afterTax', editable: false, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false, isAfterTax: true },
                      ].map((bom) => {
                        const isEditingBom = editingField === `bom_${bom.field}`;
                        const bomLocked = isFieldLocked(bom.field);
                        const val = bom.isMarkdown
                          ? markdown
                          : bom.isAfterTax
                          ? afterTax
                          : String(getValue(bom.field) ?? '').trim() || '—';
                        const isEmpty = val === '—';
                        const dropdownOptions: string[] = bom.isDropdown
                          ? bom.field === 'impAtrbt2'
                            ? getMajCatGridEntry(effectiveMajCat, 'IMP ATBT') ??
                              attributes.find((a) => a.key === 'imp_atrbt2')?.allowedValues.map((v) => v.shortForm) ??
                              getCachedValues(item.division ?? '', 'impAtrbt2') ??
                              []
                            : getCachedValues(item.division ?? '', bom.field) ?? []
                          : [];
                        return (
                          <div
                            key={bom.field}
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
                              className="flex-1 truncate text-[11px]"
                              style={{
                                color: bom.mandatory && isEmpty && !isLocked ? '#dc2626' : '#374151',
                                fontWeight: bom.mandatory ? 600 : 400,
                              }}
                            >
                              {bom.mandatory && <span className="mr-0.5 text-red-500">*</span>}
                              {bom.label}
                            </span>
                            <div className="w-[100px] shrink-0 text-right">
                              {isEditingBom && bom.isColor ? (
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
                                  <SelectTrigger className="h-6 w-full text-[11px]">
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
                                  className="h-6 px-1 text-[11px]"
                                  onKeyDown={(e) =>
                                    e.key === 'Enter' &&
                                    handleSave(bom.field, (e.target as HTMLInputElement).value || null)
                                  }
                                  onBlur={(e) => handleSave(bom.field, e.target.value || null)}
                                />
                              ) : (
                                <span
                                  className="block truncate text-[11px]"
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
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  {effectiveMajCat ? `No attributes defined for ${effectiveMajCat}` : 'No major category set.'}
                </div>
              )}

              {/* Proceed for FG Article Creation — hidden on New Articles and Failed Creations */}
              {!item.articleNumber && pathType !== 'new' && pathType !== 'failed' &&
                (() => {
                  const effectiveVendorCode =
                    localValues['vendorCode'] !== undefined ? localValues['vendorCode'] : item.vendorCode;
                  const vendorCodeMissing = !effectiveVendorCode;
                  return (
                    <div className="mt-2 shrink-0">
                      <Tooltip title={vendorCodeMissing ? 'Vendor Code is required before proceeding' : undefined}>
                        <Button
                          disabled={vendorCodeMissing}
                          onClick={() => onProceedFGArticle(item)}
                          className="h-8 w-full text-[12px] font-semibold transition-all"
                          style={{
                            background: vendorCodeMissing ? '#f3f4f6' : '#FF6F61',
                            color: vendorCodeMissing ? '#9ca3af' : '#fff',
                            border: 'none',
                          }}
                        >
                          <Rocket />
                          Proceed for FG Article Creation
                        </Button>
                      </Tooltip>
                    </div>
                  );
                })()}
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
                  attributes={attributes}
                  onRefresh={onRefresh}
                  pathType={pathType}
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
export const ApproverArticleList: React.FC<ApproverArticleListProps> = ({
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
  serverPagination,
}) => {
  const [cardGroups, setCardGroups] = useState<CardGroup[]>(() => {
    const cached = getCachedAttributeGroups();
    return cached && cached.length > 0 ? buildCardGroups(cached) : ATTRIBUTE_GROUPS;
  });

  useEffect(() => {
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
        />
      ))}
    </div>
  );
};
