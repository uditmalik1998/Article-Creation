import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  Upload as UploadIcon,
  Zap,
  Download,
  Trash2,
  FileArchive,
  RotateCw,
  Eye,
  History,
  X,
  List,
  Images,
  Shirt,
} from 'lucide-react';
import { ArticleListPanel, type ArticleListSubmit } from '../components/ArticleListPanel';
import { ModelImagesBrowser } from '../components/ModelImagesBrowser';
import { MajorCategoryManager } from '../components/MajorCategoryManager';
import { toast } from 'sonner';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tag,
  Textarea,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { message } from '@/lib/message';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
const SERVER_BASE = API_BASE.replace(/\/api$/, '');

// Resolve an image URL for rendering. The garment-upload flow stores relative
// paths (/uploads/...) served by the backend; the article-list flow stores
// absolute R2 URLs (https://pub-...r2.dev/...). Only relative paths get the
// server base prepended — absolute/blob/data URLs are used as-is.
const resolveAssetUrl = (u?: string): string => {
  if (!u) return '';
  return /^(https?:|blob:|data:)/i.test(u) ? u : `${SERVER_BASE}${u}`;
};

// Switch to the background-job pipeline once a request would be too large to
// finish in one HTTP round-trip. Anything below this still uses the original
// synchronous /generate endpoint for snappy UX.
const BULK_THRESHOLD = 5;

// fetch() has no built-in timeout — a dropped connection (e.g. the backend dev
// server restarting mid-request) otherwise hangs the calling await forever with
// no error and no way to recover short of a full page reload. This aborts the
// request after timeoutMs and turns that into a normal catchable Error.
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s — the server may have restarted. Please try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// localStorage key holding the most recent bulk jobId so we can resume polling
// after a tab switch / page refresh. Cleared when the job finishes or is dropped.
const ACTIVE_JOB_KEY = 'modelGen_activeJobId';
const RECENT_JOBS_REFRESH_MS = 15000;

interface GeneratedImage {
  file: string;
  view: string;
  url: string;
  source?: string;
}

interface BulkTaskResult {
  fileName: string;
  view: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  url?: string;
  sourceUrl?: string;
  error?: string;
}

// Canonical view order — used to lay out cells left-to-right per garment row.
// Covers both the legacy 4-view garment-upload set (front/back/left_side/closeup)
// and the 5-view article-list set (front/back/side/style_shoot/closeup).
// 'three_quarter' is retained for jobs generated before style_shoot replaced it.
const VIEW_ORDER = ['front', 'back', 'side', 'style_shoot', 'three_quarter', 'left_side', 'closeup'] as const;
type ViewName = typeof VIEW_ORDER[number];

interface GarmentRow {
  fileName: string;
  source?: string;
  // Per-view cell. Missing key = not expected for this job.
  cells: Partial<Record<ViewName, { url?: string; status?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; error?: string }>>;
}

type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'PARTIAL';

interface JobSummary {
  id: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  error?: string;
  results: BulkTaskResult[];
}

interface JobListItem {
  id: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

const isActiveStatus = (s: JobStatus) => s === 'QUEUED' || s === 'RUNNING';

const GENDER_OPTIONS = [
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' },
  { label: 'Kid Boy', value: 'kid boy' },
  { label: 'Kid Girl', value: 'kid girl' },
];

const BODYTYPE_OPTIONS = [
  { label: 'Full Body', value: 'Full-Body' },
  { label: 'Upper Body', value: 'Upper-Body' },
  { label: 'Lower Body', value: 'Lower-Body' },
];

const BROACH_PLACEMENT_OPTIONS = [
  { label: 'Left Chest', value: 'left chest' },
  { label: 'Right Chest', value: 'right chest' },
  { label: 'Center', value: 'center' },
  { label: 'Collar', value: 'collar' },
];

const VIEW_LABELS: Record<string, string> = {
  front: 'Front',
  back: 'Back',
  side: 'Side',
  style_shoot: 'Style Shoot',
  three_quarter: '3/4',
  left_side: 'Left Side',
  'left side': 'Left Side',
  closeup: 'Closeup',
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const isImage = (name: string) => IMAGE_EXTS.some((ext) => name.toLowerCase().endsWith(ext));

interface FormValues {
  gender: string;
  bodytype: string;
  imagesCount: string;
  broach_placement?: string;
  color_name?: string;
  special_instructions?: string;
}

// Status -> tailwind classes for the various job/task chips. Coral for in-flight
// (matches slate+coral brand palette), green for DONE, red for FAILED, amber for PARTIAL.
const statusTagClass = (s: JobStatus | 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | undefined): string => {
  switch (s) {
    case 'DONE':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'FAILED':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'PARTIAL':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'QUEUED':
    case 'RUNNING':
      return 'border-[#FF6F61]/30 bg-[#FF6F61]/10 text-[#FF6F61]';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
};

export default function ModelGenerationPage() {
  const userData = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null;
  const userRole = userData?.role as string | undefined;
  const canViewModelImages = userRole === 'ADMIN' || userRole === 'PD_DESIGNER';

  const form = useForm<FormValues>({
    defaultValues: {
      gender: 'female',
      bodytype: 'Full-Body',
      imagesCount: '1',
      broach_placement: '',
      color_name: '',
      special_instructions: '',
    },
  });

  const [pageMode, setPageMode] = useState<'upload-garments' | 'from-article-list' | 'model-images'>('upload-garments');
  const [designFiles, setDesignFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [broachFile, setBroachFile] = useState<File | null>(null);
  const [colorImageFile, setColorImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobListItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Which "Optional extras" rows are expanded (Option A layout).
  const [openExtras, setOpenExtras] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const designInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const patternInputRef = useRef<HTMLInputElement>(null);
  const broachInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const imagesCount = form.watch('imagesCount');

  const loadRecentJobs = async () => {
    const token = localStorage.getItem('authToken');
    try {
      setRecentLoading(true);
      const res = await fetch(`${API_BASE}/model-generation/bulk/jobs/recent?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setRecentJobs(data.jobs || []);
    } catch {
      // silent — recent list is best-effort
    } finally {
      setRecentLoading(false);
    }
  };

  // On mount: try to resume the most recently active job (saved in localStorage),
  // and load the recent-jobs list. Also set a 15s refresh for the list.
  useEffect(() => {
    const savedJobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (savedJobId) {
      const token = localStorage.getItem('authToken');
      void resumeJob(savedJobId, token);
    }
    void loadRecentJobs();
    recentTimerRef.current = setInterval(loadRecentJobs, RECENT_JOBS_REFRESH_MS);
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (recentTimerRef.current) clearInterval(recentTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFakeProgress = () => {
    setProgress(0);
    let p = 0;
    progressTimerRef.current = setInterval(() => {
      p += Math.random() * 4;
      if (p >= 90) {
        clearInterval(progressTimerRef.current!);
        p = 90;
      }
      setProgress(Math.round(p));
    }, 800);
  };

  const stopFakeProgress = () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setProgress(100);
    setTimeout(() => setProgress(0), 800);
  };

  const stopPolling = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  };

  const isBulkMode = !!zipFile || designFiles.length > BULK_THRESHOLD;

  // Blob URLs for source thumbnails in the non-bulk flow. The bulk flow uses
  // server-side URLs (sourceUrl on each task), so we only need blobs for files
  // that are still local. URLs created here are intentionally not revoked —
  // the browser cleans them up on unmount; revoking eagerly causes flicker
  // when designFiles changes shape but the underlying files are the same.
  const designSourceMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of designFiles) {
      try {
        m[f.name] = URL.createObjectURL(f);
      } catch {
        /* ignore */
      }
    }
    return m;
  }, [designFiles]);

  // Group the current results into one row per garment, in view-canonical order.
  // For an active bulk job we use job.results (includes PENDING/RUNNING/FAILED so
  // we can render placeholders). For the non-bulk flow we use the flat results array.
  const garmentRows = useMemo<GarmentRow[]>(() => {
    const acc = new Map<string, GarmentRow>();
    const ensure = (fileName: string, source?: string) => {
      let row = acc.get(fileName);
      if (!row) {
        row = { fileName, source, cells: {} };
        acc.set(fileName, row);
      }
      if (!row.source && source) row.source = source;
      return row;
    };

    if (job) {
      for (const r of job.results) {
        const row = ensure(r.fileName, r.sourceUrl);
        if ((VIEW_ORDER as readonly string[]).includes(r.view)) {
          row.cells[r.view as ViewName] = { url: r.url, status: r.status, error: r.error };
        }
      }
    } else {
      for (const r of results) {
        const row = ensure(r.file, r.source ?? designSourceMap[r.file]);
        if ((VIEW_ORDER as readonly string[]).includes(r.view)) {
          row.cells[r.view as ViewName] = { url: r.url, status: 'DONE' };
        }
      }
    }

    return Array.from(acc.values());
  }, [job, results, designSourceMap]);

  // Which view columns to render. For an active job we trust the task list; otherwise
  // derive from the form so single-view mode renders as 2 cells (source + front).
  const visibleViews = useMemo<ViewName[]>(() => {
    if (job) {
      const set = new Set(job.results.map((r) => r.view as ViewName));
      const ordered = VIEW_ORDER.filter((v) => set.has(v));
      return ordered.length > 0 ? ordered : ['front'];
    }
    return imagesCount === '4' ? ['front', 'back', 'left_side', 'closeup'] : ['front'];
  }, [job, imagesCount]);

  // Per-article roll-up of the current job. Task counts are per-view; this groups
  // them by article so we can report which article numbers got NO model at all
  // (fully failed) vs. partially generated.
  const articleStats = useMemo(() => {
    if (!job) return null;
    const map = new Map<string, { done: number; failed: number; error?: string }>();
    for (const r of job.results) {
      const s = map.get(r.fileName) || { done: 0, failed: 0 };
      if (r.status === 'DONE') s.done++;
      else if (r.status === 'FAILED') {
        s.failed++;
        if (!s.error && r.error) s.error = r.error;
      }
      map.set(r.fileName, s);
    }
    const entries = Array.from(map.entries());
    const failed = entries.filter(([, s]) => s.done === 0 && s.failed > 0).map(([code, s]) => ({ code, error: s.error }));
    const partial = entries.filter(([, s]) => s.done > 0 && s.failed > 0).map(([code]) => code);
    const complete = entries.filter(([, s]) => s.failed === 0 && s.done > 0).length;
    const all = entries.map(([code, s]) => ({
      code,
      status: s.done === 0 && s.failed > 0 ? 'FAILED' : s.failed > 0 ? 'PARTIAL' : 'DONE',
      done: s.done,
      failed: s.failed,
      error: s.error || '',
    }));
    return { total: map.size, failed, partial, complete, all };
  }, [job]);

  const copyFailedCodes = () => {
    const codes = (articleStats?.failed || []).map((f) => f.code).join('\n');
    if (!codes) return;
    navigator.clipboard?.writeText(codes).then(
      () => message.success('Failed article codes copied'),
      () => message.error('Copy failed'),
    );
  };

  // Export a CSV report of every article in the current job (status + view counts +
  // failure reason). One row per article number so it can be reconciled against the
  // input list. Reasons are quote-escaped so commas in messages don't break columns.
  const downloadFailedReport = () => {
    if (!articleStats || !job) return;
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['article_number', 'status', 'views_done', 'views_failed', 'reason'];
    const lines = articleStats.all.map((r) =>
      [esc(r.code), r.status, String(r.done), String(r.failed), esc(r.error)].join(','),
    );
    const csv = [header.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-gen-report_${job.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addDesigns = (files: File[] | FileList) => {
    const filtered = Array.from(files).filter((f) => isImage(f.name));
    if (filtered.length === 0) {
      message.warning('No image files found in selection.');
      return;
    }
    setDesignFiles((prev) => [...prev, ...filtered]);
  };

  const onPickFolder = () => folderInputRef.current?.click();

  const onFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    addDesigns(list);
    e.target.value = '';
  };

  const onZipPicked = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      message.error('Please pick a .zip file.');
      return;
    }
    setZipFile(file);
  };

  const buildFormData = (values: FormValues, forBulk: boolean): FormData => {
    const fd = new FormData();
    designFiles.forEach((f) => fd.append('designs', f));
    if (forBulk && zipFile) fd.append('archive', zipFile);
    if (patternFile) fd.append('pattern', patternFile);
    if (broachFile) fd.append('broach', broachFile);
    if (colorImageFile) fd.append('color_image', colorImageFile);
    fd.append('gender', values.gender);
    fd.append('bodytype', values.bodytype);
    fd.append('imagesCount', values.imagesCount);
    if (values.broach_placement) fd.append('broach_placement', values.broach_placement);
    if (values.special_instructions) fd.append('special_instructions', values.special_instructions);
    if (values.color_name) fd.append('color_name', values.color_name);
    return fd;
  };

  // Apply a job snapshot to component state (no side-effects beyond setState).
  const applyJobUpdate = (j: JobSummary) => {
    setJob(j);
    const pct = j.total > 0 ? Math.round(((j.done + j.failed) / j.total) * 100) : 0;
    setProgress(pct);
    const done = j.results.filter((r) => r.status === 'DONE' && r.url);
    setResults(done.map((r) => ({ file: r.fileName, view: r.view, url: r.url!, source: r.sourceUrl })));
  };

  // Continuously poll a job until it reaches a terminal status. Used by both
  // "start a new job" and "resume after tab switch."
  const startPolling = (jobId: string, token: string | null) => {
    stopPolling();
    const tick = async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/model-generation/bulk/job/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }, 15000);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to poll job');
        const j: JobSummary = data.job;
        applyJobUpdate(j);

        if (!isActiveStatus(j.status)) {
          stopPolling();
          setLoading(false);
          if (localStorage.getItem(ACTIVE_JOB_KEY) === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
          if (j.status === 'DONE') message.success(`All ${j.done} image(s) generated!`);
          else if (j.status === 'PARTIAL') message.warning(`${j.done} succeeded, ${j.failed} failed.`);
          else message.error('Job failed. ' + (j.error || ''));
          void loadRecentJobs();
        }
      } catch (err: any) {
        stopPolling();
        setLoading(false);
        setError(err.message || 'Lost connection to job.');
      }
    };
    void tick();
    pollTimerRef.current = setInterval(tick, 3000);
  };

  // Resume a job after a tab switch / page reload (called from useEffect on mount).
  const resumeJob = async (jobId: string, token: string | null) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/model-generation/bulk/job/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 15000);
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (localStorage.getItem(ACTIVE_JOB_KEY) === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      const j: JobSummary = data.job;
      applyJobUpdate(j);
      if (isActiveStatus(j.status)) {
        setLoading(true);
        startPolling(jobId, token);
      } else {
        if (localStorage.getItem(ACTIVE_JOB_KEY) === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    } catch {
      // silent — user can click the job in the Recent panel to retry
    }
  };

  // Click handler for "View" in the Recent Jobs panel.
  const viewJob = async (jobId: string) => {
    setError(null);
    const token = localStorage.getItem('authToken');
    await resumeJob(jobId, token);
  };

  const handleGenerate = async (values: FormValues) => {
    if (!designFiles.length && !zipFile) {
      message.error('Please upload at least one garment image, a folder, or a .zip.');
      return;
    }

    setError(null);
    setResults([]);
    setJob(null);
    setLoading(true);

    const token = localStorage.getItem('authToken');

    try {
      if (!isBulkMode) {
        // ── Synchronous path: existing /generate endpoint ───────────────────
        startFakeProgress();
        const res = await fetchWithTimeout(`${API_BASE}/model-generation/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: buildFormData(values, false),
        }, 180000);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Generation failed');
        setResults(data.results);
        message.success(`${data.count} image${data.count !== 1 ? 's' : ''} generated successfully!`);
        stopFakeProgress();
        setLoading(false);
        return;
      }

      // ── Bulk path: create job, then poll ────────────────────────────────
      // Long timeout — this upload can carry many large images and the backend
      // itself allows up to 20 minutes for it (see allocateJob in the bulk route).
      const res = await fetchWithTimeout(`${API_BASE}/model-generation/bulk/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: buildFormData(values, true),
      }, 20 * 60 * 1000);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

      message.success(`Job created: ${data.totalImages} image(s), ${data.totalTasks} task(s). Generating in the background...`);
      localStorage.setItem(ACTIVE_JOB_KEY, data.jobId);
      startPolling(data.jobId, token);
      void loadRecentJobs();
    } catch (err: any) {
      setError(err.message || 'Generation failed. Please try again.');
      stopFakeProgress();
      setLoading(false);
    }
  };

  const handleArticleListSubmit = async (payload: ArticleListSubmit) => {
    setError(null);
    setResults([]);
    setJob(null);
    setLoading(true);

    const token = localStorage.getItem('authToken');

    try {
      // Gender / body type / colour are resolved per-article on the server from
      // extraction_results_flat — the client only sends the article list.
      const form = new FormData();
      form.append('imagesCount', '5');
      if (payload.file) form.append('list', payload.file);
      else form.append('codesText', payload.codesText);

      // Job creation itself is fast (DB lookups only, no Gemini calls) — a generous
      // but bounded timeout so a dropped connection surfaces as an error instead of
      // hanging the "Starting…" button forever.
      const res = await fetchWithTimeout(`${API_BASE}/model-generation/bulk/from-articles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }, 60000);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start job');
      if (!data.jobId) throw new Error('Server did not return a job id');
      localStorage.setItem(ACTIVE_JOB_KEY, data.jobId);
      message.success(`Job created. Generating in the background…`);
      startPolling(data.jobId, token);
      void loadRecentJobs();
    } catch (e: any) {
      setError(e.message || 'Failed to start article-list job');
      setLoading(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    const token = localStorage.getItem('authToken');
    try {
      await fetch(`${API_BASE}/model-generation/bulk/job/${job.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      message.info('Cancel requested. The current task will finish first.');
    } catch {
      message.error('Failed to cancel.');
    }
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    } catch {
      message.error('Download failed');
    }
  };

  const downloadAll = async () => {
    // Bulk jobs have all outputs sitting on the server — ask the server to zip them
    // and stream back a single .zip. Way faster than N download dialogs.
    if (job) {
      const token = localStorage.getItem('authToken');
      const toastId = message.loading('Building zip…');
      try {
        const res = await fetch(`${API_BASE}/model-generation/bulk/job/${job.id}/download-zip`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          let errText = 'Zip download failed';
          try {
            const j = await res.json();
            errText = j?.error || errText;
          } catch {
            /* not json */
          }
          throw new Error(errText);
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `${job.id}.zip`;
        a.click();
        URL.revokeObjectURL(objectUrl);
        message.success(`Downloaded ${results.length} image${results.length !== 1 ? 's' : ''} as zip.`);
      } catch (err: any) {
        message.error(err?.message || 'Failed to download zip');
      } finally {
        toast.dismiss(toastId);
      }
      return;
    }

    // Synchronous (non-bulk) flow — there's no per-job folder on the server, so
    // fall back to looping individual downloads. Counts are small here (≤ 20 files).
    for (const img of results) {
      const filename = `${img.file.split('.')[0]}_${img.view.replace(/\s+/g, '_')}.png`;
      await downloadImage(resolveAssetUrl(img.url), filename);
    }
  };

  const handleDesignDrop = (files: FileList | null) => {
    if (!files) return;
    addDesigns(files);
  };

  // ── Option A "Studio" layout helpers (2026-10-14) ─────────────────────────
  const watchGender = form.watch('gender');
  const watchBody = form.watch('bodytype');
  const watchViews = form.watch('imagesCount');
  const watchPlacement = form.watch('broach_placement');
  const watchColorName = form.watch('color_name');
  const watchInstructions = form.watch('special_instructions');
  const labelOf = (opts: { label: string; value: string }[], v?: string) => opts.find((o) => o.value === v)?.label ?? v ?? '';
  const settingsSummary = [
    labelOf(GENDER_OPTIONS, watchGender),
    labelOf(BODYTYPE_OPTIONS, watchBody),
    watchViews === '4' ? 'All 4 views' : 'Front only',
  ].join(' · ');
  const garmentCountLabel = zipFile
    ? `.zip${designFiles.length ? ` + ${designFiles.length} image${designFiles.length !== 1 ? 's' : ''}` : ''}`
    : `${designFiles.length} image${designFiles.length !== 1 ? 's' : ''}`;

  // Segmented control (slate) used for Gender / Body type / Views.
  // Plain render functions (not components) so inputs inside keep focus across re-renders.
  const renderSegmented = ({ label, value, options, onChange }: {
    label: string;
    value?: string;
    options: { label: string; value: string }[];
    onChange: (v: string) => void;
  }) => (
    <div className="flex items-center gap-3">
      <span className="w-[82px] shrink-0 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-1 rounded-[9px] bg-slate-100 p-[3px] dark:bg-slate-800">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                'h-[30px] flex-1 rounded-[7px] px-1 text-[12.5px] font-semibold transition-colors',
                on
                  ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.1)] dark:bg-slate-950 dark:text-slate-50'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // One optional-extra row: title + hint + action; expands to show its controls.
  const renderExtraRow = ({ id, title, hint, isSet, children }: {
    id: string;
    title: string;
    hint: string;
    isSet: boolean;
    children: ReactNode;
  }) => {
    const open = openExtras.has(id);
    return (
      <div key={id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
        <button
          type="button"
          aria-expanded={open}
          onClick={() =>
            setOpenExtras((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
              {title}
              {isSet && (
                <span className="rounded-full bg-slate-800 px-1.5 py-px text-[10px] font-bold text-white">Set</span>
              )}
            </span>
            <span className="text-[11.5px] text-slate-500">{hint}</span>
          </span>
          <span className="flex h-[30px] shrink-0 items-center rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
            {open ? 'Done' : isSet ? 'Edit' : 'Add'}
          </span>
        </button>
        {open && <div className="flex flex-col gap-2.5 px-3.5 pb-3">{children}</div>}
      </div>
    );
  };

  const sectionLabel = 'mb-2 text-[12px] font-bold tracking-[0.06em] text-slate-600 dark:text-slate-400';

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6">
      {/* Header: title + source switch + Major categories */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 font-display text-[28px] font-semibold text-slate-900 dark:text-slate-50">AI Model Generation</h1>
          <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-400">Turn garment photos into on-model shots.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div role="tablist" aria-label="Source" className="flex rounded-[10px] bg-slate-200 p-[3px] dark:bg-slate-800">
            {([
              { mode: 'upload-garments', label: 'Upload garments', Icon: UploadIcon, show: true },
              { mode: 'from-article-list', label: 'From article list', Icon: List, show: canViewModelImages },
              { mode: 'model-images', label: 'model-images', Icon: Images, show: canViewModelImages },
            ] as const)
              .filter((t) => t.show)
              .map((t) => {
                const on = pageMode === t.mode;
                return (
                  <button
                    key={t.mode}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setPageMode(t.mode)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold transition-colors',
                      on ? 'bg-slate-800 text-white' : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50',
                    )}
                  >
                    <t.Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
          </div>
          {/* Manage the MAJ CAT master (add new categories + their model-image frame) */}
          <MajorCategoryManager />
        </div>
      </div>

      {canViewModelImages && pageMode === 'model-images' && <ModelImagesBrowser />}

      {pageMode !== 'model-images' && (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[440px_minmax(0,1fr)]">
        {/* LEFT — Settings card: scrolls inside, Generate bar always visible */}
        <section className="flex flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start dark:border-slate-700 dark:bg-slate-900">
          {canViewModelImages && pageMode === 'from-article-list' ? (
            <div className="overflow-y-auto p-5">
              <ArticleListPanel submitting={loading} onSubmit={handleArticleListSubmit} />
            </div>
          ) : null}
          {pageMode === 'upload-garments' ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleGenerate)} className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-[18px]">
                  {/* 1 · Garments */}
                  <div>
                    <div className={sectionLabel}>
                      1 · GARMENTS <span className="text-red-700">*</span>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && designInputRef.current?.click()}
                      onDragEnter={() => setIsDragging(true)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        handleDesignDrop(e.dataTransfer.files);
                      }}
                      onClick={() => designInputRef.current?.click()}
                      className={cn(
                        'flex h-[110px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed text-slate-700 transition-colors dark:text-slate-300',
                        isDragging
                          ? 'border-slate-800 bg-slate-100 dark:border-slate-300 dark:bg-slate-800'
                          : 'border-slate-400 bg-slate-50 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/50',
                      )}
                    >
                      <UploadIcon className="h-[22px] w-[22px]" />
                      <span className="text-[13.5px] font-semibold">Drop images here or click to browse</span>
                      <span className="text-[11.5px] text-slate-500">
                        or{' '}
                        <button
                          type="button"
                          className="font-semibold underline hover:text-slate-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPickFolder();
                          }}
                        >
                          pick a folder
                        </button>{' '}
                        ·{' '}
                        <button
                          type="button"
                          className="font-semibold underline hover:text-slate-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            zipInputRef.current?.click();
                          }}
                        >
                          upload a .zip
                        </button>
                      </span>
                    </div>
                    <input
                      ref={designInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleDesignDrop(e.target.files)}
                    />
                    {/* Hidden folder + zip inputs */}
                    <input
                      ref={folderInputRef}
                      type="file"
                      multiple
                      // webkitdirectory is non-standard, the React types don't know it
                      {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                      className="hidden"
                      onChange={onFolderInputChange}
                    />
                    <input
                      ref={zipInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      className="hidden"
                      onChange={(e) => {
                        onZipPicked(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />

                    {(designFiles.length > 0 || zipFile) && (
                      <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-[11.5px] text-slate-600 dark:border-slate-800">
                          <span className="flex items-center gap-2">
                            <b className="text-slate-900 dark:text-slate-50">{garmentCountLabel}</b>
                            {isBulkMode && (
                              <Tag className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">Bulk mode</Tag>
                            )}
                          </span>
                          <span className="flex items-center gap-3">
                            {zipFile && (
                              <button type="button" className="font-semibold text-red-700 hover:text-red-800" onClick={() => setZipFile(null)}>
                                Remove zip
                              </button>
                            )}
                            {designFiles.length > 0 && (
                              <button type="button" className="font-semibold text-red-700 hover:text-red-800" onClick={() => setDesignFiles([])}>
                                Clear all
                              </button>
                            )}
                          </span>
                        </div>
                        {zipFile && (
                          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0 dark:border-slate-800">
                            <FileArchive className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span className="truncate" title={zipFile.name}>{zipFile.name}</span>
                          </div>
                        )}
                        <div className="max-h-40 overflow-y-auto">
                          {designFiles.slice(0, 8).map((f, i) => (
                            <div key={i} className="flex items-center justify-between border-b border-slate-100 px-3 py-1 last:border-b-0 dark:border-slate-800">
                              <span className="truncate text-xs" title={f.name}>{f.name}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${f.name}`}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-700"
                                onClick={() => setDesignFiles((prev) => prev.filter((_, j) => j !== i))}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          {designFiles.length > 8 && (
                            <p className="px-3 py-1 text-[11px] text-slate-500">… and {designFiles.length - 8} more</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2 · Model */}
                  <div className="flex flex-col gap-3">
                    <div className={cn(sectionLabel, 'mb-0')}>2 · MODEL</div>
                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) =>
                        renderSegmented({ label: 'Gender', value: field.value, options: GENDER_OPTIONS, onChange: field.onChange })
                      }
                    />
                    <FormField
                      control={form.control}
                      name="bodytype"
                      render={({ field }) =>
                        renderSegmented({
                          label: 'Body type',
                          value: field.value,
                          options: BODYTYPE_OPTIONS.map((o) => ({ ...o, label: o.label.replace(' Body', '') })),
                          onChange: field.onChange,
                        })
                      }
                    />
                    <FormField
                      control={form.control}
                      name="imagesCount"
                      render={({ field }) =>
                        renderSegmented({
                          label: 'Views',
                          value: field.value,
                          options: [
                            { label: 'Front only', value: '1' },
                            { label: 'All 4 views', value: '4' },
                          ],
                          onChange: field.onChange,
                        })
                      }
                    />
                  </div>

                  {/* 3 · Optional extras */}
                  <div>
                    <div className={sectionLabel}>3 · OPTIONAL EXTRAS</div>
                    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                      {renderExtraRow({ id: 'pattern', title: 'Pattern image', hint: 'Keep a print or texture exact', isSet: !!patternFile, children: (<>
                        <input
                          ref={patternInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setPatternFile(e.target.files?.[0] || null)}
                        />
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => patternInputRef.current?.click()}>
                            <UploadIcon />
                            {patternFile ? patternFile.name : 'Upload pattern'}
                          </Button>
                          {patternFile && (
                            <Button type="button" variant="ghost" size="icon" aria-label="Remove pattern" className="h-7 w-7 text-red-700" onClick={() => setPatternFile(null)}>
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </>) })}

                      {renderExtraRow({ id: 'accessory', title: 'Accessory / broach', hint: 'Image + placement (left chest, collar…)', isSet: !!broachFile || !!watchPlacement, children: (<>
                        <input
                          ref={broachInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setBroachFile(e.target.files?.[0] || null)}
                        />
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => broachInputRef.current?.click()}>
                            <UploadIcon />
                            {broachFile ? broachFile.name : 'Upload accessory'}
                          </Button>
                          {broachFile && (
                            <Button type="button" variant="ghost" size="icon" aria-label="Remove accessory" className="h-7 w-7 text-red-700" onClick={() => setBroachFile(null)}>
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        <FormField
                          control={form.control}
                          name="broach_placement"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[12px]">Placement</FormLabel>
                              <FormControl>
                                <Select value={field.value || ''} onValueChange={field.onChange}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="e.g. left chest" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {BROACH_PLACEMENT_OPTIONS.map((o) => (
                                      <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </>) })}

                      {renderExtraRow({ id: 'colour', title: 'Colour lock', hint: 'Reference image or a colour name', isSet: !!colorImageFile || !!watchColorName, children: (<>
                        <p className="text-[11.5px] text-slate-500">
                          The garment is recoloured to match the dominant colour of the reference image.
                        </p>
                        <input
                          ref={colorInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setColorImageFile(e.target.files?.[0] || null)}
                        />
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => colorInputRef.current?.click()}>
                            <UploadIcon />
                            {colorImageFile ? colorImageFile.name : 'Upload colour reference'}
                          </Button>
                          {colorImageFile && (
                            <>
                              <img
                                src={URL.createObjectURL(colorImageFile)}
                                alt="colour reference"
                                className="h-8 w-8 rounded border border-border object-cover"
                              />
                              <Button type="button" variant="ghost" size="icon" aria-label="Remove colour reference" className="h-7 w-7 text-red-700" onClick={() => setColorImageFile(null)}>
                                <Trash2 />
                              </Button>
                            </>
                          )}
                        </div>
                        <FormField
                          control={form.control}
                          name="color_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[12px]">Colour name</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Navy Blue" {...field} value={field.value ?? ''} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </>) })}

                      {renderExtraRow({ id: 'notes', title: 'Special instructions', hint: 'Free text for the generator', isSet: !!watchInstructions, children: (<>
                        <FormField
                          control={form.control}
                          name="special_instructions"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Textarea rows={3} placeholder="Any specific requirements..." {...field} value={field.value ?? ''} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </>) })}
                    </div>
                  </div>
                </div>

                {/* Sticky action bar — always visible */}
                <div className="flex shrink-0 flex-col gap-2.5 border-t border-slate-200 bg-white px-5 py-3.5 dark:border-slate-700 dark:bg-slate-900">
                  {job && (
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
                      <Tag className={cn('text-[10px]', statusTagClass(job.status))}>{job.status}</Tag>
                      <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">{job.id.slice(0, 16)}…</code>
                      <span>
                        {job.done}/{job.total} done · {job.failed} failed · {job.running} running · {job.pending} pending
                      </span>
                      {loading && (
                        <button type="button" className="ml-auto font-semibold text-red-700 hover:text-red-800" onClick={cancelJob}>
                          Cancel job
                        </button>
                      )}
                    </div>
                  )}
                  {loading && progress > 0 && <Progress value={progress} indicatorClassName="bg-slate-800" className="h-1.5" />}
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600 dark:text-slate-400">
                      <b className="text-slate-900 dark:text-slate-50">{garmentCountLabel}</b> · {settingsSummary}
                    </span>
                    <Button
                      type="submit"
                      size="lg"
                      className="h-[42px] shrink-0 rounded-[10px] bg-slate-800 px-5 font-bold text-white hover:bg-slate-900 disabled:bg-slate-300 disabled:text-slate-600 disabled:opacity-100"
                      disabled={loading || (!designFiles.length && !zipFile)}
                    >
                      <Zap />
                      {loading
                        ? isBulkMode
                          ? 'Processing…'
                          : 'Generating…'
                        : isBulkMode
                          ? 'Start bulk job'
                          : 'Generate'}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          ) : null}
        </section>

        {/* RIGHT — Jobs + results */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Recent bulk jobs — survives tab switches; click any to view its results */}
          {recentJobs.length > 0 && (
            <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-slate-50">
                  <History className="h-4 w-4" />
                  Recent bulk jobs
                </span>
                <Button type="button" variant="outline" size="icon" aria-label="Refresh jobs" className="h-8 w-8" onClick={loadRecentJobs}>
                  <RotateCw className={cn('h-3.5 w-3.5', recentLoading && 'animate-spin')} />
                </Button>
              </div>
              <div className="max-h-[232px] overflow-y-auto">
                {recentJobs.map((rj) => {
                  const pct = rj.total > 0 ? Math.round(((rj.done + rj.failed) / rj.total) * 100) : 0;
                  const donePct = rj.total > 0 ? Math.round((rj.done / rj.total) * 100) : 0;
                  const isActive = isActiveStatus(rj.status);
                  const isCurrent = job?.id === rj.id;
                  return (
                    <div
                      key={rj.id}
                      className={cn(
                        'grid grid-cols-[84px_minmax(0,1fr)_120px_68px] items-center gap-3 border-b border-slate-50 px-4 py-2.5 last:border-b-0 dark:border-slate-800',
                        isCurrent && 'bg-slate-100 dark:bg-slate-800',
                      )}
                    >
                      <Tag className={cn('justify-center text-[10px]', statusTagClass(rj.status))}>{rj.status}</Tag>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold" title={rj.id}>
                          {new Date(rj.createdAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[11.5px] text-slate-500">
                          {rj.done}/{rj.total} done · {rj.failed} failed
                        </span>
                      </span>
                      <Progress
                        value={isActive ? pct : donePct}
                        className="h-1.5"
                        indicatorClassName={
                          rj.status === 'FAILED' ? 'bg-red-600' : rj.status === 'PARTIAL' ? 'bg-amber-600' : isActive ? 'bg-slate-800' : 'bg-emerald-600'
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant={isCurrent ? 'default' : 'outline'}
                        className={cn('h-7', isCurrent && 'bg-slate-800 text-white hover:bg-slate-900')}
                        onClick={() => viewJob(rj.id)}
                      >
                        <Eye />
                        View
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {error && (
            <Alert type="error" showIcon>
              <div className="flex items-start justify-between gap-2">
                <span>{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss error" className="text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Alert>
          )}

          {/* Per-article result summary — highlights which articles produced no model */}
          {articleStats && (articleStats.failed.length > 0 || articleStats.partial.length > 0) && (
            <Card className="border-rose-200 bg-rose-50/60">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <CardTitle className="text-sm text-rose-800">
                  {articleStats.failed.length} of {articleStats.total} article
                  {articleStats.total !== 1 ? 's' : ''} failed
                  <span className="ml-2 font-normal text-rose-600">
                    ({articleStats.complete} done{articleStats.partial.length > 0 ? `, ${articleStats.partial.length} partial` : ''})
                  </span>
                </CardTitle>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={downloadFailedReport}>
                    <Download />
                    Download report
                  </Button>
                  {articleStats.failed.length > 0 && (
                    <Button type="button" size="sm" variant="outline" onClick={copyFailedCodes}>
                      Copy failed codes
                    </Button>
                  )}
                </div>
              </CardHeader>
              {articleStats.failed.length > 0 && (
                <CardContent className="max-h-48 overflow-y-auto py-0 pb-3">
                  <ul className="space-y-1 text-xs">
                    {articleStats.failed.map((f) => (
                      <li key={f.code} className="flex items-start gap-2">
                        <code className="shrink-0 rounded bg-rose-100 px-1 py-0.5 text-rose-800">{f.code}</code>
                        <span className="text-rose-700">{f.error || 'generation failed'}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}

          {loading && garmentRows.length === 0 && (
            <section className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[14px] border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
              <Spinner size="lg" />
              <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
                {isBulkMode
                  ? 'Bulk job running — images appear here as they finish. Pacing keeps Gemini below its rate limit.'
                  : 'AI is generating your fashion models. This may take 30–90 seconds...'}
              </p>
            </section>
          )}

          {!loading && garmentRows.length === 0 && !error && (
            <section className="flex min-h-[400px] flex-col items-center justify-center gap-3 rounded-[14px] border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
              <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Shirt className="h-7 w-7" />
              </span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-50">Results will appear here</span>
              <span className="max-w-[360px] text-[13px] leading-relaxed text-slate-500">
                {pageMode === 'from-article-list' ? (
                  <>
                    Add article codes on the left, check they’re ready, then press{' '}
                    <b className="text-slate-900 dark:text-slate-50">Generate</b>. Open a recent job above to see its images.
                  </>
                ) : (
                  <>
                    Add garment images on the left, choose the model and views, then press{' '}
                    <b className="text-slate-900 dark:text-slate-50">Generate</b>.
                  </>
                )}
              </span>
            </section>
          )}

          {garmentRows.length > 0 && (
            <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-slate-50">
                  {results.length} generated image{results.length !== 1 ? 's' : ''}
                  <span className="text-xs font-normal text-slate-500">
                    · {garmentRows.length} garment{garmentRows.length !== 1 ? 's' : ''}
                  </span>
                  {loading && <Spinner size="sm" />}
                </span>
                <Button size="sm" variant="outline" onClick={downloadAll}>
                  <Download />
                  Download all
                </Button>
              </div>
              <div className="flex flex-col gap-3 p-3">
                {/* One row per garment — [source | front | back | left side | closeup] */}
                {garmentRows.map((row) => {
                  const columnsCount = visibleViews.length + 1; // +1 for source
                  return (
                    <div key={row.fileName} className="rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="truncate border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300" title={row.fileName}>
                        {row.fileName}
                      </div>
                      <div className="grid gap-2 p-2" style={{ gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))` }}>
                        {/* Source cell */}
                        <div className="flex flex-col gap-1">
                          {row.source ? (
                            <img
                              src={resolveAssetUrl(row.source)}
                              alt={`${row.fileName} - source`}
                              className="aspect-[2/3] w-full cursor-pointer rounded-md object-cover"
                              onClick={() => setPreviewUrl(resolveAssetUrl(row.source))}
                            />
                          ) : (
                            <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                              <span className="text-[11px] text-slate-500">no source</span>
                            </div>
                          )}
                          <Tag className="self-start text-[10px]">Source</Tag>
                        </div>

                        {/* One cell per expected view */}
                        {visibleViews.map((view) => {
                          const cell = row.cells[view];
                          const url = cell?.url;
                          const status = cell?.status;
                          if (url && status === 'DONE') {
                            return (
                              <div key={view} className="flex flex-col gap-1">
                                <img
                                  src={resolveAssetUrl(url)}
                                  alt={`${row.fileName} - ${view}`}
                                  className="aspect-[2/3] w-full cursor-pointer rounded-md object-cover"
                                  onClick={() => setPreviewUrl(resolveAssetUrl(url))}
                                />
                                <div className="flex items-center justify-between">
                                  <Tag className="border-slate-300 bg-slate-100 text-[10px] text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                                    {VIEW_LABELS[view] || view}
                                  </Tag>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Download ${VIEW_LABELS[view] || view}`}
                                    className="h-6 w-6"
                                    onClick={() =>
                                      downloadImage(
                                        resolveAssetUrl(url),
                                        `${row.fileName.split('.')[0]}_${view.replace(/\s+/g, '_')}.png`,
                                      )
                                    }
                                  >
                                    <Download />
                                  </Button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={view} className="flex flex-col gap-1">
                              <div
                                className={cn(
                                  'flex aspect-[2/3] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed',
                                  status === 'FAILED'
                                    ? 'border-rose-300 bg-rose-50'
                                    : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50',
                                )}
                              >
                                {status === 'RUNNING' && <Spinner size="sm" />}
                                <span className="text-[11px] text-slate-500">
                                  {status === 'RUNNING'
                                    ? 'Generating…'
                                    : status === 'PENDING'
                                      ? 'Queued'
                                      : status === 'FAILED'
                                        ? 'Failed'
                                        : '—'}
                                </span>
                              </div>
                              <Tag
                                className={cn(
                                  'self-start text-[10px]',
                                  status === 'FAILED' ? 'border-rose-200 bg-rose-50 text-rose-700' : '',
                                )}
                              >
                                {VIEW_LABELS[view] || view}
                              </Tag>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
      )}

      {/* Lightbox preview for any source/output image */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="preview"
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
