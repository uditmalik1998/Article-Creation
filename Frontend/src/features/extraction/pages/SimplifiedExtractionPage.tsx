/**
 * Simplified Extraction Page
 *
 * Workflow:
 * 1. One setup screen: Division → Sub-Division → Major Category, then upload images
 *    (the Major Category is pre-filled on every row and sent with the extraction)
 * 2. Start batch extraction and review the validated results
 */
import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Eraser, Download, Check, Bot, ChevronDown, ChevronUp, Search } from 'lucide-react';
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
import { MAJOR_CATEGORY_ALLOWED_VALUES, getMcCodeByMajorCategory } from '../../../data/majorCategoryMcCodeMap';
import { getMajCatMandatoryKeys, SCHEMA_KEY_TO_EXCEL_ATTR } from '../../../data/majCatAttributeMap';
import {
  getMajCatGridEntry,
  hasMajCatGridData,
  isMajCatGridLoadedFor,
  preloadMajCatGridFor,
  preloadNationalGrid,
  type NationalGridValues,
} from '../../../services/articleConfigService';

import './ExtractionPage.css';
import '../../../styles/App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

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

/**
 * Allowed values for one attribute. A major category with its own grid uses only
 * that grid; the national grid is used only when the category has no grid at all.
 * No major category picked yet → null (upload is locked until one is picked).
 * An attribute neither grid lists gets no options — the values have to be added to
 * the grid (Admin › Grid Values). Returns null for attributes that aren't grid-driven.
 */
const gridValuesFor = (
  majorCategory: string | null,
  schemaKey: string,
  nationalGrid: NationalGridValues,
): { shortForm: string; fullForm: string }[] | null => {
  const excelAttr = SCHEMA_KEY_TO_EXCEL_ATTR[schemaKey.toLowerCase()];
  if (!excelAttr || !majorCategory) return null;
  if (hasMajCatGridData(majorCategory)) {
    return (getMajCatGridEntry(majorCategory, excelAttr) ?? []).map((v) => ({ shortForm: v, fullForm: v }));
  }
  return (nationalGrid[excelAttr] ?? []).map((v) => ({ shortForm: v.code, fullForm: v.fullForm || v.code }));
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
  // Bumped once the selected major category's grid (maj_cat_grid_values) is loaded,
  // so the attribute dropdowns rebuild from it.
  const [majCatGridVersion, setMajCatGridVersion] = useState(0);
  // national_grid_master: fallback dropdown values when the category grid has none.
  const [nationalGrid, setNationalGrid] = useState<NationalGridValues>({});

  // Only needed when the picked major category has no grid of its own — a category
  // with a grid never calls national-grid-values. (Upload needs a major category.)
  const needsNationalGrid =
    !!selectedMajorCategory &&
    isMajCatGridLoadedFor(selectedMajorCategory) &&
    !hasMajCatGridData(selectedMajorCategory);
  useEffect(() => {
    if (!needsNationalGrid) return;
    let cancelled = false;
    preloadNationalGrid().then((grid) => {
      if (!cancelled) setNationalGrid(grid);
    });
    return () => {
      cancelled = true;
    };
  }, [needsNationalGrid, majCatGridVersion]);

  useEffect(() => {
    if (!selectedMajorCategory) return;
    let cancelled = false;
    preloadMajCatGridFor(selectedMajorCategory)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMajCatGridVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMajorCategory]);
  const [majCatSearch, setMajCatSearch] = useState('');
  const [majCatActive, setMajCatActive] = useState(0); // keyboard-highlighted row in the filtered list

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
  // Major category search matches the name or its MC code.
  const majCatFiltered = useMemo(() => {
    const q = majCatSearch.trim().toLowerCase();
    if (!q) return majorCategoryOptions;
    return majorCategoryOptions.filter(
      (mc) => mc.toLowerCase().includes(q) || (getMcCodeByMajorCategory(mc) ?? '').includes(q),
    );
  }, [majCatSearch, majorCategoryOptions]);
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
    const majorCat = selectedCategory?.majorCategory;
    if (!majorCat) {
      setSimplifiedSchema(baseSchema);
      return;
    }
    const division = selectedCategory?.department || '';
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
      // Dropdown values: the selected major category's grid (maj_cat_grid_values), or the
      // national grid (national_grid_master) when that category has no grid at all.
      const majCatValues = gridValuesFor(selectedMajorCategory, item.key, nationalGrid);
      // design_number is always required regardless of major category config
      const isRequired = item.key === 'design_number' ? true : mandatoryKeys.has(item.key);
      return { ...item, ...(majCatValues ? { allowedValues: majCatValues } : {}), required: isRequired };
    });
    setSimplifiedSchema(filtered);
  }, [baseSchema, selectedCategory, selectedMajorCategory, majCatGridVersion, nationalGrid, majorCategoriesForSubDiv]);

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

  const pickMajorCategory = (mc: string) => {
    setSelectedMajorCategory(mc);
    setMajCatOpen(false);
    setMajCatSearch('');
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
                      {/* Design "Option A": same look as the Sub-division list — full field width,
                          search inside, MC code per row, slate selected state, ↑ ↓ Enter Esc (no hint bar). */}
                      <Popover
                        open={majCatOpen}
                        onOpenChange={(o) => {
                          setMajCatOpen(o);
                          if (!o) setMajCatSearch('');
                          else setMajCatActive(Math.max(0, majorCategoryOptions.indexOf(selectedMajorCategory ?? '')));
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Major category"
                            aria-haspopup="listbox"
                            disabled={majorCategoryOptions.length === 0}
                            className={cn(
                              fieldTrigger,
                              'flex items-center justify-between border px-3 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                              majCatOpen && 'border-slate-800 ring-[3px] ring-slate-800/15',
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
                            {majCatOpen ? (
                              <ChevronUp className="ml-2 h-4 w-4 shrink-0 text-slate-800 dark:text-slate-200" />
                            ) : (
                              <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border-slate-200 p-0 shadow-xl dark:border-slate-700"
                          align="start"
                          sideOffset={6}
                        >
                          <div className="flex h-12 items-center gap-2.5 border-b border-slate-200 px-3.5 dark:border-slate-700">
                            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <input
                              autoFocus
                              value={majCatSearch}
                              onChange={(e) => {
                                setMajCatSearch(e.target.value);
                                setMajCatActive(0);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setMajCatActive((i) => Math.min(i + 1, majCatFiltered.length - 1));
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setMajCatActive((i) => Math.max(i - 1, 0));
                                } else if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const mc = majCatFiltered[majCatActive];
                                  if (mc) pickMajorCategory(mc);
                                }
                              }}
                              placeholder="Search major category or MC code"
                              aria-label="Search major category"
                              aria-controls="majcat-listbox"
                              aria-activedescendant={majCatFiltered[majCatActive] ? `majcat-opt-${majCatActive}` : undefined}
                              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            />
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {majCatSearch.trim() ? `${majCatFiltered.length} of ${majorCategoryOptions.length}` : majorCategoryOptions.length}
                            </span>
                          </div>
                          <div id="majcat-listbox" role="listbox" aria-label="Major categories" className="max-h-[420px] overflow-y-auto p-1.5">
                            {majCatFiltered.length === 0 ? (
                              <div className="px-3 py-3 text-sm text-muted-foreground">No categories match “{majCatSearch.trim()}”</div>
                            ) : (
                              majCatFiltered.map((mc, i) => {
                                const selected = selectedMajorCategory === mc;
                                const code = getMcCodeByMajorCategory(mc);
                                return (
                                  <button
                                    key={mc}
                                    id={`majcat-opt-${i}`}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    ref={i === majCatActive ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                                    onMouseMove={() => setMajCatActive(i)}
                                    onClick={() => pickMajorCategory(mc)}
                                    className={cn(
                                      'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-slate-900 dark:text-slate-100',
                                      (i === majCatActive || selected) && 'bg-slate-100 dark:bg-slate-800',
                                      selected ? 'font-bold' : 'font-medium',
                                    )}
                                  >
                                    <span className="truncate">{mc}</span>
                                    <span className="ml-auto shrink-0 font-mono text-xs font-medium text-slate-500 dark:text-slate-400">{code ?? ''}</span>
                                    {selected ? (
                                      <Check className="h-4 w-4 shrink-0 text-slate-800 dark:text-slate-200" />
                                    ) : (
                                      <span className="w-4 shrink-0" />
                                    )}
                                  </button>
                                );
                              })
                            )}
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
