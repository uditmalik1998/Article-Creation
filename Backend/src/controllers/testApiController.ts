/**
 * Test API Controller
 *
 * Endpoints for the raw_articles ingestion + extraction pipeline.
 *
 * POST /api/test-api/fetch-presentation   { "after_date": "2026-05-27" }
 * POST /api/test-api/fetch-by-ppt         { "ppt_no": "PRES-00831" }
 * POST /api/test-api/run-extraction       {}
 * GET  /api/test-api/pipeline-status
 * GET  /api/test-api/raw-articles         ?ppt_no=PRES-00831
 */

import { Request, Response } from 'express';
import { prismaClient as prisma } from '../utils/prisma';
import {
  runRawArticleExtraction,
  getRawArticlePipelineStatus,
  isExtractionRunning,
} from '../services/rawArticleExtractionService';
import {
  runFabricRawDataProcessing,
  getFabricRawPipelineStatus,
  isFabricRawRunning,
} from '../services/fabricRawDataService';

// ── SRM Paginated API (same as srmSyncService) ────────────────────────────────
const SRM_API_BASE   = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/srm-presentation-images-api';
const SRM_BY_REF_API = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/srm-presentation-by-ref';
const SRM_API_KEY    = process.env.SRM_API_KEY    || 'v2@123';
const SRM_SUPABASE_KEY = process.env.SRM_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRxbm53d3hyZ2VvbHZndmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMzU0NzYsImV4cCI6MjA2ODkxMTQ3Nn0.jUrb0jIg6qjj2Rlh9DxYesSnbstoD4uoDCswqOqAkUM';

const PAGE_SIZE = 100;

// Hard cutoff — data before this date is already in extraction_results_flat.
// The caller can never pass an after_date earlier than this.
const RAW_ARTICLES_CUTOFF = new Date('2026-05-26T23:59:59.999Z');

interface SrmRow {
  presentation_no:            string;
  vendor_code:                string;
  vendor_name?:               string | null;
  division:                   string;
  sub_division:               string;
  major_category:             string;
  presentation_received_date: string | null;
  design_number:              string;
  fabric:                     string;
  no_of_colors:               number;
  price:                      number;
  image_url?:                 string | null;
}

interface SrmApiPage {
  page:      number;
  page_size: number;
  total:     number;
  rows:      SrmRow[];
}

/** Normalise vendor code to last 6 digits (e.g. "0000200251" → "200251") */
function normaliseVendorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 6 ? digits.slice(-6) : digits || null;
}

/** Fetch a single page from the SRM API */
async function fetchSrmPage(page: number): Promise<SrmApiPage> {
  const url = `${SRM_API_BASE}?page=${page}&page_size=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: {
      apikey:          SRM_SUPABASE_KEY,
      Authorization:   `Bearer ${SRM_SUPABASE_KEY}`,
      'x-api-key':     SRM_API_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const json = await res.json() as any;
  const rows: SrmRow[] = Array.isArray(json.rows) ? json.rows
    : Array.isArray(json.data) ? json.data : [];
  const total: number = typeof json.total === 'number' ? json.total
    : typeof json.count === 'number' ? json.count : rows.length;
  return { page, page_size: PAGE_SIZE, total, rows };
}

/** Fetch ALL pages and return every row */
async function fetchAllSrmRows(): Promise<SrmRow[]> {
  const first = await fetchSrmPage(1);
  const allRows: SrmRow[] = [...first.rows];
  const totalPages = Math.ceil((first.total || first.rows.length) / PAGE_SIZE);

  for (let p = 2; p <= totalPages; p++) {
    const page = await fetchSrmPage(p);
    allRows.push(...page.rows);
  }
  return allRows;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/test-api/fetch-presentation
 *
 * Body: { after_date: "2026-05-27" }
 *
 * Fetches all rows from the SRM paginated API, filters by
 * presentation_received_date >= after_date, and inserts matching rows
 * into raw_articles with status PENDING.
 *
 * Dedup key: presentation_no + '::' + design_number
 * Existing rows are skipped (not updated).
 */
export const fetchPresentationToRaw = async (req: Request, res: Response): Promise<void> => {
  const { after_date } = req.body as { after_date?: string };

  if (!after_date) {
    res.status(400).json({ success: false, error: 'after_date is required (e.g. "2026-05-27")' });
    return;
  }

  // Parse date — treat as start of that day in UTC
  const afterDate = new Date(`${after_date.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(afterDate.getTime())) {
    res.status(400).json({ success: false, error: `Invalid after_date: "${after_date}"` });
    return;
  }

  // Enforce hard cutoff — cannot fetch data older than May 26 2026
  if (afterDate <= RAW_ARTICLES_CUTOFF) {
    res.status(422).json({
      success: false,
      error: `after_date must be after ${RAW_ARTICLES_CUTOFF.toISOString().slice(0, 10)}. Data before this date already exists in extraction_results_flat.`,
    });
    return;
  }

  // ── Fetch all rows from SRM API ──────────────────────────────────────────
  let allRows: SrmRow[];
  try {
    console.log(`[TestAPI] Fetching all SRM rows to filter by date >= ${after_date}`);
    allRows = await fetchAllSrmRows();
    console.log(`[TestAPI] SRM returned ${allRows.length} total rows`);
  } catch (err: any) {
    res.status(502).json({ success: false, error: `SRM API error: ${err.message}` });
    return;
  }

  // ── Filter by presentation_received_date >= after_date ───────────────────
  const matchedRows = allRows.filter(row => {
    if (!row.presentation_received_date) return false;
    const d = new Date(row.presentation_received_date);
    return !isNaN(d.getTime()) && d >= afterDate;
  });

  const dateFiltered = allRows.length - matchedRows.length;
  console.log(`[TestAPI] After date filter: ${matchedRows.length} matched, ${dateFiltered} skipped (too old)`);

  if (matchedRows.length === 0) {
    res.json({
      success:        true,
      after_date:     after_date.slice(0, 10),
      total_from_api: allRows.length,
      date_filtered:  dateFiltered,
      matched:        0,
      inserted:       0,
      skipped:        0,
      errors:         0,
      message:        `No presentations found with received_date >= ${after_date.slice(0, 10)}.`,
    });
    return;
  }

  // ── Insert matched rows into raw_articles ────────────────────────────────
  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const row of matchedRows) {
    try {
      // Dedup key: presentation_no + design_number + image_url
      const uniqueKey = `${row.presentation_no}::${row.design_number}::${row.image_url ?? ''}`;

      const existing = await prisma.rawArticle.findUnique({
        where:  { uniqueKey },
        select: { id: true },
      });

      if (existing) { skipped++; continue; }

      await prisma.rawArticle.create({
        data: {
          presentationNo:           row.presentation_no,
          vendorCode:               normaliseVendorCode(row.vendor_code),
          vendorName:               row.vendor_name               || null,
          division:                 row.division                  || null,
          subDivision:              row.sub_division              || null,
          majorCategory:            row.major_category            || null,
          presentationReceivedDate: row.presentation_received_date
            ? new Date(row.presentation_received_date) : null,
          designNumber:             row.design_number             || null,
          fabric:                   row.fabric                    || null,
          noOfColors:               row.no_of_colors              ?? null,
          price:                    row.price != null ? row.price : null,
          imageUrl:                 row.image_url                 || null,
          uniqueKey,
          status:                   'PENDING',
        },
      });

      inserted++;
    } catch (err: any) {
      errors++;
      console.error(`[TestAPI] Error inserting ${row.presentation_no}/${row.design_number}:`, err.message);
    }
  }

  console.log(`[TestAPI] Done — inserted: ${inserted} | skipped: ${skipped} | errors: ${errors}`);

  res.json({
    success:        true,
    after_date:     after_date.slice(0, 10),
    total_from_api: allRows.length,
    date_filtered:  dateFiltered,
    matched:        matchedRows.length,
    inserted,
    skipped,
    errors,
    message: `${inserted} new row(s) saved to raw_articles with status PENDING.`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/test-api/raw-articles?ppt_no=PRES-00831
 *
 * Returns raw_articles rows. If ppt_no is provided, filters by that presentation.
 */
export const getRawArticles = async (req: Request, res: Response): Promise<void> => {
  const pptNo = (req.query.ppt_no as string | undefined)?.trim().toUpperCase();
  const where = pptNo ? { presentationNo: pptNo } : {};

  const rows = await prisma.rawArticle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  res.json({ success: true, total: rows.length, ppt_no: pptNo ?? null, data: rows });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/test-api/fetch-by-ppt
 *
 * Body: { ppt_no: "PRES-00831" }
 *
 * Fetches a single presentation directly from the SRM by-ref API
 * (no date filter — works for any PPT regardless of received_date)
 * and inserts all its images into raw_articles with status PENDING.
 * Dedup key: presentation_no::design_number::image_url — existing rows are skipped.
 */
export const fetchByPptNo = async (req: Request, res: Response): Promise<void> => {
  const { ppt_no } = req.body as { ppt_no?: string };

  if (!ppt_no?.trim()) {
    res.status(400).json({ success: false, error: 'ppt_no is required (e.g. "PRES-00831")' });
    return;
  }

  const pptNo = ppt_no.trim().toUpperCase();

  // ── Call srm-presentation-by-ref API directly ────────────────────────────
  // This API accepts a single ref_no and returns all images for that presentation.
  // Unlike the paginated API it has no date filter, so any PPT number works.
  let presentation: any;
  let images: any[];

  try {
    console.log(`[TestAPI] Fetching PPT ${pptNo} from srm-presentation-by-ref`);
    const url = new URL(SRM_BY_REF_API);
    url.searchParams.set('ref_no', pptNo);

    const apiRes = await fetch(url.toString(), {
      headers: {
        'apikey':        SRM_SUPABASE_KEY,
        'Authorization': `Bearer ${SRM_SUPABASE_KEY}`,
        'x-api-key':     SRM_API_KEY,
      },
    });

    if (!apiRes.ok) {
      const body = await apiRes.text().catch(() => '');
      throw new Error(`HTTP ${apiRes.status} — ${body.slice(0, 300)}`);
    }

    const json = await apiRes.json() as any;
    presentation = json.presentation;
    images = Array.isArray(json.images) ? json.images : [];

    console.log(`[TestAPI] By-ref API returned ${images.length} image(s) for ${pptNo}`);
  } catch (err: any) {
    res.status(502).json({ success: false, error: `SRM API error: ${err.message}` });
    return;
  }

  if (!presentation || images.length === 0) {
    res.json({
      success:  true,
      ppt_no:   pptNo,
      matched:  0,
      inserted: 0,
      skipped:  0,
      errors:   0,
      message:  `No presentations found for ${pptNo} in the SRM API.`,
    });
    return;
  }

  let inserted = 0, skipped = 0, errors = 0;

  for (const img of images) {
    try {
      const designNumber = img.design_number || img.id || '';
      const imageUrl     = img.image_url || null;
      const uniqueKey    = `${presentation.ref_no}::${designNumber}::${imageUrl ?? ''}`;

      const existing = await prisma.rawArticle.findUnique({
        where:  { uniqueKey },
        select: { id: true },
      });

      if (existing) { skipped++; continue; }

      await prisma.rawArticle.create({
        data: {
          presentationNo:           presentation.ref_no,
          vendorCode:               normaliseVendorCode(presentation.vendor_code),
          vendorName:               presentation.vendor_name               || null,
          division:                 presentation.division                  || null,
          subDivision:              presentation.sub_division              || null,
          majorCategory:            presentation.major_category            || null,
          presentationReceivedDate: presentation.received_at
            ? new Date(presentation.received_at) : null,
          designNumber:             designNumber                           || null,
          fabric:                   img.fabric                             || null,
          noOfColors:               img.no_of_colors                      ?? null,
          price:                    img.price != null ? img.price          : null,
          imageUrl,
          uniqueKey,
          status: 'PENDING',
        },
      });

      inserted++;
    } catch (err: any) {
      errors++;
      console.error(`[TestAPI] Error inserting ${presentation.ref_no}/${img.design_number}:`, err.message);
    }
  }

  console.log(`[TestAPI] PPT ${pptNo} done — inserted:${inserted} skipped:${skipped} errors:${errors}`);

  res.json({
    success:  true,
    ppt_no:   pptNo,
    matched:  images.length,
    inserted,
    skipped,
    errors,
    message:  `${inserted} new row(s) saved to raw_articles with status PENDING.`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/test-api/run-extraction
 *
 * Triggers the raw_articles extraction worker.
 * Claims up to 10 PENDING/FAILED rows, runs VLM, pushes to extraction_results_flat.
 * Returns immediately if a run is already in progress.
 */
export const runExtraction = async (req: Request, res: Response): Promise<void> => {
  if (isExtractionRunning()) {
    res.status(409).json({
      success: false,
      error:   'Extraction worker is already running. Try again once it completes.',
    });
    return;
  }

  // Fire-and-forget — run in background so the HTTP response returns immediately
  runRawArticleExtraction('ADMIN_MANUAL').catch(err => {
    console.error('[TestAPI] Extraction worker error:', err.message);
  });

  res.json({
    success: true,
    message: 'Extraction worker started in background. Check pipeline status in a few minutes.',
  });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/test-api/pipeline-status
 *
 * Returns counts of raw_articles grouped by status.
 */
export const getPipelineStatus = async (_req: Request, res: Response): Promise<void> => {
  const status = await getRawArticlePipelineStatus();
  res.json({ success: true, data: status });
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/test-api/fabric-raw-pipeline-status
 * Returns fabric_raw_data counts grouped by status.
 */
export const getFabricRawStatus = async (_req: Request, res: Response): Promise<void> => {
  const status = await getFabricRawPipelineStatus();
  res.json({ success: true, data: status });
};

/**
 * POST /api/test-api/run-fabric-raw-processing
 * Triggers the fabric_raw_data → fabric_article_data processing worker.
 * Returns immediately if a run is already in progress.
 */
export const runFabricRawProcessing = async (_req: Request, res: Response): Promise<void> => {
  if (isFabricRawRunning()) {
    res.status(409).json({
      success: false,
      error: 'Fabric raw processing worker is already running. Try again once it completes.',
    });
    return;
  }

  runFabricRawDataProcessing('ADMIN_MANUAL').catch(err => {
    console.error('[TestAPI] Fabric raw processing error:', err.message);
  });

  res.json({
    success: true,
    message: 'Fabric raw processing started in background. Check pipeline status in a few seconds.',
  });
};
