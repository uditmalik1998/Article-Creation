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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Shirt,
  DollarSign,
  Plus,
  Minus,
  RotateCw,
  Search,
  Wand2,
  X,
  Tag as TagIcon,
  Check,
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
import { CARD_THEME } from '../../approver/components/cardTheme';
import type { ApproverItem } from '../types';
import {
  SCHEMA_KEY_TO_EXCEL_ATTR,
  SAP_NAME_TO_SCHEMA_KEY,
  normalizeMajorCategory,
} from '../../../data/majCatAttributeMap';
import { getMajorCategoriesByDivision, getMcCodeByMajorCategory } from '../../../data/majorCategoryMcCodeMap';
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
import FabricVariantSubTable from './FabricVariantSubTable';
import FabricArticleVariantSubTable from './FabricArticleVariantSubTable';

// Alias so the combobox trigger can use a distinct name from the plain icon
const ChevronDownIcon = ChevronDown;

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

// Fabric Segment master (by cost = RATE): upper limit of E, V, P per division; above P is SP.
const FABRIC_SEGMENT_LIMITS: Record<'WOVEN' | 'KNITS' | 'DENIM', [number, number, number]> = {
  WOVEN: [80, 125, 200],
  KNITS: [300, 400, 500],
  DENIM: [225, 275, 350],
};

/** Division is stored as K / Knits / KNITS, W / Woven, D / Denim — read its first letter. */
const fabricSegmentDivision = (division: string | null | undefined): keyof typeof FABRIC_SEGMENT_LIMITS | null => {
  const d = String(division ?? '').trim().toUpperCase();
  if (d.startsWith('K')) return 'KNITS';
  if (d.startsWith('D')) return 'DENIM';
  if (d.startsWith('W')) return 'WOVEN';
  return null;
};

const computeFabricSegment = (rate: string | null | undefined, division: string | null | undefined): string | null => {
  const r = parseFloat(String(rate ?? ''));
  const div = fabricSegmentDivision(division);
  if (isNaN(r) || r < 0 || !div) return null;
  const [e, v, p] = FABRIC_SEGMENT_LIMITS[div];
  return r <= e ? 'E' : r <= v ? 'V' : r <= p ? 'P' : 'SP';
};

const f = (schemaKey: string) => SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey] ?? schemaKey;

// FABRIC ARTICLE DESC order per division ("FABRIC ARTICLE SEQUENCE.xlsx"):
// M_FAB_DIV, M_YARN, M_WEAVE_01, M_LYCRA, M_FAB_MAIN_MVGR_2, M_WIDTH, M_GSM (Knits) /
// M_OUNZ (Woven & Denim), M_COUNT, M_COMPOSITION. Other FAB fields are not part of it.
const FAB_DESC_SEQUENCE_KNITS = ['fabDiv', 'yarn1', 'weave', 'lycra', 'fabricMainMvgr', 'fWidth', 'gsm', 'fCount', 'composition'];
const FAB_DESC_SEQUENCE_WOVEN_DENIM = ['fabDiv', 'yarn1', 'weave', 'lycra', 'fabricMainMvgr', 'fWidth', 'fOunce', 'fCount', 'composition'];
/** Fields that change the description, plus the division that picks the sequence. */
const FAB_DESC_TRIGGER_FIELDS = new Set([...FAB_DESC_SEQUENCE_KNITS, 'fOunce', 'division']);

/** Builds FABRIC ARTICLE DESC; division is stored as K / Knits / KNITS, so K… = Knits, anything else = Woven/Denim. */
const buildFabricArticleDesc = (getVal: (field: string) => string | null): string | null => {
  const division = (getVal('division') || getVal('fabDiv') || '').trim().toUpperCase();
  const sequence = division.startsWith('K') ? FAB_DESC_SEQUENCE_KNITS : FAB_DESC_SEQUENCE_WOVEN_DENIM;
  const parts = sequence.map((field) => getVal(field)).filter((v): v is string => Boolean(v) && !/^-+$/.test(v as string));
  return parts.length > 0 ? parts.join('-').replace(/-{2,}/g, '-').replace(/-+$/, '') : null;
};

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

// ─── Redesign tokens — header/icon palette per group ──────────────────────────
const GROUP_LABELS: Record<string, string> = {
  FAB: 'FAB',
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  FAB: <Shirt className="h-3.5 w-3.5" />,
};

// Group surfaces use saturated 400-tier border stops so the card edges
// read confidently against the page. BUSINESS shifted from purple
// (palette violation) to slate to fit the locked slate+coral palette.
// FAB uses the same Ink card theme as the FG article page.
const GROUP_HEADER_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  FAB: CARD_THEME,
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
  onDuplicate: (item: ApproverItem) => Promise<void>;
  /**
   * Modify an already-created (SAP-synced) article. Receives only the changed
   * fields. Used by the "Modify" button on the Created Articles page; pushes to
   * SAP first and persists locally only on success. Optional — pages that don't
   * support modify (new/old/rejected) simply omit it and the button is hidden.
   */
  onModify?: (item: ApproverItem, changes: Record<string, unknown>) => Promise<void>;
  onRefresh: () => void;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
  /** Detail page (design "Option A"): the card's top strip continues the page's ink
   *  header as one block — square top corners, no top border, divider line. */
  joinTop?: boolean;
  hideGroups?: string[];
  fabHierarchy?: {
    divisions: string[];
    subDivsByDiv: Record<string, string[]>;
    majCatsBySubDiv: Record<string, string[]>;
    mcDesByMajCat: Record<string, string[]>;
  };
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
    onRefresh,
    cardGroups,
    pathType,
    joinTop,
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
    onRefresh: () => void;
    cardGroups: CardGroup[];
    pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
    joinTop?: boolean;
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
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    // Left rail: Article Information / Reference & Vendor are collapsible, open by default.
    const [openLeftCards, setOpenLeftCards] = useState<Set<string>>(() => new Set(['info', 'reference']));
    const [imgZoom, setImgZoom] = useState(1);
    const [imgRotation, setImgRotation] = useState(0);
    const [catOpen, setCatOpen] = useState(false);
    const [catSearch, setCatSearch] = useState('');
    const [mcDesOpen, setMcDesOpen] = useState(false);
    const [mcDesSearch, setMcDesSearch] = useState('');
    // Search term for the attribute-value dropdown. A single shared term is
    // enough because only one attribute (editingField) is open at a time.
    const [attrSearch, setAttrSearch] = useState('');
    const [subDivSearch, setSubDivSearch] = useState('');

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

    // SEGMENT is not editable: it always follows RATE + division (Fabric Segment master).
    // Also corrects articles saved before this rule.
    const segRate = String((localValues['mrp'] !== undefined ? localValues['mrp'] : item.mrp) ?? '');
    const segDivision = String((localValues['division'] !== undefined ? localValues['division'] : item.division) ?? '')
      || String((localValues['fabDiv'] !== undefined ? localValues['fabDiv'] : (item as any).fabDiv) ?? '');
    useEffect(() => {
      if (item.approvalStatus !== 'PENDING') return;
      const expected = computeFabricSegment(segRate, segDivision);
      if (!expected) return;
      const current = String((localValues['segment'] !== undefined ? localValues['segment'] : item.segment) ?? '');
      if (expected === current) return;
      setLocalValues((prev) => ({ ...prev, segment: expected }));
      if (!isModifyMode) {
        onSave({ ...item, segment: expected } as ApproverItem, { segment: expected } as Record<string, unknown>, { silent: true });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id, segRate, segDivision]);

    // Tracks when the major-category grid JSON (for THIS article's category) has loaded
    const [gridReady, setGridReady] = useState(() => isMajCatGridLoadedFor(effectiveMajCat));
    // Tracks when the mandatory grid (for THIS article's category) has loaded
    const [mandatoryGridReady, setMandatoryGridReady] = useState(() => isMandatoryGridLoadedFor(effectiveMajCat));
    // Fabric attribute grid values from fabric_maj_cat_grid_values table
    const [fabricGrid, setFabricGrid] = useState<FabGridValues>({});
    const [fabricGridReady, setFabricGridReady] = useState(false);

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
    }, [effectiveMajCat, gridReady, mandatoryGridReady, attributeFields, localValues, fabricGrid, fabricGridReady]);

    const [editingField, setEditingField] = useState<string | null>(null);

    // Vendor autocomplete state
    // null = not typed yet (show the saved name); '' = the user cleared the box.
    const [vendorQuery, setVendorQuery] = useState<string | null>(null);
    const [vendorOptions, setVendorOptions] = useState<AutocompleteOption[]>([]);
    const [vendorSearching, setVendorSearching] = useState(false);
    const vendorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const newFabDesc = buildFabricArticleDesc(getVal);
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
      const computed = buildFabricArticleDesc((field) => {
        const v = (localValues[field] !== undefined ? localValues[field] : (item as any)[field]);
        return v ? String(v).trim() : null;
      });
      if (!computed) return;
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
    // Front / Back photo switch (back photo only when SRM sent one).
    const [showBackImg, setShowBackImg] = useState(false);
    const [backImgFailed, setBackImgFailed] = useState(false);
    useEffect(() => {
      setShowBackImg(false);
      setBackImgFailed(false);
    }, [item.id]);
    const backImgUrl = item.backImageUrl ? getImageUrl(item.backImageUrl) : null;
    const showingBack = showBackImg && !!backImgUrl;
    const shownImgUrl = showingBack ? (backImgFailed ? null : backImgUrl) : imgUrl;

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

    const getValue = (field: string): string | null => {
      if (field in localValues) return localValues[field];
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
      const updates: Record<string, string | null> = { [field]: value };
      if (field === 'mrp' || field === 'division') {
        const seg = computeFabricSegment(
          field === 'mrp' ? value : getValue('mrp'),
          (field === 'division' ? value : getValue('division')) || getValue('fabDiv'),
        );
        if (seg) updates['segment'] = seg;
      }
      if (field === 'majorCategory' && value) {
        const newMcCode = getMcCodeByMajorCategory(value);
        if (newMcCode) updates['mcCode'] = newMcCode;
        const mcDesOptions = fabHierarchy?.mcDesByMajCat[value] ?? [];
        if (mcDesOptions.length > 0) updates['mcDescription'] = mcDesOptions[0];
      }
      // When a Construction & Fabric attribute changes, recompute fabricArticleDescription
      // and bundle it into the same save so the DB value stays in sync with the UI.
      if (FAB_DESC_TRIGGER_FIELDS.has(field)) {
        const getVal = (f: string) => {
          const v = updates[f] !== undefined ? updates[f] : (localValues[f] !== undefined ? localValues[f] : (item as any)[f]);
          return v ? String(v).trim() : null;
        };
        const newFabDesc = buildFabricArticleDesc(getVal);
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
    const groupMap: Record<string, { color: string; attrs: typeof visibleAttrs }> = {};
    for (const attr of visibleAttrs) {
      if (!groupMap[attr.group]) groupMap[attr.group] = { color: attr.groupColor, attrs: [] };
      groupMap[attr.group].attrs.push(attr);
    }
    const activeGroups = ATTRIBUTE_GROUPS.filter((g) => groupMap[g.group] && !hideGroups?.includes(g.group));

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
      { label: 'MC DESCRIPTION', field: 'mcDescription', editable: true, required: false, color: '#7c3aed' },
      {
        label: isFGMode ? 'FABRIC ARTICLE NUMBER' : 'ARTICLE NUMBER',
        field: 'articleNumber',
        editable: !item.sapArticleId && !item.fabricArticleNumber,
        required: false,
        color: (item.sapArticleId || item.fabricArticleNumber) ? '#15803d' : '#FF6F61',
      },
      { label: 'VENDOR CODE', field: 'vendorCode', editable: true, required: true, color: '#1f2937' },
      { label: 'VENDOR NAME', field: 'vendorName', editable: true, required: true, color: '#1f2937' },
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
          className="border-b border-slate-100 last:border-b-0"
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          onClick={() => {
            if (canEdit && !isEditingThis) setEditingField(`hdr_${field}`);
          }}
        >
          {/* Label stacked above a full-width value (same as the FG page). */}
          <div className="flex flex-col gap-0.5 px-3 py-1.5">
            <span
              className="text-[12px] font-semibold uppercase tracking-wider"
              style={{ color: showRequiredError ? '#c2410c' : '#475569' }}
            >
              {label}
              {required && <span className="ml-0.5 text-orange-700">*</span>}
            </span>
            <div className="min-w-0">
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
                      className="flex h-7 w-full items-center justify-between rounded border border-input bg-background px-2 text-sm hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                      {(() => {
                        const effectiveSubDiv = (localValues['subDivision'] ?? item.subDivision) || '';
                        const effectiveDiv   = (localValues['division']    ?? item.division)    || '';
                        let cats: string[] = [];
                        if (effectiveSubDiv && fabHierarchy?.majCatsBySubDiv[effectiveSubDiv]) {
                          cats = fabHierarchy.majCatsBySubDiv[effectiveSubDiv];
                        } else if (effectiveDiv && fabHierarchy?.subDivsByDiv[effectiveDiv]) {
                          cats = fabHierarchy.subDivsByDiv[effectiveDiv]
                            .flatMap(sd => fabHierarchy!.majCatsBySubDiv[sd] ?? []);
                        } else {
                          cats = Object.values(fabHierarchy?.majCatsBySubDiv ?? {}).flat();
                        }
                        const unique = Array.from(new Set(cats)).sort();
                        const filtered = unique.filter(c => c.toLowerCase().includes(catSearch.toLowerCase()));
                        return filtered.length === 0
                          ? <div className="px-3 py-2 text-xs text-muted-foreground">No categories found</div>
                          : filtered.map(cat => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => { handleSave(field, cat); setCatOpen(false); setCatSearch(''); }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                            >
                              {cat}
                            </button>
                          ));
                      })()}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : isEditingThis && field === 'mcDescription' ? (
                <Popover
                  open={mcDesOpen}
                  onOpenChange={(o) => {
                    setMcDesOpen(o);
                    if (!o) setMcDesSearch('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-full items-center justify-between rounded border border-input bg-background px-2 text-sm hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <span className="truncate text-left">{displayVal || 'Select...'}</span>
                      <ChevronDownIcon className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <div className="flex items-center border-b px-2 py-1.5">
                      <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        value={mcDesSearch}
                        onChange={(e) => setMcDesSearch(e.target.value)}
                        placeholder="Search MC description..."
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {(() => {
                        const currentMajCat = (localValues['majorCategory'] ?? item.majorCategory) || '';
                        const opts = (currentMajCat && fabHierarchy?.mcDesByMajCat[currentMajCat]) ?? [];
                        const filtered = opts.filter(d => d.toLowerCase().includes(mcDesSearch.toLowerCase()));
                        return filtered.length === 0
                          ? <div className="px-3 py-2 text-xs text-muted-foreground">
                              {currentMajCat ? 'No descriptions found' : 'Select a major category first'}
                            </div>
                          : filtered.map(d => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => { handleSave(field, d); setMcDesOpen(false); setMcDesSearch(''); }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                            >
                              {d}
                            </button>
                          ));
                      })()}
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
                  className="text-sm"
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
                    if (val) handleSave('vendorName', val);
                    else setEditingField(null);
                    setVendorOptions([]);
                    setVendorQuery(null);
                  }}
                  className="text-sm"
                />
              ) : isEditingThis ? (
                <Input
                  autoFocus
                  defaultValue={displayVal || ''}
                  className="h-8 px-2 text-sm"
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSave(field, (e.target as HTMLInputElement).value || null)
                  }
                  onBlur={(e) => handleSave(field, e.target.value || null)}
                />
              ) : (
                <span
                  title={displayVal || undefined}
                  className={`block truncate ${
                    displayVal
                      ? field === 'majorCategory' || field === 'mcDescription'
                        ? 'font-mono text-[13.5px] text-slate-900'
                        : 'text-[14.5px] font-semibold text-slate-900'
                      : showRequiredError
                      ? 'text-sm font-semibold italic text-orange-700'
                      : 'text-sm italic text-slate-500'
                  }`}
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
    }, big = false) => {
      // big = Fabric FAB card (matches the FG FAB card): 13 px names, 14 px values, 26 px rows.
      const valueText = big ? 'text-[14px]' : 'text-[11px]';
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
          <span className={cn('shrink-0 text-right font-bold tabular-nums text-muted-foreground', big ? 'w-6 text-[12px]' : 'w-4 text-[10px]')}>{num}.</span>
          <span
            className={cn(
              'flex-1 truncate leading-snug',
              big ? 'text-[13px]' : 'text-[10.5px]',
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
                  className={big ? 'h-7 px-2 text-[13px]' : 'h-6 px-1 text-[11px]'}
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
                      big ? 'h-7 px-2 text-[13px]' : 'h-6 px-1.5 text-[11px]',
                    )}
                  >
                    <span className="truncate text-left">
                      {isEffectivelyEmpty ? 'Select' : currentValue}
                    </span>
                    <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-64 overflow-hidden rounded-xl border-slate-200 p-0 shadow-xl dark:border-slate-700"
                  align="end"
                  sideOffset={6}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Dropdown (Fabric pages): titled panel, roomier search, code + full name per
                      row, slate highlight + check on the current value; text 1 px up. */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="truncate text-[12px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">{attr.label}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{attr.values.length} options</span>
                  </div>
                  <div className="flex h-10 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
                    <Search className="h-4 w-4 shrink-0 text-slate-500" />
                    <input
                      autoFocus
                      value={attrSearch}
                      onChange={(e) => setAttrSearch(e.target.value)}
                      placeholder="Search code or name…"
                      aria-label={`Search ${attr.label}`}
                      className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-slate-400"
                    />
                  </div>
                  {!isEffectivelyEmpty && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSave(attr.field, null);
                        setAttrSearch('');
                      }}
                      className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-[12px] font-semibold text-red-700 hover:bg-red-50 dark:border-slate-800"
                    >
                      <X className="h-3.5 w-3.5 shrink-0" />
                      Clear selection
                      <span className="ml-auto truncate font-mono text-[11.5px] font-medium text-slate-500">{currentValue}</span>
                    </button>
                  )}
                  <div className="max-h-64 overflow-y-auto p-1.5">
                    {(() => {
                      const q = attrSearch.trim().toLowerCase();
                      const matches = attr.values.filter(
                        (v) =>
                          v.shortForm.toLowerCase().includes(q) ||
                          (v.fullForm ?? '').toLowerCase().includes(q),
                      );
                      if (matches.length === 0) {
                        return (
                          <div className="px-3 py-3 text-[12px] text-slate-500">
                            No options match “{attrSearch.trim()}”
                          </div>
                        );
                      }
                      return matches.map((v) => {
                        const selected = v.shortForm === currentValue;
                        return (
                          <button
                            key={v.shortForm}
                            type="button"
                            onClick={() => {
                              handleSave(attr.field, v.shortForm);
                              setAttrSearch('');
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                              selected ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                            )}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className={cn('truncate text-[12.5px] text-slate-900 dark:text-slate-100', selected ? 'font-bold' : 'font-semibold')}>
                                {v.shortForm}
                              </span>
                              {v.fullForm && v.fullForm !== v.shortForm && (
                                <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{v.fullForm}</span>
                              )}
                            </span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-slate-800 dark:text-slate-200" />}
                          </button>
                        );
                      });
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
    // ── Left rail (same design as the FG page, "Option A · Ink headers") ──
    const levelColor = (level: string) =>
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
    // Ink header; with `cardKey` it becomes a toggle that shows `summary` while closed.
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
    const isSrm = item.source === 'SRM';
    const infoRows: { label: string; value: React.ReactNode }[] = [
      ...(!isSrm
        ? [{ label: 'Article ID', value: item.sapArticleId || item.articleNumber || item.imageName || '—' }]
        : []),
      {
        label: 'Category',
        value: [formatDivisionLabel(item.division), item.subDivision, effectiveMajCat].filter(Boolean).join(' › ') || '—',
      },
      ...(!isSrm
        ? [
            {
              label: 'AI confidence',
              value: <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white">{aiConfidence}%</span>,
            },
            { label: 'Image quality', value: <span className={levelColor(imageQualityLevel)}>{imageQualityLevel}</span> },
            { label: 'Product clarity', value: <span className={levelColor(productClarityLevel)}>{productClarityLevel}</span> },
            {
              label: 'Attribute match',
              value: (
                <span className={levelColor(attrMatchLevel)}>
                  {attrMatchLevel} · {filledAttrCount} / {visibleAttrs.length}
                </span>
              ),
            },
          ]
        : []),
      { label: pathType === 'created' ? 'Last updated' : 'Created', value: createdOrUpdatedLabel },
    ];

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
                disabled={item.approvalStatus === 'REJECTED'}
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
                      {(fabHierarchy?.divisions ?? []).map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
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
                  <Popover
                    open
                    onOpenChange={(open) => { if (!open) { setEditingField(null); setSubDivSearch(''); } }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-6 w-36 items-center justify-between rounded border border-white/30 bg-white/10 px-2 text-[11px] text-white"
                      >
                        <span className="truncate">
                          {(localValues['subDivision'] ?? item.subDivision) || 'Select sub-division'}
                        </span>
                        <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-52 p-0"
                      align="start"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const effectiveDiv = (localValues['division'] ?? item.division) || '';
                        const opts = (effectiveDiv && fabHierarchy?.subDivsByDiv[effectiveDiv])
                          ? fabHierarchy.subDivsByDiv[effectiveDiv]
                          : Object.values(fabHierarchy?.subDivsByDiv ?? {}).flat();
                        const q = subDivSearch.trim().toLowerCase();
                        const filtered = opts.filter((sd: string) => sd.toLowerCase().includes(q));
                        const currentSubDiv = (localValues['subDivision'] ?? item.subDivision) || '';
                        return (
                          <>
                            <div className="flex items-center border-b px-2 py-1.5">
                              <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <input
                                autoFocus
                                value={subDivSearch}
                                onChange={(e) => setSubDivSearch(e.target.value)}
                                placeholder="Search..."
                                className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
                              />
                            </div>
                            {currentSubDiv && (
                              <button
                                type="button"
                                onClick={() => { handleSave('subDivision', null); setSubDivSearch(''); setEditingField(null); }}
                                className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                              >
                                <X className="h-3 w-3 shrink-0" />
                                Clear selection
                              </button>
                            )}
                            <div className="max-h-56 overflow-y-auto py-1">
                              {filtered.length === 0 ? (
                                <div className="px-3 py-2 text-[11px] text-muted-foreground">No options found</div>
                              ) : filtered.map((sd: string) => (
                                <button
                                  key={sd}
                                  type="button"
                                  onClick={() => { handleSave('subDivision', sd); setSubDivSearch(''); setEditingField(null); }}
                                  className={cn(
                                    'flex w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                                    sd === currentSubDiv && 'bg-accent/60 font-medium',
                                  )}
                                >
                                  {sd}
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </PopoverContent>
                  </Popover>
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
                    {item.mrp != null && Number(item.mrp) > 1 && <> · ₹{item.mrp}</>}
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
          <div className="grid items-start gap-3 p-3 lg:grid-cols-[minmax(320px,40%)_1fr] xl:grid-cols-[minmax(360px,40%)_1fr] 2xl:grid-cols-[minmax(400px,40%)_1fr]">
            {/* ─── LEFT: Image + Article Info + Reference ───
             *
             * Sticky rail: image + identity stay anchored to the viewport
             * while the attribute groups on the right scroll. Top offset =
             * height of the dashboard's sticky brand+filter chrome (~120px).
             */}
            <aside className="sticky top-[120px] flex min-w-0 flex-col gap-3 self-start">
              {/* Same design as the FG page ("Option A · Ink headers") */}
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                {renderInkCardHeader('Article Image', {
                  right: (
                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10.5px] font-semibold">
                      {backImgUrl ? `${showingBack ? 'Back · 2' : 'Front · 1'} / 2` : '1 / 1'}
                    </span>
                  ),
                })}
                <div className="flex flex-col gap-2 p-3">
                  <div className="relative h-[420px] w-full overflow-hidden rounded-lg bg-slate-100">
                    {shownImgUrl ? (
                      <>
                        <img
                          src={shownImgUrl}
                          alt=""
                          className="block h-full w-full cursor-zoom-in object-contain p-2"
                          onError={showingBack ? () => setBackImgFailed(true) : handleImgError}
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
                        {showingBack ? 'Back photo unavailable' : 'No image'}
                      </div>
                    )}
                    {backImgUrl && (
                      <>
                        <span className="absolute left-2.5 top-2.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.06em] text-white">
                          {showingBack ? 'BACK' : 'FRONT'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowBackImg(false)}
                          disabled={!showingBack}
                          aria-label="Show front photo"
                          className="absolute left-2.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white disabled:pointer-events-none disabled:opacity-0"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBackImg(true)}
                          disabled={showingBack}
                          aria-label="Show back photo"
                          className="absolute right-2.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white disabled:pointer-events-none disabled:opacity-0"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </>
                    )}
                  </div>
                  {item.imageName && (
                    <span className="truncate font-mono text-[11px] text-slate-600" title={item.imageName}>
                      {item.imageName}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                {renderInkCardHeader('Article Information', {
                  cardKey: 'info',
                  summary: (
                    <span className="truncate text-[11px] font-medium text-slate-300">
                      {isSrm
                        ? [item.subDivision, effectiveMajCat].filter(Boolean).join(' › ')
                        : `${aiConfidence}% · ${attrMatchLevel} ${filledAttrCount}/${visibleAttrs.length}`}
                    </span>
                  ),
                })}
                {isLeftCardOpen('info') && (
                  <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] px-3 py-1 text-sm">
                    {infoRows.map(({ label, value }, i) => (
                      <React.Fragment key={label}>
                        <dt className={`py-1.5 text-slate-600 ${i < infoRows.length - 1 ? 'border-b border-slate-100' : ''}`}>{label}</dt>
                        <dd
                          className={`m-0 truncate py-1.5 text-right font-semibold text-slate-900 ${
                            i < infoRows.length - 1 ? 'border-b border-slate-100' : ''
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
                <div className="grid auto-rows-min grid-cols-1 gap-3">
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
                          className="flex w-full items-center justify-between border-b-2 px-2 py-1.5 transition-colors hover:brightness-110"
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
                            {groupMap[g.group].attrs.map((attr) => renderAttributeRow(attr, g.group === 'FAB'))}

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
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          {label}
                                        </span>
                                        {autoFillFn && !isLocked && (
                                          <button
                                            type="button"
                                            className="text-[9px] text-slate-700 underline hover:text-slate-950"
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
                                          className="h-7 px-2 text-[13px]"
                                          onKeyDown={(e) =>
                                            e.key === 'Enter' && saveVal((e.target as HTMLInputElement).value)
                                          }
                                          onBlur={(e) => saveVal(e.target.value)}
                                        />
                                      ) : (
                                        <div
                                          className="truncate text-[14px] font-semibold"
                                          style={{ color: displayVal ? '#111827' : '#9ca3af' }}
                                        >
                                          {displayVal || (isLocked ? '—' : 'Click to fill')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                };
                                const fabAutoFill = () => {
                                  const desc = buildFabricArticleDesc((field) => {
                                    const v = localValues[field] !== undefined ? localValues[field] : (item as any)[field];
                                    return v ? String(v).trim() : null;
                                  });
                                  if (desc) handleSave('fabricArticleDescription', desc);
                                };
                                return (
                                  <>
                                    {renderField('fabricArticleNumber', 'FABRIC ARTICLE NO.')}
                                    {renderField('fabricArticleDescription', 'FABRIC ARTICLE DESC', fabAutoFill)}
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
                    className="overflow-hidden rounded-lg border-2 bg-white"
                    style={{ borderColor: CARD_THEME.border }}
                  >
                    <div
                      className="flex items-center justify-between border-b px-2 py-1.5"
                      style={{ background: CARD_THEME.bg, borderColor: CARD_THEME.bg, color: CARD_THEME.fg }}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                        <DollarSign className="h-3 w-3" />
                        BOM
                      </span>
                    </div>
                    <div className="space-y-0 p-1">
                      {[
                        ...(!isFGMode ? [
                          { label: 'RATE', field: 'mrp', editable: true, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false },
                          ...(!item.source || item.source !== 'SRM' ? [
                            { label: 'Base Color', field: 'colour', editable: true, mandatory: false, isDropdown: true, isColor: true, isMarkdown: false },
                          ] : []),
                        ] : []),
                        { label: 'ARTICLE FASHION TYPE', field: 'articleFashionType', editable: true, mandatory: true, isDropdown: true, isColor: false, isMarkdown: false, boldLabel: true },
                        ...(!isFGMode ? [
                          { label: 'SEGMENT', field: 'segment', editable: false, mandatory: true, isDropdown: false, isColor: false, isMarkdown: false, boldLabel: true },
                        ] : []),
                        ...(isFGMode ? [
                          { label: 'VENDOR FABRIC RATE', field: 'fabricRate', editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                          { label: 'V2 FABRIC RATE', field: 'v2FabricRate', editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                          { label: 'VALUE ADD ACC. COST', field: 'valueAddCost', editable: true, mandatory: false, isDropdown: false, isColor: false, isMarkdown: false },
                        ] : []),
                      ].map((bom) => {
                        const isEditingBom = editingField === `bom_${bom.field}`;
                        const bomLocked = isFieldLocked(bom.field);
                        const val = String(getValue(bom.field) ?? '').trim() || '—';
                        const isEmpty = val === '—';
                        const dropdownOptions: string[] = bom.isDropdown
                          ? bom.field === 'articleFashionType'
                            ? ['C']
                            : []
                          : [];
                        return (
                          <div
                            key={bom.field}
                            className="mb-0.5 flex min-h-[26px] items-center gap-2 rounded px-2 py-0.5 transition-colors hover:bg-muted/40"
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
                              className="flex-1 truncate text-[13px]"
                              style={{
                                color: bom.mandatory && isEmpty && !isLocked ? '#dc2626' : '#374151',
                                fontWeight: bom.mandatory || (bom as any).boldLabel ? 600 : 400,
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
                                  defaultOpen
                                  defaultValue={val === '—' ? undefined : val}
                                  onValueChange={(v) => handleSave(bom.field, v ?? null)}
                                  onOpenChange={(open) => { if (!open) setEditingField(null); }}
                                >
                                  <SelectTrigger className="h-7 w-full text-[13px]">
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
                                  className="h-7 px-2 text-[13px]"
                                  onKeyDown={(e) =>
                                    e.key === 'Enter' &&
                                    handleSave(bom.field, (e.target as HTMLInputElement).value || null)
                                  }
                                  onBlur={(e) => handleSave(bom.field, e.target.value || null)}
                                />
                              ) : (
                                <span
                                  className="block truncate text-[14px]"
                                  style={{
                                    color: bom.mandatory && isEmpty && !isLocked
                                      ? '#ea580c'
                                      : isEmpty
                                      ? '#9ca3af'
                                      : '#111827',
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

          {/* ─── Variants section — SRM Fabric Articles only ─── */}
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
                  Color Variants
                </span>
                <span className="text-[11px] text-muted-foreground">{showVariants ? '▲ Hide' : '▼ Show'}</span>
              </button>
              {showVariants && (
                item.source === 'SRM' ? (
                  <FabricArticleVariantSubTable
                    genericId={item.id}
                    genericRecord={item}
                    pathType={pathType}
                  />
                ) : (
                  <FabricVariantSubTable
                    genericId={item.id}
                    genericRecord={item}
                    onRefresh={onRefresh}
                    pathType={pathType}
                  />
                )
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
                src={shownImgUrl || ''}
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
export const FabricArticleList: React.FC<ApproverArticleListProps> = ({
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
  joinTop,
  hideGroups,
  isFGMode,
  serverPagination,
  fabHierarchy,
}) => {
  const cardGroups = ATTRIBUTE_GROUPS;

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
          onRefresh={onRefresh}
          cardGroups={cardGroups}
          pathType={pathType}
          joinTop={joinTop}
          hideGroups={hideGroups}
          isFGMode={isFGMode}
          fabHierarchy={fabHierarchy}
        />
      ))}
    </div>
  );
};
