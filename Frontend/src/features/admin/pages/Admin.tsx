import { useEffect, useState, useCallback, useRef } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  User,
  CloudUpload,
  CheckCircle2,
  XCircle,
  RotateCw,
  DollarSign,
  ImageIcon,
  Eye,
  FileText,
  RefreshCw,
  Info,
  Search,
  Table as TableIcon,
  Inbox,
  Download,
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
  Tag,
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

interface SegmentMasterMeta {
  total?: number;
  categories?: number;
  skipped?: number;
  lastUpdated?: string;
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
  const [stats, setStats] = useState({ totalUploads: 0, completed: 0, failed: 0, pending: 0 });
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

  // Segment Master (maj_cat_segment)
  const [segmentMasterMeta, setSegmentMasterMeta] = useState<SegmentMasterMeta | null>(null);
  const [segmentMasterStatusLoading, setSegmentMasterStatusLoading] = useState(false);
  const [segmentMasterUploading, setSegmentMasterUploading] = useState(false);
  const [segmentMasterProgress, setSegmentMasterProgress] = useState<number>(0);
  const segmentFileRef = useRef<HTMLInputElement | null>(null);

  // National Grid Master
  const [nationalGridTotal, setNationalGridTotal] = useState<number | null>(null);
  const [nationalGridStatusLoading, setNationalGridStatusLoading] = useState(false);
  const [nationalGridUploading, setNationalGridUploading] = useState(false);
  const [nationalGridProgress, setNationalGridProgress] = useState<number>(0);
  const nationalGridFileRef = useRef<HTMLInputElement | null>(null);

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

  // ─────────────────────────────── National Grid Master ───────────────────────────────
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
    loadSegmentMasterStatus();
    loadNationalGridStatus();
    loadHierarchyExcelStatus();
    loadPipelineStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVendorStatus, loadMajCatGridStatus, loadMandatoryGridStatus, loadSizeMasterStatus, loadColorMasterStatus, loadFabricArticleDataStatus, loadFabricArticleMasterStatus, loadBodyArticleDataStatus, loadSegmentMasterStatus, loadNationalGridStatus, loadHierarchyExcelStatus, loadPipelineStatus]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [adminStats, expenses, images, detailed] = await Promise.all([
        api.getAdminStats(),
        api.getExpenseAnalytics(),
        api.getImageUsageAnalytics(),
        api.getDetailedExpenses({ limit: 500 }),
      ]);
      setStats(adminStats);
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

  const categoryBreakdownData = imageData?.categoryBreakdown
    ? Object.entries(imageData.categoryBreakdown).map(([category, count]: [string, any]) => ({ key: category, category, count }))
    : [];

  return (
    <div className="page-scroll-enabled p-3">
      {/* ─── Gradient Header Strip ─── */}
      <div
        className="mb-5 flex items-center justify-between rounded-2xl px-6 py-4 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1f2937 0%, #334155 60%, #475569 100%)' }}
      >
        <div>
          <h1 className="m-0 text-xl font-bold text-white">Admin Dashboard</h1>
          <p className="m-0 mt-0.5 text-xs text-white/60">System health, sync status &amp; analytics</p>
        </div>
        <Button onClick={loadData} disabled={loading} variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
          <RotateCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <Spinner spinning={loading}>
        {/* Main Statistics Row */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Card className="glass card-3d rounded-2xl border border-white/60">
            <CardContent className="pt-6">
              <Statistic
                title="Total Uploads"
                value={stats.totalUploads}
                prefix={<CloudUpload className="h-5 w-5" />}
                valueStyle={{ color: '#FF6F61' }}
              />
            </CardContent>
          </Card>
          <Card className="glass card-3d rounded-2xl border border-white/60">
            <CardContent className="pt-6">
              <Statistic
                title="Completed"
                value={stats.completed}
                prefix={<CheckCircle2 className="h-5 w-5" />}
                valueStyle={{ color: '#10b981' }}
              />
            </CardContent>
          </Card>
          <Card className="glass card-3d rounded-2xl border border-white/60">
            <CardContent className="pt-6">
              <Statistic
                title="Failed"
                value={stats.failed}
                prefix={<XCircle className="h-5 w-5" />}
                valueStyle={{ color: '#e11d48' }}
              />
            </CardContent>
          </Card>
          <Card className="glass card-3d rounded-2xl border border-white/60">
            <CardContent className="pt-6">
              <Statistic
                title="Pending"
                value={stats.pending}
                prefix={<User className="h-5 w-5" />}
                valueStyle={{ color: '#faad14' }}
              />
            </CardContent>
          </Card>
        </div>

        {/* raw_articles Pipeline (test API — date/PPT fetch + pipeline status + run extraction) */}
        <Card className="mb-6 glass rounded-2xl border border-amber-300/60">
          <CardHeader className="flex flex-row items-center justify-between bg-amber-50/60">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              raw_articles Pipeline
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadPipelineStatus} disabled={pipelineStatusLoading}>
              <RotateCw className={pipelineStatusLoading ? 'animate-spin' : ''} />
              Refresh Status
            </Button>
          </CardHeader>
          <CardContent>
            {/* Pipeline status row */}
            <div className="mb-5">
              <div className="mb-2.5 text-[13px] font-semibold">Pipeline Status</div>
              {pipelineStatus ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  <Tag className="px-2.5 py-0.5 text-[13px]" bgColor="#fef3c7" color="#92400e" borderColor="#fde68a">
                    PENDING: <strong className="ml-1">{pipelineStatus.PENDING}</strong>
                  </Tag>
                  <Tag className="px-2.5 py-0.5 text-[13px]" bgColor="#dbeafe" color="#1e40af" borderColor="#bfdbfe">
                    PROCESSING: <strong className="ml-1">{pipelineStatus.PROCESSING}</strong>
                  </Tag>
                  <Tag className="px-2.5 py-0.5 text-[13px]" bgColor="#d1fae5" color="#065f46" borderColor="#a7f3d0">
                    COMPLETED: <strong className="ml-1">{pipelineStatus.COMPLETED}</strong>
                  </Tag>
                  <Tag className="px-2.5 py-0.5 text-[13px]" bgColor="#fee2e2" color="#991b1b" borderColor="#fecaca">
                    FAILED: <strong className="ml-1">{pipelineStatus.FAILED}</strong>
                  </Tag>
                  <Tag className="px-2.5 py-0.5 text-[13px]" bgColor="#ffe4e0" color="#FF6F61" borderColor="#ffc7bf">
                    PERM_FAILED: <strong className="ml-1">{pipelineStatus.PERM_FAILED}</strong>
                  </Tag>
                  <Tag className="px-2.5 py-0.5 text-[13px]">
                    TOTAL: <strong className="ml-1">{pipelineStatus.total}</strong>
                  </Tag>
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
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      <RefreshCw className={extractionRunning ? 'animate-spin' : ''} />
                      {extractionRunning
                        ? 'Starting...'
                        : `Run Extraction (${pipelineStatus.PENDING + pipelineStatus.FAILED} queued)`}
                    </Button>
                  </Popconfirm>
                </div>
              ) : (
                <Spinner spinning={pipelineStatusLoading}>
                  <span className="text-[13px] text-muted-foreground">Loading pipeline status...</span>
                </Spinner>
              )}
              {extractionMessage && <Alert type="info" showIcon className="mt-2.5" message={extractionMessage} />}
            </div>

            <div className="mb-3 border-t border-border pt-4">
              <div className="mb-2 text-[13px] font-semibold">Fetch Presentations to raw_articles</div>
              <div className="mb-2.5 text-xs text-muted-foreground">
                Saves SRM presentations to <code className="rounded bg-muted px-1 py-0.5">raw_articles</code> as <strong>PENDING</strong> — no VLM triggered.
                {testFetchMode === 'date' && (
                  <span className="ml-1.5 text-amber-600">
                    ⚠ Only dates on or after <strong>27 May 2026</strong> allowed.
                  </span>
                )}
              </div>

              {/* Mode toggle */}
              <div className="mb-3 flex gap-2">
                <Button
                  size="sm"
                  variant={testFetchMode === 'date' ? 'default' : 'outline'}
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
                  variant={testFetchMode === 'ppt' ? 'default' : 'outline'}
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
                  className="bg-amber-500 hover:bg-amber-600"
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
          </CardContent>
        </Card>

        {/* Vendor Master Sync */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />
              Vendor Master Sync
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadVendorStatus} disabled={vendorStatusLoading}>
              <RotateCw className={vendorStatusLoading ? 'animate-spin' : ''} />
              Refresh Status
            </Button>
          </CardHeader>
          <CardContent>
            <Spinner spinning={vendorStatusLoading}>
              {vendorStatus ? (
                <>
                  <Descriptions bordered className="mb-4">
                    <Descriptions.Item label="Records in DB">
                      <strong className="text-lg">{vendorStatus.count.toLocaleString()}</strong>
                    </Descriptions.Item>
                    <Descriptions.Item label="Last Sync">
                      {vendorStatus.lastSyncedAt
                        ? new Date(vendorStatus.lastSyncedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }) + ' IST'
                        : <span className="text-muted-foreground">Never</span>}
                    </Descriptions.Item>
                    <Descriptions.Item label="Schedule">Daily at 2:00 AM IST</Descriptions.Item>
                    <Descriptions.Item label="Source API">
                      <span className="font-mono text-xs text-muted-foreground">
                        https://my-dab-app.azurewebsites.net/api/ET_Supplier_Master
                      </span>
                    </Descriptions.Item>
                    {vendorStatus.inProgress && (
                      <Descriptions.Item label="Status">
                        <span className="flex items-center gap-1.5 text-blue-600">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sync in progress…
                        </span>
                      </Descriptions.Item>
                    )}
                    {vendorStatus.lastResult && (
                      <Descriptions.Item label="Last Run">
                        {vendorStatus.lastResult.error ? (
                          <span className="font-mono text-xs text-red-600">
                            ❌ {vendorStatus.lastResult.error}
                          </span>
                        ) : (
                          <span className="text-xs text-green-700">
                            ✅ {vendorStatus.lastResult.upserted.toLocaleString()} records in {vendorStatus.lastResult.pages} pages ({(vendorStatus.lastResult.durationMs / 1000).toFixed(1)}s)
                          </span>
                        )}
                      </Descriptions.Item>
                    )}
                  </Descriptions>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="card-3d rounded-xl border border-white/60 bg-white/50 p-4 backdrop-blur-sm">
                      <div className="mb-1 font-semibold">Sync Vendor Master</div>
                      <div className="mb-2.5 text-xs text-muted-foreground">
                        Fetches all vendor records from the DAB API and upserts into the local database. Runs in background — page will auto-refresh status after 5s.
                      </div>
                      <Popconfirm
                        title="Trigger Vendor Master Sync?"
                        description="Fetch all vendors from the DAB API and upsert into master_vendor_details. This may take a minute."
                        onConfirm={runVendorSync}
                        okText="Yes, sync now"
                        cancelText="Cancel"
                      >
                        <Button disabled={vendorSyncing} className="w-full">
                          <RefreshCw className={vendorSyncing ? 'animate-spin' : ''} />
                          {vendorSyncing ? 'Syncing...' : 'Sync Now'}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                </>
              ) : (
                <Empty description="Could not load vendor master status" />
              )}
            </Spinner>
          </CardContent>
        </Card>

        {/* Major-Category Grid Upload (dropdown values per major category, ported from c9e8839) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Major Category Grid (Dropdown Values)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadMajCatTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadMajCatGridStatus} disabled={majCatGridStatusLoading}>
                <RotateCw className={majCatGridStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={majCatGridStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
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
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Size Master Upload (major-category-wise sizes → maj_cat_sizes) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Size Master (Sizes per Major Category)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadSizeMasterTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadSizeMasterStatus} disabled={sizeMasterStatusLoading}>
                <RotateCw className={sizeMasterStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={sizeMasterStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={sizeMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sizeFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Color Master Upload (father/child colours → color_master) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Color Master (Father / Child Colours)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadColorMasterTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadColorMasterStatus} disabled={colorMasterStatusLoading}>
                <RotateCw className={colorMasterStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={colorMasterStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={colorMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => colorFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Fabric Article Data Upload (fabric article records → fabric_article_data) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Fabric Article Data (Bulk Insert)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadFabricArticleDataTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadFabricArticleDataStatus} disabled={fabricArticleDataStatusLoading}>
                <RotateCw className={fabricArticleDataStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={fabricArticleDataStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & inserting records...
                        </div>
                        <Progress value={fabricArticleDataProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fabricArticleDataFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Fabric Article Master Upload (fabric hierarchy → fabric_article_master) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Fabric Article Master (Fabric Hierarchy)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadFabricArticleMasterTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadFabricArticleMasterStatus} disabled={fabricArticleMasterStatusLoading}>
                <RotateCw className={fabricArticleMasterStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={fabricArticleMasterStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                      description="Upload the Fabric Article Master Excel (columns: DIV, SUB-DIV, MJ_CAT, MC_CD, MC_DESC) to populate fabric hierarchy dropdowns."
                    />
                  )}
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Fabric Article Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Sheet <strong>FAB UPLAODER FORMAT</strong> (or first sheet), headers in row 3, data from row 5 —
                      columns A (DIV), B (SUB-DIV), C (MJ_CAT), D (MC_CD), E (MC_DESC). Replaces the entire table.
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & replacing table...
                        </div>
                        <Progress value={fabricArticleMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fabricArticleFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Mandatory Grid Upload (field visibility per major category, ported from 993f2cb) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Mandatory Grid (Field Visibility per Major Category)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadMandatoryTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadMandatoryGridStatus} disabled={mandatoryGridStatusLoading}>
                <RotateCw className={mandatoryGridStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={mandatoryGridStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel... please wait
                        </div>
                        <Progress value={mandatoryGridProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mandatoryFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* National Grid Master Upload (attribute-code validation table) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              National Grid (Attribute Values)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadNationalGridTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadNationalGridStatus} disabled={nationalGridStatusLoading}>
                <RotateCw className={nationalGridStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={nationalGridStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing &amp; importing rows...
                        </div>
                        <Progress value={nationalGridProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => nationalGridFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Hierarchy Excel Upload (Division / Sub-Division / Major Category, two-step preview→confirm) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Hierarchy Excel Upload (Division / Sub-Division / Major Category)
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadHierarchyExcelStatus} disabled={hierarchyExcelStatusLoading}>
              <RotateCw className={hierarchyExcelStatusLoading ? 'animate-spin' : ''} />
              Refresh Status
            </Button>
          </CardHeader>
          <CardContent>
            <Spinner spinning={hierarchyExcelStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
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
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Segment Master Upload (price segments per major category → maj_cat_segment) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Segment Master (Price Segments per Major Category)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadSegmentMasterTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={exportSegmentMaster}>
                <Download />
                Export Data
              </Button>
              <Button size="sm" variant="outline" onClick={loadSegmentMasterStatus} disabled={segmentMasterStatusLoading}>
                <RotateCw className={segmentMasterStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={segmentMasterStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; replacing table...
                        </div>
                        <Progress value={segmentMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => segmentFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Body Article Data Upload (construction attributes + costs → body_article_data) */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableIcon className="h-4 w-4" />
              Body Article Data (Bulk Update)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadBodyArticleDataTemplate}>
                <Download />
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={loadBodyArticleDataStatus} disabled={bodyArticleDataStatusLoading}>
                <RotateCw className={bodyArticleDataStatusLoading ? 'animate-spin' : ''} />
                Refresh Status
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Spinner spinning={bodyArticleDataStatusLoading}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {/* Status panel */}
                <div className="md:col-span-7">
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
                </div>

                {/* Upload panel */}
                <div className="md:col-span-5">
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
                        <div className="mb-2 text-[13px] text-[#FF6F61]">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel & updating table...
                        </div>
                        <Progress value={bodyArticleDataProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => bodyArticleDataFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-[#FF6F61] hover:bg-[#FF6F61]/5"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-[#FF6F61]" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Spinner>
          </CardContent>
        </Card>

        {/* Debug Info */}
        <Card className="mb-6 glass rounded-2xl border border-white/60">
          <CardContent className="pt-6">
            <p><strong>Debug Info:</strong></p>
            <p>Expense Data Loaded: {expenseData ? 'Yes' : 'No'}</p>
            <p>Image Data Loaded: {imageData ? 'Yes' : 'No'}</p>
            <p>Status Breakdown Records: {statusBreakdownData.length}</p>
            <p>Category Breakdown Records: {categoryBreakdownData.length}</p>
          </CardContent>
        </Card>

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

        <Card className="mt-6 glass rounded-2xl border border-white/60">
          <CardHeader>
            <CardTitle className="text-base">Admin Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Use the sidebar navigation to manage the system:</p>
            <ul className="ml-4 list-disc">
              <li><strong>Hierarchy Management:</strong> Manage departments, categories, and attributes</li>
              <li><strong>Expense Analytics:</strong> Track costs, selling prices, and profit margins</li>
              <li><strong>Image Usage Analytics:</strong> Monitor total images and extraction statistics</li>
            </ul>
            {/* keep Tag/Info imports referenced */}
            {false && <Tag><Info /></Tag>}
          </CardContent>
        </Card>
      </Spinner>
    </div>
  );
}
