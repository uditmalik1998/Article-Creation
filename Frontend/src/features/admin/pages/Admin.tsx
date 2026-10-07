import { useEffect, useState, useCallback, useRef } from 'react';
import { JumpNav, MasterDataCard, MasterGroup, PipelineRow, SectionHeading, SLATE_PRIMARY_BTN } from '../components/DashboardParts';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import {
  CheckCircle2,
  RotateCw,
  DollarSign,
  ImageIcon,
  Eye,
  FileText,
  RefreshCw,
  Search,
  Inbox,
  Download,
  ClipboardList,
  History,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Spinner,
  Statistic,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { BackendApiService } from '../../../services/api/backendApi';
import { APP_CONFIG } from '../../../constants/app/config';

const api = new BackendApiService();

interface VendorSyncResult {
  upserted: number;
  pages: number;
  durationMs: number;
  startedAt: string;
  error?: string;
}
interface VendorMasterStatus {
  count: number;
  lastSyncedAt: string | null;
  inProgress?: boolean;
  lastResult?: VendorSyncResult | null;
}

interface MajCatGridMeta {
  uploadedAt?: string;
  fileName?: string;
  totalRows?: number;
  skippedRows?: number;
  inactiveSkipped?: number;
  categoriesCount?: number;
  attributesCount?: number;
  totalValues?: number;
}

interface MandatoryGridMeta {
  uploadedAt?: string;
  fileName?: string;
  totalRows?: number;
  skippedRows?: number;
  categoriesCount?: number;
  attributesCount?: number;
  activeMappings?: number;
  totalMappings?: number;
  totalValues?: number;
}

interface SizeMasterMeta {
  uploadedAt?: string;
  fileName?: string;
  total?: number;
  active?: number;
  categories?: number;
  skipped?: number;
}

interface ColorMasterMeta {
  uploadedAt?: string;
  fileName?: string;
  total?: number;
  fathers?: number;
  codes?: number;
  skipped?: number;
}

interface FabricArticleDataMeta {
  uploadedAt?: string;
  fileName?: string;
  total?: number;
  synced?: number;
  pending?: number;
  skipped?: number;
}

interface FabricArticleMasterMeta {
  uploadedAt?: string;
  fileName?: string;
  total?: number;
  categories?: number;
  skipped?: number;
}

interface BodyArticleDataMeta {
  uploadedAt?: string;
  fileName?: string;
  total?: number;
  bodyArticles?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  truncated?: number;
}

interface BroaderMenuMeta {
  uploadedAt?: string;
  fileName?: string;
  sheet?: string;
  total?: number;
  majCats?: number;
  subCats?: number;
  active?: number;
  lastUpload?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  truncated?: number;
  duplicates?: number;
  unmappedValues?: number;
  missingColumns?: string[];
}

interface BasicAccessoriesMeta {
  total?: number;
  categories?: number;
  components?: number;
  withCost?: number;
  updated?: number;
  skipped?: number;
  lastUpdated?: string;
}

interface CmpCostMasterMeta {
  total?: number;
  categories?: number;
  skipped?: number;
  lastUpdated?: string;
}

interface SegmentMasterMeta {
  total?: number;
  categories?: number;
  skipped?: number;
  lastUpdated?: string;
}

interface GmGridMeta {
  uploadedAt?: string;
  fileName?: string;
  totalRows?: number;
  skippedRows?: number;
  categoriesCount?: number;
  familyCodesCount?: number;
  totalValues?: number;
}

interface GmMctMeta {
  uploadedAt?: string;
  fileName?: string;
  totalRows?: number;
  skippedRows?: number;
  categoriesCount?: number;
  familyCodesCount?: number;
}

interface HierarchyExcelStatus {
  departments: number;
  subDepartments: number;
  categories: number;
}
interface HierarchyUploadResult {
  departments: { new: number; updated: number; total: number };
  subDepartments: { new: number; updated: number; total: number };
  categories: { new: number; updated: number; total: number };
  skippedRows: number;
  dryRun: boolean;
  preview?: { divisions: string[]; subDivisions: string[]; majorCategories: string[] };
}

/** Master-data upload cards on this page (Attributes, GM, Fabric & body, Costs, Hierarchy). */
const MASTER_DATA_COUNT = 18;

interface PipelineStatusData {
  PENDING: number;
  PROCESSING: number;
  COMPLETED: number;
  FAILED: number;
  PERM_FAILED: number;
  total: number;
}

interface TestApiResult {
  // date-mode fields
  after_date?: string;
  total_from_api?: number;
  date_filtered?: number;
  matched?: number;
  // ppt-mode fields
  ppt_no?: string;
  // shared
  inserted: number;
  skipped: number;
  errors: number;
  message?: string;
}

const RAW_ARTICLES_MIN_DATE = dayjs('2026-05-27');

export default function Admin() {
  const navigate = useNavigate();
  const [expenseData, setExpenseData] = useState<any>(null);
  const [imageData, setImageData] = useState<any>(null);
  const [detailedExpenses, setDetailedExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // Vendor
  const [vendorStatus, setVendorStatus] = useState<VendorMasterStatus | null>(null);
  const [vendorStatusLoading, setVendorStatusLoading] = useState(false);
  const [vendorSyncing, setVendorSyncing] = useState(false);

  // raw_articles pipeline (test API)
  const [testFetchMode, setTestFetchMode] = useState<'date' | 'ppt'>('date');
  const [testAfterDate, setTestAfterDate] = useState<Dayjs | null>(RAW_ARTICLES_MIN_DATE);
  const [testPptInput, setTestPptInput] = useState('');
  const [testFetching, setTestFetching] = useState(false);
  const [testResult, setTestResult] = useState<TestApiResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatusData | null>(null);
  const [pipelineStatusLoading, setPipelineStatusLoading] = useState(false);
  const [extractionRunning, setExtractionRunning] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);

  const [fabricRawStatus, setFabricRawStatus] = useState<{ PENDING: number; PROCESSING: number; COMPLETED: number; FAILED: number; total: number } | null>(null);
  const [fabricRawStatusLoading, setFabricRawStatusLoading] = useState(false);
  const [fabricRawRunning, setFabricRawRunning] = useState(false);
  const [fabricRawMessage, setFabricRawMessage] = useState<string | null>(null);

  const [gmRawStatus, setGmRawStatus] = useState<{ PENDING: number; PROCESSING: number; COMPLETED: number; FAILED: number; total: number } | null>(null);
  const [gmRawStatusLoading, setGmRawStatusLoading] = useState(false);
  const [gmRawRunning, setGmRawRunning] = useState(false);
  const [gmRawMessage, setGmRawMessage] = useState<string | null>(null);

  // Maj-Cat Grid
  const [majCatGridMeta, setMajCatGridMeta] = useState<MajCatGridMeta | null>(null);
  const [majCatGridStatusLoading, setMajCatGridStatusLoading] = useState(false);
  const [majCatGridUploading, setMajCatGridUploading] = useState(false);
  const [majCatGridProgress, setMajCatGridProgress] = useState<number>(0);
  const [majCatJobPhase, setMajCatJobPhase] = useState<string>('');
  const majCatFileRef = useRef<HTMLInputElement | null>(null);
  const majCatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mandatory Grid
  const [mandatoryGridMeta, setMandatoryGridMeta] = useState<MandatoryGridMeta | null>(null);
  const [mandatoryGridStatusLoading, setMandatoryGridStatusLoading] = useState(false);
  const [mandatoryGridUploading, setMandatoryGridUploading] = useState(false);
  const [mandatoryGridProgress, setMandatoryGridProgress] = useState<number>(0);
  const mandatoryFileRef = useRef<HTMLInputElement | null>(null);

  // Size Master (maj_cat_sizes)
  const [sizeMasterMeta, setSizeMasterMeta] = useState<SizeMasterMeta | null>(null);
  const [sizeMasterStatusLoading, setSizeMasterStatusLoading] = useState(false);
  const [sizeMasterUploading, setSizeMasterUploading] = useState(false);
  const [sizeMasterProgress, setSizeMasterProgress] = useState<number>(0);
  const sizeFileRef = useRef<HTMLInputElement | null>(null);

  // Color Master (color_master)
  const [colorMasterMeta, setColorMasterMeta] = useState<ColorMasterMeta | null>(null);
  const [colorMasterStatusLoading, setColorMasterStatusLoading] = useState(false);
  const [colorMasterUploading, setColorMasterUploading] = useState(false);
  const [colorMasterProgress, setColorMasterProgress] = useState<number>(0);
  const colorFileRef = useRef<HTMLInputElement | null>(null);

  // Fabric Article Data (fabric_article_data)
  const [fabricArticleDataMeta, setFabricArticleDataMeta] = useState<FabricArticleDataMeta | null>(null);
  const [fabricArticleDataStatusLoading, setFabricArticleDataStatusLoading] = useState(false);
  const [fabricArticleDataUploading, setFabricArticleDataUploading] = useState(false);
  const [fabricArticleDataProgress, setFabricArticleDataProgress] = useState<number>(0);
  const fabricArticleDataFileRef = useRef<HTMLInputElement | null>(null);

  // Fabric Article Master (fabric_article_master)
  const [fabricArticleMasterMeta, setFabricArticleMasterMeta] = useState<FabricArticleMasterMeta | null>(null);
  const [fabricArticleMasterStatusLoading, setFabricArticleMasterStatusLoading] = useState(false);
  const [fabricArticleMasterUploading, setFabricArticleMasterUploading] = useState(false);
  const [fabricArticleMasterProgress, setFabricArticleMasterProgress] = useState<number>(0);
  const fabricArticleFileRef = useRef<HTMLInputElement | null>(null);

  // Body Article Data (body_article_data)
  const [bodyArticleDataMeta, setBodyArticleDataMeta] = useState<BodyArticleDataMeta | null>(null);
  const [bodyArticleDataStatusLoading, setBodyArticleDataStatusLoading] = useState(false);
  const [bodyArticleDataUploading, setBodyArticleDataUploading] = useState(false);
  const [bodyArticleDataProgress, setBodyArticleDataProgress] = useState<number>(0);
  const bodyArticleDataFileRef = useRef<HTMLInputElement | null>(null);
  const [broaderMenuMeta, setBroaderMenuMeta] = useState<BroaderMenuMeta | null>(null);
  const [broaderMenuStatusLoading, setBroaderMenuStatusLoading] = useState(false);
  const [broaderMenuUploading, setBroaderMenuUploading] = useState(false);
  const [broaderMenuProgress, setBroaderMenuProgress] = useState<number>(0);
  const broaderMenuFileRef = useRef<HTMLInputElement | null>(null);

  // Segment Master (maj_cat_segment)
  const [segmentMasterMeta, setSegmentMasterMeta] = useState<SegmentMasterMeta | null>(null);
  const [segmentMasterStatusLoading, setSegmentMasterStatusLoading] = useState(false);
  const [segmentMasterUploading, setSegmentMasterUploading] = useState(false);
  const [segmentMasterProgress, setSegmentMasterProgress] = useState<number>(0);
  const segmentFileRef = useRef<HTMLInputElement | null>(null);

  // Basic Accessories (basic_trim_cost_master + basic_trim_cost_component)
  const [basicAccessoriesMeta, setBasicAccessoriesMeta] = useState<BasicAccessoriesMeta | null>(null);
  const [basicAccessoriesStatusLoading, setBasicAccessoriesStatusLoading] = useState(false);
  const [basicAccessoriesUploading, setBasicAccessoriesUploading] = useState(false);
  const [basicAccessoriesProgress, setBasicAccessoriesProgress] = useState<number>(0);
  const basicAccessoriesFileRef = useRef<HTMLInputElement | null>(null);

  // CMP Cost Master (rough_cmp_cost_master)
  const [cmpCostMasterMeta, setCmpCostMasterMeta] = useState<CmpCostMasterMeta | null>(null);
  const [cmpCostMasterStatusLoading, setCmpCostMasterStatusLoading] = useState(false);
  const [cmpCostMasterUploading, setCmpCostMasterUploading] = useState(false);
  const [cmpCostMasterProgress, setCmpCostMasterProgress] = useState<number>(0);
  const cmpCostMasterFileRef = useRef<HTMLInputElement | null>(null);

  // National Grid Master
  const [nationalGridTotal, setNationalGridTotal] = useState<number | null>(null);
  const [nationalGridStatusLoading, setNationalGridStatusLoading] = useState(false);
  const [nationalGridUploading, setNationalGridUploading] = useState(false);
  const [nationalGridProgress, setNationalGridProgress] = useState<number>(0);
  const nationalGridFileRef = useRef<HTMLInputElement | null>(null);

  // Body Fabric Consumption
  const [bodyFabConsTotal, setBodyFabConsTotal] = useState<{ total: number; categories: number } | null>(null);
  const [bodyFabConsStatusLoading, setBodyFabConsStatusLoading] = useState(false);
  const [bodyFabConsUploading, setBodyFabConsUploading] = useState(false);
  const [bodyFabConsProgress, setBodyFabConsProgress] = useState<number>(0);
  const bodyFabConsFileRef = useRef<HTMLInputElement | null>(null);

  // Value Addition Accessories Cost
  const [vaacTotal, setVaacTotal] = useState<{ total: number; categories: number } | null>(null);
  const [vaacStatusLoading, setVaacStatusLoading] = useState(false);
  const [vaacUploading, setVaacUploading] = useState(false);
  const [vaacProgress, setVaacProgress] = useState<number>(0);
  const vaacFileRef = useRef<HTMLInputElement | null>(null);

  const [mcdTotal, setMcdTotal] = useState<{ total: number; categories: number } | null>(null);
  const [mcdStatusLoading, setMcdStatusLoading] = useState(false);
  const [mcdUploading, setMcdUploading] = useState(false);
  const [mcdProgress, setMcdProgress] = useState<number>(0);
  const mcdFileRef = useRef<HTMLInputElement | null>(null);

  // GM Major Category Details (gm_major_category_details)
  const [gmMctMeta, setGmMctMeta] = useState<GmMctMeta | null>(null);
  const [gmMctStatusLoading, setGmMctStatusLoading] = useState(false);
  const [gmMctUploading, setGmMctUploading] = useState(false);
  const [gmMctProgress, setGmMctProgress] = useState<number>(0);
  const [gmMctJobPhase, setGmMctJobPhase] = useState<string>('');
  const gmMctFileRef = useRef<HTMLInputElement | null>(null);
  const gmMctPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // GM Major Category Grid (gm_major_category_grid_values)
  const [gmGridMeta, setGmGridMeta] = useState<GmGridMeta | null>(null);
  const [gmGridStatusLoading, setGmGridStatusLoading] = useState(false);
  const [gmGridUploading, setGmGridUploading] = useState(false);
  const [gmGridProgress, setGmGridProgress] = useState<number>(0);
  const [gmGridJobPhase, setGmGridJobPhase] = useState<string>('');
  const gmGridFileRef = useRef<HTMLInputElement | null>(null);
  const gmGridPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hierarchy Excel Upload (two-step)
  const [hierarchyExcelStatus, setHierarchyExcelStatus] = useState<HierarchyExcelStatus | null>(null);
  const [hierarchyExcelStatusLoading, setHierarchyExcelStatusLoading] = useState(false);
  const [hierarchyExcelUploading, setHierarchyExcelUploading] = useState(false);
  const [hierarchyExcelProgress, setHierarchyExcelProgress] = useState<number>(0);
  const [hierarchyPreview, setHierarchyPreview] = useState<HierarchyUploadResult | null>(null);
  const [hierarchyResult, setHierarchyResult] = useState<HierarchyUploadResult | null>(null);
  const [hierarchyPendingFile, setHierarchyPendingFile] = useState<File | null>(null);
  const hierarchyFileRef = useRef<HTMLInputElement | null>(null);

  // ─────────────────────────────── Vendor ───────────────────────────────
  const loadVendorStatus = useCallback(async () => {
    setVendorStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/vendor-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load vendor master status');
      setVendorStatus(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load vendor master status');
    } finally {
      setVendorStatusLoading(false);
    }
  }, []);

  const runVendorSync = async () => {
    setVendorSyncing(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/vendor-master/sync`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vendor master sync failed');
      message.info('Vendor master sync started — polling for completion…');

      // Poll status every 4s until inProgress flips to false
      const poll = async () => {
        const token = localStorage.getItem('authToken');
        const statusRes = await fetch(`${APP_CONFIG.api.baseURL}/admin/vendor-master/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const statusData = await statusRes.json();
        if (statusData.success) {
          setVendorStatus(statusData.data);
          if (statusData.data.inProgress) {
            setTimeout(poll, 4000);
          } else {
            setVendorSyncing(false);
            const result = statusData.data.lastResult;
            if (result?.error) {
              message.error(`Sync failed: ${result.error}`);
            } else if (result) {
              message.success(`Sync complete — ${result.upserted.toLocaleString()} records updated in ${result.pages} pages`);
            }
          }
        } else {
          setVendorSyncing(false);
        }
      };
      setTimeout(poll, 4000);
    } catch (err: any) {
      message.error(err?.message || 'Vendor master sync failed');
      setVendorSyncing(false);
    }
  };

  // ─────────────────────────────── raw_articles Pipeline ───────────────────────────────
  const loadPipelineStatus = useCallback(async () => {
    setPipelineStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/pipeline-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load pipeline status');
      setPipelineStatus(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load pipeline status');
    } finally {
      setPipelineStatusLoading(false);
    }
  }, []);

  const loadFabricRawStatus = useCallback(async () => {
    setFabricRawStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/fabric-raw-pipeline-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load fabric raw pipeline status');
      setFabricRawStatus(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load fabric raw pipeline status');
    } finally {
      setFabricRawStatusLoading(false);
    }
  }, []);

  const triggerFabricRawProcessing = async () => {
    setFabricRawRunning(true);
    setFabricRawMessage(null);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/run-fabric-raw-processing`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start processing');
      setFabricRawMessage(data.message);
      message.success(data.message);
      let polls = 0;
      const pollInterval = setInterval(async () => {
        polls++;
        await loadFabricRawStatus();
        if (polls >= 12) clearInterval(pollInterval);
      }, 5000);
    } catch (err: any) {
      message.error(err?.message || 'Failed to start processing');
    } finally {
      setFabricRawRunning(false);
    }
  };

  const loadGmRawStatus = useCallback(async () => {
    setGmRawStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/gm-raw-pipeline-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load GM raw pipeline status');
      setGmRawStatus(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load GM raw pipeline status');
    } finally {
      setGmRawStatusLoading(false);
    }
  }, []);

  const triggerGmRawProcessing = async () => {
    setGmRawRunning(true);
    setGmRawMessage(null);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/run-gm-raw-processing`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start processing');
      setGmRawMessage(data.message);
      message.success(data.message);
      let polls = 0;
      const pollInterval = setInterval(async () => {
        polls++;
        await loadGmRawStatus();
        if (polls >= 12) clearInterval(pollInterval);
      }, 5000);
    } catch (err: any) {
      message.error(err?.message || 'Failed to start processing');
    } finally {
      setGmRawRunning(false);
    }
  };

  const runTestApiFetch = async () => {
    if (testFetchMode === 'date') {
      if (!testAfterDate) {
        message.warning('Select a date first');
        return;
      }
    } else {
      if (!testPptInput.trim()) {
        message.warning('Enter a PPT number first (e.g. PRES-00831)');
        return;
      }
    }

    setTestFetching(true);
    setTestResult(null);
    setTestError(null);
    try {
      const token = localStorage.getItem('authToken');
      let url: string;
      let body: object;

      if (testFetchMode === 'date') {
        url = `${APP_CONFIG.api.baseURL}/test-api/fetch-presentation`;
        body = { after_date: testAfterDate!.format('YYYY-MM-DD') };
      } else {
        url = `${APP_CONFIG.api.baseURL}/test-api/fetch-by-ppt`;
        body = { ppt_no: testPptInput.trim().toUpperCase() };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch presentations');
      setTestResult(data);
      message.success(`${data.inserted} new row(s) saved to raw_articles`);
      loadPipelineStatus();
    } catch (err: any) {
      setTestError(err?.message || 'Failed to fetch presentations');
      message.error(err?.message || 'Failed to fetch presentations');
    } finally {
      setTestFetching(false);
    }
  };

  const triggerExtraction = async () => {
    setExtractionRunning(true);
    setExtractionMessage(null);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/test-api/run-extraction`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start extraction');
      setExtractionMessage(data.message);
      message.success(data.message);
      let polls = 0;
      const pollInterval = setInterval(async () => {
        polls++;
        await loadPipelineStatus();
        if (polls >= 12) clearInterval(pollInterval);
      }, 15000);
    } catch (err: any) {
      message.error(err?.message || 'Failed to start extraction');
    } finally {
      setExtractionRunning(false);
    }
  };

  // ─────────────────────────────── Maj-Cat Grid ───────────────────────────────
  const downloadMajCatGridData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/majcat-grid/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `MAJ_CAT_GRID_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download major category grid data'));
  };

  const downloadMajCatTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/majcat-grid/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MAJ_CAT_GRID_TEMPLATE.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      })
      .catch(() => message.error('Failed to download template'));
  };

  const loadMajCatGridStatus = useCallback(async () => {
    setMajCatGridStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/majcat-grid/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load grid status');
      setMajCatGridMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load maj-cat grid status');
    } finally {
      setMajCatGridStatusLoading(false);
    }
  }, []);

  const handleMajCatGridUpload = async (file: File) => {
    // Clear any previous poll
    if (majCatPollRef.current) { clearInterval(majCatPollRef.current); majCatPollRef.current = null; }

    setMajCatGridUploading(true);
    setMajCatGridProgress(2);
    setMajCatJobPhase('Uploading file…');

    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/majcat-grid/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      // Server accepted — now poll for job completion
      const { jobId } = data;
      setMajCatJobPhase('Queued — waiting for processing…');

      const poll = async () => {
        try {
          const sr = await fetch(`${APP_CONFIG.api.baseURL}/admin/majcat-grid/upload-status/${jobId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const sdata = await sr.json();
          if (!sr.ok || !sdata.success) return;

          setMajCatGridProgress(sdata.progress ?? 0);
          setMajCatJobPhase(sdata.phase || '');

          if (sdata.status === 'DONE') {
            clearInterval(majCatPollRef.current!);
            majCatPollRef.current = null;
            message.success(`Grid uploaded — ${(sdata.meta?.totalRows ?? 0).toLocaleString()} rows across ${sdata.meta?.categoriesCount ?? 0} major categories`);
            setMajCatGridMeta(sdata.meta as MajCatGridMeta);
            setMajCatGridUploading(false);
            setTimeout(() => { setMajCatGridProgress(0); setMajCatJobPhase(''); }, 1500);
            if (majCatFileRef.current) majCatFileRef.current.value = '';
          } else if (sdata.status === 'FAILED') {
            clearInterval(majCatPollRef.current!);
            majCatPollRef.current = null;
            message.error(sdata.error || 'Upload failed during processing');
            setMajCatGridUploading(false);
            setTimeout(() => { setMajCatGridProgress(0); setMajCatJobPhase(''); }, 1500);
            if (majCatFileRef.current) majCatFileRef.current.value = '';
          }
        } catch { /* network blip — keep polling */ }
      };

      poll(); // immediate first check
      majCatPollRef.current = setInterval(poll, 2500);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
      setMajCatGridUploading(false);
      setMajCatGridProgress(0);
      setMajCatJobPhase('');
      if (majCatFileRef.current) majCatFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Mandatory Grid ───────────────────────────────
  const loadMandatoryGridStatus = useCallback(async () => {
    setMandatoryGridStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/mandatory-grid/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load mandatory grid status');
      setMandatoryGridMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load mandatory grid status');
    } finally {
      setMandatoryGridStatusLoading(false);
    }
  }, []);

  const downloadMandatoryTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/mandatory-grid/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mandatory-grid-template.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const downloadMandatoryGridData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/mandatory-grid/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `MANDATORY_GRID_DATA_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download mandatory grid data'));
  };

  const handleMandatoryGridUpload = async (file: File) => {
    setMandatoryGridUploading(true);
    setMandatoryGridProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setMandatoryGridProgress((prev) => Math.min(prev + 3, 90));
      }, 800);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/mandatory-grid/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setMandatoryGridProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setMandatoryGridMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setMandatoryGridUploading(false);
      setTimeout(() => setMandatoryGridProgress(0), 1500);
      if (mandatoryFileRef.current) mandatoryFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── GM Major Category Details ───────────────────────────────
  const downloadGMMctData = () => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/admin/gm-mct/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `GM_MCT_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download GM major category details data'));
  };

  const downloadGMMctTemplate = () => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/admin/gm-mct/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'GM_MCT_TEMPLATE.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      })
      .catch(() => message.error('Failed to download GM MCT template'));
  };

  const loadGMMctStatus = useCallback(async () => {
    setGmMctStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-mct/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load GM MCT status');
      setGmMctMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load GM major category details status');
    } finally {
      setGmMctStatusLoading(false);
    }
  }, []);

  const handleGMMctUpload = async (file: File) => {
    if (gmMctPollRef.current) { clearInterval(gmMctPollRef.current); gmMctPollRef.current = null; }

    setGmMctUploading(true);
    setGmMctProgress(2);
    setGmMctJobPhase('Uploading file…');

    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-mct/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const { jobId } = data;
      setGmMctJobPhase('Queued — waiting for processing…');

      const poll = async () => {
        try {
          const sr = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-mct/upload-status/${jobId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const sdata = await sr.json();
          if (!sr.ok || !sdata.success) return;

          setGmMctProgress(sdata.progress ?? 0);
          setGmMctJobPhase(sdata.phase || '');

          if (sdata.status === 'DONE') {
            clearInterval(gmMctPollRef.current!);
            gmMctPollRef.current = null;
            message.success(`GM MCT uploaded — ${(sdata.meta?.totalRows ?? 0).toLocaleString()} rows across ${sdata.meta?.categoriesCount ?? 0} major categories`);
            setGmMctMeta(sdata.meta as GmMctMeta);
            setGmMctUploading(false);
            setTimeout(() => { setGmMctProgress(0); setGmMctJobPhase(''); }, 1500);
            if (gmMctFileRef.current) gmMctFileRef.current.value = '';
          } else if (sdata.status === 'FAILED') {
            clearInterval(gmMctPollRef.current!);
            gmMctPollRef.current = null;
            message.error(sdata.error || 'Upload failed during processing');
            setGmMctUploading(false);
            setTimeout(() => { setGmMctProgress(0); setGmMctJobPhase(''); }, 1500);
            if (gmMctFileRef.current) gmMctFileRef.current.value = '';
          }
        } catch { /* network blip — keep polling */ }
      };

      poll();
      gmMctPollRef.current = setInterval(poll, 2500);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
      setGmMctUploading(false);
      setGmMctProgress(0);
      setGmMctJobPhase('');
      if (gmMctFileRef.current) gmMctFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── GM Major Category Grid ───────────────────────────────
  const downloadGMGridData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/gm-grid/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `GM_GRID_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download GM grid data'));
  };

  const downloadGMGridTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/gm-grid/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'GM_GRID_TEMPLATE.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      })
      .catch(() => message.error('Failed to download GM grid template'));
  };

  const loadGMGridStatus = useCallback(async () => {
    setGmGridStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-grid/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load GM grid status');
      setGmGridMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load GM grid status');
    } finally {
      setGmGridStatusLoading(false);
    }
  }, []);

  const handleGMGridUpload = async (file: File) => {
    if (gmGridPollRef.current) { clearInterval(gmGridPollRef.current); gmGridPollRef.current = null; }

    setGmGridUploading(true);
    setGmGridProgress(2);
    setGmGridJobPhase('Uploading file…');

    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-grid/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const { jobId } = data;
      setGmGridJobPhase('Queued — waiting for processing…');

      const poll = async () => {
        try {
          const sr = await fetch(`${APP_CONFIG.api.baseURL}/admin/gm-grid/upload-status/${jobId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const sdata = await sr.json();
          if (!sr.ok || !sdata.success) return;

          setGmGridProgress(sdata.progress ?? 0);
          setGmGridJobPhase(sdata.phase || '');

          if (sdata.status === 'DONE') {
            clearInterval(gmGridPollRef.current!);
            gmGridPollRef.current = null;
            message.success(`GM grid uploaded — ${(sdata.meta?.totalRows ?? 0).toLocaleString()} rows across ${sdata.meta?.categoriesCount ?? 0} major categories`);
            setGmGridMeta(sdata.meta as GmGridMeta);
            setGmGridUploading(false);
            setTimeout(() => { setGmGridProgress(0); setGmGridJobPhase(''); }, 1500);
            if (gmGridFileRef.current) gmGridFileRef.current.value = '';
          } else if (sdata.status === 'FAILED') {
            clearInterval(gmGridPollRef.current!);
            gmGridPollRef.current = null;
            message.error(sdata.error || 'Upload failed during processing');
            setGmGridUploading(false);
            setTimeout(() => { setGmGridProgress(0); setGmGridJobPhase(''); }, 1500);
            if (gmGridFileRef.current) gmGridFileRef.current.value = '';
          }
        } catch { /* network blip — keep polling */ }
      };

      poll();
      gmGridPollRef.current = setInterval(poll, 2500);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
      setGmGridUploading(false);
      setGmGridProgress(0);
      setGmGridJobPhase('');
      if (gmGridFileRef.current) gmGridFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Size Master ───────────────────────────────
  const loadSizeMasterStatus = useCallback(async () => {
    setSizeMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/size-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load size master status');
      setSizeMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load size master status');
    } finally {
      setSizeMasterStatusLoading(false);
    }
  }, []);

  const downloadSizeMasterTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/size-master/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'SIZE_MASTER_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const downloadSizeMasterData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/size-master/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `SIZE_MASTER_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download size master data'));
  };

  const handleSizeMasterUpload = async (file: File) => {
    setSizeMasterUploading(true);
    setSizeMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setSizeMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/size-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setSizeMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setSizeMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setSizeMasterUploading(false);
      setTimeout(() => setSizeMasterProgress(0), 1500);
      if (sizeFileRef.current) sizeFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Color Master ───────────────────────────────
  const loadColorMasterStatus = useCallback(async () => {
    setColorMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/color-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load color master status');
      setColorMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load color master status');
    } finally {
      setColorMasterStatusLoading(false);
    }
  }, []);

  const downloadColorMasterTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/color-master/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'COLOR_MASTER_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const downloadColorMasterData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/color-master/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `COLOR_MASTER_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download color master data'));
  };

  const handleColorMasterUpload = async (file: File) => {
    setColorMasterUploading(true);
    setColorMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setColorMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/color-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setColorMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setColorMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setColorMasterUploading(false);
      setTimeout(() => setColorMasterProgress(0), 1500);
      if (colorFileRef.current) colorFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Fabric Article Data ────────────────────────
  const loadFabricArticleDataStatus = useCallback(async () => {
    setFabricArticleDataStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/fabric-article-data/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load fabric article data status');
      setFabricArticleDataMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load fabric article data status');
    } finally {
      setFabricArticleDataStatusLoading(false);
    }
  }, []);

  const downloadFabricArticleDataTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/fabric-article-data/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'FABRIC_ARTICLE_DATA_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const handleFabricArticleDataUpload = async (file: File) => {
    setFabricArticleDataUploading(true);
    setFabricArticleDataProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setFabricArticleDataProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/fabric-article-data/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setFabricArticleDataProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setFabricArticleDataMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setFabricArticleDataUploading(false);
      setTimeout(() => setFabricArticleDataProgress(0), 1500);
      if (fabricArticleDataFileRef.current) fabricArticleDataFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Fabric Article Master ──────────────────────
  const loadFabricArticleMasterStatus = useCallback(async () => {
    setFabricArticleMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/fabric-article-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load fabric article master status');
      setFabricArticleMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load fabric article master status');
    } finally {
      setFabricArticleMasterStatusLoading(false);
    }
  }, []);

  const downloadFabricArticleMasterData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/fabric-article-master/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `FABRIC_ARTICLE_MASTER_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download fabric article master data'));
  };

  const downloadFabricArticleMasterTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/fabric-article-master/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'FABRIC_ARTICLE_MASTER_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const handleFabricArticleMasterUpload = async (file: File) => {
    setFabricArticleMasterUploading(true);
    setFabricArticleMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setFabricArticleMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/fabric-article-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setFabricArticleMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setFabricArticleMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setFabricArticleMasterUploading(false);
      setTimeout(() => setFabricArticleMasterProgress(0), 1500);
      if (fabricArticleFileRef.current) fabricArticleFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Body Article Data ──────────────────────────
  const loadBodyArticleDataStatus = useCallback(async () => {
    setBodyArticleDataStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/body-article-data/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load body article data status');
      setBodyArticleDataMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load body article data status');
    } finally {
      setBodyArticleDataStatusLoading(false);
    }
  }, []);

  const downloadBodyArticleDataTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/body-article-data/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'BODY_ARTICLE_DATA_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const handleBodyArticleDataUpload = async (file: File) => {
    setBodyArticleDataUploading(true);
    setBodyArticleDataProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setBodyArticleDataProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/body-article-data/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setBodyArticleDataProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setBodyArticleDataMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setBodyArticleDataUploading(false);
      setTimeout(() => setBodyArticleDataProgress(0), 1500);
      if (bodyArticleDataFileRef.current) bodyArticleDataFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Broader Menu ───────────────────────────────
  const loadBroaderMenuStatus = useCallback(async () => {
    setBroaderMenuStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/broader-menu/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load broader menu status');
      setBroaderMenuMeta((prev) => ({ ...prev, ...data.data }));
    } catch (err: any) {
      message.error(err?.message || 'Failed to load broader menu status');
    } finally {
      setBroaderMenuStatusLoading(false);
    }
  }, []);

  const downloadBroaderMenuTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/broader-menu/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'BROADER_MENU_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const handleBroaderMenuUpload = async (file: File) => {
    setBroaderMenuUploading(true);
    setBroaderMenuProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setBroaderMenuProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/broader-menu/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setBroaderMenuProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setBroaderMenuMeta(data.data);
      // Refresh the derived counts (maj cats / sub cats / active) the upload
      // response doesn't carry.
      await loadBroaderMenuStatus();
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setBroaderMenuUploading(false);
      setTimeout(() => setBroaderMenuProgress(0), 1500);
      if (broaderMenuFileRef.current) broaderMenuFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Segment Master ─────────────────────────────
  const loadSegmentMasterStatus = useCallback(async () => {
    setSegmentMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/segment-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load segment master status');
      setSegmentMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load segment master status');
    } finally {
      setSegmentMasterStatusLoading(false);
    }
  }, []);

  const downloadSegmentMasterTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/segment-master/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'SEGMENT_MASTER_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const exportSegmentMaster = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/segment-master/export`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'SEGMENT_MASTER_EXPORT.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to export segment master'));
  };

  const handleSegmentMasterUpload = async (file: File) => {
    setSegmentMasterUploading(true);
    setSegmentMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setSegmentMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/segment-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setSegmentMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setSegmentMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setSegmentMasterUploading(false);
      setTimeout(() => setSegmentMasterProgress(0), 1500);
      if (segmentFileRef.current) segmentFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Basic Accessories ──────────────────────────────
  const loadBasicAccessoriesStatus = useCallback(async () => {
    setBasicAccessoriesStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/basic-accessories/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load basic accessories status');
      setBasicAccessoriesMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load basic accessories status');
    } finally {
      setBasicAccessoriesStatusLoading(false);
    }
  }, []);

  const downloadBasicAccessoriesFile = (kind: 'template' | 'export') => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/basic-accessories/${kind}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = kind === 'template' ? 'PACKAGING_MASTER_TEMPLATE.xlsx' : 'BASIC_ACCESSORIES_EXPORT.xlsx';
        a.click();
      })
      .catch(() => message.error(kind === 'template' ? 'Failed to download template' : 'Failed to export basic accessories'));
  };

  const handleBasicAccessoriesUpload = async (file: File) => {
    setBasicAccessoriesUploading(true);
    setBasicAccessoriesProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setBasicAccessoriesProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/basic-accessories/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setBasicAccessoriesProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setBasicAccessoriesMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setBasicAccessoriesUploading(false);
      setTimeout(() => setBasicAccessoriesProgress(0), 1500);
      if (basicAccessoriesFileRef.current) basicAccessoriesFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── CMP Cost Master ─────────────────────────────
  const loadCmpCostMasterStatus = useCallback(async () => {
    setCmpCostMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/cmp-cost-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load CMP cost master status');
      setCmpCostMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load CMP cost master status');
    } finally {
      setCmpCostMasterStatusLoading(false);
    }
  }, []);

  const downloadCmpCostMasterFile = (kind: 'template' | 'export') => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/cmp-cost-master/${kind}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = kind === 'template' ? 'CMP_COST_MASTER_TEMPLATE.xlsx' : 'CMP_COST_MASTER_EXPORT.xlsx';
        a.click();
      })
      .catch(() => message.error(kind === 'template' ? 'Failed to download template' : 'Failed to export CMP cost master'));
  };

  const handleCmpCostMasterUpload = async (file: File) => {
    setCmpCostMasterUploading(true);
    setCmpCostMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setCmpCostMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/cmp-cost-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setCmpCostMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setCmpCostMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setCmpCostMasterUploading(false);
      setTimeout(() => setCmpCostMasterProgress(0), 1500);
      if (cmpCostMasterFileRef.current) cmpCostMasterFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── National Grid Master ───────────────────────────────
  const downloadNationalGridData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/national-grid/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `NATIONAL_GRID_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download national grid data'));
  };

  const downloadNationalGridTemplate = async () => {
    try {
      const xlsx = await import('xlsx');

      // Vertical format matching NATIONAL_GRID_VERTICAL_SEQUENCED.xlsx
      // Row 1: title, Row 2: blank, Row 3: headers, Row 4: blank, Row 5+: data
      const headers = ['F_GRD_SR', 'F_GRID_NM', 'CHILD_GRID_SR NO', 'M_GRID_NM', 'G_CHILD_SR NO', 'G_CHILD_GRID_VAL', 'FULL FORM', 'GRID_STATUS'];

      const title  = ['', 'MDM NATIONAL GRID - VERTICAL SEQUENCED', '', '', '', '', '', ''];
      const blank  = ['', '', '', '', '', '', '', ''];
      const sample = [
        ['1', 'FAB', '1.01', 'M_FAB_DIV', '1.01.01', 'K',   'KNIT',   'ACT'],
        ['1', 'FAB', '1.01', 'M_FAB_DIV', '1.01.02', 'W',   'WOVEN',  'ACT'],
        ['1', 'FAB', '1.01', 'M_FAB_DIV', '1.01.03', 'DNM', 'DENIM',  'ACT'],
        ['2', 'FAB', '1.02', 'M_YARN',    '1.02.01', 'C',   'COTTON', 'ACT'],
        ['2', 'FAB', '1.02', 'M_YARN',    '1.02.02', 'P',   'POLYESTER', 'ACT'],
      ];
      // 15 empty rows after samples
      const emptyRows = Array.from({ length: 15 }, () => Array(8).fill(''));

      const aoa = [title, blank, headers, blank, ...sample, ...emptyRows];
      const ws = xlsx.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 32 }, { wch: 14 }];

      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'NATIONAL_GRID_SEQ');
      xlsx.writeFile(wb, 'NATIONAL_GRID_TEMPLATE.xlsx');
    } catch {
      message.error('Failed to generate template');
    }
  };

  const loadNationalGridStatus = useCallback(async () => {
    setNationalGridStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/national-grid?limit=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load national grid status');
      setNationalGridTotal(data.total ?? 0);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load national grid status');
    } finally {
      setNationalGridStatusLoading(false);
    }
  }, []);

  const handleNationalGridUpload = async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      message.error('Please select an Excel file (.xlsx or .xls)');
      return;
    }
    setNationalGridUploading(true);
    setNationalGridProgress(10);
    try {
      const xlsx = await import('xlsx');
      const buf  = await file.arrayBuffer();
      const wb   = xlsx.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];

      // Read as 2D array to detect format
      const aoa = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as string[][];
      setNationalGridProgress(30);

      type GridRow = { attributeName: string; code: string; fullForm: string | null };
      const rows: GridRow[] = [];
      let skipped = 0;

      // Detect VERTICAL format: Row 3 (index 2) contains M_GRID_NM and G_CHILD_GRID_VAL headers
      const row3Headers = (aoa[2] || []).map((v) => String(v).trim().toUpperCase());
      const isVertical = row3Headers.includes('M_GRID_NM') && row3Headers.includes('G_CHILD_GRID_VAL');

      // Detect BASE_HORIZONTAL format: Row 4 (index 3) col 0 is a real SAP attribute key
      const SKIP = new Set(['VALUE', 'FULL FORM', 'STATUS', 'DIV', 'OK', 'IMP ATBT', 'AGE GROUP', '']);
      const row4 = (aoa[3] || []).map((v) => String(v).trim());
      const isBaseHorizontal = !isVertical && row4.length > 0 && !!row4[0] && !SKIP.has(row4[0]) && !SKIP.has(row4[0].toUpperCase());

      if (isVertical) {
        // Vertical format: headers in Row 3 (index 2), data from Row 5 (index 4)
        const attrIdx   = row3Headers.indexOf('M_GRID_NM');
        const codeIdx   = row3Headers.indexOf('G_CHILD_GRID_VAL');
        const formIdx   = row3Headers.indexOf('FULL FORM');
        const statusIdx = row3Headers.indexOf('GRID_STATUS');

        for (let r = 4; r < aoa.length; r++) {
          const row = aoa[r];
          const attributeName = String(row[attrIdx] ?? '').trim();
          const code          = String(row[codeIdx] ?? '').trim();
          const fullForm      = formIdx >= 0 ? String(row[formIdx] ?? '').trim() || null : null;
          const status        = statusIdx >= 0 ? String(row[statusIdx] ?? '').trim().toUpperCase() : 'ACT';
          if (!attributeName || !code) { skipped++; continue; }
          if (status && status !== 'ACT') { skipped++; continue; } // skip inactive
          rows.push({ attributeName, code, fullForm });
        }
      } else if (isBaseHorizontal) {
        // BASE_HORIZONTAL: discover block starts from Row 4, data from Row 6+
        const blocks: { colIdx: number; attributeName: string }[] = [];
        const seen = new Set<string>();
        for (let c = 0; c < row4.length; c++) {
          const v = row4[c];
          if (v && !SKIP.has(v) && !SKIP.has(v.toUpperCase()) && !seen.has(v)) {
            blocks.push({ colIdx: c, attributeName: v });
            seen.add(v);
          }
        }
        for (let r = 5; r < aoa.length; r++) {
          const row = aoa[r];
          for (const { colIdx, attributeName } of blocks) {
            const code     = String(row[colIdx + 1] ?? '').trim();
            const fullForm = String(row[colIdx + 2] ?? '').trim() || null;
            if (!code) continue;
            rows.push({ attributeName, code, fullForm });
          }
        }
      } else {
        // Simple column format: attribute_name | code | full_form
        const raw = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (raw.length === 0) { message.warning('No rows found in file.'); return; }

        const hdrKeys  = Object.keys(raw[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
        const origKeys = Object.keys(raw[0]);
        const findCol  = (aliases: string[]) => {
          const idx = hdrKeys.findIndex((h) => aliases.includes(h));
          return idx >= 0 ? origKeys[idx] : null;
        };
        const attrCol = findCol(['attribute_name', 'attributename', 'attribute', 'attr', 'sapkey', 'm_grid_nm']);
        const codeCol = findCol(['code', 'value', 'val', 'g_child_grid_val']);
        const formCol = findCol(['full_form', 'fullform', 'description', 'desc', 'full form']);

        if (!attrCol || !codeCol) {
          message.error('File must have "M_GRID_NM" and "G_CHILD_GRID_VAL" columns (or "attribute_name" and "code").');
          return;
        }
        for (const row of raw) {
          const attributeName = String(row[attrCol] ?? '').trim();
          const code          = String(row[codeCol] ?? '').trim();
          const fullForm      = formCol ? String(row[formCol] ?? '').trim() || null : null;
          if (!attributeName || !code) { skipped++; continue; }
          rows.push({ attributeName, code, fullForm });
        }
      }

      if (rows.length === 0) { message.warning(`No valid rows found (${skipped} empty rows skipped).`); return; }
      setNationalGridProgress(70);

      // POST to backend
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/national-grid/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rows }),
      });
      setNationalGridProgress(95);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      message.success(`${data.upserted} rows upserted${skipped ? ` (${skipped} empty rows skipped)` : ''}.`);
      await loadNationalGridStatus();
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setNationalGridUploading(false);
      setTimeout(() => setNationalGridProgress(0), 1500);
      if (nationalGridFileRef.current) nationalGridFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Body Fabric Consumption ───────────────────────────────
  const loadBodyFabConsStatus = useCallback(async () => {
    setBodyFabConsStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/body-fabric-consumption/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load status');
      setBodyFabConsTotal(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load body fabric consumption status');
    } finally {
      setBodyFabConsStatusLoading(false);
    }
  }, []);

  const downloadBodyFabConsTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/body-fabric-consumption/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'FAB_CONSUMPTION_MASTER_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const downloadBodyFabConsData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/body-fabric-consumption/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then((blob) => {
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `FAB_CONSUMPTION_MASTER_${today}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download body fabric consumption data'));
  };

  const handleBodyFabConsUpload = async (file: File) => {
    setBodyFabConsUploading(true);
    setBodyFabConsProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setBodyFabConsProgress((prev) => Math.min(prev + 5, 90));
      }, 400);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/body-fabric-consumption/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setBodyFabConsProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setBodyFabConsTotal(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setBodyFabConsUploading(false);
      setTimeout(() => setBodyFabConsProgress(0), 1500);
      if (bodyFabConsFileRef.current) bodyFabConsFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Value Addition Accessories Cost ──────────────
  const loadVaacStatus = useCallback(async () => {
    setVaacStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/value-addition-accessories-cost/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load status');
      setVaacTotal(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load value addition accessories cost status');
    } finally {
      setVaacStatusLoading(false);
    }
  }, []);

  const downloadVaacTemplate = () => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/admin/value-addition-accessories-cost/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'VAL_ADD_ACC_COST_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Failed to download template'));
  };

  const downloadVaacData = () => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/admin/value-addition-accessories-cost/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `VAL_ADD_ACC_COST_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Failed to download value addition accessories cost data'));
  };

  const handleVaacUpload = async (file: File) => {
    setVaacUploading(true);
    setVaacProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setVaacProgress((prev) => Math.min(prev + 5, 90));
      }, 400);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/value-addition-accessories-cost/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setVaacProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setVaacTotal(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setVaacUploading(false);
      setTimeout(() => setVaacProgress(0), 1500);
      if (vaacFileRef.current) vaacFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Major Category Details ───────────────────────
  const loadMcdStatus = useCallback(async () => {
    setMcdStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/major-category-details/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load status');
      setMcdTotal(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load status');
    } finally {
      setMcdStatusLoading(false);
    }
  }, []);

  const downloadMcdTemplate = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/major-category-details/template`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MAJOR_CATEGORY_DETAILS_TEMPLATE.xlsx';
        a.click();
      })
      .catch(() => message.error('Download failed'));
  };

  const downloadMcdData = () => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/major-category-details/download`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `MAJOR_CATEGORY_DETAILS_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
      })
      .catch(() => message.error('Download failed'));
  };

  const handleMcdUpload = async (file: File) => {
    setMcdUploading(true);
    setMcdProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setMcdProgress((prev) => Math.min(prev + 5, 90));
      }, 400);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/major-category-details/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setMcdProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(`Uploaded ${data.data?.inserted ?? 0} rows successfully`);
      loadMcdStatus();
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setMcdUploading(false);
      setTimeout(() => setMcdProgress(0), 1500);
      if (mcdFileRef.current) mcdFileRef.current.value = '';
    }
  };

  // ─────────────────────────────── Hierarchy Excel ───────────────────────────────
  const loadHierarchyExcelStatus = useCallback(async () => {
    setHierarchyExcelStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/hierarchy/excel-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load hierarchy status');
      setHierarchyExcelStatus(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load hierarchy status');
    } finally {
      setHierarchyExcelStatusLoading(false);
    }
  }, []);

  const handleHierarchyPreview = async (file: File) => {
    setHierarchyExcelUploading(true);
    setHierarchyExcelProgress(0);
    setHierarchyPreview(null);
    setHierarchyResult(null);
    setHierarchyPendingFile(file);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setHierarchyExcelProgress((prev) => Math.min(prev + 8, 85));
      }, 300);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/hierarchy/upload-excel?dryRun=true`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setHierarchyExcelProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setHierarchyPreview(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Preview failed');
      setHierarchyPendingFile(null);
    } finally {
      setHierarchyExcelUploading(false);
      setTimeout(() => setHierarchyExcelProgress(0), 1000);
      if (hierarchyFileRef.current) hierarchyFileRef.current.value = '';
    }
  };

  const handleHierarchyConfirm = async () => {
    if (!hierarchyPendingFile) return;
    setHierarchyExcelUploading(true);
    setHierarchyExcelProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', hierarchyPendingFile);
      const progressInterval = setInterval(() => {
        setHierarchyExcelProgress((prev) => Math.min(prev + 2, 90));
      }, 600);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/hierarchy/upload-excel`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setHierarchyExcelProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setHierarchyResult(data.data);
      setHierarchyPreview(null);
      setHierarchyPendingFile(null);
      message.success(data.message);
      await loadHierarchyExcelStatus();
    } catch (err: any) {
      message.error(err?.message || 'Import failed');
    } finally {
      setHierarchyExcelUploading(false);
      setTimeout(() => setHierarchyExcelProgress(0), 1500);
    }
  };

  // ─────────────────────────────── Boot ───────────────────────────────
  useEffect(() => {
    loadData();
    loadVendorStatus();
    loadMajCatGridStatus();
    loadMandatoryGridStatus();
    loadSizeMasterStatus();
    loadColorMasterStatus();
    loadFabricArticleDataStatus();
    loadFabricArticleMasterStatus();
    loadBodyArticleDataStatus();
    loadBroaderMenuStatus();
    loadSegmentMasterStatus();
    loadBasicAccessoriesStatus();
    loadCmpCostMasterStatus();
    loadNationalGridStatus();
    loadHierarchyExcelStatus();
    loadPipelineStatus();
    loadFabricRawStatus();
    loadGmRawStatus();
    loadBodyFabConsStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVendorStatus, loadMajCatGridStatus, loadMandatoryGridStatus, loadSizeMasterStatus, loadColorMasterStatus, loadFabricArticleDataStatus, loadFabricArticleMasterStatus, loadBodyArticleDataStatus, loadBroaderMenuStatus, loadSegmentMasterStatus, loadBasicAccessoriesStatus, loadCmpCostMasterStatus, loadNationalGridStatus, loadHierarchyExcelStatus, loadPipelineStatus, loadFabricRawStatus, loadGmRawStatus, loadBodyFabConsStatus]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [expenses, images, detailed] = await Promise.all([
        api.getExpenseAnalytics(),
        api.getImageUsageAnalytics(),
        api.getDetailedExpenses({ limit: 500 }),
      ]);
      setExpenseData(expenses);
      setImageData(images);
      setDetailedExpenses(detailed || []);
    } catch (error) {
      message.error('Failed to load admin data');
      console.error('Error loading admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const expenseColumns: DataTableColumn<any>[] = [
    { title: 'Status', dataIndex: 'status', key: 'status' },
    { title: 'Count', dataIndex: 'count', key: 'count' },
    {
      title: 'Total Cost',
      key: 'costPrice',
      render: (_v, record) => `$${record.totalCostPrice?.toFixed(2) || '0.00'}`,
    },
  ];

  const detailedExpenseColumns: DataTableColumn<any>[] = [
    {
      title: 'Image',
      key: 'image',
      width: 80,
      align: 'center',
      render: (_v, record) =>
        record.imageUrl ? (
          <Button variant="link" size="icon" onClick={() => window.open(record.imageUrl, '_blank')} title="View image">
            <Eye />
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      title: 'Article',
      dataIndex: 'imageName',
      key: 'imageName',
      render: (imageName: string, record) => record.articleNumber || imageName || '—',
    },
    {
      title: 'Input Tokens',
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      align: 'right',
      render: (val: number) => val?.toLocaleString() || '0',
    },
    {
      title: 'Output Tokens',
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      align: 'right',
      render: (val: number) => val?.toLocaleString() || '0',
    },
    {
      title: 'Total Tokens',
      key: 'totalTokens',
      align: 'right',
      render: (_v, record) => ((record.inputTokens || 0) + (record.outputTokens || 0)).toLocaleString(),
    },
    {
      title: 'Cost',
      dataIndex: 'cost',
      key: 'cost',
      align: 'right',
      render: (val: number) => `$${val?.toFixed(4) || '0.0000'}`,
    },
  ];

  const statusBreakdownData = expenseData?.statusBreakdown
    ? Object.entries(expenseData.statusBreakdown).map(([status, data]: [string, any]) => ({
        key: status,
        status,
        count: data.count,
        totalCostPrice: data.totalCostPrice,
        totalSellingPrice: data.totalSellingPrice,
      }))
    : [];

  return (
    <div className="page-scroll-enabled p-3">
      {/* ─── Header ─── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-800 px-6 py-4 text-white shadow-lg">
        <div>
          <h1 className="m-0 text-xl font-bold text-white">Admin Dashboard</h1>
          <p className="m-0 mt-0.5 text-xs text-white/70">System health, sync status &amp; master data</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => navigate('/admin/expense-change-requests')}
            variant="outline"
            className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <ClipboardList />
            Change Requests
          </Button>
          <Button
            onClick={() => navigate('/admin/expense-audit-log')}
            variant="outline"
            className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            title="Every request raised, every stage action, and every write to a master table"
          >
            <History />
            Audit Log
          </Button>
          <Button onClick={loadData} disabled={loading} className="bg-white font-bold text-slate-800 hover:bg-slate-100">
            <RotateCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      <Spinner spinning={loading}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <JumpNav
            items={[
              { id: 'pipelines', label: 'Pipelines', count: 3 },
              { id: 'vendor', label: 'Vendor sync' },
              { id: 'masters', label: 'Master data', count: MASTER_DATA_COUNT },
              { id: 'analytics', label: 'Analytics' },
            ]}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section id="pipelines" className="scroll-mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h2 className="m-0 text-[17px] font-bold">Pipelines</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { loadPipelineStatus(); loadFabricRawStatus(); loadGmRawStatus(); }}
              disabled={pipelineStatusLoading || fabricRawStatusLoading || gmRawStatusLoading}
            >
              <RotateCw className={pipelineStatusLoading || fabricRawStatusLoading || gmRawStatusLoading ? 'animate-spin' : ''} />
              Refresh status
            </Button>
          </div>
          <PipelineRow
            name="raw_articles"
            counts={pipelineStatus}
            loading={pipelineStatusLoading}
            onView={() => navigate('/admin/expense/raw-articles')}
            runAction={pipelineStatus ? (
              <Popconfirm
                                  title="Run VLM Extraction?"
                                  description="This will process up to 10 PENDING/FAILED rows, run VLM on each image, and push results to extraction_results_flat. Runs in background."
                                  onConfirm={triggerExtraction}
                                  okText="Yes, run now"
                                  cancelText="Cancel"
                                  disabled={pipelineStatus.PENDING + pipelineStatus.FAILED === 0}
                                >
                                  <Button
                                    disabled={extractionRunning || pipelineStatus.PENDING + pipelineStatus.FAILED === 0}
                                    size="sm"
              className={SLATE_PRIMARY_BTN}
                                  >
                                    <RefreshCw className={extractionRunning ? 'animate-spin' : ''} />
                                    {extractionRunning
                                      ? 'Starting...'
                                      : `Run Extraction (${pipelineStatus.PENDING + pipelineStatus.FAILED} queued)`}
                                  </Button>
                                </Popconfirm>
            ) : null}
            message={extractionMessage && <Alert type="info" showIcon message={extractionMessage} />}
          />
          <PipelineRow
            name="fabric_raw_data"
            counts={fabricRawStatus}
            loading={fabricRawStatusLoading}
            onView={() => navigate('/admin/expense/fabric-article-data')}
            runAction={fabricRawStatus ? (
              <Popconfirm
                                title="Run Fabric Raw Processing?"
                                description="This will process up to 20 PENDING rows: upload images to R2 and save records to fabric_article_data. Runs in background."
                                onConfirm={triggerFabricRawProcessing}
                                okText="Yes, run now"
                                cancelText="Cancel"
                                disabled={fabricRawStatus.PENDING === 0}
                              >
                                <Button
                                  disabled={fabricRawRunning || fabricRawStatus.PENDING === 0}
                                  size="sm"
              className={SLATE_PRIMARY_BTN}
                                >
                                  <RefreshCw className={fabricRawRunning ? 'animate-spin' : ''} />
                                  {fabricRawRunning
                                    ? 'Starting...'
                                    : `Run Processing (${fabricRawStatus.PENDING} queued)`}
                                </Button>
                              </Popconfirm>
            ) : null}
            message={fabricRawMessage && <Alert type="info" showIcon message={fabricRawMessage} />}
          />
          <PipelineRow
            name="gm_raw_data"
            counts={gmRawStatus}
            loading={gmRawStatusLoading}
            onView={() => navigate('/gm-article')}
            runAction={gmRawStatus ? (
              <Popconfirm
                                title="Run GM Raw Processing?"
                                description="This will process up to 20 PENDING rows: upload images to R2 and save records to gm_article_data. Runs in background."
                                onConfirm={triggerGmRawProcessing}
                                okText="Yes, run now"
                                cancelText="Cancel"
                                disabled={gmRawStatus.PENDING === 0}
                              >
                                <Button
                                  disabled={gmRawRunning || gmRawStatus.PENDING === 0}
                                  size="sm"
              className={SLATE_PRIMARY_BTN}
                                >
                                  <RefreshCw className={gmRawRunning ? 'animate-spin' : ''} />
                                  {gmRawRunning
                                    ? 'Starting...'
                                    : `Run Processing (${gmRawStatus.PENDING} queued)`}
                                </Button>
                              </Popconfirm>
            ) : null}
            message={gmRawMessage && <Alert type="info" showIcon message={gmRawMessage} />}
          />
          <div className="border-t border-border bg-muted/30 px-5 py-4">
            <div className="mb-2 text-[13px] font-semibold">Fetch SRM presentations → raw_articles</div>
            <div>
              <div className="mb-2 text-[13px] font-semibold">Fetch Presentations to raw_articles</div>
              <div className="mb-2.5 text-xs text-muted-foreground">
                Saves SRM presentations to <code className="rounded bg-muted px-1 py-0.5">raw_articles</code> as <strong>PENDING</strong> — no VLM triggered.
                {testFetchMode === 'date' && (
                  <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                    ⚠ Only dates on or after <strong>27 May 2026</strong> allowed.
                  </span>
                )}
              </div>

              {/* Mode toggle */}
              <div className="mb-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className={testFetchMode === 'date' ? SLATE_PRIMARY_BTN : undefined}
                  onClick={() => {
                    setTestFetchMode('date');
                    setTestResult(null);
                    setTestError(null);
                  }}
                >
                  By Date
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={testFetchMode === 'ppt' ? SLATE_PRIMARY_BTN : undefined}
                  onClick={() => {
                    setTestFetchMode('ppt');
                    setTestResult(null);
                    setTestError(null);
                  }}
                >
                  By PPT Number
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {testFetchMode === 'date' ? (
                  <DatePicker
                    value={testAfterDate}
                    onChange={(val) => {
                      // enforce cutoff client-side too
                      if (val && val.isBefore(RAW_ARTICLES_MIN_DATE, 'day')) {
                        setTestAfterDate(RAW_ARTICLES_MIN_DATE);
                      } else {
                        setTestAfterDate(val);
                      }
                      setTestResult(null);
                      setTestError(null);
                    }}
                    placeholder="Received on or after"
                    className="max-w-[200px]"
                    disabled={testFetching}
                  />
                ) : (
                  <Input
                    placeholder="e.g. PRES-00831"
                    value={testPptInput}
                    onChange={(e) => {
                      setTestPptInput(e.target.value.toUpperCase());
                      setTestResult(null);
                      setTestError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runTestApiFetch();
                    }}
                    className="max-w-[200px] font-mono font-semibold"
                    disabled={testFetching}
                  />
                )}
                <Button
                  onClick={runTestApiFetch}
                  disabled={testFetching || (testFetchMode === 'date' ? !testAfterDate : !testPptInput.trim())}
                  variant="outline"
                  className="border-slate-800 font-semibold text-slate-800 dark:border-slate-200 dark:text-slate-200"
                >
                  <Search className={testFetching ? 'animate-spin' : ''} />
                  {testFetching ? 'Fetching...' : 'Fetch to Raw Articles'}
                </Button>
              </div>
            </div>

            {testError && (
              <Alert type="error" showIcon className="mt-2.5" message="Error" description={testError} />
            )}

            {testResult && (
              <Alert
                type={testResult.errors > 0 ? 'warning' : (testResult.matched ?? testResult.inserted) === 0 ? 'info' : 'success'}
                showIcon
                className="mt-2.5"
                message={
                  testFetchMode === 'date' ? (
                    <span>
                      Results for <strong>{testResult.after_date}</strong> onwards
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        · {(testResult.total_from_api ?? 0).toLocaleString()} total from API · {(testResult.date_filtered ?? 0).toLocaleString()} too old ·{' '}
                        <strong>{(testResult.matched ?? 0).toLocaleString()}</strong> matched
                      </span>
                    </span>
                  ) : (
                    <span>
                      Results for <strong>{testResult.ppt_no}</strong> · <strong>{testResult.matched ?? 0}</strong> rows in SRM API
                    </span>
                  )
                }
                description={
                  <div className="mt-1 flex flex-wrap gap-3">
                    <span>
                      <strong className="text-emerald-600">{testResult.inserted}</strong> new rows inserted (PENDING)
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span>
                      <strong>{testResult.skipped}</strong> already existed (skipped)
                    </span>
                    {testResult.errors > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span>
                          <strong className="text-rose-600">{testResult.errors}</strong> errors
                        </span>
                      </>
                    )}
                    {testResult.message && (
                      <span className="italic text-muted-foreground">{testResult.message}</span>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </section>

        <section id="vendor" className="scroll-mt-3 rounded-xl border border-border bg-card px-5 py-4">
          <Spinner spinning={vendorStatusLoading}>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
              <div className="flex min-w-[180px] flex-col">
                <h2 className="m-0 text-[17px] font-bold">Vendor master sync</h2>
                <span className="text-[12.5px] text-muted-foreground">Daily at 2:00 AM IST</span>
              </div>
              {vendorStatus ? (
                <>
                  <div className="flex flex-col">
                    <span className="text-[12px] text-muted-foreground">Records</span>
                    <strong className="text-[15px] tabular-nums">{vendorStatus.count.toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[12px] text-muted-foreground">Last sync</span>
                    <strong className="text-[15px]">
                      {vendorStatus.lastSyncedAt
                        ? new Date(vendorStatus.lastSyncedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'
                        : 'Never'}
                    </strong>
                  </div>
                  <div className="flex min-w-0 flex-col" title="https://my-dab-app.azurewebsites.net/api/DY_SUPPLIER_MST">
                    <span className="text-[12px] text-muted-foreground">Source</span>
                    <span className="truncate font-mono text-[12.5px]">DY_SUPPLIER_MST (DAB API)</span>
                  </div>
                </>
              ) : (
                <span className="text-[13px] text-muted-foreground">Could not load vendor master status</span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/admin/expense/vendor-master')}>
                  <Eye />
                  View data
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={loadVendorStatus} disabled={vendorStatusLoading} aria-label="Refresh vendor sync status" title="Refresh status">
                  <RotateCw className={vendorStatusLoading ? 'animate-spin' : ''} />
                </Button>
                <Popconfirm
                  title="Trigger Vendor Master Sync?"
                  description="Fetch all vendors from the DAB API and upsert into master_vendor_details. This may take a minute."
                  onConfirm={runVendorSync}
                  okText="Yes, sync now"
                  cancelText="Cancel"
                >
                  <Button size="sm" disabled={vendorSyncing} className={SLATE_PRIMARY_BTN}>
                    <RefreshCw className={vendorSyncing ? 'animate-spin' : ''} />
                    {vendorSyncing ? 'Syncing...' : 'Sync Now'}
                  </Button>
                </Popconfirm>
              </div>
            </div>
            {vendorStatus?.inProgress && (
              <div className="mt-2 flex items-center gap-1.5 text-[13px] text-blue-700 dark:text-blue-300">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sync in progress…
              </div>
            )}
            {vendorStatus?.lastResult && (
              <div className="mt-2 text-[12.5px]">
                <span className="text-muted-foreground">Last run: </span>
                {vendorStatus.lastResult.error ? (
                  <span className="font-mono text-red-700 dark:text-red-400">Failed — {vendorStatus.lastResult.error}</span>
                ) : (
                  <span className="text-green-800 dark:text-green-400">
                    {vendorStatus.lastResult.upserted.toLocaleString('en-IN')} records in {vendorStatus.lastResult.pages} pages ({(vendorStatus.lastResult.durationMs / 1000).toFixed(1)}s)
                  </span>
                )}
              </div>
            )}
          </Spinner>
        </section>

        <section id="masters" className="scroll-mt-3 flex flex-col gap-3">
          <SectionHeading title="Master data uploads" meta={`${MASTER_DATA_COUNT} datasets`} />
          <MasterGroup title="Attributes & grids" count={7} notUploaded={((majCatGridMeta ? (majCatGridMeta.totalRows ?? majCatGridMeta.totalValues ?? 0) : null) === 0 ? 1 : 0) + ((sizeMasterMeta ? (sizeMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((colorMasterMeta ? (colorMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((mandatoryGridMeta ? (mandatoryGridMeta.totalRows ?? 0) : null) === 0 ? 1 : 0) + ((mcdTotal ? mcdTotal.total : null) === 0 ? 1 : 0) + ((nationalGridTotal) === 0 ? 1 : 0) + ((segmentMasterMeta ? (segmentMasterMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
            <MasterDataCard
              title="Major Category Grid"
              description="Dropdown Values"
              rows={majCatGridMeta ? (majCatGridMeta.totalRows ?? majCatGridMeta.totalValues ?? 0) : null}
              lastUpload={majCatGridMeta?.uploadedAt ?? null}
              loading={majCatGridStatusLoading}
              busy={majCatGridUploading}
              onView={() => navigate('/admin/expense/major-category-grid')}
              onDownload={downloadMajCatGridData}
              onTemplate={downloadMajCatTemplate}
              onRefresh={loadMajCatGridStatus}
              details={
                <>
                  {majCatGridMeta ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Last Upload">
                        {majCatGridMeta.uploadedAt
                          ? new Date(majCatGridMeta.uploadedAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }) + ' IST'
                          : <span className="text-muted-foreground">Unknown</span>}
                      </Descriptions.Item>
                      <Descriptions.Item label="File">
                        <span className="font-mono text-xs">{majCatGridMeta.fileName || '—'}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(majCatGridMeta.categoriesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Attribute Slots">
                        <Badge variant="secondary">{(majCatGridMeta.attributesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Data Rows Parsed">
                        <Badge variant="success">{(majCatGridMeta.totalRows ?? majCatGridMeta.totalValues ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Rows Skipped">
                        <Badge variant={(majCatGridMeta.skippedRows ?? 0) > 0 ? 'warning' : 'secondary'}>
                          {(majCatGridMeta.skippedRows ?? 0).toLocaleString()}
                        </Badge>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No grid uploaded yet"
                      description="Upload ALL_300_GRIDS_SEQUENCED.xlsx to enable major-category-scoped dropdown filtering in the Approver page."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Grid Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Upload <strong>ALL_300_GRIDS_SEQUENCED.xlsx</strong> — columns A (Major Category), E (Attribute), G (Allowed Value). Parsing ~318k rows may take 30–60 seconds.
                    </div>

                    <input
                      ref={majCatFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleMajCatGridUpload(file);
                      }}
                    />

                    {majCatGridUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          {majCatJobPhase || 'Processing…'}
                        </div>
                        <Progress value={majCatGridProgress} />
                        <div className="mt-1 text-[11px] text-muted-foreground">{majCatGridProgress}% complete</div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => majCatFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Size Master"
              description="Sizes per Major Category"
              rows={sizeMasterMeta ? (sizeMasterMeta.total ?? 0) : null}
              lastUpload={sizeMasterMeta?.uploadedAt ?? null}
              loading={sizeMasterStatusLoading}
              busy={sizeMasterUploading}
              onView={() => navigate('/admin/expense/size-master')}
              onDownload={downloadSizeMasterData}
              onTemplate={downloadSizeMasterTemplate}
              onRefresh={loadSizeMasterStatus}
              details={
                <>
                  {sizeMasterMeta && (sizeMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {sizeMasterMeta.uploadedAt && (
                        <Descriptions.Item label="Last Upload">
                          {new Date(sizeMasterMeta.uploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {sizeMasterMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{sizeMasterMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(sizeMasterMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="secondary">{(sizeMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Active (ACT)">
                        <Badge variant="success">{(sizeMasterMeta.active ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {sizeMasterMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(sizeMasterMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(sizeMasterMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No size master uploaded yet"
                      description="Upload the SIZE MASTER Excel (sheet COMPILE, columns: DIV, SUB-DIV, MC_CD, MC_DESC, SIZE, SIZE ST) to populate major-category-wise sizes."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Size Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>COMPILE</strong>, headers in row 3, data from row 5 — columns
                      A (DIV), B (SUB-DIV), C (MC_CD), D (MC_DESC), E (SIZE), F (SIZE ST). Replaces the entire table.
                    </div>

                    <input
                      ref={sizeFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSizeMasterUpload(file);
                      }}
                    />

                    {sizeMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={sizeMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sizeFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Color Master"
              description="Father / Child Colours"
              rows={colorMasterMeta ? (colorMasterMeta.total ?? 0) : null}
              lastUpload={colorMasterMeta?.uploadedAt ?? null}
              loading={colorMasterStatusLoading}
              busy={colorMasterUploading}
              onView={() => navigate('/admin/expense/color-master')}
              onDownload={downloadColorMasterData}
              onTemplate={downloadColorMasterTemplate}
              onRefresh={loadColorMasterStatus}
              details={
                <>
                  {colorMasterMeta && (colorMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {colorMasterMeta.uploadedAt && (
                        <Descriptions.Item label="Last Upload">
                          {new Date(colorMasterMeta.uploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {colorMasterMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{colorMasterMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Father Colours">
                        <Badge variant="info">{(colorMasterMeta.fathers ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Colours">
                        <Badge variant="secondary">{(colorMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {colorMasterMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(colorMasterMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(colorMasterMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No color master uploaded yet"
                      description="Upload the COLOR CHART MASTER Excel (columns FATHER COLOR, CHILD COLOR, SAP CREATE OLD) to populate the Add Color dropdown."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Color Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns <strong>FATHER COLOR</strong>, <strong>CHILD COLOR</strong> and
                      {' '}<strong>SAP CREATE OLD</strong> (matched by header name; other columns ignored).
                      Replaces the entire table. Duplicate SAP codes are skipped.
                    </div>

                    <input
                      ref={colorFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleColorMasterUpload(file);
                      }}
                    />

                    {colorMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={colorMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => colorFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Mandatory Grid"
              description="Field Visibility per Major Category"
              rows={mandatoryGridMeta ? (mandatoryGridMeta.totalRows ?? 0) : null}
              lastUpload={mandatoryGridMeta?.uploadedAt ?? null}
              loading={mandatoryGridStatusLoading}
              busy={mandatoryGridUploading}
              onView={() => navigate('/admin/expense/mandatory-grid')}
              onDownload={downloadMandatoryGridData}
              onTemplate={downloadMandatoryTemplate}
              onRefresh={loadMandatoryGridStatus}
              details={
                <>
                  {mandatoryGridMeta ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Last Upload">
                        {mandatoryGridMeta.uploadedAt
                          ? new Date(mandatoryGridMeta.uploadedAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }) + ' IST'
                          : <span className="text-muted-foreground">Unknown</span>}
                      </Descriptions.Item>
                      <Descriptions.Item label="File">
                        <span className="font-mono text-xs">{mandatoryGridMeta.fileName || '—'}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="Excel Rows (Major Cat.)">
                        <Badge variant="info">{(mandatoryGridMeta.categoriesCount ?? mandatoryGridMeta.totalRows ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="SAP Key Columns">
                        <Badge variant="secondary">{(mandatoryGridMeta.attributesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Visible Fields (1s in Excel)">
                        <Badge variant="success" title="Count of (major_category × SAP_key) cells marked 1 = visible in article card">
                          {(mandatoryGridMeta.activeMappings ?? mandatoryGridMeta.totalValues ?? 0).toLocaleString()}
                        </Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Rows Skipped">
                        <Badge variant={(mandatoryGridMeta.skippedRows ?? 0) > 0 ? 'warning' : 'secondary'}>
                          {(mandatoryGridMeta.skippedRows ?? 0).toLocaleString()}
                        </Badge>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No mandatory grid uploaded yet"
                      description="Upload MANDATORY GRID DATA.xlsx — Row 3: SAP keys, Row 4: labels, Row 6+: data rows (1 = visible, 0/empty = hidden)."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Mandatory Grid Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Upload <strong>MANDATORY GRID DATA.xlsx</strong> — Row 3 has SAP keys, Row 4 has labels, Row 5 is empty, Row 6+ are data rows (1 = active/visible, 0 or empty = hidden).
                    </div>

                    <input
                      ref={mandatoryFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleMandatoryGridUpload(file);
                      }}
                    />

                    {mandatoryGridUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel... please wait
                        </div>
                        <Progress value={mandatoryGridProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mandatoryFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Major Category Details"
              rows={mcdTotal ? mcdTotal.total : null}
              loading={mcdStatusLoading}
              busy={mcdUploading}
              onDownload={downloadMcdData}
              onTemplate={downloadMcdTemplate}
              onRefresh={loadMcdStatus}
              details={
                <>
                  {mcdTotal && mcdTotal.total > 0 ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{mcdTotal.total.toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        {mcdTotal.categories.toLocaleString()}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No major category details loaded"
                      description="Upload MAJOR CATEGORY DETAILS Excel. Columns: SEG, DIV, SUB DIV, MAJ CAT, MC CODE, MC DES, HSN CODE, MC STATUS. Data starts at row 4. Replaces the entire table."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Major Category Details Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns: <strong>SEG</strong>, <strong>DIV</strong>, <strong>SUB DIV</strong>, <strong>MAJ CAT</strong>, <strong>MC CODE</strong>, <strong>MC DES</strong>, <strong>HSN CODE</strong>, <strong>MC STATUS</strong>.{' '}
                      <strong className="text-destructive">Replaces entire table.</strong>
                    </div>
                    <input
                      ref={mcdFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleMcdUpload(file);
                      }}
                    />
                    {mcdUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; replacing table...
                        </div>
                        <Progress value={mcdProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mcdFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="National Grid"
              description="Attribute Values"
              rows={nationalGridTotal}
              loading={nationalGridStatusLoading}
              busy={nationalGridUploading}
              onView={() => navigate('/admin/expense/national-grid')}
              onDownload={downloadNationalGridData}
              onTemplate={downloadNationalGridTemplate}
              onRefresh={loadNationalGridStatus}
              details={
                <>
                  {nationalGridTotal !== null && nationalGridTotal > 0 ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Total (attribute, code) pairs">
                        <Badge variant="success">{nationalGridTotal.toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Usage">
                        Validated on every article modify before SAP &amp; DB update.
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No national grid data loaded"
                      description="Upload an Excel with columns attribute_name, code, full_form to populate the validation table. The template below shows the expected format."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload National Grid Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Accepts the vertical sequenced format — columns <strong>M_GRID_NM</strong>, <strong>G_CHILD_GRID_VAL</strong>, <strong>FULL FORM</strong>, <strong>GRID_STATUS</strong>.
                      Only <code>ACT</code> rows are imported. <strong className="text-destructive">Uploading replaces the entire table.</strong>
                    </div>

                    <input
                      ref={nationalGridFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleNationalGridUpload(file);
                      }}
                    />

                    {nationalGridUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing &amp; importing rows...
                        </div>
                        <Progress value={nationalGridProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => nationalGridFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Segment Master"
              description="Price Segments per Major Category"
              rows={segmentMasterMeta ? (segmentMasterMeta.total ?? 0) : null}
              lastUpload={segmentMasterMeta?.lastUpdated ?? null}
              loading={segmentMasterStatusLoading}
              busy={segmentMasterUploading}
              onView={() => navigate('/admin/expense/segment-master')}
              onDownload={exportSegmentMaster}
              onTemplate={downloadSegmentMasterTemplate}
              onRefresh={loadSegmentMasterStatus}
              details={
                <>
                  {segmentMasterMeta && (segmentMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {segmentMasterMeta.lastUpdated && (
                        <Descriptions.Item label="Last Updated">
                          {new Date(segmentMasterMeta.lastUpdated).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(segmentMasterMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{(segmentMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {segmentMasterMeta.skipped != null && (segmentMasterMeta.skipped ?? 0) > 0 && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant="warning">{(segmentMasterMeta.skipped ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No segment master data"
                      description="Upload the Segment Master Excel (columns: SUB-DIVISION, MAJOR-CATEGORY, SEGMENT_TYPE, MIN, MAX). When MAX = ABOVE, that segment gets max=999999 and further segments for that MC are dropped."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Segment Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns: <strong>SUB-DIVISION, MAJOR-CATEGORY, SEGMENT_TYPE, MIN, MAX</strong>. When MAX = <code>ABOVE</code>, max becomes 999999 and subsequent segments for that MC are dropped. <strong className="text-destructive">Replaces entire table.</strong>
                    </div>

                    <input
                      ref={segmentFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSegmentMasterUpload(file);
                      }}
                    />

                    {segmentMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; replacing table...
                        </div>
                        <Progress value={segmentMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => segmentFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
          </MasterGroup>
          <MasterGroup title="GM" count={2} notUploaded={((gmMctMeta ? (gmMctMeta.totalRows ?? 0) : null) === 0 ? 1 : 0) + ((gmGridMeta ? (gmGridMeta.totalRows ?? gmGridMeta.totalValues ?? 0) : null) === 0 ? 1 : 0)}>
            <MasterDataCard
              title="GM Major Category Details"
              rows={gmMctMeta ? (gmMctMeta.totalRows ?? 0) : null}
              lastUpload={gmMctMeta?.uploadedAt ?? null}
              loading={gmMctStatusLoading}
              busy={gmMctUploading}
              onDownload={downloadGMMctData}
              onTemplate={downloadGMMctTemplate}
              onRefresh={loadGMMctStatus}
              details={
                <>
                  {gmMctMeta && (gmMctMeta.totalRows ?? 0) > 0 ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Last Upload">
                        {gmMctMeta.uploadedAt
                          ? new Date(gmMctMeta.uploadedAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }) + ' IST'
                          : <span className="text-muted-foreground">Unknown</span>}
                      </Descriptions.Item>
                      <Descriptions.Item label="File">
                        <span className="font-mono text-xs">{gmMctMeta.fileName || '—'}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(gmMctMeta.categoriesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Family Codes">
                        <Badge variant="secondary">{(gmMctMeta.familyCodesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{(gmMctMeta.totalRows ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Rows Skipped">
                        <Badge variant={(gmMctMeta.skippedRows ?? 0) > 0 ? 'warning' : 'secondary'}>
                          {(gmMctMeta.skippedRows ?? 0).toLocaleString()}
                        </Badge>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No GM major category details uploaded yet"
                      description="Upload the GM MCT Excel to populate the GM article hierarchy (division → sub-division → major category) and family code mappings."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload GM MCT Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns: <strong>seg, div, sub_div, maj_cat_nm</strong> (required), mc_cd, maj_cat_desc, mj_status, archetype, archetype_nm, family_code, family_name, status. Row 1 = headers, data from Row 2. Replaces the entire table.
                    </div>

                    <input
                      ref={gmMctFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleGMMctUpload(file);
                      }}
                    />

                    {gmMctUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          {gmMctJobPhase || 'Processing…'}
                        </div>
                        <Progress value={gmMctProgress} />
                        <div className="mt-1 text-[11px] text-muted-foreground">{gmMctProgress}% complete</div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => gmMctFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="GM Major Category Grid Values"
              rows={gmGridMeta ? (gmGridMeta.totalRows ?? gmGridMeta.totalValues ?? 0) : null}
              lastUpload={gmGridMeta?.uploadedAt ?? null}
              loading={gmGridStatusLoading}
              busy={gmGridUploading}
              onDownload={downloadGMGridData}
              onTemplate={downloadGMGridTemplate}
              onRefresh={loadGMGridStatus}
              details={
                <>
                  {gmGridMeta ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Last Upload">
                        {gmGridMeta.uploadedAt
                          ? new Date(gmGridMeta.uploadedAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }) + ' IST'
                          : <span className="text-muted-foreground">Unknown</span>}
                      </Descriptions.Item>
                      <Descriptions.Item label="File">
                        <span className="font-mono text-xs">{gmGridMeta.fileName || '—'}</span>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(gmGridMeta.categoriesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Family Codes">
                        <Badge variant="secondary">{(gmGridMeta.familyCodesCount ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Data Rows">
                        <Badge variant="success">{(gmGridMeta.totalRows ?? gmGridMeta.totalValues ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Rows Skipped">
                        <Badge variant={(gmGridMeta.skippedRows ?? 0) > 0 ? 'warning' : 'secondary'}>
                          {(gmGridMeta.skippedRows ?? 0).toLocaleString()}
                        </Badge>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No GM grid uploaded yet"
                      description="Upload the GM major category grid Excel to enable attribute dropdowns on the GM Article new article page."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload GM Grid Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns: <strong>div, sub_div, seg, maj_cat_nm</strong> (required), <strong>family_code</strong> (required), mandatory, family_name, status, <strong>grid_val</strong> (required), uom. Row 1 = title, Row 2 = headers, data from Row 3.
                    </div>

                    <input
                      ref={gmGridFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleGMGridUpload(file);
                      }}
                    />

                    {gmGridUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          {gmGridJobPhase || 'Processing…'}
                        </div>
                        <Progress value={gmGridProgress} />
                        <div className="mt-1 text-[11px] text-muted-foreground">{gmGridProgress}% complete</div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => gmGridFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
          </MasterGroup>
          <MasterGroup title="Fabric & body" count={4} notUploaded={((fabricArticleDataMeta ? (fabricArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((fabricArticleMasterMeta ? (fabricArticleMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((bodyFabConsTotal ? bodyFabConsTotal.total : null) === 0 ? 1 : 0) + ((bodyArticleDataMeta ? (bodyArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
            <MasterDataCard
              title="Fabric Article Data"
              description="Bulk Insert"
              rows={fabricArticleDataMeta ? (fabricArticleDataMeta.total ?? 0) : null}
              lastUpload={fabricArticleDataMeta?.uploadedAt ?? null}
              loading={fabricArticleDataStatusLoading}
              busy={fabricArticleDataUploading}
              onView={() => navigate('/admin/expense/fabric-article-data')}
              onTemplate={downloadFabricArticleDataTemplate}
              onRefresh={loadFabricArticleDataStatus}
              details={
                <>
                  {fabricArticleDataMeta && (fabricArticleDataMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {fabricArticleDataMeta.uploadedAt && (
                        <Descriptions.Item label="Last Upload">
                          {new Date(fabricArticleDataMeta.uploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {fabricArticleDataMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{fabricArticleDataMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="secondary">{(fabricArticleDataMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Synced">
                        <Badge variant="success">{(fabricArticleDataMeta.synced ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Pending">
                        <Badge variant="warning">{(fabricArticleDataMeta.pending ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {fabricArticleDataMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(fabricArticleDataMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(fabricArticleDataMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No fabric article data uploaded yet"
                      description="Upload an Excel with columns: FABRIC_ARTICLE_NUMBER, FABRIC_ARTICLE_DESC, DIVISION, SUB_DIVISION, MAJOR_CATEGORY, VENDOR_NAME, VENDOR_CODE, plus fabric attribute columns. Each row is inserted as a new record."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Fabric Article Data Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>FABRIC ARTICLE DATA</strong> (or first sheet), headers in row 3, data from row 5.
                      Each row is <strong>inserted as a new record</strong> with a fresh ID.
                    </div>

                    <input
                      ref={fabricArticleDataFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFabricArticleDataUpload(file);
                      }}
                    />

                    {fabricArticleDataUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & inserting records...
                        </div>
                        <Progress value={fabricArticleDataProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fabricArticleDataFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Fabric Article Master"
              description="Fabric Hierarchy"
              rows={fabricArticleMasterMeta ? (fabricArticleMasterMeta.total ?? 0) : null}
              lastUpload={fabricArticleMasterMeta?.uploadedAt ?? null}
              loading={fabricArticleMasterStatusLoading}
              busy={fabricArticleMasterUploading}
              onView={() => navigate('/admin/expense/fabric-article-master')}
              onDownload={downloadFabricArticleMasterData}
              onTemplate={downloadFabricArticleMasterTemplate}
              onRefresh={loadFabricArticleMasterStatus}
              details={
                <>
                  {fabricArticleMasterMeta && (fabricArticleMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {fabricArticleMasterMeta.uploadedAt && (
                        <Descriptions.Item label="Last Upload">
                          {new Date(fabricArticleMasterMeta.uploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {fabricArticleMasterMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{fabricArticleMasterMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(fabricArticleMasterMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="secondary">{(fabricArticleMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {fabricArticleMasterMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(fabricArticleMasterMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(fabricArticleMasterMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No fabric article master uploaded yet"
                      description="Upload the Fabric Article Master Excel (columns: SEG, DIV, SUB DIV, MAJ CAT, MC CODE, MC DES, STATUS, HSN CD, ART_TYPE) to populate fabric hierarchy dropdowns."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Fabric Article Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>HIERARCHY MASTER</strong> (or first sheet), headers in row 3, data from row 5 —
                      columns: SEG, DIV, SUB DIV, MAJ CAT, MC CODE, MC DES, STATUS, HSN CD, ART_TYPE. Replaces the entire table.
                    </div>

                    <input
                      ref={fabricArticleFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFabricArticleMasterUpload(file);
                      }}
                    />

                    {fabricArticleMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={fabricArticleMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fabricArticleFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Body Fabric Consumption"
              rows={bodyFabConsTotal ? bodyFabConsTotal.total : null}
              loading={bodyFabConsStatusLoading}
              busy={bodyFabConsUploading}
              onDownload={downloadBodyFabConsData}
              onTemplate={downloadBodyFabConsTemplate}
              onRefresh={loadBodyFabConsStatus}
              details={
                <>
                  {bodyFabConsTotal && bodyFabConsTotal.total > 0 ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{bodyFabConsTotal.total.toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        {bodyFabConsTotal.categories.toLocaleString()}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No body fabric consumption data loaded"
                      description="Upload FAB CONSUMPTION MASTER Excel. Reads columns: DIV, SUB DIV, MAJ CAT, FAB_WIDTH, FAB CONSUMPTION, GSM. All other columns are ignored. Replaces the entire table."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload FAB CONSUMPTION MASTER Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns used: <strong>DIV</strong>, <strong>SUB DIV</strong>, <strong>MAJ CAT</strong>, <strong>FAB_WIDTH</strong>, <strong>FAB CONSUMPTION</strong>, <strong>GSM</strong>.
                      All other size/age columns are ignored. <strong className="text-destructive">Replaces entire table.</strong>
                    </div>

                    <input
                      ref={bodyFabConsFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBodyFabConsUpload(file);
                      }}
                    />

                    {bodyFabConsUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; replacing table...
                        </div>
                        <Progress value={bodyFabConsProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => bodyFabConsFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Body Article Data"
              description="Bulk Update"
              rows={bodyArticleDataMeta ? (bodyArticleDataMeta.total ?? 0) : null}
              lastUpload={bodyArticleDataMeta?.uploadedAt ?? null}
              loading={bodyArticleDataStatusLoading}
              busy={bodyArticleDataUploading}
              onView={() => navigate('/admin/expense/body-article-data')}
              onTemplate={downloadBodyArticleDataTemplate}
              onRefresh={loadBodyArticleDataStatus}
              details={
                <>
                  {bodyArticleDataMeta && (bodyArticleDataMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {bodyArticleDataMeta.uploadedAt && (
                        <Descriptions.Item label="Last Upload">
                          {new Date(bodyArticleDataMeta.uploadedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {bodyArticleDataMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{bodyArticleDataMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Body Articles">
                        <Badge variant="info">{(bodyArticleDataMeta.bodyArticles ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="secondary">{(bodyArticleDataMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {bodyArticleDataMeta.inserted != null && (
                        <Descriptions.Item label="Rows Inserted">
                          <Badge variant="secondary">{(bodyArticleDataMeta.inserted ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {bodyArticleDataMeta.updated != null && (
                        <Descriptions.Item label="Rows Updated">
                          <Badge variant="secondary">{(bodyArticleDataMeta.updated ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {bodyArticleDataMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(bodyArticleDataMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(bodyArticleDataMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                      {bodyArticleDataMeta.truncated != null && (
                        <Descriptions.Item label="Values Truncated">
                          <Badge variant={(bodyArticleDataMeta.truncated ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(bodyArticleDataMeta.truncated ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No body article data uploaded yet"
                      description="Upload the Body Article Data Excel (Division/Sub Division/Major Category/MC Code, Body Article Number/Description, construction attributes, CMTP_COST, CMP_COST, FAB_CONS, WIDTH) to populate body article master data."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Body Article Data Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>BODY UPLOADER FORMAT</strong> (or first sheet), headers in row 3, data from row 5 —
                      Division, Sub Division, Major Category, MC Code, Body Article Number, Description, construction attributes, CMTP_COST, CMP_COST, FAB_CONS, WIDTH.
                      Rows matching an existing Body Article Number are updated, others are inserted; approval/SAP-sync data is untouched.
                      Text values over 100 characters (255 for Description) are truncated to fit.
                    </div>

                    <input
                      ref={bodyArticleDataFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBodyArticleDataUpload(file);
                      }}
                    />

                    {bodyArticleDataUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & updating table...
                        </div>
                        <Progress value={bodyArticleDataProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => bodyArticleDataFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
          </MasterGroup>
          <MasterGroup title="Costs" count={3} notUploaded={((vaacTotal ? vaacTotal.total : null) === 0 ? 1 : 0) + ((basicAccessoriesMeta ? (basicAccessoriesMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((cmpCostMasterMeta ? (cmpCostMasterMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
            <MasterDataCard
              title="Value Addition Accessories Cost"
              rows={vaacTotal ? vaacTotal.total : null}
              loading={vaacStatusLoading}
              busy={vaacUploading}
              onDownload={downloadVaacData}
              onTemplate={downloadVaacTemplate}
              onRefresh={loadVaacStatus}
              details={
                <>
                  {vaacTotal && vaacTotal.total > 0 ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{vaacTotal.total.toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        {vaacTotal.categories.toLocaleString()}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No value addition accessories cost data loaded"
                      description="Upload VAL ADD ACC MASTER Excel. Columns: DIV, SUB DIV, MAJ CAT + 7 accessory types (Button, Zipper, Velcro, Patch, Label, Elastic, Others) × 3 cols each. Replaces the entire table."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload VAL ADD ACC MASTER Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns used: <strong>DIV</strong>, <strong>SUB DIV</strong>, <strong>MAJ CAT</strong> + 7 accessory cost columns.{' '}
                      <strong className="text-destructive">Replaces entire table.</strong>
                    </div>

                    <input
                      ref={vaacFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleVaacUpload(file);
                      }}
                    />

                    {vaacUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; replacing table...
                        </div>
                        <Progress value={vaacProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => vaacFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Basic Accessories"
              description="Trims &amp; Packaging Cost per Major Category"
              rows={basicAccessoriesMeta ? (basicAccessoriesMeta.total ?? 0) : null}
              lastUpload={basicAccessoriesMeta?.lastUpdated ?? null}
              loading={basicAccessoriesStatusLoading}
              busy={basicAccessoriesUploading}
              onView={() => navigate('/admin/expense/basic-accessories')}
              onDownload={() => downloadBasicAccessoriesFile('export')}
              onTemplate={() => downloadBasicAccessoriesFile('template')}
              onRefresh={loadBasicAccessoriesStatus}
              details={
                <>
                  {basicAccessoriesMeta && (basicAccessoriesMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {basicAccessoriesMeta.lastUpdated && (
                        <Descriptions.Item label="Last Updated">
                          {new Date(basicAccessoriesMeta.lastUpdated).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(basicAccessoriesMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Accessory Rows">
                        <Badge variant="success">{(basicAccessoriesMeta.components ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {basicAccessoriesMeta.withCost != null && (
                        <Descriptions.Item label="With Basic &amp; Trims Cost">
                          <Badge variant="info">{(basicAccessoriesMeta.withCost ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {basicAccessoriesMeta.updated != null && (
                        <Descriptions.Item label="Updated in Last Upload">
                          <Badge variant="success">{(basicAccessoriesMeta.updated ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {basicAccessoriesMeta.skipped != null && (basicAccessoriesMeta.skipped ?? 0) > 0 && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant="warning">{(basicAccessoriesMeta.skipped ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No basic accessories data"
                      description={'Upload the "MAJ CAT WISE BASIC ACCESSORIES DETAILS" workbook — sheets "ACC LIST" (Button, Zipper, Elastic, Lace, Draw Cord, Hook & Loop, Interlining) and "Packaging Master" (Poly Bag, Price Tag, Kimball Tag, Hanger, Tissue Paper, Carton), each with PER PC CONSUMPTION (QTY), RATE and VALUE per major category.'}
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Basic Accessories Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheets: <strong>ACC LIST</strong> + <strong>Packaging Master</strong>, headers on row 3 starting at column C
                      (DIV, SUB DIV, MAJ CAT, then QTY / RATE / VALUE per accessory). Download the template for the exact layout.{' '}
                      <strong>Updates by MAJ CAT</strong> — categories not in the file are left untouched.
                    </div>

                    <input
                      ref={basicAccessoriesFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBasicAccessoriesUpload(file);
                      }}
                    />

                    {basicAccessoriesUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; updating accessories...
                        </div>
                        <Progress value={basicAccessoriesProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => basicAccessoriesFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="CMP Cost Master"
              description="Rough CMP Cost per Major Category"
              rows={cmpCostMasterMeta ? (cmpCostMasterMeta.total ?? 0) : null}
              lastUpload={cmpCostMasterMeta?.lastUpdated ?? null}
              loading={cmpCostMasterStatusLoading}
              busy={cmpCostMasterUploading}
              onView={() => navigate('/admin/expense/cmp-cost-master')}
              onDownload={() => downloadCmpCostMasterFile('export')}
              onTemplate={() => downloadCmpCostMasterFile('template')}
              onRefresh={loadCmpCostMasterStatus}
              details={
                <>
                  {cmpCostMasterMeta && (cmpCostMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {cmpCostMasterMeta.lastUpdated && (
                        <Descriptions.Item label="Last Updated">
                          {new Date(cmpCostMasterMeta.lastUpdated).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(cmpCostMasterMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{(cmpCostMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {cmpCostMasterMeta.skipped != null && (cmpCostMasterMeta.skipped ?? 0) > 0 && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant="warning">{(cmpCostMasterMeta.skipped ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No CMP cost master data"
                      description="Upload the CMP Cost Excel (columns: DIV, SUB_DIV, MAJ_CAT, Total). Auto-fills a Body Article's CMP Cost on the New Article page when a pending article of that major category has none of its own yet."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload CMP Cost Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Columns: <strong>DIV, SUB_DIV, MAJ_CAT, Total</strong>. Download the template for the exact layout.{' '}
                      <strong>Upserts by DIV + SUB_DIV + MAJ_CAT</strong> — combinations not in the file are left untouched.
                    </div>

                    <input
                      ref={cmpCostMasterFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCmpCostMasterUpload(file);
                      }}
                    />

                    {cmpCostMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; updating CMP costs...
                        </div>
                        <Progress value={cmpCostMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => cmpCostMasterFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
          </MasterGroup>
          <MasterGroup title="Hierarchy & menus" count={2} notUploaded={((hierarchyExcelStatus ? hierarchyExcelStatus.categories : null) === 0 ? 1 : 0) + ((broaderMenuMeta ? (broaderMenuMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
            <MasterDataCard
              title="Hierarchy Excel"
              description="Division / Sub-Division / Major Category"
              rows={hierarchyExcelStatus ? hierarchyExcelStatus.categories : null}
              rowsLabel="Major categories"
              loading={hierarchyExcelStatusLoading}
              busy={hierarchyExcelUploading || !!hierarchyPreview}
              onView={() => navigate('/admin/expense/hierarchy')}
              onRefresh={loadHierarchyExcelStatus}
              details={
                <>
                  {hierarchyExcelStatus ? (
                    <Descriptions bordered>
                      <Descriptions.Item label="Divisions (Departments)">
                        <Badge variant="info">{hierarchyExcelStatus.departments}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Sub-Divisions">
                        <Badge variant="secondary">{hierarchyExcelStatus.subDepartments}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="success">{hierarchyExcelStatus.categories}</Badge>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      message="Upload Mandatory Grid Excel to sync hierarchy"
                      description="Reads DIV, SUB-DIV, MAJOR_CATEGORY columns and upserts into departments, sub_departments, categories tables. Safe to re-upload — existing records are updated, nothing is deleted."
                    />
                  )}

                  {hierarchyResult && (
                    <Alert
                      type="success"
                      showIcon
                      className="mt-3"
                      message="Import Complete"
                      description={
                        <div className="mt-1 flex flex-wrap gap-4">
                          <div>
                            <strong>Departments:</strong>{' '}
                            <Badge variant="success">+{hierarchyResult.departments.new} new</Badge>{' '}
                            <Badge variant="info">~{hierarchyResult.departments.updated} updated</Badge>
                          </div>
                          <div>
                            <strong>Sub-Divisions:</strong>{' '}
                            <Badge variant="success">+{hierarchyResult.subDepartments.new} new</Badge>{' '}
                            <Badge variant="info">~{hierarchyResult.subDepartments.updated} updated</Badge>
                          </div>
                          <div>
                            <strong>Major Categories:</strong>{' '}
                            <Badge variant="success">+{hierarchyResult.categories.new} new</Badge>{' '}
                            <Badge variant="info">~{hierarchyResult.categories.updated} updated</Badge>
                          </div>
                          {hierarchyResult.skippedRows > 0 && (
                            <Badge variant="warning">{hierarchyResult.skippedRows} rows skipped (empty cells)</Badge>
                          )}
                        </div>
                      }
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Hierarchy Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Upload <strong>MANDATORY GRID DATA.xlsx</strong> — columns A (DIV), B (SUB-DIV), C (MAJOR_CATEGORY). Data starts from row 6. Sub-division codes are auto-normalized (e.g. <code>KGU</code> → <code>KG-U</code>).
                    </div>

                    <input
                      ref={hierarchyFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleHierarchyPreview(file);
                      }}
                    />

                    {hierarchyExcelUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          {hierarchyPreview ? 'Importing to database...' : 'Reading Excel file...'}
                        </div>
                        <Progress value={hierarchyExcelProgress} />
                      </div>
                    ) : hierarchyPreview ? (
                      <div>
                        <Alert
                          type="info"
                          showIcon
                          className="mb-3"
                          message="Preview — confirm to import"
                          description={
                            <div className="mt-1">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span>
                                  <strong>Divisions:</strong> <Badge variant="info">{hierarchyPreview.departments.total}</Badge>
                                </span>
                                <span>
                                  <strong>Sub-Divisions:</strong> <Badge variant="secondary">{hierarchyPreview.subDepartments.total}</Badge>
                                </span>
                                <span>
                                  <strong>Major Categories:</strong> <Badge variant="success">{hierarchyPreview.categories.total}</Badge>
                                </span>
                                {hierarchyPreview.skippedRows > 0 && (
                                  <Badge variant="warning">{hierarchyPreview.skippedRows} rows skipped</Badge>
                                )}
                              </div>
                              {hierarchyPreview.preview && (
                                <div className="text-xs text-muted-foreground">
                                  <div>
                                    <strong>Divisions found:</strong> {hierarchyPreview.preview.divisions.join(', ')}
                                  </div>
                                  <div className="mt-1">
                                    <strong>Sub-Divisions:</strong> {hierarchyPreview.preview.subDivisions.join(', ')}
                                  </div>
                                </div>
                              )}
                            </div>
                          }
                        />
                        <div className="flex gap-2">
                          <Button onClick={handleHierarchyConfirm} className="flex-1">
                            <CheckCircle2 />
                            Confirm Import
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setHierarchyPreview(null);
                              setHierarchyPendingFile(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => hierarchyFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-emerald-500 hover:bg-emerald-50/40"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-emerald-600" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Previews before importing. Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
            <MasterDataCard
              title="Broader Menu"
              description="Merchandising Master"
              rows={broaderMenuMeta ? (broaderMenuMeta.total ?? 0) : null}
              lastUpload={broaderMenuMeta?.uploadedAt ?? null}
              loading={broaderMenuStatusLoading}
              busy={broaderMenuUploading}
              onView={() => navigate('/admin/expense/broader-menu')}
              onTemplate={downloadBroaderMenuTemplate}
              onRefresh={loadBroaderMenuStatus}
              details={
                <>
                  {broaderMenuMeta && (broaderMenuMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {(broaderMenuMeta.uploadedAt || broaderMenuMeta.lastUpload) && (
                        <Descriptions.Item label="Last Upload">
                          {new Date((broaderMenuMeta.uploadedAt || broaderMenuMeta.lastUpload)!).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.fileName && (
                        <Descriptions.Item label="File">
                          <span className="font-mono text-xs">{broaderMenuMeta.fileName}</span>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Total MC Codes">
                        <Badge variant="info">{(broaderMenuMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {broaderMenuMeta.active != null && (
                        <Descriptions.Item label="Active MCs">
                          <Badge variant="success">{(broaderMenuMeta.active ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.majCats != null && (
                        <Descriptions.Item label="Major Categories">
                          <Badge variant="secondary">{(broaderMenuMeta.majCats ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.subCats != null && (
                        <Descriptions.Item label="Sub Categories">
                          <Badge variant="secondary">{(broaderMenuMeta.subCats ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.inserted != null && (
                        <Descriptions.Item label="Rows Inserted">
                          <Badge variant="secondary">{(broaderMenuMeta.inserted ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.updated != null && (
                        <Descriptions.Item label="Rows Updated">
                          <Badge variant="secondary">{(broaderMenuMeta.updated ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.skipped != null && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant={(broaderMenuMeta.skipped ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(broaderMenuMeta.skipped ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.duplicates != null && (
                        <Descriptions.Item label="Duplicate MC CDs">
                          <Badge variant={(broaderMenuMeta.duplicates ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(broaderMenuMeta.duplicates ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                      {broaderMenuMeta.truncated != null && (
                        <Descriptions.Item label="Values Truncated">
                          <Badge variant={(broaderMenuMeta.truncated ?? 0) > 0 ? 'warning' : 'secondary'}>
                            {(broaderMenuMeta.truncated ?? 0).toLocaleString()}
                          </Badge>
                        </Descriptions.Item>
                      )}
                      {(broaderMenuMeta.unmappedValues ?? 0) > 0 && (
                        <Descriptions.Item label="Not Imported">
                          <Badge variant="warning">
                            {(broaderMenuMeta.unmappedValues ?? 0).toLocaleString()} value(s) in unmapped columns
                          </Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No broader menu data uploaded yet"
                      description="Upload the BROADER MENU workbook to populate the merchandising master — one row per MC CD with its SEG / DIV / SUB_DIV / MAJ_CAT / SUB_CAT hierarchy, status flags, pack sizes and fixture densities."
                    />
                  )}

                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Broader Menu Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>BM-H</strong> (or first sheet), headers in row 3, data from row 5. Columns are
                      matched <strong>by header name</strong>, so the original workbook can be uploaded unchanged —
                      its 84-column per-store density block is simply ignored. <strong>MC CD</strong> is the key:
                      an existing code is updated, a new one is inserted, and an upload never deletes rows.
                    </div>

                    <input
                      ref={broaderMenuFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBroaderMenuUpload(file);
                      }}
                    />

                    {broaderMenuUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; updating table...
                        </div>
                        <Progress value={broaderMenuProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => broaderMenuFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>

                </>
              }
            />
          </MasterGroup>
        </section>

        <section id="analytics" className="flex scroll-mt-3 flex-col">
          <SectionHeading title="Analytics" />
          <div className="h-3" />
        {/* Expense and Image Analytics Row */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="glass card-3d rounded-2xl border border-white/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Expense Overview</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {expenseData ? (
                <Statistic
                  title="Total Cost Price"
                  value={expenseData.totalCostPrice}
                  prefix="$"
                  valueStyle={{ color: '#FF6F61' }}
                />
              ) : (
                <Empty description="No expense data available" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Image Usage Overview</CardTitle>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {imageData ? (
                <div className="grid grid-cols-2 gap-4">
                  <Statistic title="Total Images Used" value={imageData.totalImages} valueStyle={{ color: '#FF6F61' }} />
                  <Statistic title="Unique Images" value={imageData.uniqueImages} valueStyle={{ color: '#FFA62B' }} />
                  <Statistic
                    title="Images with Costs"
                    value={expenseData?.totalJobsWithCosts || 0}
                    valueStyle={{ color: '#1f2937' }}
                  />
                  <Statistic
                    title="Avg Images/Day"
                    value={imageData.averageImagesPerDay}
                    valueStyle={{ color: '#10b981' }}
                  />
                </div>
              ) : (
                <Empty description="No image data available" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detailed Tables */}
        <Card className="mb-6 mt-6 glass rounded-2xl border border-white/60">
          <CardHeader>
            <CardTitle className="text-base">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {statusBreakdownData.length > 0 ? (
              <DataTable
                columns={expenseColumns}
                dataSource={statusBreakdownData}
                pagination={false}
                size="small"
                rowKey="key"
              />
            ) : (
              <Empty description="No expense data available" className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader>
            <CardTitle className="text-base">Detailed Image Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            {detailedExpenses.length > 0 ? (
              <DataTable
                columns={detailedExpenseColumns}
                dataSource={detailedExpenses}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                size="small"
                rowKey="key"
                scroll={{ x: 800 }}
              />
            ) : (
              <Empty description="No detailed expense data available" className="py-10" />
            )}
          </CardContent>
        </Card>

        </section>
          </div>
        </div>
      </Spinner>
    </div>
  );
}
