/**
 * Simplified Extraction Page
 *
 * Workflow:
 * 1. One setup screen: Division → Sub-Division → Major Category, then upload images
 *    (the Major Category is pre-filled on every row and sent with the extraction)
 * 2. Start batch extraction and review the validated results
 */
import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Eraser, Download, Check, Bot, ChevronDown, Search } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { formatFileSize } from '../../../shared/utils/common/helpers';
import { SIMPLIFIED_HIERARCHY } from '../components/SimplifiedCategorySelector';
import type { SimplifiedCategory } from '../components/SimplifiedCategorySelector';
import { UploadArea } from '../components';
import { AttributeTable } from '../components/AttributeTable';
import ExportManager from '../components/ExportManager';
import { useImageExtraction } from '../../../shared/hooks/extraction/useImageExtraction';
import type { SchemaItem } from '../../../shared/types/extraction/ExtractionTypes';
import { MAJOR_CATEGORY_ALLOWED_VALUES } from '../../../data/majorCategoryMcCodeMap';
import { getMajCatAllowedValues, getMajCatMandatoryKeys } from '../../../data/majCatAttributeMap';
import { preloadAttributeValues } from '../../../services/articleConfigService';

import './ExtractionPage.css';
import '../../../styles/App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

const KEY_ALIASES: Record<string, string> = {
  neck_details: 'neck_detail',
  colour: 'color',
  child_belt: 'child_belt_detail',
  lycra_non_lycra: 'lycra_non\nlycra',
  patches_type: 'patch_type',
};

const ATTRIBUTE_VALUE_CORRECTIONS: Record<string, Record<string, string>> = {
  weave: { CH_TWL: 'CHN_TWL', CHINA_TWL: 'CHN_TWL' },
  m_fab2: { '3': '3/1' },
};

const normalizeAllowedValues = (attributeKey: string, allowedValues: any[] = []) => {
  const normalizedKey = String(attributeKey || '').trim().toLowerCase();
  const correctionMap = ATTRIBUTE_VALUE_CORRECTIONS[normalizedKey] || {};
  const deduped = new Map<string, { shortForm: string; fullForm: string }>();
  for (const item of allowedValues) {
    const shortFormRaw = String(item?.shortForm ?? item?.value ?? '').trim();
    const fullFormRaw = String(item?.fullForm ?? shortFormRaw).trim();
    if (!shortFormRaw && !fullFormRaw) continue;
    const correctedShortForm = correctionMap[shortFormRaw] || shortFormRaw;
    const key = correctedShortForm.toUpperCase();
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, { shortForm: correctedShortForm, fullForm: fullFormRaw || correctedShortForm });
    }
  }
  return Array.from(deduped.values());
};

const BASE_SIMPLIFIED_SCHEMA: SchemaItem[] = [
  // division + sub_division are intentionally excluded from the VLM schema:
  // user-selected (not AI-guessed) and injected as pre-filled attributes after
  // extraction so flatteningService uses the correct user-chosen values.
  { key: 'major_category', label: 'Major Category', type: 'select', allowedValues: MAJOR_CATEGORY_ALLOWED_VALUES },
  { key: 'design_number', label: 'Design Number', type: 'text', required: true },
  { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
  { key: 'reference_article_number', label: 'Reference Article Number', type: 'text' },
  { key: 'reference_article_description', label: 'Reference Article Description', type: 'text', required: false },
  { key: 'rate', label: 'Rate/Price', type: 'text' },
  { key: 'mrp', label: 'MRP', type: 'text' },
  // ── FAB ──
  { key: 'macro_mvgr', label: 'M_IMP_ATBT', type: 'select' },
  { key: 'yarn_01', label: 'M_YARN', type: 'select' },
  { key: 'main_mvgr', label: 'M_FAB_MAIN_MVGR_1', type: 'select' },
  { key: 'fabric_main_mvgr', label: 'M_FAB_MAIN_MVGR_2', type: 'select' },
  { key: 'weave', label: 'M_WEAVE_01', type: 'select' },
  { key: 'm_fab2', label: 'M_WEAVE_02', type: 'select' },
  { key: 'composition', label: 'M_COMPOSITION', type: 'select' },
  { key: 'f_count', label: 'M_COUNT', type: 'select' },
  { key: 'f_construction', label: 'M_CONSTRUCTION', type: 'select' },
  { key: 'lycra_non_lycra', label: 'M_LYCRA', type: 'select' },
  { key: 'finish', label: 'M_FINISH', type: 'select' },
  { key: 'gsm', label: 'M_GSM', type: 'select' },
  { key: 'f_ounce', label: 'M_OUNZ', type: 'select' },
  { key: 'f_width', label: 'M_WIDTH', type: 'select' },
  { key: 'fab_div', label: 'M_FAB_DIV', type: 'select' },
  { key: 'fab_vdr', label: 'M_FAB_VDR', type: 'select' },
  // ── BODY ──
  { key: 'collar', label: 'M_COLLAR_TYPE', type: 'select' },
  { key: 'collar_style', label: 'M_COLLAR_STYLE', type: 'select' },
  { key: 'neck_details', label: 'M_NECK_STYLE', type: 'select' },
  { key: 'neck', label: 'M_NECK_TYPE', type: 'select' },
  { key: 'placket', label: 'M_PLACKET', type: 'select' },
  { key: 'father_belt', label: 'M_BLT_TYPE', type: 'select' },
  { key: 'child_belt', label: 'M_BLT_STYLE', type: 'select' },
  { key: 'sleeve', label: 'M_SLEEVES_MAIN_STYLE', type: 'select' },
  { key: 'sleeve_fold', label: 'M_SLEEVE_FOLD', type: 'select' },
  { key: 'bottom_fold', label: 'M_BTM_FOLD', type: 'select' },
  { key: 'no_of_pocket', label: 'M_NO_OF_POCKET', type: 'select' },
  { key: 'pocket_type', label: 'M_POCKET', type: 'select' },
  { key: 'extra_pocket', label: 'M_EXTRA_POCKET', type: 'select' },
  { key: 'fit', label: 'M_FIT', type: 'select' },
  { key: 'body_style', label: 'M_BODY_STYLE', type: 'select' },
  { key: 'length', label: 'M_LENGTH', type: 'select' },
  // ── VA ACC ──
  { key: 'drawcord', label: 'M_DC_STYLE', type: 'select' },
  { key: 'dc_shape', label: 'M_DC_SHAPE', type: 'select' },
  { key: 'button', label: 'M_BTN_TYPE', type: 'select' },
  { key: 'btn_colour', label: 'M_BTN_CLR', type: 'select' },
  { key: 'zipper', label: 'M_ZIP_TYPE', type: 'select' },
  { key: 'zip_colour', label: 'M_ZIP_COL', type: 'select' },
  { key: 'patches_type', label: 'M_PATCH_STYLE', type: 'select' },
  { key: 'patches', label: 'M_PATCHE_TYPE', type: 'select' },
  { key: 'print_type', label: 'M_PRINT_TYPE', type: 'select' },
  { key: 'print_style', label: 'M_PRINT_STYLE', type: 'select' },
  { key: 'print_placement', label: 'M_PRINT_PLACEMENT', type: 'select' },
  { key: 'embroidery', label: 'M_EMB_TYPE', type: 'select' },
  { key: 'embroidery_type', label: 'M_EMBROIDERY_STYLE', type: 'select' },
  { key: 'wash', label: 'M_WASH', type: 'select' },
];

// Detect CREATOR with exactly ONE pre-assigned division — they skip Step 1 entirely.
// Multi-division CREATORs must select a division manually so this returns null for them.
const getCreatorDivision = (): string | null => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'CREATOR') return null;
    const raw = String(user.division || '').trim();
    if (!raw) return null;
    // Multiple divisions (comma-separated) → do not auto-select
    if (raw.includes(',')) return null;
    const upper = raw.toUpperCase();
    if (upper === 'MEN' || upper === 'MENS') return 'MENS';
    if (upper === 'KIDS') return 'Kids';
    if (upper === 'LADIES') return 'Ladies';
    return raw;
  } catch {
    return null;
  }
};

const normalizeDivision = (raw: string): string => {
  const upper = raw.trim().toUpperCase();
  if (upper === 'MEN' || upper === 'MENS') return 'MENS';
  if (upper === 'KIDS') return 'Kids';
  if (upper === 'LADIES') return 'Ladies';
  return raw.trim();
};

// Divisions the user may pick: restricted to the profile's division list when it
// has one (any role), otherwise every division.
const getDivisionOptions = (): string[] => {
  const all = Object.keys(SIMPLIFIED_HIERARCHY);
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const assigned = String(user.division || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .map(normalizeDivision);
    const allowed = all.filter((d) => assigned.includes(d));
    return allowed.length > 0 ? allowed : all;
  } catch {
    return all;
  }
};

type DivisionHierarchy = { subDivisions: string[]; majorCategories: { subDiv: string; majCat: string }[] };

// Sub-divisions + major categories come from major_category_details (Admin › Hierarchy),
// fetched for the chosen division only and cached per division for the session.
const divisionHierarchyCache = new Map<string, Promise<DivisionHierarchy | null>>();
const fetchDivisionHierarchy = (division: string): Promise<DivisionHierarchy | null> => {
  const key = division.trim().toUpperCase();
  const cached = divisionHierarchyCache.get(key);
  if (cached) return cached;
  const token = localStorage.getItem('authToken');
  const p = fetch(`${API_BASE_URL}/user/major-category-hierarchy?division=${encodeURIComponent(key)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => (json?.success ? (json.data as DivisionHierarchy) : null))
    .catch(() => null);
  // Don't keep a failed lookup — the next division pick retries.
  p.then((d) => { if (!d) divisionHierarchyCache.delete(key); });
  divisionHierarchyCache.set(key, p);
  return p;
};

type SavedSetup = {
  selectedCategory?: SimplifiedCategory | null;
  selectedSubDivision?: string | null;
  selectedMajorCategory?: string | null;
};

const SimplifiedExtractionPage = () => {
  const divisionOptions = useMemo(getDivisionOptions, []);
  // A single assigned division (CREATOR profile, or a one-division list) is pre-filled and locked.
  const creatorDivision = getCreatorDivision() ?? (divisionOptions.length === 1 ? divisionOptions[0] : null);

  const [selectedCategory, setSelectedCategory] = useState<SimplifiedCategory | null>(
    creatorDivision ? { department: creatorDivision, majorCategory: '', displayName: creatorDivision } : null
  );
  const [selectedSubDivision, setSelectedSubDivision] = useState<string | null>(null);
  const [selectedMajorCategory, setSelectedMajorCategory] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'setup' | 'extraction'>('setup');
  const [baseSchema, setBaseSchema] = useState<SchemaItem[]>(BASE_SIMPLIFIED_SCHEMA);
  const [simplifiedSchema, setSimplifiedSchema] = useState<SchemaItem[]>(BASE_SIMPLIFIED_SCHEMA);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; name?: string } | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [manualNavigation, setManualNavigation] = useState(false);
  const [missingFieldsDialog, setMissingFieldsDialog] = useState<{ rowName: string; missingLabels: string[] }[] | null>(null);
  const [showMissingDesignOnly, setShowMissingDesignOnly] = useState(false);
  const [divisionHierarchy, setDivisionHierarchy] = useState<DivisionHierarchy | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [majCatOpen, setMajCatOpen] = useState(false);
  const [majCatSearch, setMajCatSearch] = useState('');

  useEffect(() => {
    const division = selectedCategory?.department;
    setDivisionHierarchy(null);
    if (!division) return;
    let cancelled = false;
    setHierarchyLoading(true);
    fetchDivisionHierarchy(division).then((data) => {
      if (cancelled) return;
      setDivisionHierarchy(data);
      setHierarchyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCategory?.department]);

  const majorCategoriesForSubDiv = useCallback(
    (subDivision: string | null | undefined): string[] => {
      const sub = (subDivision || '').trim().toUpperCase();
      if (!divisionHierarchy || !sub) return [];
      return [
        ...new Set(
          divisionHierarchy.majorCategories.filter((r) => r.subDiv.toUpperCase() === sub).map((r) => r.majCat),
        ),
      ];
    },
    [divisionHierarchy],
  );

  const {
    extractedRows,
    isExtracting,
    progress,
    stats,
    addImages,
    extractAllPending,
    clearAll,
    updateRowAttribute,
    removeRow,
  } = useImageExtraction();

  useEffect(() => {
    // Restore the last setup so the three dropdowns come back pre-filled. A locked
    // (single-division) user only gets it back when it is for their own division.
    // Never restore the 'extraction' step — the rows-loaded effect handles that.
    const saved = localStorage.getItem('simplifiedExtractionState');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as SavedSetup;
      const dept = parsed?.selectedCategory?.department;
      if (!dept || !divisionOptions.includes(dept)) return;
      if (creatorDivision && dept !== creatorDivision) return;
      setSelectedCategory(parsed.selectedCategory ?? null);
      setSelectedSubDivision(parsed.selectedSubDivision ?? null);
      setSelectedMajorCategory(parsed.selectedMajorCategory ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const isBatchComplete = stats && stats.total > 0 && stats.done === stats.total;

  useEffect(() => {
    if (extractedRows.length > 0 && !manualNavigation) setCurrentStep('extraction');
  }, [extractedRows.length, manualNavigation]);

  useEffect(() => {
    const setup: SavedSetup = { selectedCategory, selectedSubDivision, selectedMajorCategory };
    localStorage.setItem('simplifiedExtractionState', JSON.stringify(setup));
  }, [selectedCategory, selectedSubDivision, selectedMajorCategory]);

  const subDivisionOptions = divisionHierarchy?.subDivisions ?? [];
  const majorCategoryOptions = useMemo(
    () => majorCategoriesForSubDiv(selectedSubDivision),
    [majorCategoriesForSubDiv, selectedSubDivision],
  );
  // Major Category is required whenever the sub-division has any to pick from.
  const isSetupComplete =
    !!selectedCategory?.department &&
    !!divisionHierarchy &&
    !!selectedSubDivision &&
    (majorCategoryOptions.length === 0 || !!selectedMajorCategory);
  const uploadTargetLabel = [selectedCategory?.department, selectedSubDivision, selectedMajorCategory]
    .filter(Boolean)
    .join(' › ');

  const handleDivisionChange = (department: string) => {
    setSelectedCategory({ department, majorCategory: '', displayName: department });
    setSelectedSubDivision(null);
    setSelectedMajorCategory(null);
  };

  const handleSubDivisionChange = (subDivision: string) => {
    setSelectedSubDivision(subDivision);
    setSelectedMajorCategory(null);
    setSelectedCategory((prev) =>
      prev ? { ...prev, majorCategory: subDivision, displayName: `${prev.department} - ${subDivision}` } : prev,
    );
  };

  const resetSetup = () => {
    setSelectedSubDivision(null);
    setSelectedMajorCategory(null);
    setSelectedCategory(
      creatorDivision ? { department: creatorDivision, majorCategory: '', displayName: creatorDivision } : null,
    );
  };

  useEffect(() => {
    const loadAllowedValues = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_BASE_URL}/user/attributes?includeValues=true`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!response.ok) return;
        const payload = await response.json();
        const attributes = payload?.data || [];
        const allowedMap = new Map<string, any[]>(
          attributes.map((attr: any) => [String(attr.key).toLowerCase(), attr.allowedValues || []]),
        );
        const schemaWithAllowed = BASE_SIMPLIFIED_SCHEMA.map((item) => {
          const keyLower = item.key.toLowerCase();
          if (keyLower === 'major_category') {
            return { ...item, allowedValues: normalizeAllowedValues(item.key, MAJOR_CATEGORY_ALLOWED_VALUES) };
          }
          const aliasKey = KEY_ALIASES[keyLower] || keyLower;
          const fetchedAllowed = allowedMap.get(keyLower) || allowedMap.get(aliasKey);
          return {
            ...item,
            allowedValues: normalizeAllowedValues(item.key, fetchedAllowed && fetchedAllowed.length > 0 ? fetchedAllowed : item.allowedValues || []),
          };
        });
        setBaseSchema(schemaWithAllowed);
      } catch (error) {
        console.warn('Failed to load allowed values for simplified schema', error);
      }
    };
    loadAllowedValues();
  }, []);

  useEffect(() => {
    const majorCat = selectedCategory?.majorCategory;
    if (!majorCat) {
      setSimplifiedSchema(baseSchema);
      return;
    }
    const division = selectedCategory?.department || '';
    preloadAttributeValues(division).catch(() => {});
    const mandatoryKeys = getMajCatMandatoryKeys(majorCat);
    // `majorCat` here is actually the selected Sub-Division (e.g. MW, MS-U) —
    // narrow the Major Category options to that division + sub-division so
    // e.g. MS-U never shows MW-only categories like MW_THRM_LOWER.
    const subDivisionCategories = normalizeAllowedValues(
      'major_category',
      majorCategoriesForSubDiv(majorCat).map((name) => ({ shortForm: name, fullForm: name })),
    );
    const filtered = baseSchema.map((item) => {
      if (item.key === 'major_category') {
        return {
          ...item,
          allowedValues: subDivisionCategories.length > 0 ? subDivisionCategories : item.allowedValues,
          required: mandatoryKeys.has(item.key),
        };
      }
      const majCatValues = getMajCatAllowedValues(division, item.key);
      // design_number is always required regardless of major category config
      const isRequired = item.key === 'design_number' ? true : mandatoryKeys.has(item.key);
      return { ...item, ...(majCatValues ? { allowedValues: majCatValues } : {}), required: isRequired };
    });
    setSimplifiedSchema(filtered);
  }, [baseSchema, selectedCategory, majorCategoriesForSubDiv]);

  const handleAddToSchema = useCallback((attributeKey: string, value: string) => {
    setSimplifiedSchema((prev) =>
      prev.map((item) => {
        if (item.key !== attributeKey) return item;
        const normalizedIncoming = normalizeAllowedValues(attributeKey, [{ shortForm: value, fullForm: value }])[0];
        if (!normalizedIncoming) return item;
        const alreadyExists = item.allowedValues?.some((v) => (v.shortForm || '').toLowerCase() === normalizedIncoming.shortForm.toLowerCase());
        if (alreadyExists) return item;
        return { ...item, allowedValues: [...(item.allowedValues || []), normalizedIncoming] };
      }),
    );
  }, []);

  const handleAttributeChange = useCallback(
    (rowId: string, attributeKey: string, value: string | number | null) => {
      updateRowAttribute(rowId, attributeKey, value);
      if (attributeKey === 'rate') {
        const rate = parseFloat(String(value ?? ''));
        if (!isNaN(rate) && rate > 0) {
          const mrp = Math.ceil((rate * 1.47) / 25) * 25;
          updateRowAttribute(rowId, 'mrp', mrp);
        }
      }
    },
    [updateRowAttribute],
  );

  const handleImagesUpload = useCallback(
    async (fileList: File[]) => {
      if (!isSetupComplete) return;
      const rows = await addImages(fileList);
      // Pre-fill the chosen Major Category on every new row; still editable per row.
      if (selectedMajorCategory) {
        rows.forEach((row) => updateRowAttribute(row.id, 'major_category', selectedMajorCategory));
      }
      if (fileList.length > 0) {
        setManualNavigation(false);
        setCurrentStep('extraction');
      }
    },
    [addImages, isSetupComplete, selectedMajorCategory, updateRowAttribute],
  );

  // "Start Batch" is blocked when any pending row is missing a Design Number
  const pendingRows = extractedRows.filter((r) => r.status === 'Pending' || r.status === 'Error' || r.status === 'Queued');
  const missingDesignRows = pendingRows.filter((row) => {
    const val = row.attributes?.['design_number'];
    return !String(val?.schemaValue ?? val?.rawValue ?? '').trim();
  });
  const anyMissingDesignNo = missingDesignRows.length > 0;
  // "Show them" narrows the table to rows still missing a Design Number; it falls
  // back to all rows on its own once they are all filled.
  const filterMissingDesign = showMissingDesignOnly && anyMissingDesignNo;
  const tableRows = filterMissingDesign ? missingDesignRows : extractedRows;

  const handleStartBatch = useCallback(() => {
    if (!selectedSubDivision) return;
    if (selectedCategory && extractAllPending) {
      const subDiv = selectedSubDivision ?? selectedCategory.majorCategory;
      extractAllPending(
        simplifiedSchema,
        selectedCategory.displayName,
        `${selectedCategory.department}-${subDiv}`,
        selectedMajorCategory ? { majorCategory: selectedMajorCategory } : {},
        'FG Article',
      );
    }
  }, [selectedCategory, selectedSubDivision, selectedMajorCategory, extractAllPending, simplifiedSchema]);

  const handleExportClick = useCallback(() => {
    const mandatoryItems = simplifiedSchema.filter((item) => item.required);
    if (mandatoryItems.length === 0) {
      setExportModalVisible(true);
      return;
    }
    const missing: { rowName: string; missingLabels: string[] }[] = [];
    for (const row of extractedRows) {
      const missingLabels: string[] = [];
      for (const item of mandatoryItems) {
        const attr = row.attributes?.[item.key];
        const val = attr?.schemaValue ?? attr?.rawValue;
        if (val === null || val === undefined || String(val).trim() === '') missingLabels.push(item.label);
      }
      if (missingLabels.length > 0) missing.push({ rowName: row.originalFileName || row.id, missingLabels });
    }
    if (missing.length === 0) {
      setExportModalVisible(true);
      return;
    }
    setMissingFieldsDialog(missing);
  }, [simplifiedSchema, extractedRows]);

  const handleStartOver = () => {
    setManualNavigation(true);
    clearAll();
    resetSetup();
    setCurrentStep('setup');
  };

  const handleGoHome = () => {
    setManualNavigation(true);
    localStorage.removeItem('simplifiedExtractionState');
    window.location.href = '/dashboard';
  };

  const handleImageClick = useCallback((url: string, name?: string) => {
    setSelectedImage({ url, name });
    setImageModalVisible(true);
  }, []);

  const handleBackToSetup = () => {
    setManualNavigation(true);
    setCurrentStep('setup');
  };

  const fieldLabel = 'text-[12px] font-semibold tracking-[0.06em] text-slate-600 dark:text-slate-400';
  const fieldTrigger =
    'h-11 w-full rounded-[10px] border-slate-300 bg-white text-[14.5px] font-semibold text-slate-900 focus:ring-slate-800 data-[state=open]:border-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50';

  const imageCount = `${extractedRows.length} ${extractedRows.length === 1 ? 'image' : 'images'}`;
  const totalUploadBytes = extractedRows.reduce((sum, r) => sum + (r.file?.size ?? 0), 0);
  const pageTitle =
    currentStep === 'setup'
      ? 'FG Article extraction'
      : isExtracting
      ? `Extracting ${imageCount}…`
      : isBatchComplete
      ? 'Extraction complete'
      : 'Ready to extract';
  const pageSubtitle =
    currentStep === 'setup'
      ? 'Pick where these garments belong, drop the photos, and the AI fills 42 attributes.'
      : `${uploadTargetLabel || 'No setup chosen'} · ${
          isExtracting
            ? 'values fill in as each image finishes.'
            : isBatchComplete
            ? 'review the values, then export.'
            : 'fix anything marked below, then start the batch.'
        }`;

  // Ready-check card (option C). A render function, not a component, so it never remounts.
  const renderCheckCard = (opts: { ok: boolean; badge?: number; title: string; detail: ReactNode; action?: ReactNode }) => (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3.5 py-3',
        opts.ok
          ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950'
          : 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-bold',
          opts.ok ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'border-2 border-orange-600 bg-white text-orange-800',
        )}
      >
        {opts.ok ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : opts.badge ?? '!'}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <b className={cn('text-[13.5px]', opts.ok ? 'text-slate-900 dark:text-slate-50' : 'text-orange-900 dark:text-orange-200')}>
          {opts.title}
        </b>
        <span className={cn('text-xs', opts.ok ? 'text-slate-600 dark:text-slate-400' : 'text-orange-800 dark:text-orange-300')}>
          {opts.detail}
        </span>
      </div>
      {opts.action}
    </div>
  );
  const checkActionBtn =
    'h-8 flex-none rounded-lg border border-orange-600 bg-white px-3 text-xs font-semibold text-orange-800 hover:bg-orange-100';

  return (
    <div className="extraction-scroll-page">
      <div className="content-wrapper">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="m-0 font-display text-[28px] font-semibold text-slate-900 dark:text-slate-50">{pageTitle}</h1>
            <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-400">{pageSubtitle}</p>
          </div>
          <span className="text-[12.5px] text-slate-600 dark:text-slate-400">
            Step <b className="text-slate-900 dark:text-slate-50">{currentStep === 'setup' ? '1 of 2' : '2 of 2'}</b> ·{' '}
            {currentStep === 'setup' ? 'Set up & upload' : 'Extract & review'}
          </span>
        </header>

        <div className="main-grid">
          <div className="left-panel">
            {currentStep === 'setup' && (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-3.5 rounded-[14px] border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <span className={fieldLabel}>1 · DIVISION</span>
                      <Select
                        value={selectedCategory?.department ?? ''}
                        onValueChange={handleDivisionChange}
                        disabled={!!creatorDivision}
                      >
                        <SelectTrigger className={fieldTrigger} aria-label="Division">
                          <SelectValue placeholder="Select division" />
                        </SelectTrigger>
                        <SelectContent>
                          {divisionOptions.map((dept) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className={fieldLabel}>2 · SUB-DIVISION</span>
                      <Select
                        value={selectedSubDivision ?? ''}
                        onValueChange={handleSubDivisionChange}
                        disabled={!selectedCategory?.department || subDivisionOptions.length === 0}
                      >
                        <SelectTrigger className={fieldTrigger} aria-label="Sub-division">
                          <SelectValue
                            placeholder={
                              !selectedCategory?.department
                                ? 'Pick a division first'
                                : hierarchyLoading
                                ? 'Loading…'
                                : subDivisionOptions.length === 0
                                ? 'No sub-divisions found'
                                : 'Select sub-division'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {subDivisionOptions.map((sub) => (
                            <SelectItem key={sub} value={sub}>
                              {sub}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className={fieldLabel}>3 · MAJOR CATEGORY</span>
                      <Popover
                        open={majCatOpen}
                        onOpenChange={(o) => {
                          setMajCatOpen(o);
                          if (!o) setMajCatSearch('');
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Major category"
                            disabled={majorCategoryOptions.length === 0}
                            className={cn(
                              fieldTrigger,
                              'flex items-center justify-between border px-3 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                            )}
                          >
                            <span className={cn('truncate', !selectedMajorCategory && 'font-normal text-muted-foreground')}>
                              {selectedMajorCategory ||
                                (!selectedSubDivision
                                  ? 'Pick a sub-division first'
                                  : majorCategoryOptions.length === 0
                                  ? 'None for this sub-division'
                                  : 'Select major category')}
                            </span>
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <div className="flex items-center border-b px-3 py-2">
                            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                            <input
                              autoFocus
                              value={majCatSearch}
                              onChange={(e) => setMajCatSearch(e.target.value)}
                              placeholder="Search major category…"
                              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            />
                          </div>
                          <div className="max-h-60 overflow-y-auto py-1">
                            {(() => {
                              const q = majCatSearch.trim().toLowerCase();
                              const filtered = q
                                ? majorCategoryOptions.filter((mc) => mc.toLowerCase().includes(q))
                                : majorCategoryOptions;
                              if (filtered.length === 0) {
                                return <div className="px-3 py-2 text-sm text-muted-foreground">No categories found</div>;
                              }
                              return filtered.map((mc) => (
                                <button
                                  key={mc}
                                  type="button"
                                  onClick={() => {
                                    setSelectedMajorCategory(mc);
                                    setMajCatOpen(false);
                                    setMajCatSearch('');
                                  }}
                                  className={cn(
                                    'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800',
                                    selectedMajorCategory === mc && 'bg-slate-100 font-medium dark:bg-slate-800',
                                  )}
                                >
                                  <span className="truncate">{mc}</span>
                                  {selectedMajorCategory === mc && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                                </button>
                              ));
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-600 dark:text-slate-400">
                    <span>
                      Each list only shows options for the one before it. Major category is pre-filled on every image — you can
                      still change it per row.
                    </span>
                    {(!!selectedSubDivision || (!creatorDivision && !!selectedCategory)) && (
                      <button
                        type="button"
                        onClick={resetSetup}
                        className="font-semibold text-slate-800 underline hover:text-slate-950 dark:text-slate-200"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </section>

                <UploadArea
                  compact
                  disabled={!isSetupComplete}
                  disabledHint={
                    !selectedCategory?.department
                      ? 'Pick a division to start'
                      : !selectedSubDivision
                      ? 'Pick a sub-division to unlock upload'
                      : 'Pick a major category to unlock upload'
                  }
                  targetLabel={uploadTargetLabel}
                  onUpload={async (_file: File, fileList: File[]) => {
                    await handleImagesUpload(fileList);
                    return false;
                  }}
                />
              </div>
            )}

            {currentStep === 'extraction' && extractedRows.length > 0 && (
              <div className="flex flex-col gap-3.5">
                {/* Ready-check cards */}
                <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {renderCheckCard({
                    ok: !!selectedSubDivision,
                    title: selectedSubDivision ? 'Setup chosen' : 'Setup incomplete',
                    detail: selectedSubDivision ? uploadTargetLabel : 'Pick a sub-division before starting',
                    action: selectedSubDivision ? undefined : (
                      <button type="button" className={checkActionBtn} onClick={handleBackToSetup}>
                        Open setup
                      </button>
                    ),
                  })}
                  {renderCheckCard({
                    ok: isExtracting || stats.error === 0,
                    badge: stats.error,
                    title: !isExtracting && stats.error > 0 ? `${stats.error} failed` : `${imageCount} added`,
                    detail: isExtracting ? (
                      <span className="flex items-center gap-2">
                        {stats.done} of {stats.total} done
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <span
                            className="block h-full rounded-full bg-slate-800 transition-all dark:bg-slate-200"
                            style={{ width: `${Math.round(progress)}%` }}
                          />
                        </span>
                      </span>
                    ) : stats.done > 0 || stats.error > 0 ? (
                      `${stats.done} done · ${stats.pending} pending · ${stats.error} failed`
                    ) : (
                      `${formatFileSize(totalUploadBytes)} in total`
                    ),
                  })}
                  {renderCheckCard({
                    ok: !anyMissingDesignNo,
                    badge: missingDesignRows.length,
                    title: anyMissingDesignNo ? 'Design Number missing' : 'Design numbers filled',
                    detail: anyMissingDesignNo
                      ? `${missingDesignRows.length} of ${pendingRows.length} rows to extract`
                      : 'Every row has one',
                    action: anyMissingDesignNo ? (
                      <button
                        type="button"
                        className={checkActionBtn}
                        onClick={() => setShowMissingDesignOnly((v) => !v)}
                      >
                        {filterMissingDesign ? 'Show all' : 'Show them'}
                      </button>
                    ) : undefined,
                  })}
                </section>

                {/* Horizontal results table: Image + Design Number frozen */}
                <section className="rounded-[14px] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  {filterMissingDesign && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-400">
                      Showing the {missingDesignRows.length} rows without a Design Number.
                      <button
                        type="button"
                        onClick={() => setShowMissingDesignOnly(false)}
                        className="font-semibold text-slate-800 underline hover:text-slate-950 dark:text-slate-200"
                      >
                        Show all rows
                      </button>
                    </div>
                  )}
                  <AttributeTable
                    layout="frozen"
                    extractedRows={tableRows}
                    schema={simplifiedSchema}
                    selectedRowKeys={[]}
                    onSelectionChange={() => {}}
                    onAttributeChange={handleAttributeChange}
                    onDeleteRow={removeRow}
                    onImageClick={handleImageClick}
                    onReExtract={() => {}}
                    onAddToSchema={handleAddToSchema}
                    isExtracting={isExtracting}
                  />
                </section>

                {/* Sticky action bar */}
                <footer className="sticky bottom-3 z-40 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-slate-800 px-5 py-3 text-slate-50 shadow-lg dark:bg-slate-900">
                  <div className="flex flex-wrap items-center gap-4 text-[13px]">
                    <button type="button" onClick={handleBackToSetup} className="font-semibold text-slate-50 hover:underline">
                      ← Setup
                    </button>
                    <span className="text-slate-300">
                      {imageCount} · {stats.done} done · {stats.pending} pending · {stats.error} failed
                      {isExtracting && <> · {Math.round(progress)}%</>}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={handleStartOver}
                      className="h-10 border-slate-500 bg-transparent text-red-200 hover:border-red-300 hover:bg-slate-700 hover:text-red-100"
                    >
                      <Eraser />
                      Start over
                    </Button>
                    <Button
                      variant="outline"
                      disabled={stats?.done === 0}
                      onClick={handleExportClick}
                      className="h-10 border-slate-500 bg-transparent text-slate-50 hover:bg-slate-700 hover:text-white disabled:text-slate-400"
                    >
                      <Download />
                      Export results
                    </Button>
                    {isBatchComplete && (
                      <Button
                        variant="outline"
                        onClick={handleGoHome}
                        className="h-10 border-slate-500 bg-transparent text-slate-50 hover:bg-slate-700 hover:text-white"
                      >
                        Go home
                      </Button>
                    )}
                    {!isExtracting && stats.pending > 0 && (
                      <Button
                        onClick={handleStartBatch}
                        disabled={!selectedSubDivision || anyMissingDesignNo}
                        className="h-10 bg-white font-bold text-slate-900 hover:bg-slate-100 disabled:bg-slate-600 disabled:text-slate-300 disabled:opacity-100"
                      >
                        <Bot />
                        {!selectedSubDivision
                          ? 'Start batch · pick a sub-division first'
                          : anyMissingDesignNo
                          ? `Start batch · fill ${missingDesignRows.length} design ${missingDesignRows.length === 1 ? 'number' : 'numbers'} first`
                          : `Start batch (${stats.pending})`}
                      </Button>
                    )}
                  </div>
                </footer>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={imageModalVisible} onOpenChange={setImageModalVisible}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{selectedImage?.name || 'Image Preview'}</DialogTitle>
          </DialogHeader>
          <div className="text-center">
            <img src={selectedImage?.url || ''} alt={selectedImage?.name || 'Product Image'} className="mx-auto max-h-[60vh] max-w-full" />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={exportModalVisible} onOpenChange={setExportModalVisible}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Export Results</DialogTitle>
          </DialogHeader>
          <ExportManager
            extractedRows={extractedRows}
            schema={simplifiedSchema}
            categoryName={selectedCategory?.displayName}
            onClose={() => setExportModalVisible(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!missingFieldsDialog} onOpenChange={(o) => !o && setMissingFieldsDialog(null)}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Mandatory Fields Missing</DialogTitle>
          </DialogHeader>
          <div className="max-h-[360px] overflow-y-auto">
            <p className="mb-3 text-muted-foreground">
              The following rows are missing mandatory fields required for article creation. Please fill them before exporting.
            </p>
            {missingFieldsDialog?.map(({ rowName, missingLabels }) => (
              <div key={rowName} className="mb-2.5">
                <strong className="text-xs">{rowName}</strong>
                <div className="mt-1 flex flex-wrap gap-1">
                  {missingLabels.map((label) => (
                    <span key={label} className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SimplifiedExtractionPage;
