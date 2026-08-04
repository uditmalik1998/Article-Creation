import { useState, useCallback, useEffect } from 'react';
import { Eraser, Download, CheckCircle2, Upload as UploadIcon, Bot, LayoutGrid } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Statistic,
  Steps,
} from '@/shared/components/ui-tw';
import { SimplifiedCategorySelector, SIMPLIFIED_HIERARCHY } from '../components/SimplifiedCategorySelector';
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
  { key: 'major_category', label: 'Major Category', type: 'select', allowedValues: MAJOR_CATEGORY_ALLOWED_VALUES },
  { key: 'design_number', label: 'Design Number', type: 'text' },
  { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
  { key: 'reference_article_number', label: 'Reference Article Number', type: 'text' },
  { key: 'reference_article_description', label: 'Reference Article Description', type: 'text', required: false },
  { key: 'rate', label: 'Rate/Price', type: 'text' },
  { key: 'mrp', label: 'MRP', type: 'text' },
  // ── CONSTRUCTION & FABRIC ──
  { key: 'fab_div', label: 'M_FAB_DIV', type: 'select' },
  { key: 'yarn_01', label: 'M_YARN', type: 'select' },
  { key: 'main_mvgr', label: 'M_FAB_MAIN_MVGR_1', type: 'select' },
  { key: 'fabric_main_mvgr', label: 'M_FAB_MAIN_MVGR_2', type: 'select' },
  { key: 'f_construction', label: 'M_CONSTRUCTION', type: 'select' },
  { key: 'f_ounce', label: 'M_OUNZ', type: 'select' },
  { key: 'f_width', label: 'M_WIDTH', type: 'select' },
  { key: 'm_fab2', label: 'M_WEAVE_02', type: 'select' },
  { key: 'f_count', label: 'M_COUNT', type: 'select' },
  { key: 'weave', label: 'M_WEAVE_01', type: 'select' },
  { key: 'composition', label: 'M_COMPOSITION', type: 'select' },
  { key: 'finish', label: 'M_FINISH', type: 'select' },
  { key: 'gsm', label: 'M_GSM', type: 'select' },
  { key: 'lycra_non_lycra', label: 'M_LYCRA', type: 'select' },
  { key: 'fab_vdr', label: 'M_FAB_VDR', type: 'select' },
];

const getCreatorDivision = (): string | null => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'CREATOR') return null;
    const raw = String(user.division || '').trim();
    if (!raw) return null;
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

const FabricExtractionPage = () => {
  const creatorDivision = getCreatorDivision();

  const [selectedCategory, setSelectedCategory] = useState<SimplifiedCategory | null>(
    creatorDivision ? { department: creatorDivision, majorCategory: '', displayName: creatorDivision } : null
  );
  const [selectedSubDivision, setSelectedSubDivision] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'category' | 'upload' | 'extraction'>(
    creatorDivision ? 'upload' : 'category'
  );
  const [baseSchema, setBaseSchema] = useState<SchemaItem[]>(BASE_SIMPLIFIED_SCHEMA);
  const [simplifiedSchema, setSimplifiedSchema] = useState<SchemaItem[]>(BASE_SIMPLIFIED_SCHEMA);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; name?: string } | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [manualNavigation, setManualNavigation] = useState(false);
  const [missingFieldsDialog, setMissingFieldsDialog] = useState<{ rowName: string; missingLabels: string[] }[] | null>(null);

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
    if (creatorDivision) return;
    const saved = localStorage.getItem('fabricExtractionState');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.selectedCategory) setSelectedCategory(parsed.selectedCategory);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const isBatchComplete = stats && stats.total > 0 && stats.done === stats.total;

  useEffect(() => {
    if (extractedRows.length > 0 && !manualNavigation) setCurrentStep('extraction');
  }, [extractedRows.length, manualNavigation]);

  useEffect(() => {
    if (creatorDivision) return;
    localStorage.setItem('fabricExtractionState', JSON.stringify({ selectedCategory, currentStep }));
  }, [selectedCategory, currentStep, creatorDivision]);

  const handleCategorySelect = useCallback(
    (category: SimplifiedCategory | null) => {
      setSelectedCategory(category);
      setSelectedSubDivision(null);
      if (category) {
        setSimplifiedSchema(baseSchema);
        setManualNavigation(false);
        setCurrentStep('upload');
      }
    },
    [baseSchema],
  );

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
        console.warn('Failed to load allowed values for fabric extraction schema', error);
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
    const filtered = baseSchema.map((item) => {
      const majCatValues = getMajCatAllowedValues(division, item.key);
      const isRequired = mandatoryKeys.has(item.key);
      return { ...item, ...(majCatValues ? { allowedValues: majCatValues } : {}), required: isRequired };
    });
    setSimplifiedSchema(filtered);
  }, [baseSchema, selectedCategory]);

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
      if (!selectedSubDivision) return;
      await addImages(fileList);
      if (fileList.length > 0) {
        setManualNavigation(false);
        setCurrentStep('extraction');
      }
    },
    [addImages, selectedSubDivision],
  );

  const handleStartBatch = useCallback(() => {
    if (!selectedSubDivision) return;
    if (selectedCategory && extractAllPending) {
      const subDiv = selectedSubDivision ?? selectedCategory.majorCategory;
      extractAllPending(
        simplifiedSchema,
        selectedCategory.displayName,
        `${selectedCategory.department}-${subDiv}`,
        {},
        'Fabric Article',
      );
    }
  }, [selectedCategory, selectedSubDivision, extractAllPending, simplifiedSchema]);

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
    setSelectedSubDivision(null);
    if (creatorDivision) {
      setSelectedCategory({ department: creatorDivision, majorCategory: '', displayName: creatorDivision });
      setCurrentStep('upload');
    } else {
      setCurrentStep('category');
      setSelectedCategory(null);
      localStorage.removeItem('fabricExtractionState');
    }
  };

  const handleBackToCategory = () => {
    setManualNavigation(true);
    setSelectedSubDivision(null);
    if (creatorDivision) {
      setSelectedCategory({ department: creatorDivision, majorCategory: '', displayName: creatorDivision });
      setCurrentStep('upload');
    } else {
      setSelectedCategory(null);
      setCurrentStep('category');
      localStorage.removeItem('fabricExtractionState');
    }
  };

  const handleGoHome = () => {
    setManualNavigation(true);
    localStorage.removeItem('fabricExtractionState');
    window.location.href = '/dashboard';
  };

  const handleImageClick = useCallback((url: string, name?: string) => {
    setSelectedImage({ url, name });
    setImageModalVisible(true);
  }, []);

  const stepIndex = currentStep === 'category' ? 0 : currentStep === 'upload' ? 1 : 2;

  const stepItems = [
    { title: 'Select Category', icon: <LayoutGrid className="h-4 w-4" /> },
    { title: 'Upload Images', icon: <UploadIcon className="h-4 w-4" /> },
    { title: 'Auto-Extract', icon: <Bot className="h-4 w-4" /> },
  ];

  return (
    <div className="extraction-scroll-page">
      <div className="content-wrapper">
        <Card className="mb-3 border-none" style={{ background: 'linear-gradient(135deg, #6B9E9B 0%, #C4A882 100%)' }}>
          <CardContent className="py-4 text-center">
            <h1 className="m-0 text-2xl font-semibold text-white">Fabric Article Extraction</h1>
            <span className="text-white/90">Division → Category → Upload → Auto-Extract (22 attributes)</span>
          </CardContent>
        </Card>

        <Card className="steps-card mb-3">
          <CardContent className="px-3 py-2">
            <Steps current={stepIndex} items={stepItems} />
          </CardContent>
        </Card>

        <div className="main-grid">
          <div className="left-panel">
            {currentStep === 'category' && (
              <Card className="step-card border border-[#6B9E9B]/50 p-4 card-3d glass">
                <div className="mb-4 text-center">
                  <h4 className="mb-1 text-lg font-semibold text-[#6B9E9B]">Step 1: Select Division</h4>
                  <span className="text-[13px] text-muted-foreground">Choose Division → Sub-Division (Upper/Lower/Sets/Denim)</span>
                </div>
                <SimplifiedCategorySelector
                  key={selectedCategory?.displayName || 'none'}
                  selectedCategory={selectedCategory}
                  onCategorySelect={handleCategorySelect}
                />
              </Card>
            )}

            {currentStep === 'upload' && (
              <Card className="step-card border border-[#C4A882]/50 p-4 card-3d glass">
                <div className="mb-4 text-center">
                  <h4 className="mb-1 text-lg font-semibold text-[#A88D6A]">Step 2: Upload Images</h4>
                  <span className="text-[13px] text-muted-foreground">
                    Division: <strong>{selectedCategory?.department}</strong>
                    {selectedSubDivision ? <> · Sub-Division: <strong>{selectedSubDivision}</strong></> : null}
                    {' '}· Upload images to auto-start extraction
                  </span>
                </div>

                {!creatorDivision && (
                  <div className="mb-3">
                    <Button onClick={handleBackToCategory} variant="link" size="sm" className="pl-0">
                      ← Change Division
                    </Button>
                  </div>
                )}

                <div className="mb-5">
                  <span className="mb-2 block text-sm font-semibold">
                    {creatorDivision ? '1.' : '2.'} Sub-Division
                  </span>
                  <Select
                    value={selectedSubDivision ?? ''}
                    onValueChange={(value: string) => {
                      setSelectedSubDivision(value);
                      setSelectedCategory((prev) =>
                        prev ? { ...prev, majorCategory: value, displayName: `${prev.department} - ${value}` } : prev,
                      );
                    }}
                  >
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Select Sub-Division (e.g. MU, MW, LU, LW…)" />
                    </SelectTrigger>
                    <SelectContent>
                      {(SIMPLIFIED_HIERARCHY[selectedCategory?.department ?? ''] || []).map((sub) => (
                        <SelectItem key={sub} value={sub}>
                          {sub}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!selectedSubDivision && (
                  <Alert
                    type="warning"
                    className="mb-3"
                    message="Please select a Sub-Division before uploading images."
                  />
                )}

                <Alert
                  type="info"
                  showIcon
                  className="mb-4"
                  message="Simplified Workflow Active"
                  description="No metadata form required. Extraction will start automatically after upload with fixed 42 attributes."
                />

                <div className={selectedSubDivision ? '' : 'pointer-events-none opacity-40'}>
                  <UploadArea
                    onUpload={async (_file: File, fileList: File[]) => {
                      await handleImagesUpload(fileList);
                      return false;
                    }}
                  />
                </div>
              </Card>
            )}

            {currentStep === 'extraction' && extractedRows.length > 0 && (
              <Card className="step-card border border-[#A7B6D9]/50 px-4 py-3 card-3d glass">
                <div className="mb-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h5 className="m-0 mr-3 inline-block text-base font-semibold text-[#7F8EB8]">Step 3: Auto-Extraction Results</h5>
                      <span className="text-xs text-muted-foreground">
                        {selectedCategory?.displayName} | {extractedRows.length} images | 22 attributes
                      </span>
                    </div>
                    {stats && (
                      <div className="flex items-center gap-4 text-xs">
                        <span>
                          <span className="font-bold text-[#7BAF7A]">{stats.done}</span> Done
                        </span>
                        <span>
                          <span className="font-bold text-[#CFAF7F]">{stats.pending}</span> Pending
                        </span>
                        <span>
                          <span className="font-bold text-[#7F8EB8]">{Math.round(stats.successRate)}%</span> Success
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {stats.pending > 0 && !isExtracting && (
                  <Alert
                    type="info"
                    showIcon
                    className="mb-3"
                    message="Ready to Extract"
                    description={`${stats.pending} image(s) ready for AI extraction. Click "Start Batch" to begin.`}
                  />
                )}

                {isExtracting && !isBatchComplete && (
                  <Progress value={Math.round(progress)} indicatorClassName="bg-gradient-to-r from-[#6B9E9B] to-[#C4A882]" className="mb-3" />
                )}

                {isBatchComplete && (
                  <Alert
                    type="success"
                    showIcon
                    className="mb-3"
                    message="Extraction Complete!"
                    description={
                      <div className="mt-2 grid grid-cols-3 gap-4">
                        <Statistic title="Processed" value={stats.done} prefix={<CheckCircle2 className="h-4 w-4" />} valueStyle={{ fontSize: 20, color: '#7BAF7A' }} />
                        <Statistic title="Success Rate" value={Math.round(stats.successRate)} suffix="%" valueStyle={{ fontSize: 20, color: '#7F8EB8' }} />
                        <Statistic title="Auto-Validated" value="Enabled" valueStyle={{ fontSize: 16, color: '#7F8EB8' }} />
                      </div>
                    }
                  />
                )}

                <div className="mb-3 flex items-center justify-between">
                  <Button
                    onClick={() => {
                      setManualNavigation(true);
                      setCurrentStep('upload');
                    }}
                    variant="link"
                    size="sm"
                    className="pl-0"
                  >
                    ← Back to Upload
                  </Button>
                  <div className="flex items-center gap-2">
                    {!isExtracting && stats.pending > 0 && (
                      <Button
                        size="lg"
                        onClick={handleStartBatch}
                        disabled={!selectedSubDivision}
                        title={!selectedSubDivision ? 'Go back and select a Sub-Division first' : undefined}
                        className="border-none font-semibold"
                        style={
                          selectedSubDivision
                            ? { background: 'linear-gradient(135deg, #6B9E9B 0%, #C4A882 100%)' }
                            : undefined
                        }
                      >
                        <Bot />
                        Start Batch ({stats.pending})
                      </Button>
                    )}
                    <Button disabled={stats?.done === 0} onClick={handleExportClick}>
                      <Download />
                      Export Results
                    </Button>
                    {stats && stats.done === stats.total && stats.total > 0 && (
                      <Button variant="outline" onClick={handleGoHome}>
                        Go Home
                      </Button>
                    )}
                    <Button variant="destructive" onClick={handleStartOver}>
                      <Eraser />
                      Start Over
                    </Button>
                  </div>
                </div>

                <div className="mb-3 rounded-lg bg-muted/40 p-3">
                  <strong>Extraction Results</strong>
                  <br />
                  <span className="text-xs text-muted-foreground">Results are validated automatically. Low-confidence values are hidden.</span>
                </div>

                <AttributeTable
                  extractedRows={extractedRows}
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
              </Card>
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

export default FabricExtractionPage;
