import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Descriptions,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import type { SchemaItem } from '../../../shared/types/extraction/ExtractionTypes';
import { exportToExcel, mapMasterAttributes } from '../../../shared/utils/export/extractionExport';
import { SIMPLE_APPROVER_EXPORT_HEADERS } from '../../approver/pages/ApproverDashboard';
import { getImageUrl } from '../../../shared/utils/common/helpers';
import { calculateMrpFromRate } from '../../../shared/utils/common/pricing';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import './Products.css';

type ProductRow = {
  key: string;
  jobId: string;
  userId?: string | null;
  name: string;
  productType: string;
  vendor: string;
  status: 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'PENDING';
  rawStatus?: string | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  sapSyncStatus?: 'NOT_SYNCED' | 'PENDING' | 'SYNCED' | 'FAILED' | null;
  createdAt: string;
  createdAtTs?: number;
  updatedAt: string;
  updatedAtTs?: number;
  userName?: string | null;
  userEmail?: string | null;
  imageUrl?: string | null;
  results?: Array<{
    attribute?: { key?: string | null; label?: string | null } | null;
    rawValue?: string | number | null;
    finalValue?: string | number | null;
    confidence?: number | null;
  }>;
  flatData?: any;
};

type EditableAttributeDefinition = {
  key: string;
  label: string;
  field: string;
};

type HierarchySubDivision = {
  id: number;
  code: string;
  name: string;
  departmentId?: number;
  department?: { id?: number; code?: string; name?: string } | null;
};

const EDITABLE_ATTRIBUTE_DEFINITIONS: EditableAttributeDefinition[] = [
  { key: 'division', label: 'Division', field: 'division' },
  { key: 'sub_division', label: 'Sub-Division', field: 'subDivision' },
  { key: 'major_category', label: 'Major Category', field: 'majorCategory' },
  { key: 'design_number', label: 'Design Number', field: 'designNumber' },
  { key: 'vendor_name', label: 'Vendor Name', field: 'vendorName' },
  { key: 'reference_article_number', label: 'Reference Article Number', field: 'referenceArticleNumber' },
  { key: 'reference_article_description', label: 'Reference Article Description', field: 'referenceArticleDescription' },
  { key: 'rate', label: 'Rate/Cost', field: 'rate' },
  { key: 'mrp', label: 'MRP', field: 'mrp' },
  { key: 'imp_atrbt_2', label: 'IMP_ATRBT-2', field: 'impAtrbt2' },
  { key: 'macro_mvgr', label: 'OTHER MVGR', field: 'macroMvgr' },
  { key: 'yarn_01', label: 'F_YARN', field: 'yarn1' },
  { key: 'main_mvgr', label: 'F_FABRIC MAIN MVGR-01', field: 'mainMvgr' },
  { key: 'fabric_main_mvgr', label: 'F_FABRIC MAIN MVGR-02', field: 'fabricMainMvgr' },
  { key: 'weave', label: 'F_WEAVE_01', field: 'weave' },
  { key: 'm_fab2', label: 'F_WEAVE_02', field: 'mFab2' },
  { key: 'composition', label: 'F_COMP', field: 'composition' },
  { key: 'f_count', label: 'F_COUNT', field: 'fCount' },
  { key: 'f_construction', label: 'F_CONSTRUCTION', field: 'fConstruction' },
  { key: 'lycra_non_lycra', label: 'F_STRETCH', field: 'lycra' },
  { key: 'finish', label: 'F_FINISH', field: 'finish' },
  { key: 'gsm', label: 'F_GSM_GLM', field: 'gsm' },
  { key: 'f_ounce', label: 'F_OUNCE', field: 'fOunce' },
  { key: 'f_width', label: 'F_WIDTH', field: 'fWidth' },
  { key: 'collar', label: 'COLLAR TYPE', field: 'collar' },
  { key: 'collar_style', label: 'COLLAR STYLE', field: 'collarStyle' },
  { key: 'neck', label: 'NECK TYPE', field: 'neck' },
  { key: 'neck_details', label: 'NECK STYLE', field: 'neckDetails' },
  { key: 'placket', label: 'PLACKET', field: 'placket' },
  { key: 'father_belt', label: 'BELT', field: 'fatherBelt' },
  { key: 'sleeve', label: 'SLEEVE', field: 'sleeve' },
  { key: 'sleeve_fold', label: 'SLEEVE FOLD', field: 'sleeveFold' },
  { key: 'bottom_fold', label: 'BOTTOM FOLD', field: 'bottomFold' },
  { key: 'no_of_pocket', label: 'NO. OF POCKET', field: 'noOfPocket' },
  { key: 'pocket_type', label: 'POCKET TYPE', field: 'pocketType' },
  { key: 'extra_pocket', label: 'EXTRA POCKET', field: 'extraPocket' },
  { key: 'fit', label: 'FIT', field: 'fit' },
  { key: 'body_style', label: 'BODY STYLE', field: 'pattern' },
  { key: 'length', label: 'LENGTH', field: 'length' },
  { key: 'drawcord', label: 'DC_TYPE', field: 'drawcord' },
  { key: 'dc_shape', label: 'DC_SHAPE', field: 'dcShape' },
  { key: 'button', label: 'BTN_TYPE', field: 'button' },
  { key: 'btn_colour', label: 'BTN_CLR', field: 'btnColour' },
  { key: 'zipper', label: 'ZIP_TYPE', field: 'zipper' },
  { key: 'zip_colour', label: 'ZIP_CLR', field: 'zipColour' },
  { key: 'patches', label: 'PATCH_TYPE', field: 'patches' },
  { key: 'patches_type', label: 'PATCH_STYLE', field: 'patchesType' },
  { key: 'print_type', label: 'PRT_TYPE', field: 'printType' },
  { key: 'print_style', label: 'PRT_STYLE', field: 'printStyle' },
  { key: 'print_placement', label: 'PRT_PLCMNT', field: 'printPlacement' },
  { key: 'embroidery', label: 'EMB_TYPE', field: 'embroidery' },
  { key: 'embroidery_type', label: 'EMB_STYLE', field: 'embroideryType' },
  { key: 'wash', label: 'WASH', field: 'wash' },
];

type VariantRow = {
  id: string;
  variantSize: string | null;
  variantColor: string | null;
  approvalStatus: string | null;
  majorCategory: string | null;
};

const VariantReadOnlySubTable: React.FC<{ jobId: string }> = ({ jobId }) => {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('authToken');
        const resp = await fetch(
          `${APP_CONFIG.api.baseURL}/approver/items/${encodeURIComponent(jobId)}/variants`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        if (!resp.ok) return;
        const result = await resp.json();
        const data: VariantRow[] = (result.data || result).map((v: any) => ({
          id: String(v.id),
          variantSize: v.variantSize ?? null,
          variantColor: v.variantColor ?? null,
          approvalStatus: v.approvalStatus ?? null,
          majorCategory: v.majorCategory ?? null,
        }));
        setVariants(data);
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-3">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Loading variants…</span>
      </div>
    );
  }
  if (variants.length === 0) {
    return <span className="block px-4 py-2 text-sm text-muted-foreground">No variants for this article.</span>;
  }

  const variantColumns: DataTableColumn<VariantRow>[] = [
    { title: 'Size', dataIndex: 'variantSize', key: 'variantSize', width: 90, render: (v) => v || <span className="text-muted-foreground">—</span> },
    {
      title: 'Color',
      dataIndex: 'variantColor',
      key: 'variantColor',
      width: 140,
      render: (v) => (v ? <Badge variant="info">{v}</Badge> : <span className="text-muted-foreground">—</span>),
    },
    {
      title: 'Status',
      dataIndex: 'approvalStatus',
      key: 'approvalStatus',
      width: 110,
      render: (status: string | null) => {
        const s = status || 'PENDING';
        const variant = s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'warning';
        return <Badge variant={variant as any}>{s}</Badge>;
      },
    },
    { title: 'Major Category', dataIndex: 'majorCategory', key: 'majorCategory', width: 160, render: (v) => v || <span className="text-muted-foreground">—</span> },
  ];

  return (
    <div className="rounded-md bg-muted/30 p-3">
      <strong className="mb-2 block text-[13px]">Variants ({variants.length})</strong>
      <DataTable<VariantRow> dataSource={variants} columns={variantColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
    </div>
  );
};

export default function Products() {
  const user = localStorage.getItem('user');
  const userData = useMemo(() => {
    if (!user) return null;
    try {
      return JSON.parse(user);
    } catch {
      return null;
    }
  }, [user]);
  const normalizedRole = String(userData?.role || '').toUpperCase();
  const isAdmin = normalizedRole === 'ADMIN';
  const isCreatorLike = normalizedRole === 'CREATOR' || normalizedRole === 'PO_COMMITTEE';
  const currentUserId = userData?.id ? String(userData.id) : null;
  const currentUserEmail = userData?.email ? String(userData.email).toLowerCase() : null;

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // Debounced copy of `search`. Typing updates `search` instantly (so the input
  // stays responsive) but the expensive `filteredRows` re-computation — which
  // scans/maps every row — only re-runs 250ms after the user stops typing,
  // instead of on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null);
  const [detailsRow, setDetailsRow] = useState<ProductRow | null>(null);
  const [editingRow, setEditingRow] = useState<ProductRow | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editInitialValues, setEditInitialValues] = useState<Record<string, string>>({});
  const [savingEdits, setSavingEdits] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [masterAttributes, setMasterAttributes] = useState<SchemaItem[]>([]);
  const [allSubDivisions, setAllSubDivisions] = useState<HierarchySubDivision[]>([]);
  const [divisionFilter, setDivisionFilter] = useState<string>('ALL');
  const [subDivisionFilter, setSubDivisionFilter] = useState<string>('ALL');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(500);
  const recalcScrollY = useCallback(() => {
    const el = tableWrapperRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    setScrollY(Math.max(200, window.innerHeight - top - 35 - 40 - 16 - 8));
  }, []);
  useEffect(() => {
    recalcScrollY();
    window.addEventListener('resize', recalcScrollY);
    return () => window.removeEventListener('resize', recalcScrollY);
  }, [recalcScrollY]);

  const normalizeStatus = useCallback((status?: string | null): ProductRow['status'] => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed' || normalized === 'complete') return 'COMPLETED';
    if (normalized === 'error' || normalized === 'failed' || normalized === 'fail') return 'FAILED';
    if (normalized === 'processing' || normalized === 'extracting') return 'PROCESSING';
    return 'PENDING';
  }, []);

  const getDisplayStatus = useCallback(
    (flat: any): ProductRow['status'] => {
      const approvalStatus = String(flat?.approvalStatus || '').toUpperCase();
      const sapSyncStatus = String(flat?.sapSyncStatus || '').toUpperCase();
      const extractionStatus = normalizeStatus(flat?.extractionStatus);
      if (approvalStatus === 'REJECTED') return 'FAILED';
      if (approvalStatus === 'APPROVED') return 'COMPLETED';
      if (sapSyncStatus === 'FAILED') return 'FAILED';
      return extractionStatus;
    },
    [normalizeStatus],
  );

  const canEditRow = useCallback(
    (row: ProductRow) => {
      if (isAdmin) return true;
      const approvalStatus = String(row.approvalStatus || row.flatData?.approvalStatus || '').toUpperCase();
      const sapSyncStatus = String(row.sapSyncStatus || row.flatData?.sapSyncStatus || '').toUpperCase();
      if (approvalStatus !== 'APPROVED') return true;
      return sapSyncStatus !== 'SYNCED';
    },
    [isAdmin],
  );

  const normalizeAttrKey = useCallback((key: string) => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, ''), []);

  const attributeOptionsByKey = useMemo(() => {
    const map = new Map<string, Array<{ label: string; value: string }>>();
    masterAttributes.forEach((attr) => {
      const options = (attr.allowedValues || [])
        .map((value) => {
          const short = (value?.shortForm || '').trim();
          const full = (value?.fullForm || '').trim();
          if (!short && !full) return null;
          const optionValue = short || full;
          const optionLabel = full && short ? `${short} - ${full}` : optionValue;
          return { label: optionLabel, value: optionValue };
        })
        .filter((item): item is { label: string; value: string } => !!item);
      if (options.length > 0) map.set(normalizeAttrKey(attr.key), options);
    });
    return map;
  }, [masterAttributes, normalizeAttrKey]);

  const buildDetailsRows = useCallback((row: ProductRow) => {
    if (row.results && row.results.length > 0) {
      return row.results
        .filter((item) => {
          const raw = item.rawValue;
          const final = item.finalValue;
          const hasRaw = typeof raw === 'string' ? raw.trim() !== '' : raw !== null && raw !== undefined;
          const hasFinal = typeof final === 'string' ? final.trim() !== '' : final !== null && final !== undefined;
          return hasRaw || hasFinal;
        })
        .map((item) => ({
          attribute: item.attribute,
          rawValue: item.rawValue ?? '—',
          finalValue: item.finalValue ?? '—',
          confidence: item.confidence,
        }));
    }
    const flatData = row.flatData || row;
    const attributeMapping: Array<{ key: string; label: string; value: any }> = [
      { key: 'article_number', label: 'Article Number', value: flatData.articleNumber || flatData.imageName },
      ...EDITABLE_ATTRIBUTE_DEFINITIONS.map((item) => ({
        key: item.key,
        label: item.label,
        value: item.field === 'division' ? formatDivisionLabel(flatData[item.field]) : flatData[item.field],
      })),
    ];
    return attributeMapping
      .filter((attr) => attr.value !== null && attr.value !== undefined && attr.value !== '')
      .map((attr) => ({
        attribute: { key: attr.key, label: attr.label },
        rawValue: String(attr.value),
        finalValue: String(attr.value),
        confidence: flatData.avgConfidence ? Number(flatData.avgConfidence) : undefined,
      }));
  }, []);

  const buildExportData = useCallback((items: ProductRow[]) => {
    return items.map((row) => {
      const flat = row.flatData || {};
      const createdAt = flat.createdAt ? new Date(flat.createdAt) : null;
      const formattedDate = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString('en-GB') : '';
      return {
        'Article Number': flat.articleNumber || flat.imageName || '',
        Division: flat.division || '',
        'Sub Division': flat.subDivision || '',
        'Major Category': flat.majorCategory || '',
        Status: flat.approvalStatus || '',
        'Vendor Name': flat.vendorName || '',
        'Vendor Code': flat.vendorCode || '',
        'Design Number': flat.designNumber || '',
        'PPT Number': flat.pptNumber || '',
        Rate: flat.rate == null ? undefined : Number(flat.rate),
        MRP: flat.mrp == null ? undefined : Number(flat.mrp),
        Size: flat.size || '',
        Pattern: flat.pattern || '',
        Fit: flat.fit || '',
        Wash: flat.wash || '',
        'Macro MVGR': flat.macroMvgr || '',
        'Main MVGR': flat.mainMvgr || '',
        'Yarn 1': flat.yarn1 || '',
        'Fabric Main MVGR': flat.fabricMainMvgr || '',
        Weave: flat.weave || '',
        'M FAB 2': flat.mFab2 || '',
        Composition: flat.composition || '',
        Finish: flat.finish || '',
        GSM: flat.gsm || '',
        Weight: flat.weight || '',
        Lycra: flat.lycra || '',
        Shade: flat.shade || '',
        Neck: flat.neck || '',
        'Neck Details': flat.neckDetails || '',
        Sleeve: flat.sleeve || '',
        Length: flat.length || '',
        Collar: flat.collar || '',
        Placket: flat.placket || '',
        'Bottom Fold': flat.bottomFold || '',
        'Front Open Style': flat.frontOpenStyle || '',
        'Pocket Type': flat.pocketType || '',
        Drawcord: flat.drawcord || '',
        Button: flat.button || '',
        Zipper: flat.zipper || '',
        'Zip Colour': flat.zipColour || '',
        'Father Belt': flat.fatherBelt || '',
        'Child Belt': flat.childBelt || '',
        'Print Type': flat.printType || '',
        'Print Style': flat.printStyle || '',
        'Print Placement': flat.printPlacement || '',
        Patches: flat.patches || '',
        'Patches Type': flat.patchesType || '',
        Embroidery: flat.embroidery || '',
        'Embroidery Type': flat.embroideryType || '',
        'Reference Article Number': flat.referenceArticleNumber || '',
        'Reference Article Description': flat.referenceArticleDescription || '',
        'MC Code': flat.mcCode || '',
        Segment: flat.segment || '',
        Season: flat.season || '',
        'HSN Tax Code': flat.hsnTaxCode || '',
        'Article Description': flat.articleDescription || '',
        'Fashion Grid': flat.fashionGrid || '',
        Year: flat.year || '',
        'Article Type': flat.articleType || '',
        'Extracted By': flat.userName || '',
        'Created Date': formattedDate,
      };
    });
  }, []);

  const handleView = useCallback((row: ProductRow) => {
    if (!row.imageUrl) {
      message.warning('No image available for this extraction');
      return;
    }
    setSelectedImage({ url: row.imageUrl, name: row.name });
  }, []);

  const handleViewDetails = useCallback((row: ProductRow) => setDetailsRow(row), []);

  const handleOpenEdit = useCallback((row: ProductRow) => {
    const values: Record<string, string> = {};
    EDITABLE_ATTRIBUTE_DEFINITIONS.forEach((item) => {
      const raw = row.flatData?.[item.field];
      values[item.key] = raw === null || raw === undefined ? '' : String(raw);
    });
    setEditingRow(row);
    setEditValues(values);
    setEditInitialValues(values);
  }, []);

  const handleSaveEdits = useCallback(async () => {
    if (!editingRow) return;
    const token = localStorage.getItem('authToken');
    if (!token) {
      message.error('Unauthorized');
      return;
    }
    const changed = EDITABLE_ATTRIBUTE_DEFINITIONS.map((item) => ({
      ...item,
      newValue: (editValues[item.key] ?? '').trim(),
      oldValue: (editInitialValues[item.key] ?? '').trim(),
    })).filter((item) => item.newValue !== item.oldValue);
    if (changed.length === 0) {
      message.info('No changes to save');
      return;
    }
    setSavingEdits(true);
    try {
      for (const item of changed) {
        const response = await fetch(
          `${APP_CONFIG.api.baseURL}/user/extraction/history/flat/job/${encodeURIComponent(editingRow.jobId)}/attribute`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ attributeKey: item.key, value: item.newValue }),
          },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Failed to save ${item.label}`);
        }
      }
      setRows((prev) =>
        prev.map((row) => {
          if (row.jobId !== editingRow.jobId) return row;
          const nextFlatData = { ...(row.flatData || {}) };
          EDITABLE_ATTRIBUTE_DEFINITIONS.forEach((item) => {
            if (Object.prototype.hasOwnProperty.call(editValues, item.key)) {
              nextFlatData[item.field] = (editValues[item.key] ?? '').trim() || null;
            }
          });
          const nextRow: ProductRow = {
            ...row,
            name: nextFlatData.imageName || nextFlatData.designNumber || nextFlatData.jobId,
            productType: nextFlatData.majorCategory || '—',
            vendor: nextFlatData.vendorName || '—',
            flatData: nextFlatData,
          };
          nextRow.results = buildDetailsRows(nextRow);
          return nextRow;
        }),
      );
      message.success('Attributes updated successfully');
      setEditingRow(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to save changes');
    } finally {
      setSavingEdits(false);
    }
  }, [buildDetailsRows, editInitialValues, editValues, editingRow]);

  const handleExport = useCallback(
    async (row: ProductRow) => {
      if (!row.results || row.results.length === 0 || row.status !== 'COMPLETED') {
        message.warning('No completed extraction to export');
        return;
      }
      const exportData = buildExportData([row]);
      await exportToExcel(exportData, [...SIMPLE_APPROVER_EXPORT_HEADERS], [], row.productType || 'results');
    },
    [buildExportData],
  );

  const selectedRowsMemo = useMemo(() => rows.filter((r) => selectedRowKeys.includes(r.key)), [rows, selectedRowKeys]);

  const handleBulkExport = useCallback(async () => {
    if (selectedRowsMemo.length === 0) {
      message.warning('Select at least one product to export');
      return;
    }
    const completedRows = selectedRowsMemo.filter(
      (row) => row.status === 'COMPLETED' && row.results && row.results.length > 0,
    );
    if (completedRows.length === 0) {
      message.warning('No completed extractions in the selection');
      return;
    }
    if (completedRows.length !== selectedRowsMemo.length) {
      message.info('Some selected items are not completed and will be skipped');
    }
    const exportData = buildExportData(completedRows);
    await exportToExcel(exportData, [...SIMPLE_APPROVER_EXPORT_HEADERS], [], 'bulk');
  }, [buildExportData, selectedRowsMemo]);

  const statusVariant = (s: ProductRow['status']): 'success' | 'destructive' | 'info' | 'warning' =>
    s === 'COMPLETED' ? 'success' : s === 'FAILED' ? 'destructive' : s === 'PROCESSING' ? 'info' : 'warning';

  useEffect(() => {
    const fetchRows = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${APP_CONFIG.api.baseURL}/user/extraction/history/flat`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) throw new Error('Failed to fetch extraction history');
        const result = await response.json();
        const flatJobs = result?.data?.jobs || [];
        const userScopedJobs = isCreatorLike
          ? flatJobs.filter((flat: any) => {
              const flatUserId = flat?.userId ? String(flat.userId) : null;
              const flatUserEmail = flat?.userEmail ? String(flat.userEmail).toLowerCase() : null;
              if (currentUserId && flatUserId) return flatUserId === currentUserId;
              if (currentUserEmail && flatUserEmail) return flatUserEmail === currentUserEmail;
              return false;
            })
          : flatJobs;
        const mapped: ProductRow[] = userScopedJobs
          .map((flat: any, index: number) => {
            const createdAtDate = flat.createdAt ? new Date(flat.createdAt) : null;
            const updatedAtDate = flat.updatedAt ? new Date(flat.updatedAt) : null;
            const row: ProductRow = {
              key: String(flat.id ?? flat.jobId ?? `${flat.imageName || 'row'}-${index}`),
              jobId: String(flat.jobId || flat.id || ''),
              userId: flat.userId ? String(flat.userId) : null,
              name: flat.imageName || flat.designNumber || flat.jobId,
              productType: flat.majorCategory || '—',
              vendor: flat.vendorName || '—',
              status: getDisplayStatus(flat),
              rawStatus: flat.extractionStatus,
              approvalStatus: flat.approvalStatus || null,
              sapSyncStatus: flat.sapSyncStatus || null,
              createdAt: createdAtDate ? createdAtDate.toLocaleString() : '—',
              createdAtTs: createdAtDate ? createdAtDate.getTime() : 0,
              updatedAt: updatedAtDate ? updatedAtDate.toLocaleString() : '—',
              updatedAtTs: updatedAtDate ? updatedAtDate.getTime() : 0,
              userName: flat.userName,
              userEmail: flat.userEmail || null,
              imageUrl: getImageUrl(flat.imageUrl) || null,
              results: [],
              flatData: flat,
            };
            row.results = buildDetailsRows(row);
            return row;
          })
          .sort((a: ProductRow, b: ProductRow) => {
            const byCreated = (b.createdAtTs || 0) - (a.createdAtTs || 0);
            if (byCreated !== 0) return byCreated;
            const byUpdated = (b.updatedAtTs || 0) - (a.updatedAtTs || 0);
            if (byUpdated !== 0) return byUpdated;
            return b.key.localeCompare(a.key);
          });
        setRows(mapped);
        localStorage.setItem('extractionsLastUpdated', `${Date.now()}`);
        setTimeout(recalcScrollY, 50);
      } catch {
        message.error('Unable to load extraction history');
      } finally {
        setLoading(false);
      }
    };
    fetchRows();
  }, [currentUserEmail, currentUserId, isAdmin, isCreatorLike, getDisplayStatus, buildDetailsRows, recalcScrollY]);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${APP_CONFIG.api.baseURL}/user/attributes?includeValues=true`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const result = await response.json().catch(() => null);
        const data = result?.data;
        if (!Array.isArray(data)) return;
        setMasterAttributes(mapMasterAttributes(data));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const normalizeDivision = (v: string) => (v === 'MEN' ? 'MENS' : v);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${APP_CONFIG.api.baseURL}/user/sub-departments`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const result = await response.json().catch(() => null);
        const data = result?.data;
        if (!Array.isArray(data)) return;
        setAllSubDivisions(data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const divisionOptions = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach((r) => {
      const v = r.flatData?.division;
      if (v) seen.add(normalizeDivision(String(v).toUpperCase()));
    });
    return Array.from(seen).sort();
  }, [rows]);

  const subDivisionOptions = useMemo(() => {
    const seen = new Set<string>();
    allSubDivisions.forEach((subDivision) => {
      const parentDivision = normalizeDivision(String(subDivision.department?.code || subDivision.department?.name || '').toUpperCase());
      if (divisionFilter !== 'ALL' && parentDivision !== divisionFilter) return;
      const value = String(subDivision.code || '').toUpperCase().trim();
      if (value) seen.add(value);
    });
    if (seen.size === 0) {
      rows.forEach((r) => {
        if (divisionFilter !== 'ALL' && normalizeDivision(String(r.flatData?.division || '').toUpperCase()) !== divisionFilter) return;
        const v = r.flatData?.subDivision;
        if (v) seen.add(String(v).toUpperCase());
      });
    }
    return Array.from(seen).sort();
  }, [allSubDivisions, rows, divisionFilter]);

  const showDivisionFilter = isAdmin || divisionOptions.length > 1;
  const showSubDivisionFilter = subDivisionOptions.length > 1;

  useEffect(() => {
    if (subDivisionFilter !== 'ALL' && !subDivisionOptions.includes(subDivisionFilter)) {
      setSubDivisionFilter('ALL');
    }
  }, [subDivisionFilter, subDivisionOptions]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const filteredRows = useMemo(
    () =>
      rows
        .filter((row) => {
          if (divisionFilter !== 'ALL' && normalizeDivision(String(row.flatData?.division || '').toUpperCase()) !== divisionFilter) return false;
          if (subDivisionFilter !== 'ALL' && String(row.flatData?.subDivision || '').toUpperCase() !== subDivisionFilter) return false;
          const haystack = `${row.name} ${row.productType} ${row.vendor} ${row.userName || ''} ${row.userEmail || ''}`.toLowerCase();
          return haystack.includes(debouncedSearch.toLowerCase());
        })
        // Pre-compute the "Extracted Data" preview once per row so the column
        // render is a cheap string lookup instead of filter+slice+map on every
        // scroll/checkbox tick.
        .map((row) => {
          if ((row as any).__extractedPreview !== undefined) return row;
          const items = (row.results || [])
            .filter((item) => {
              const raw = item.rawValue;
              const final = item.finalValue;
              const hasRaw = typeof raw === 'string' ? raw.trim() !== '' : raw !== null && raw !== undefined;
              const hasFinal = typeof final === 'string' ? final.trim() !== '' : final !== null && final !== undefined;
              return hasRaw || hasFinal;
            })
            .slice(0, 6)
            .map((item) => `${item.attribute?.label || item.attribute?.key}: ${item.finalValue ?? item.rawValue ?? '—'}`);
          (row as any).__extractedPreview = items.length > 0 ? items.join(', ') : '';
          return row;
        }),
    [rows, divisionFilter, subDivisionFilter, debouncedSearch],
  );

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedRowKeys.includes(r.key));
  const someSelected = filteredRows.some((r) => selectedRowKeys.includes(r.key));

  const columns = useMemo<DataTableColumn<ProductRow>[]>(() => {
    return [
      {
        title: (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected;
            }}
            onChange={(e) => {
              if (e.target.checked) setSelectedRowKeys(filteredRows.map((r) => r.key));
              else setSelectedRowKeys([]);
            }}
          />
        ),
        key: '__select__',
        width: 36,
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={selectedRowKeys.includes(row.key)}
            onChange={() =>
              setSelectedRowKeys((prev) => (prev.includes(row.key) ? prev.filter((k) => k !== row.key) : [...prev, row.key]))
            }
          />
        ),
      },
      {
        title: '',
        key: '__expand__',
        width: 36,
        render: (_v, row) => (
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => toggleExpand(row.key)}
          >
            {expandedRows.has(row.key) ? '▾' : '▸'}
          </button>
        ),
      },
      {
        title: 'Image',
        key: 'image',
        render: (_v, row) => (
          <div className="h-16 w-16 overflow-hidden rounded-xl bg-muted">
            {row.imageUrl ? (
              <img
                src={row.imageUrl}
                alt={row.name}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : null}
          </div>
        ),
      },
      {
        title: 'Extracted Data',
        key: 'extractedData',
        render: (_v, row) => {
          const preview = (row as any).__extractedPreview as string | undefined;
          return (
            <div className="max-w-[420px]">
              {preview ? (
                <span className="text-xs text-muted-foreground">{preview}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      ...(isAdmin
        ? [
            {
              title: 'User',
              key: 'user',
              render: (_v: any, row: ProductRow) => (
                <div>
                  <div>{row.userName || '—'}</div>
                  <span className="text-xs text-muted-foreground">{row.userEmail || ''}</span>
                </div>
              ),
            } as DataTableColumn<ProductRow>,
          ]
        : []),
      { title: 'Created At', dataIndex: 'createdAt', key: 'createdAt' },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (status: ProductRow['status']) => (
          <Badge variant={statusVariant(status)} className="products-status-tag">
            {status}
          </Badge>
        ),
      },
      {
        title: 'Actions',
        key: 'actions',
        render: (_v, row) => (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => handleView(row)} disabled={!row.imageUrl}>
              View Image
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleViewDetails(row)}>
              Details
            </Button>
            {isCreatorLike ? (
              <Button size="sm" variant="outline" disabled title="Editing is not allowed for Creator role">
                Edit
              </Button>
            ) : canEditRow(row) ? (
              <Button size="sm" variant="outline" onClick={() => handleOpenEdit(row)}>
                Edit
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => handleExport(row)} disabled={!row.results?.length || row.status !== 'COMPLETED'}>
              Download
            </Button>
          </div>
        ),
      },
    ];
  }, [
    allSelected,
    someSelected,
    selectedRowKeys,
    filteredRows,
    expandedRows,
    canEditRow,
    handleExport,
    handleOpenEdit,
    handleView,
    handleViewDetails,
    isAdmin,
  ]);

  // Render-time row interleaving for expanded rows.
  // Build a synthetic dataSource that contains an extra "expanded" row right after each expanded source row.
  const dataWithExpanded = useMemo(() => {
    const out: (ProductRow & { __expandedFor?: string })[] = [];
    for (const row of filteredRows) {
      out.push(row);
      if (expandedRows.has(row.key)) {
        out.push({ ...row, key: `__expanded__${row.key}`, __expandedFor: row.key } as ProductRow & { __expandedFor: string });
      }
    }
    return out;
  }, [filteredRows, expandedRows]);

  // Patch column renders to render the expanded sub-table for "__expandedFor" rows
  const finalColumns = useMemo<DataTableColumn<ProductRow & { __expandedFor?: string }>[]>(() => {
    return columns.map((col, ci) => ({
      ...col,
      render: (v: any, record: any, idx: number) => {
        if (record.__expandedFor) {
          if (ci === 0) {
            return (
              <div style={{ gridColumn: '1 / -1' }}>
                <VariantReadOnlySubTable jobId={record.flatData?.id || record.jobId} />
              </div>
            );
          }
          return null;
        }
        return col.render ? col.render(v, record, idx) : (v as React.ReactNode);
      },
    }));
  }, [columns]);

  return (
    <div className="products-page">
      <div className="products-hero">
        <div className="flex items-baseline gap-3">
          <h4 className="products-title m-0 text-lg font-semibold">History</h4>
          <span className="text-xs text-muted-foreground">Extraction history with export options.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDivisionFilter && (
            <Select
              value={divisionFilter}
              onValueChange={(v) => {
                setDivisionFilter(v);
                setSubDivisionFilter('ALL');
              }}
            >
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Divisions</SelectItem>
                {divisionOptions.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showSubDivisionFilter && (
            <Select value={subDivisionFilter} onValueChange={setSubDivisionFilter}>
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sub-Divs</SelectItem>
                {subDivisionOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={handleBulkExport} disabled={selectedRowsMemo.length === 0}>
            Bulk Download
          </Button>
          <Input
            prefix={<Search className="h-4 w-4" />}
            placeholder="Search history"
            className="products-search h-8"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        </div>
      </div>

      <Card className="products-table-card">
        <CardContent className="px-2 py-1.5">
          <div ref={tableWrapperRef}>
            <DataTable<ProductRow & { __expandedFor?: string }>
              columns={finalColumns}
              dataSource={dataWithExpanded}
              rowKey="key"
              size="small"
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                pageSizeOptions: ['50', '100', '200'],
              }}
              className="products-table"
              loading={loading}
              locale={{ emptyText: <Empty description="No extraction history yet" /> }}
              scroll={{ x: 'max-content', y: scrollY }}
              sticky
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedImage} onOpenChange={(o) => !o && setSelectedImage(null)}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{selectedImage?.name || 'Uploaded Image'}</DialogTitle>
          </DialogHeader>
          {selectedImage?.url ? <img src={selectedImage.url} alt={selectedImage.name} className="w-full" /> : <Empty description="No image available" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailsRow} onOpenChange={(o) => !o && setDetailsRow(null)}>
        <DialogContent className="max-w-[900px]">
          <DialogHeader>
            <DialogTitle>{detailsRow?.name || 'Extraction Details'}</DialogTitle>
          </DialogHeader>
          {detailsRow && (
            <div className="flex flex-col gap-4">
              <Descriptions bordered column={2}>
                <Descriptions.Item label="Major Category">{detailsRow.productType || '—'}</Descriptions.Item>
                <Descriptions.Item label="Status">{detailsRow.status}</Descriptions.Item>
                <Descriptions.Item label="Vendor">{detailsRow.vendor || '—'}</Descriptions.Item>
                <Descriptions.Item label="Updated At">{detailsRow.updatedAt || '—'}</Descriptions.Item>
                <Descriptions.Item label="Created At">{detailsRow.createdAt || '—'}</Descriptions.Item>
                {detailsRow.userName ? (
                  <Descriptions.Item label="User">
                    {detailsRow.userName} ({detailsRow.userEmail || '—'})
                  </Descriptions.Item>
                ) : null}
              </Descriptions>
              <div>
                <strong>Extraction Result</strong>
                <DataTable
                  size="small"
                  rowKey={(row: any) => `${row.attribute?.key || row.attribute?.label}-${row.rawValue}-${row.finalValue}`}
                  dataSource={buildDetailsRows(detailsRow)}
                  columns={[
                    {
                      title: 'Attribute',
                      dataIndex: 'attribute',
                      key: 'attribute',
                      render: (attr: any) => attr?.label || attr?.key || '—',
                    },
                    { title: 'Raw Value', dataIndex: 'rawValue', key: 'rawValue', render: (v: any) => v || '—' },
                    { title: 'Final Value', dataIndex: 'finalValue', key: 'finalValue', render: (v: any) => v || '—' },
                    {
                      title: 'Confidence',
                      dataIndex: 'confidence',
                      key: 'confidence',
                      render: (c: any) => (typeof c === 'number' ? `${c}%` : '—'),
                    },
                  ]}
                  pagination={{ pageSize: 12 }}
                  locale={{ emptyText: 'No extraction data available' }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingRow} onOpenChange={(o) => !o && !savingEdits && setEditingRow(null)}>
        <DialogContent className="max-h-[90vh] w-[920px] max-w-[920px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRow ? `Edit Attributes - ${editingRow.name}` : 'Edit Attributes'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[520px] overflow-y-auto pr-2">
            {EDITABLE_ATTRIBUTE_DEFINITIONS.map((item) => {
              const options = attributeOptionsByKey.get(normalizeAttrKey(item.key)) || [];
              return (
                <Fragment key={item.key}>
                  <div className="mb-3">
                    <label className="mb-1 block text-sm font-medium">{item.label}</label>
                    {options.length > 0 ? (
                      <Select
                        value={editValues[item.key] || ''}
                        onValueChange={(value) => setEditValues((prev) => ({ ...prev, [item.key]: value ?? '' }))}
                        disabled={savingEdits}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${item.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={editValues[item.key] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditValues((prev) => {
                            const next = { ...prev, [item.key]: val };
                            if (item.key === 'rate') {
                              const rate = parseFloat(val);
                              if (!isNaN(rate) && rate > 0) {
                                next['mrp'] = String(calculateMrpFromRate(rate));
                              }
                            }
                            return next;
                          });
                        }}
                        disabled={savingEdits}
                        placeholder={`Enter ${item.label}`}
                      />
                    )}
                  </div>
                  {item.key === 'mrp' &&
                    (() => {
                      const mrp = parseFloat(String(editValues['mrp'] ?? ''));
                      const rate = parseFloat(String(editValues['rate'] ?? ''));
                      if (!isFinite(mrp) || !isFinite(rate) || mrp === 0) return null;
                      const md = (((mrp - rate) / mrp) * 100).toFixed(1);
                      return (
                        <div className="mb-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-[13px]">
                          <span className="text-muted-foreground">Markdown: </span>
                          <span className="font-bold text-blue-600">{md}%</span>
                          <span className="ml-2 text-xs text-muted-foreground">(MRP − Rate) ÷ MRP × 100</span>
                        </div>
                      );
                    })()}
                </Fragment>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRow(null)} disabled={savingEdits}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdits} disabled={savingEdits}>
              {savingEdits ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
