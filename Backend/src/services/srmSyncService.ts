/**
 * SRM Sync Service
 *
 * Replaces AI-based attribute extraction for presentation data that already
 * exists in the SRM (Sample Request Management) system.
 *
 * Instead of scanning images with a VLM to read attributes off a whiteboard,
 * this service fetches structured data from the SRM API and inserts it
 * directly into extraction_results_flat — no AI cost, instant results.
 *
 * Fields from SRM API:
 *   presentation_no   → pptNumber
 *   vendor_code       → vendorCode
 *   division          → division
 *   sub_division      → subDivision
 *   major_category    → majorCategory
 *   design_number     → designNumber
 *   fabric            → macroMvgr (closest match)
 *   no_of_colors      → NOT mapped (impAtrbt2 is left null, filled manually)
 *   price             → rate
 *   image_url         → imageUrl
 */

import { prismaClient as prisma } from '../utils/prisma';
import { getHsnCodeByMcCode, getMcCodeByMajorCategory } from '../utils/mcCodeMapper';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';
import { buildArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { mirror360FlatUpdate } from '../utils/mirror360Flat';
import { VLMService } from './vlm/vlmService';
import { mvgrMappingService } from './mvgrMappingService';
import { storageService } from './storageService';
import { upsertRawArticleFromSrm, RAW_PIPELINE_CUTOFF } from './rawArticleExtractionService';
import { hierarchyService } from './hierarchyService';
import { snapValueToGrid } from '../utils/gridSnap';

const SRM_API_BASE = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/srm-presentation-images-api';
const SRM_API_KEY = process.env.SRM_API_KEY || 'v2@123';
const SRM_SUPABASE_KEY = process.env.SRM_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRxbm53d3hyZ2VvbHZndmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMzU0NzYsImV4cCI6MjA2ODkxMTQ3Nn0.jUrb0jIg6qjj2Rlh9DxYesSnbstoD4uoDCswqOqAkUM';
const PAGE_SIZE = 100;

interface SrmRow {
  presentation_no: string;
  vendor_code: string;
  vendor_name?: string | null;
  division: string;
  sub_division: string;
  major_category: string;
  presentation_received_date: string;
  design_number: string;
  fabric: string;
  no_of_colors: number;
  price: number;
  image_url?: string | null;
  presentations_type?: string | null;
}

/** Normalise vendor code to last 6 digits (e.g. "0000200251" → "200251") */
function normaliseVendorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 6 ? digits.slice(-6) : digits || null;
}

interface SrmApiResponse {
  page: number;
  page_size: number;
  total: number;
  rows: SrmRow[];
}

interface SyncResult {
  inserted: number;
  skipped: number;
  errors: number;
  total: number;
  staged: number;   // rows staged to raw_articles (new pipeline, after cutoff)
}

export interface EnrichResult {
  processed: number;
  enriched: number;
  failed: number;
}

// Module-level cache: last completed sync result + timestamp
export interface LastSyncResult extends SyncResult {
  completedAt: string; // ISO string
  ranAt: string;       // ISO string (when sync started)
}
let _lastSyncResult: LastSyncResult | null = null;
export function getLastSrmSyncResult(): LastSyncResult | null { return _lastSyncResult; }

// Minimum delay between consecutive VLM calls to avoid Gemini rate limits
const VLM_ENRICH_DELAY_MS = 2000;

/**
 * Fetches an image URL (Supabase private or public R2) and returns it as a
 * data-URI base64 string suitable for the VLM provider.
 *
 * Supabase private storage URLs require `apikey` + `Authorization` headers.
 * Public R2 URLs work with a plain fetch (no headers needed).
 *
 * Returns null if the fetch fails for any reason.
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // SRM image URLs (api.v2retail.com/storage/v1/object/public/...) are publicly
    // accessible — no auth headers required.
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`[SRM Image] fetchImageAsBase64 failed ${res.status} for: ${imageUrl.slice(0, 120)}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeBase = contentType.split(';')[0].trim().toLowerCase();
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${mimeBase};base64,${buffer.toString('base64')}`;
  } catch (err: any) {
    console.warn(`[SRM Image] fetchImageAsBase64 error: ${err.message}`);
    return null;
  }
}

/**
 * Downloads an SRM image URL (which may be a private Supabase storage URL or a
 * short-lived signed URL) using the SRM Supabase auth headers, then re-uploads it
 * to our own R2 bucket so it is permanently accessible without authentication.
 *
 * Returns the permanent R2 public URL, or null if the download/upload fails.
 * This must be called during sync — not at enrichment time — to avoid expired URLs.
 */
async function downloadAndMirrorToR2(srmImageUrl: string): Promise<string | null> {
  try {
    // Fetch with SRM Supabase auth headers (required for private buckets / signed URLs)
    const res = await fetch(srmImageUrl, {
      headers: {
        'apikey': SRM_SUPABASE_KEY,
        'Authorization': `Bearer ${SRM_SUPABASE_KEY}`,
      },
    });

    if (!res.ok) {
      console.warn(`[SRM Image] Fetch failed ${res.status} for: ${srmImageUrl.slice(0, 120)}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeBase = contentType.split(';')[0].trim().toLowerCase();
    const ext = mimeBase.includes('png') ? 'png'
      : mimeBase.includes('webp') ? 'webp'
      : mimeBase.includes('gif') ? 'gif'
      : 'jpg';

    const buffer = Buffer.from(await res.arrayBuffer());
    const result = await storageService.uploadFile(buffer, `srm-image.${ext}`, mimeBase, 'srm-images');
    console.log(`[SRM Image] Mirrored to R2: ${result.url.slice(0, 80)}...`);
    return result.url;
  } catch (err: any) {
    console.warn(`[SRM Image] Mirror to R2 failed: ${err.message}`);
    return null;
  }
}

/**
 * Public wrapper around enrichSrmRowWithVlm for admin-initiated retries.
 * The inner function is intentionally kept module-private so callers can't
 * accidentally call it without going through the rate-limit gap logic.
 * The admin controller calls this directly and manages its own sequencing.
 */
export async function enrichSrmRowWithVlmAdmin(
  flatId: string,
  imageUrl: string,
  majorCategory: string | null,
): Promise<boolean> {
  // Pass checkRawPipelineOwnership=false — the raw_articles cron IS the pipeline;
  // it must never skip itself due to its own ownership guard.
  return enrichSrmRowWithVlm(flatId, imageUrl, majorCategory, false);
}

// Module-level schema cache — masterAttribute rows rarely change, no need to re-query
// for every single SRM record during a backfill run. Loaded once per process lifetime.
let cachedEnrichSchema: Array<{ key: string; label: string; type: any; allowedValues: string[] }> | null = null;

async function getEnrichSchema() {
  if (cachedEnrichSchema) return cachedEnrichSchema;
  const masterAttrs = await prisma.masterAttribute.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: {
      allowedValues: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } }
    }
  });
  cachedEnrichSchema = masterAttrs.map(attr => ({
    key: attr.key,
    label: attr.label || attr.key,
    type: attr.type.toLowerCase() as any,
    allowedValues: attr.allowedValues.map((av: any) => av.shortForm),
  }));
  return cachedEnrichSchema;
}

// How many pages to fetch in parallel per batch
const PAGE_BATCH_SIZE = 5;
// Max retries per page on transient failure
const PAGE_MAX_RETRIES = 3;

/**
 * Fetch one page from the SRM API with retry logic.
 */
async function fetchPage(page: number, retries = PAGE_MAX_RETRIES): Promise<SrmApiResponse> {
  const url = `${SRM_API_BASE}?page=${page}&page_size=${PAGE_SIZE}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'apikey': SRM_SUPABASE_KEY,
          'Authorization': `Bearer ${SRM_SUPABASE_KEY}`,
          'x-api-key': SRM_API_KEY,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const json = await res.json() as any;

      // Log API structure on first page so we can diagnose mismatches in server logs
      if (page === 1) {
        const keys = Object.keys(json).join(', ');
        const rowsLen = Array.isArray(json.rows) ? json.rows.length
          : Array.isArray(json.data) ? json.data.length : '?';
        console.log(`[SRM Sync] API page 1 — keys: [${keys}] | total=${json.total ?? json.count ?? '?'} | rows_in_page=${rowsLen}`);
      }

      // Normalise: support both 'rows'/'total' and 'data'/'count' response shapes
      const rows: SrmRow[] = Array.isArray(json.rows) ? json.rows
        : Array.isArray(json.data) ? json.data : [];
      const total: number = (typeof json.total === 'number' && json.total > 0) ? json.total
        : (typeof json.count === 'number' && json.count > 0) ? json.count
        : rows.length;

      return { page: json.page ?? page, page_size: json.page_size ?? PAGE_SIZE, total, rows };
    } catch (err: any) {
      if (attempt === retries) {
        throw new Error(`SRM API page ${page} failed after ${retries} attempts: ${err.message}`);
      }
      const delay = attempt * 1000; // 1s, 2s back-off
      console.warn(`[SRM Sync] Page ${page} attempt ${attempt} failed — retrying in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  // Unreachable but satisfies TypeScript
  throw new Error(`SRM API page ${page}: exhausted retries`);
}

/**
 * Fetch all pages and return every row.
 * Pages are fetched in parallel batches of PAGE_BATCH_SIZE to balance speed vs rate limits.
 */
async function fetchAllRows(): Promise<SrmRow[]> {
  // Step 1: fetch page 1 to discover total record count
  const first = await fetchPage(1);
  const allRows: SrmRow[] = [...first.rows];

  // Guard: if total came back as 0 but we got rows, trust the rows (API quirk)
  const reportedTotal = first.total > 0 ? first.total : first.rows.length;
  const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);

  if (totalPages <= 1) {
    console.log(`[SRM Sync] Single page — ${allRows.length} records fetched`);
    return allRows;
  }

  console.log(`[SRM Sync] ${reportedTotal} total records → ${totalPages} pages (batch size ${PAGE_BATCH_SIZE})`);

  // Step 2: fetch remaining pages in parallel batches
  for (let batchStart = 2; batchStart <= totalPages; batchStart += PAGE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PAGE_BATCH_SIZE - 1, totalPages);
    const pageNums = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

    const pages = await Promise.all(pageNums.map(p => fetchPage(p)));
    for (const p of pages) allRows.push(...p.rows);

    console.log(`[SRM Sync] ✓ Pages ${batchStart}–${batchEnd} of ${totalPages} (${allRows.length}/${reportedTotal} rows so far)`);
  }

  console.log(`[SRM Sync] All pages fetched — ${allRows.length} total rows`);
  return allRows;
}

/**
 * Find an existing SRM record using the IMMUTABLE srm_original_design_number key.
 *
 * Why immutable? The user-facing `designNumber` field can be edited by approvers
 * after import. If we dedup by `designNumber` alone, a user edit (e.g. "151" → "1007")
 * makes the cron think the original "151" is new — and inserts a duplicate.
 *
 * `srmOriginalDesignNumber` is set ONCE on insert and never touched again, making
 * it a reliable stable key regardless of what the user changes later.
 */
async function findExisting(presentationNo: string, srmDesignNumber: string): Promise<{ id: string; imageUrl: string | null; vendorCode: string | null; vendorName: string | null } | null> {
  return prisma.extractionResultFlat.findFirst({
    where: {
      pptNumber: presentationNo,
      source: 'SRM',
      // Match on the immutable key OR the visible design number.
      //
      // Why the fallback: rows imported before srm_original_design_number was
      // populated have it NULL, and rows whose design number was edited have it
      // diverged. Matching ONLY on srmOriginalDesignNumber misses those rows, so
      // a re-import (admin "Sync by PPT" / SRM webhook) treated them as new and
      // inserted DUPLICATES (this is the PRES-00513 bug). Falling back to
      // designNumber lets us find and patch the existing row instead.
      //
      // This also dedups WITHIN a single batch: each insert is committed before
      // the next image is processed, so a repeated design number in the same
      // payload now matches the row we just created.
      OR: [
        { srmOriginalDesignNumber: srmDesignNumber },
        { designNumber: srmDesignNumber },
      ],
    },
    // Prefer an already-enriched row (COMPLETED < SRM_IMPORT alphabetically) over
    // an un-enriched stub when both exist for the same design number.
    orderBy: { extractionStatus: 'asc' },
    select: { id: true, imageUrl: true, vendorCode: true, vendorName: true },
  });
}

/**
 * Resolve a Category ID from the major_category code (same fallback chain as the watcher).
 */
async function resolveCategoryId(majorCategory: string, division: string): Promise<number> {
  // Try exact code match first
  const exact = await prisma.category.findFirst({
    where: { code: { equals: majorCategory, mode: 'insensitive' } },
    select: { id: true },
  });
  if (exact) return exact.id;

  // Fallback: first category in the division
  const divisionFallback = await prisma.category.findFirst({
    where: {
      subDepartment: {
        department: { name: { equals: division, mode: 'insensitive' } },
      },
    },
    select: { id: true },
  });
  if (divisionFallback) return divisionFallback.id;

  // Absolute last resort
  const any = await prisma.category.findFirst({ select: { id: true } });
  if (any) return any.id;

  throw new Error('No Category found in database — cannot create ExtractionJob');
}

/**
 * VLM enrichment for SRM records that have an image URL.
 * Runs after the flat row is already created, fills in all the garment
 * attributes that SRM doesn't provide (FAB, BODY, VA ACC, PRINTING groups).
 * Never overwrites the SRM-authoritative fields.
 */
const vlmService = new VLMService();

// Max VLM attempts per record: 1 initial call + 2 automatic retries
const VLM_MAX_ATTEMPTS = 3;
// Backoff between retry attempts (multiplied by attempt number: 3s, 6s)
const VLM_RETRY_BACKOFF_MS = 3000;

async function enrichSrmRowWithVlm(
  flatId: string,
  imageUrl: string,
  majorCategory: string | null,
  /** Set false when called directly from rawArticleExtractionService — skip the ownership guard */
  checkRawPipelineOwnership = true,
): Promise<boolean> {
  // ── Guard: skip if this record is already COMPLETED ───────────────────────
  const currentRecord = await prisma.extractionResultFlat.findUnique({
    where: { id: flatId },
    select: { extractionStatus: true },
  });
  if (currentRecord?.extractionStatus === 'COMPLETED') {
    console.log(`[SRM VLM] Skipping ${flatId} — already COMPLETED`);
    return true;
  }

  // ── Guard: skip if raw_articles pipeline owns this flat record ───────────────
  // Prevents double-VLM race condition when both the SRM sync cron (12PM/8PM)
  // and the raw_articles extraction cron try to enrich the same record.
  // We only apply this check when called from srmSyncService (checkRawPipelineOwnership=true);
  // when called from rawArticleExtractionService itself we skip the check to avoid
  // the cron blocking itself.
  if (checkRawPipelineOwnership) {
    const rawArticleOwner = await prisma.rawArticle.findFirst({
      where: {
        flatId,
        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
      },
      select: { id: true, status: true },
    });
    if (rawArticleOwner) {
      console.log(`[SRM VLM] Skipping ${flatId} — owned by raw_articles pipeline (row: ${rawArticleOwner.id}, status: ${rawArticleOwner.status})`);
      return true;
    }
  }

  // ── Guard: skip if the same public image URL is already COMPLETED in another record ─
  const sameImageCompleted = await prisma.extractionResultFlat.findFirst({
    where: {
      imageUrl,
      extractionStatus: 'COMPLETED',
      id: { not: flatId },
    },
    select: { id: true },
  });
  if (sameImageCompleted) {
    console.log(`[SRM VLM] Skipping ${flatId} — imageUrl already extracted in record ${sameImageCompleted.id}`);
    return true;
  }

  console.log(`[SRM VLM] Starting enrichment for ${flatId} | category: ${majorCategory} | url: ${imageUrl.slice(0, 100)}`);

  // ── Step 1: fetch image (once — no retry, fast-fail) ──────────────────────
  const base64Image = await fetchImageAsBase64(imageUrl);
  if (!base64Image) {
    console.warn(`[SRM VLM] ❌ Image fetch failed for ${flatId}. URL: ${imageUrl.slice(0, 120)}`);
    return false;
  }
  console.log(`[SRM VLM] ✓ Image fetched — base64 length: ${base64Image.length} chars`);

  // ── Step 2: load schema (once — cached after first call) ──────────────────
  const schema = await getEnrichSchema();
  console.log(`[SRM VLM] ✓ Schema loaded — ${schema.length} attributes`);

  // ── Step 2b: constrain schema to the per-major-category grid whitelist ────
  // STRICT (matches the manual extraction page): the grid is the whitelist.
  //  - Only attributes that have grid values for this category are kept.
  //  - Each kept attribute is given allowedValues = that category's grid values,
  //    so the VLM must pick the nearest of those (e.g. M_WASH → RINSE_WSH, not RINSE).
  //  - NO fallback to the global attribute_allowed_values list.
  //  - A category with no grid (or a null category) stores nothing: we mark the
  //    record COMPLETED with zero attributes so it isn't reprocessed forever.
  const gridValues = majorCategory
    ? await hierarchyService.getCategoryGridValues(majorCategory)
    : new Map<string, string[]>();

  const constrainedSchema = schema
    .filter(s => gridValues.has(s.key) && gridValues.get(s.key)!.length > 0)
    .map(s => ({ ...s, allowedValues: gridValues.get(s.key)! }));

  if (constrainedSchema.length === 0) {
    console.log(`[SRM VLM] No grid values for category "${majorCategory}" — marking COMPLETED with no attributes (nothing stored).`);
    await prisma.extractionResultFlat.update({
      where: { id: flatId },
      data: { extractionStatus: 'COMPLETED', avgConfidence: 0, aiModel: 'grid-skip' },
    });
    return true;
  }
  console.log(`[SRM VLM] ✓ Grid-constrained schema — ${constrainedSchema.length}/${schema.length} attributes for "${majorCategory}"`);

  // ── Step 3: VLM call with up to VLM_MAX_ATTEMPTS attempts ─────────────────
  for (let attempt = 1; attempt <= VLM_MAX_ATTEMPTS; attempt++) {
    const attemptTag = attempt > 1 ? ` [retry ${attempt - 1}/${VLM_MAX_ATTEMPTS - 1}]` : '';
    try {
      const result = await vlmService.extractFashionAttributes({
        image: base64Image,
        schema: constrainedSchema,
        categoryName: majorCategory || undefined,
        discoveryMode: false,
      });

      const nonNullAttrs = Object.entries(result.attributes || {})
        .filter(([, v]) => v !== null && (v as any)?.rawValue != null)
        .map(([k]) => k);
      console.log(`[SRM VLM]${attemptTag} ✓ VLM complete — confidence: ${result.confidence}% | non-null attrs (${nonNullAttrs.length}): ${nonNullAttrs.join(', ') || 'NONE'} | model: ${result.modelUsed}`);

      const attrs = result.attributes || {};
      const get = (...keys: string[]): string | null => {
        for (const key of keys) {
          const attr = attrs[key];
          if (!attr) continue;
          const v = attr.schemaValue ?? attr.rawValue;
          const s = v != null ? String(v).trim() : '';
          // Skip empty strings AND dash-only values — VLM uses "-" to mean
          // "not visible / not applicable". Storing it causes "----TOP-RINSE" style
          // article descriptions and pollutes DB fields that should stay null.
          if (s === '' || /^-+$/.test(s)) continue;
          // Snap to the per-category grid whitelist. The schema is already
          // grid-constrained (Step 2b), so any key present here is grid-governed
          // and `gridValues` holds its allowed tokens. The VLM may still return
          // a semantically-correct but off-grid token (e.g. "RINSE" instead of
          // "RINSE_WSH"); snap it back to the canonical grid value, or drop it
          // (continue to next key) if no reasonable match exists.
          const allowed = gridValues.get(key);
          if (allowed && allowed.length > 0) {
            const snapped = snapValueToGrid(s, allowed);
            if (snapped) return snapped;
            continue;
          }
          return s;
        }
        return null;
      };

      const updates: Record<string, any> = {};

      // FAB group
      const yarn1 = get('yarn_01');       if (yarn1)  updates.yarn1  = yarn1;
      const yarn2 = get('yarn_02');       if (yarn2)  updates.yarn2  = yarn2;
      const mainMvgr = get('main_mvgr'); if (mainMvgr) {
        updates.mainMvgr = mainMvgr;
        updates.mainMvgrFullForm = mvgrMappingService.getMainMvgrFullForm(mainMvgr);
      }
      const fabMain = get('fabric_main_mvgr'); if (fabMain) updates.fabricMainMvgr = fabMain;
      const weave   = get('weave');            if (weave)   updates.weave           = weave;
      const mFab2   = get('m_fab2');           if (mFab2)   {
        updates.mFab2 = mFab2;
        updates.mFab2FullForm = mvgrMappingService.getWeave2FullForm(mFab2);
      }
      const comp    = get('composition');      if (comp)    updates.composition     = comp;
      const finish  = get('finish');           if (finish)  updates.finish          = finish;
      const gsm     = get('gsm', 'gram_per_square_meter'); if (gsm) updates.gsm   = gsm;
      const shade   = get('shade');            if (shade)   updates.shade           = shade;
      const lycra   = get('lycra_non_lycra'); if (lycra)   updates.lycra           = lycra;
      const fCount  = get('f_count');          if (fCount)  updates.fCount          = fCount;
      const fConstr = get('f_construction');   if (fConstr) updates.fConstruction   = fConstr;
      const fOunce  = get('f_ounce');          if (fOunce)  updates.fOunce          = fOunce;
      const fWidth  = get('f_width');          if (fWidth)  updates.fWidth          = fWidth;

      // Weight — extract numeric only
      const weightAttr = attrs['m_fab_weight'] ?? attrs['weight'] ?? attrs['g_weight'] ?? attrs['G-Weight'];
      if (weightAttr) {
        const v = weightAttr.schemaValue ?? weightAttr.rawValue;
        if (v != null) {
          const match = String(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
          if (match) updates.weight = match[1];
        }
      }

      // BODY group
      const neck       = get('neck');                          if (neck)       updates.neck           = neck;
      const neckDet    = get('neck_details', 'neck_detail');   if (neckDet)    updates.neckDetails    = neckDet;
      const collar     = get('collar');                        if (collar)     updates.collar         = collar;
      const collarSt   = get('collar_style');                  if (collarSt)   updates.collarStyle    = collarSt;
      const placket    = get('placket');                       if (placket)    updates.placket        = placket;
      const sleeve     = get('sleeve');                        if (sleeve)     updates.sleeve         = sleeve;
      const sleeveFold = get('sleeve_fold');                   if (sleeveFold) updates.sleeveFold     = sleeveFold;
      const botFold    = get('bottom_fold');                   if (botFold)    updates.bottomFold     = botFold;
      const frontOpen  = get('front_open_style');              if (frontOpen)  updates.frontOpenStyle = frontOpen;
      const noOfPocket = get('no_of_pocket');                  if (noOfPocket) updates.noOfPocket     = noOfPocket;
      const pocketType = get('pocket_type');                   if (pocketType) updates.pocketType     = pocketType;
      const extraPkt   = get('extra_pocket');                  if (extraPkt)   updates.extraPocket    = extraPkt;
      const fit        = get('fit');                           if (fit)        updates.fit            = fit;
      const pattern    = get('pattern', 'body_style');         if (pattern)    updates.pattern        = pattern;
      const length     = get('length');                        if (length)     updates.length         = length;
      const colour     = get('colour', 'color');               if (colour)     updates.colour         = colour;
      const fatBelt    = get('father_belt');                   if (fatBelt)    updates.fatherBelt     = fatBelt;
      const childBelt  = get('child_belt');                    if (childBelt)  updates.childBelt      = childBelt;
      const ageGroup   = get('age_group');                     if (ageGroup)   updates.ageGroup       = ageGroup;

      // VA ACC group
      const drawcord  = get('drawcord');                       if (drawcord)  updates.drawcord   = drawcord;
      const dcShape   = get('dc_shape');                       if (dcShape)   updates.dcShape    = dcShape;
      const button    = get('button');                         if (button)    updates.button     = button;
      const btnColour = get('btn_colour');                     if (btnColour) updates.btnColour  = btnColour;
      const zipper    = get('zipper');                         if (zipper)    updates.zipper     = zipper;
      const zipColour = get('zip_colour');                     if (zipColour) updates.zipColour  = zipColour;
      const patches   = get('patches');                        if (patches)   updates.patches    = patches;
      const patchType = get('patches_type', 'patch_type');     if (patchType) updates.patchesType = patchType;
      const htrfType  = get('htrf_type');                      if (htrfType)  updates.htrfType   = htrfType;
      const htrfStyle = get('htrf_style');                     if (htrfStyle) updates.htrfStyle  = htrfStyle;

      // PRINTING group
      const printType  = get('print_type');                    if (printType)  updates.printType  = printType;
      const printStyle = get('print_style');                   if (printStyle) updates.printStyle = printStyle;
      const printPlace = get('print_placement');               if (printPlace) updates.printPlacement = printPlace;
      const emb        = get('embroidery');                    if (emb)        updates.embroidery = emb;
      const embType    = get('embroidery_type');               if (embType)    updates.embroideryType = embType;
      const embPlace   = get('emb_placement');                 if (embPlace)   updates.embPlacement   = embPlace;
      const wash       = get('wash');                          if (wash)       updates.wash       = wash;

      // Misc
      const fashionGrid   = get('fashion_grid', 'fashiongrid');                   if (fashionGrid)   updates.fashionGrid        = fashionGrid;
      const articleType   = get('article_type', 'articletype');                   if (articleType)   updates.articleType        = articleType;
      const artFashType   = get('article_fashion_type', 'fashion_grade');         if (artFashType)   updates.articleFashionType = artFashType;

      // Mark as VLM-enriched
      updates.extractionStatus = 'COMPLETED';
      updates.aiModel = result.modelUsed ? String(result.modelUsed) : 'google-gemini';
      if (result.confidence != null) updates.avgConfidence = result.confidence;
      if (result.inputTokens)  updates.inputTokens = result.inputTokens;
      if (result.outputTokens) updates.outputTokens = result.outputTokens;
      if (result.apiCost)      updates.apiCost = result.apiCost;
      const rawAllAttrs = await vlmService.extractAllFashionAttributes(base64Image);
      if (rawAllAttrs) updates.imageExtractionRawData = rawAllAttrs;

      if (Object.keys(updates).length <= 3) {
        // VLM returned 0 usable attributes — retry if attempts remain
        if (attempt < VLM_MAX_ATTEMPTS) {
          const delay = attempt * VLM_RETRY_BACKOFF_MS;
          console.warn(`[SRM VLM]${attemptTag} ⚠️ 0 usable attributes for ${flatId} — retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.warn(`[SRM VLM] ❌ All ${VLM_MAX_ATTEMPTS} attempts returned 0 usable attributes for ${flatId}. Non-null from VLM: [${nonNullAttrs.join(', ')}]`);
        return false;
      }

      // ── Save to DB ─────────────────────────────────────────────────────────
      const updatedRow = await prisma.extractionResultFlat.update({ where: { id: flatId }, data: updates });

      // Rebuild article description with the newly populated fields
      if (updatedRow) {
        const artDesc = buildArticleDescription(updatedRow as any, 40, {
          excludeFields: await getExcludedDescriptionFields((updatedRow as any).majorCategory) as any,
        });
        if (artDesc) {
          await prisma.extractionResultFlat.update({
            where: { id: flatId },
            data: { articleDescription: artDesc }
          });
          updates.articleDescription = artDesc;
        }
      }

      void mirror360FlatUpdate(flatId, updates);
      console.log(`[SRM VLM]${attemptTag} ✅ Enriched ${flatId} — ${Object.keys(updates).length} fields saved`);
      return true;

    } catch (err: any) {
      if (attempt < VLM_MAX_ATTEMPTS) {
        const delay = attempt * VLM_RETRY_BACKOFF_MS;
        console.warn(`[SRM VLM]${attemptTag} ⚠️ VLM exception for ${flatId} — retrying in ${delay / 1000}s: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.error(`[SRM VLM] ❌ All ${VLM_MAX_ATTEMPTS} attempts failed for ${flatId}: ${err.message}`);
      console.error(`[SRM VLM] Stack:`, err.stack);
      return false;
    }
  }

  // Unreachable but satisfies TypeScript
  return false;
}

/**
 * Insert one SRM row into the database. Returns the created flat record.
 */
async function insertRowAndReturn(row: SrmRow): Promise<{ id: string; imageUrl: string | null } | null> {
  return insertRow(row);
}

/**
 * Public export — used by rawArticleExtractionService to create a flat record
 * from a raw_articles row without going through the full SRM sync flow.
 * Pass rawArticleId to populate srm_unique_id on the flat record.
 */
export async function insertRawArticleAsFlat(row: SrmRow, rawArticleId?: string): Promise<{ id: string; imageUrl: string | null } | null> {
  return insertRow(row, rawArticleId);
}

/** Exported type so rawArticleExtractionService can build SrmRow objects */
export type { SrmRow };

async function insertRow(row: SrmRow, rawArticleId?: string): Promise<{ id: string; imageUrl: string | null } | null> {
  const categoryId = await resolveCategoryId(row.major_category, row.division);

  // Create ExtractionJob (required by FK; no AI used — just a shell record)
  const srmImageUrl = row.image_url || null;

  const job = await prisma.extractionJob.create({
    data: {
      categoryId,
      imageUrl: srmImageUrl || '',
      status:   'COMPLETED',
      aiModel:  null,
      designNumber: row.design_number || null,
    },
  });

  // Compute derived fields
  const now = new Date();
  const month = now.getMonth() + 1;
  const yearShort = String(now.getFullYear()).slice(-2);
  let season = `W${yearShort}`;
  if      (month >= 1 && month <= 3) season = `SP${yearShort}`;
  else if (month >= 4 && month <= 6) season = `S${yearShort}`;
  else if (month >= 7 && month <= 9) season = `A${yearShort}`;

  const mcCode     = getMcCodeByMajorCategory(row.major_category) || null;
  const hsnTaxCode = mcCode ? (getHsnCodeByMcCode(mcCode) || null) : null;
  const rate       = row.price > 0 ? row.price : null;
  const segment    = getSegmentByCategoryAndMrp(row.major_category, rate ? rate as any : null) || null;

  // no_of_colors is intentionally NOT mapped into impAtrbt2 — leave it null
  // (impAtrbt2 / IMP ATBT is filled manually by the approver later).
  const impAtrbt2: string | null = null;

  // Create ExtractionResultFlat directly — no flattening from AI results needed
  const flat = await prisma.extractionResultFlat.create({
    data: {
      jobId:          job.id,
      source:         'SRM',
      extractionStatus: 'SRM_IMPORT',
      imageName:      null,
      imageUrl:       srmImageUrl,
      isGeneric:      true,   // SRM records are standalone articles, not variants

      // SRM-provided fields
      pptNumber:                row.presentation_no || null,
      designNumber:             row.design_number   || null,
      // Immutable dedup key — NEVER updated even if user changes designNumber later
      srmOriginalDesignNumber:  row.design_number   || null,
      // FK back to raw_articles.id (only set when called from rawArticleExtractionService)
      srmUniqueId:              rawArticleId        || null,
      vendorCode:     normaliseVendorCode(row.vendor_code),
      vendorName:     row.vendor_name     || null,
      division:       row.division        || null,
      subDivision:    row.sub_division    || null,
      majorCategory:  row.major_category  || null,
      macroMvgr:      row.fabric          || null,   // Best available fabric field
      rate:           rate as any,
      impAtrbt2:      impAtrbt2,

      // Derived fields
      year:              String(now.getFullYear()),
      season,
      mcCode:            mcCode || null,
      hsnTaxCode,
      segment,
      extractionDate:    now,
      presentationsType: row.presentations_type || null,
    },
  });

  // Build article description from available fields
  try {
    const artDesc = buildArticleDescription(flat as any, 40, {
      excludeFields: await getExcludedDescriptionFields((flat as any).majorCategory) as any,
    });
    if (artDesc) {
      await prisma.extractionResultFlat.update({
        where: { id: flat.id },
        data: { articleDescription: artDesc },
      });
      void mirror360FlatUpdate(flat.id, { articleDescription: artDesc });
    }
  } catch {
    // Non-critical
  }

  // Mirror to 360article schema
  void mirror360FlatUpdate(flat.id, {
    source: 'SRM', extractionStatus: 'SRM_IMPORT',
    pptNumber: flat.pptNumber, designNumber: flat.designNumber,
    vendorCode: flat.vendorCode, vendorName: flat.vendorName, division: flat.division,
    subDivision: flat.subDivision, majorCategory: flat.majorCategory,
    macroMvgr: flat.macroMvgr, rate: flat.rate,
    year: flat.year, season: flat.season, mcCode: flat.mcCode,
    hsnTaxCode: flat.hsnTaxCode, segment: flat.segment,
  });

  // NOTE: Do NOT call duplicateForKidsDivision for SRM records.
  // SRM provides the exact major category from the vendor — we must trust it as-is.
  // Duplication would create spurious sibling records (e.g. YBW_... alongside JBW_...).
  // Variant creation is also skipped for the same reason.

  // Mirror SRM image to R2 immediately so VLM enrichment gets a permanent, auth-free URL.
  // SRM image URLs are private Supabase storage or short-lived signed URLs — they expire
  // and cannot be fetched by the VLM provider without credentials.
  let finalImageUrl = flat.imageUrl;
  if (srmImageUrl) {
    const r2Url = await downloadAndMirrorToR2(srmImageUrl);
    if (r2Url) {
      finalImageUrl = r2Url;
      await prisma.extractionResultFlat.update({
        where: { id: flat.id },
        data: { imageUrl: r2Url },
      });
      void mirror360FlatUpdate(flat.id, { imageUrl: r2Url });
    }
  }

  return { id: flat.id, imageUrl: finalImageUrl };
}

/**
 * Main sync function. Call this from the route handler or cron job.
 *
 * Every execution writes a persistent audit trail to:
 *   srm_sync_runs       — one row per execution (counts + timing)
 *   srm_sync_run_items  — one row per article (action + flat_id link)
 *
 * Deduplication uses `srmOriginalDesignNumber` (immutable) NOT `designNumber`
 * (user-editable). This prevents false "new article" detections when an approver
 * renames a design number after import.
 */
export async function syncFromSrm(triggeredBy: 'CRON' | 'ADMIN' | 'WEBHOOK' = 'CRON'): Promise<SyncResult> {
  console.log(`[SRM Sync] Starting sync (triggeredBy=${triggeredBy})...`);
  const startedAt = new Date();
  const result: SyncResult = { inserted: 0, skipped: 0, errors: 0, total: 0, staged: 0 };

  // ── Create persistent run record ──────────────────────────────────────────
  const run = await prisma.srmSyncRun.create({
    data: { triggeredBy, startedAt },
  });
  console.log(`[SRM Sync] Run ID: ${run.id}`);

  // Buffer item logs — batch-insert at the end to avoid per-row DB round-trips
  const itemLogs: Array<{
    runId: string;
    pptNumber: string | null;
    srmDesignNumber: string | null;
    flatId: string | null;
    action: string;
    errorMessage: string | null;
  }> = [];

  let rows: SrmRow[];
  try {
    rows = await fetchAllRows();
  } catch (err: any) {
    console.error('[SRM Sync] Failed to fetch from SRM API:', err.message);
    await prisma.srmSyncRun.update({
      where: { id: run.id },
      data: { completedAt: new Date(), notes: `Fetch failed: ${err.message}` },
    });
    throw err;
  }

  result.total = rows.length;
  console.log(`[SRM Sync] Fetched ${rows.length} records from SRM API`);

  for (const row of rows) {
    try {
      // ── Skip presentations on or before the cutoff ────────────────────────
      // Old presentations (≤ 26 May 2026) are synced manually via Admin "By PPT Number".
      // The cron only handles new presentations that arrived after the cutoff.
      const receivedDate = row.presentation_received_date
        ? new Date(row.presentation_received_date) : null;

      if (!receivedDate || receivedDate <= RAW_PIPELINE_CUTOFF) {
        result.skipped++;
        itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: null, action: 'SKIPPED', errorMessage: null });
        continue;
      }

      // ── New presentation (after 26 May 2026): stage to raw_articles ──────
      // Check if a flat record already exists (created by a previous extraction run)
      const existing = await findExisting(row.presentation_no, row.design_number);

      if (existing) {
        // Flat record already exists — patch any missing fields only.
        // Do NOT trigger VLM here — raw_articles extraction cron owns that.
        const patch: Record<string, any> = {};
        if (row.image_url && !existing.imageUrl) patch.imageUrl = row.image_url;
        const normCode = normaliseVendorCode(row.vendor_code);
        if (normCode && existing.vendorCode !== normCode) patch.vendorCode = normCode;
        if (row.vendor_name && !existing.vendorName) patch.vendorName = row.vendor_name;

        if (Object.keys(patch).length > 0) {
          if (patch.imageUrl) {
            const r2Url = await downloadAndMirrorToR2(patch.imageUrl);
            if (r2Url) patch.imageUrl = r2Url;
          }
          await prisma.extractionResultFlat.update({ where: { id: existing.id }, data: patch });
          void mirror360FlatUpdate(existing.id, patch);
          console.log(`[SRM Sync] Patched [${Object.keys(patch).join(', ')}] for: ${row.presentation_no} / ${row.design_number}`);
          result.inserted++;
          itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: existing.id, action: 'PATCHED', errorMessage: null });
        } else {
          result.skipped++;
          itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: existing.id, action: 'SKIPPED', errorMessage: null });
        }
      } else {
        // No flat record — stage to raw_articles (PENDING), 10-min cron handles VLM
        const staged = await upsertRawArticleFromSrm(row, 'CRON_SYNC');
        if (staged === 'inserted') {
          result.staged++;
          console.log(`[SRM Sync] Staged to raw_articles: ${row.presentation_no} / ${row.design_number}`);
          itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: null, action: 'STAGED', errorMessage: null });
        } else {
          result.skipped++;
          itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: null, action: 'SKIPPED', errorMessage: null });
        }
      }

    } catch (err: any) {
      result.errors++;
      console.error(`[SRM Sync] Error for ${row.presentation_no}/${row.design_number}:`, err.message);
      itemLogs.push({ runId: run.id, pptNumber: row.presentation_no, srmDesignNumber: row.design_number, flatId: null, action: 'ERROR', errorMessage: err.message?.slice(0, 500) ?? null });
    }
  }

  // ── Batch-insert all item logs ────────────────────────────────────────────
  if (itemLogs.length > 0) {
    await prisma.srmSyncRunItem.createMany({ data: itemLogs });
  }

  // ── Mark run as complete ──────────────────────────────────────────────────
  const patched = itemLogs.filter(l => l.action === 'PATCHED').length;
  await prisma.srmSyncRun.update({
    where: { id: run.id },
    data: {
      completedAt: new Date(),
      total:    result.total,
      inserted: result.inserted - patched,  // true new inserts only
      skipped:  result.skipped,
      patched,
      errors:   result.errors,
    },
  });

  console.log(`[SRM Sync] Done — inserted: ${result.inserted - patched}, patched: ${patched}, staged: ${result.staged}, skipped: ${result.skipped}, errors: ${result.errors} | Run: ${run.id}`);

  // Cache the in-memory result for the status endpoint
  _lastSyncResult = { ...result, completedAt: new Date().toISOString(), ranAt: startedAt.toISOString() };

  // VLM enrichment is now handled entirely by the raw_articles extraction cron (every 10 min).
  // The 12PM/8PM sync cron only stages rows to raw_articles — no direct VLM calls here.

  return result;
}

/**
 * Startup recovery enrichment — runs once when the server boots.
 *
 * Finds SRM records that were inserted within the last 48 hours but still have
 * extractionStatus = 'SRM_IMPORT' (meaning the fire-and-forget VLM background
 * task was killed before it finished, most likely due to a server restart).
 *
 * Scoped to the last 48 h only — genuinely old records are NEVER touched.
 * Runs entirely in the background; startup is not blocked.
 */
export async function recoverRecentSrmVlmEnrichment(): Promise<void> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  // Use the later of: 48h ago OR the hard cutoff date — whichever is more recent.
  // This ensures legacy records (before 2026-05-25) are NEVER touched even if the
  // server restarts close to that date.
  const cutoff = fortyEightHoursAgo > SRM_ENRICHMENT_CUTOFF
    ? fortyEightHoursAgo
    : SRM_ENRICHMENT_CUTOFF;

  const records = await prisma.extractionResultFlat.findMany({
    where: {
      source: 'SRM',
      extractionStatus: 'SRM_IMPORT',
      imageUrl: { not: null },
      createdAt: { gte: cutoff },
    },
    select: { id: true, imageUrl: true, majorCategory: true, pptNumber: true,
              srmOriginalDesignNumber: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (records.length === 0) {
    console.log('[SRM Recovery] No recent SRM_IMPORT records in last 48h — nothing to recover');
    return;
  }

  console.log(`[SRM Recovery] Found ${records.length} recent record(s) still at SRM_IMPORT — starting background recovery`);

  // Run entirely in the background — does not block server startup
  void (async () => {
    let enriched = 0;
    let failed = 0;
    let requeued = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec.imageUrl) continue;

      try {
        // ── New pipeline records (after cutoff): re-queue via raw_articles ──
        // If a server restart killed the extraction worker mid-run, the flat record
        // stays at SRM_IMPORT. Rather than running VLM directly here, we ensure a
        // raw_articles PENDING row exists so the 10-min extraction cron picks it up.
        if (rec.createdAt > RAW_PIPELINE_CUTOFF) {
          const existingRaw = await prisma.rawArticle.findFirst({
            where: { flatId: rec.id },
            select: { id: true, status: true },
          });

          if (existingRaw) {
            // raw_articles row exists — extraction cron will handle it
            console.log(`[SRM Recovery] Skipping flat ${rec.id} — already in raw_articles (status: ${existingRaw.status})`);
            requeued++;
          } else {
            // No raw_articles row — create one so the cron picks it up
            const uniqueKey = `${rec.pptNumber ?? ''}::${rec.srmOriginalDesignNumber ?? ''}::${rec.imageUrl}`;
            await prisma.rawArticle.upsert({
              where:  { uniqueKey },
              update: {},   // already exists, leave it
              create: {
                presentationNo: rec.pptNumber ?? '',
                designNumber:   rec.srmOriginalDesignNumber ?? null,
                imageUrl:       rec.imageUrl,
                uniqueKey,
                source:         'CRON_SYNC',
                flatId:         rec.id,
                status:         'PENDING',
              },
            });
            console.log(`[SRM Recovery] Re-queued flat ${rec.id} → new raw_articles PENDING row`);
            requeued++;
          }
          continue;
        }

        // ── Old pipeline records (before cutoff): run VLM directly ──────────
        const success = await enrichSrmRowWithVlm(rec.id, rec.imageUrl, rec.majorCategory);
        if (success) enriched++; else failed++;
      } catch {
        failed++;
      }

      if (i < records.length - 1) {
        await new Promise(r => setTimeout(r, VLM_ENRICH_DELAY_MS));
      }
    }
    console.log(`[SRM Recovery] Complete — enriched: ${enriched}, requeued: ${requeued}, failed: ${failed} (of ${records.length})`);
  })();
}

// Hard cutoff: never auto-enrich SRM_IMPORT records created before this date.
// Records before this date are legacy imports whose data must not be overwritten.
const SRM_ENRICHMENT_CUTOFF = new Date('2026-05-25T00:00:00.000Z');

/**
 * Backfill VLM enrichment for SRM records that have an imageUrl
 * but are still at SRM_IMPORT status.
 *
 * IMPORTANT: Only processes records created ON OR AFTER 2026-05-25.
 * Records before that date are legacy imports — their data must not be
 * overwritten by re-running enrichment, even if their status is SRM_IMPORT.
 *
 * Runs sequentially to avoid rate limits.
 * Exported for the admin panel manual trigger.
 */
export async function backfillSrmVlmEnrichment(): Promise<EnrichResult> {
  const records = await prisma.extractionResultFlat.findMany({
    where: {
      source: 'SRM',
      extractionStatus: 'SRM_IMPORT',
      imageUrl: { not: null },
      createdAt: { gte: SRM_ENRICHMENT_CUTOFF },   // ← only new records
    },
    select: { id: true, imageUrl: true, majorCategory: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: EnrichResult = { processed: records.length, enriched: 0, failed: 0 };
  console.log(`[SRM Enrich Backfill] Starting — ${records.length} records to process`);

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec.imageUrl) continue;

    // If the stored URL is still an SRM Supabase URL (not yet mirrored to R2),
    // re-download and mirror it now so VLM gets a permanent accessible URL.
    let imageUrl = rec.imageUrl;
    if (imageUrl.includes('supabase.co/storage')) {
      const r2Url = await downloadAndMirrorToR2(imageUrl);
      if (r2Url) {
        imageUrl = r2Url;
        await prisma.extractionResultFlat.update({
          where: { id: rec.id },
          data: { imageUrl: r2Url },
        });
        void mirror360FlatUpdate(rec.id, { imageUrl: r2Url });
        console.log(`[SRM Enrich Backfill] Re-mirrored SRM image to R2 for ${rec.id}`);
      } else {
        console.warn(`[SRM Enrich Backfill] Could not re-mirror image for ${rec.id} — skipping VLM`);
        result.failed++;
        continue;
      }
    }

    try {
      const success = await enrichSrmRowWithVlm(rec.id, imageUrl, rec.majorCategory);
      if (success) {
        result.enriched++;
      } else {
        result.failed++;
      }
    } catch {
      result.failed++;
    }
    if (i < records.length - 1) {
      await new Promise(r => setTimeout(r, VLM_ENRICH_DELAY_MS));
    }
  }

  console.log(`[SRM Enrich Backfill] Done — enriched: ${result.enriched}, failed/no-change: ${result.failed}`);
  return result;
}

// ─── Single Presentation Fetch ─────────────────────────────────────────────

const SRM_BY_REF_API = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/srm-presentation-by-ref';

interface SrmByRefImage {
  id: string;
  design_number: string;
  fabric: string;
  no_of_colors: number;
  price: number;
  quantity: number | null;
  available_date: string | null;
  image_url: string | null;
  cost_sheet_url: string | null;
  notes: string | null;
  uploaded_at: string;
  latest_decision: string | null;
}

interface SrmByRefResponse {
  presentation: {
    id: string;
    ref_no: string;
    status: string;
    vendor_code: string;
    vendor_name: string;
    division: string;
    sub_division: string;
    major_category: string;
    category_head_decision: string | null;
    subdivision_head_decision: string | null;
    received_at: string | null;
    approved_at: string | null;
    created_at: string;
  };
  images: SrmByRefImage[];
  image_count: number;
}

export interface SinglePptSyncResult {
  refNo: string;
  imageCount: number;
  inserted: number;
  skipped: number;
  errors: number;
  vlmQueued: number;
}

/**
 * Fetch a single SRM presentation by ref_no (PPT number) and insert/patch
 * its images into extraction_results_flat — same logic as bulk sync but
 * for one presentation only. VLM enrichment runs in background.
 */
export async function syncSinglePresentation(
  refNo: string,
  approvedOnly = false,
): Promise<SinglePptSyncResult> {
  console.log(`[SRM Single] Fetching presentation: ${refNo}`);

  const url = new URL(SRM_BY_REF_API);
  url.searchParams.set('ref_no', refNo);
  if (approvedOnly) url.searchParams.set('approved_only', 'true');

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': SRM_SUPABASE_KEY,
      'Authorization': `Bearer ${SRM_SUPABASE_KEY}`,
      'x-api-key': SRM_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SRM API error: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }

  const json = await res.json() as SrmByRefResponse;
  const { presentation, images } = json;

  const result: SinglePptSyncResult = {
    refNo,
    imageCount: images.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
    vlmQueued: 0,
  };

  const toEnrich: Array<{ id: string; imageUrl: string; majorCategory: string | null }> = [];

  for (const img of images) {
    try {
      // Build an SrmRow compatible with insertRow()
      const row: SrmRow = {
        presentation_no: presentation.ref_no,
        vendor_code:     presentation.vendor_code,
        vendor_name:     presentation.vendor_name || null,
        division:        presentation.division,
        sub_division:    presentation.sub_division,
        major_category:  presentation.major_category,
        presentation_received_date: presentation.received_at || presentation.created_at,
        design_number:   img.design_number || img.id,
        fabric:          img.fabric || '',
        no_of_colors:    img.no_of_colors ?? 0,
        price:           img.price ?? 0,
        image_url:       img.image_url || null,
      };

      const existing = await findExisting(row.presentation_no, row.design_number);
      if (existing) {
        if (row.image_url && !existing.imageUrl) {
          // Mirror to R2 first so the stored URL is permanent
          const r2Url = await downloadAndMirrorToR2(row.image_url);
          const finalUrl = r2Url || row.image_url;
          await prisma.extractionResultFlat.update({
            where: { id: existing.id },
            data: { imageUrl: finalUrl },
          });
          void mirror360FlatUpdate(existing.id, { imageUrl: finalUrl });
          toEnrich.push({ id: existing.id, imageUrl: finalUrl, majorCategory: presentation.major_category });
          result.inserted++;
        } else {
          result.skipped++;
        }
        continue;
      }

      const flat = await insertRow(row);
      result.inserted++;
      console.log(`[SRM Single] Inserted: ${row.presentation_no} / ${row.design_number}`);
      if (flat?.imageUrl) {
        toEnrich.push({ id: flat.id, imageUrl: flat.imageUrl, majorCategory: presentation.major_category });
      }
    } catch (err: any) {
      result.errors++;
      console.error(`[SRM Single] Error for image ${img.id}:`, err.message);
    }
  }

  result.vlmQueued = toEnrich.length;
  console.log(`[SRM Single] Done — inserted:${result.inserted} skipped:${result.skipped} errors:${result.errors} vlmQueued:${result.vlmQueued}`);

  // VLM enrichment in background
  if (toEnrich.length > 0) {
    void (async () => {
      for (let i = 0; i < toEnrich.length; i++) {
        await enrichSrmRowWithVlm(toEnrich[i].id, toEnrich[i].imageUrl, toEnrich[i].majorCategory);
        if (i < toEnrich.length - 1) await new Promise(r => setTimeout(r, VLM_ENRICH_DELAY_MS));
      }
      console.log(`[SRM Single] VLM enrichment complete for ${refNo} — ${toEnrich.length} images`);
    })();
  }

  return result;
}

// ─── SRM Webhook Batch Processing ─────────────────────────────────────────

/**
 * One image entry as sent by the SRM web app in the webhook request body.
 */
export interface SrmWebhookImage {
  design_number: string;
  image_url?: string | null;
  price?: number;
  fabric?: string;
  no_of_colors?: number;
}

/**
 * Full request body shape expected from the SRM web app.
 */
export interface SrmWebhookBatchRequest {
  presentation_no: string;
  vendor_code: string;
  vendor_name?: string | null;
  division: string;
  sub_division?: string | null;
  major_category: string;
  presentation_received_date?: string | null;
  images: SrmWebhookImage[];
}

/**
 * Progress update emitted after each image is processed.
 * The controller uses this to update the in-memory job store.
 */
export interface SrmWebhookProgress {
  designNumber: string;
  id?: string;
  success: boolean;
  extractionStatus?: string;
  articleDescription?: string;
  error?: string;
}

export type SrmWebhookProgressCallback = (progress: SrmWebhookProgress) => void;

/**
 * Process a batch of SRM images received via the webhook endpoint.
 *
 * Runs SEQUENTIALLY (one image at a time) to respect Gemini rate limits.
 * Calls onProgress after each image so the caller can update job state.
 *
 * This function is designed to be called inside a fire-and-forget wrapper —
 * the HTTP response (202) must already have been sent before calling this.
 *
 * Does NOT touch cron-job logic or manual-trigger logic — purely additive.
 */
export async function processSrmWebhookBatch(
  req: SrmWebhookBatchRequest,
  onProgress: SrmWebhookProgressCallback,
): Promise<void> {
  console.log(`[SRM Hook] Batch started — presentation: ${req.presentation_no} | images: ${req.images.length}`);

  // ── Audit trail ───────────────────────────────────────────────────────────
  // The webhook is otherwise invisible (it's excluded from audit_logs), which is
  // why the 8-June duplication was hard to trace. Record a persistent run +
  // per-image item rows in the SAME tables the cron sync uses (srm_sync_runs /
  // srm_sync_run_items), with triggeredBy='WEBHOOK'. All logging is best-effort:
  // a logging failure must never break extraction.
  let runId: string | null = null;
  try {
    const run = await prisma.srmSyncRun.create({
      data: {
        triggeredBy: 'WEBHOOK',
        total:       req.images.length,
        notes:       `webhook batch — presentation: ${req.presentation_no} | images: ${req.images.length}`,
      },
    });
    runId = run.id;
    console.log(`[SRM Hook] Run ID: ${runId}`);
  } catch (e: any) {
    console.error('[SRM Hook] Failed to create sync-run record (continuing):', e?.message);
  }

  const itemLogs: Array<{ runId: string; pptNumber: string | null; srmDesignNumber: string | null; flatId: string | null; action: string; errorMessage: string | null }> = [];
  const counts = { inserted: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < req.images.length; i++) {
    const img = req.images[i];
    const designNumber = (img.design_number || `img-${i + 1}`).trim();
    let action = 'SKIPPED';
    let itemFlatId: string | null = null;
    let itemError: string | null = null;

    try {
      // Build SrmRow compatible with insertRow()
      const row: SrmRow = {
        presentation_no:            req.presentation_no,
        vendor_code:                req.vendor_code,
        vendor_name:                req.vendor_name  || null,
        division:                   req.division,
        sub_division:               req.sub_division || '',
        major_category:             req.major_category,
        presentation_received_date: req.presentation_received_date || new Date().toISOString(),
        design_number:              designNumber,
        fabric:                     img.fabric       || '',
        no_of_colors:               img.no_of_colors ?? 0,
        price:                      img.price        ?? 0,
        image_url:                  img.image_url    || null,
      };

      // ── 1. Insert or locate existing DB record ──────────────────────────
      const existing = await findExisting(req.presentation_no, designNumber);
      let flatId: string;
      let imageUrl: string | null;

      if (existing) {
        flatId   = existing.id;
        imageUrl = existing.imageUrl;
        action   = 'SKIPPED';

        // If this call now provides an image URL we didn't have before — mirror it
        if (img.image_url && !existing.imageUrl) {
          const r2Url = await downloadAndMirrorToR2(img.image_url);
          if (r2Url) {
            imageUrl = r2Url;
            await prisma.extractionResultFlat.update({ where: { id: flatId }, data: { imageUrl: r2Url } });
            void mirror360FlatUpdate(flatId, { imageUrl: r2Url });
            action = 'PATCHED';
          }
        }
        console.log(`[SRM Hook] Existing record for ${designNumber} — id: ${flatId} (dedup matched — no duplicate created)`);
      } else {
        const flat = await insertRow(row);
        if (!flat) throw new Error('insertRow returned null');
        flatId   = flat.id;
        imageUrl = flat.imageUrl;
        action   = 'INSERTED';
        console.log(`[SRM Hook] Inserted new record for ${designNumber} — id: ${flatId}`);
      }
      itemFlatId = flatId;

      // ── 2. VLM Extraction ────────────────────────────────────────────────
      if (!imageUrl) {
        console.warn(`[SRM Hook] No image URL for ${designNumber} — skipping VLM`);
        onProgress({ designNumber, id: flatId, success: false, extractionStatus: 'SRM_IMPORT', error: 'No image URL' });
      } else {
        const success = await enrichSrmRowWithVlm(flatId, imageUrl, req.major_category);

        // ── 3. Fetch final DB state for the progress report ──────────────────
        const final = await prisma.extractionResultFlat.findUnique({
          where:  { id: flatId },
          select: { extractionStatus: true, articleDescription: true },
        });

        onProgress({
          designNumber,
          id:                 flatId,
          success,
          extractionStatus:   final?.extractionStatus   ?? (success ? 'COMPLETED' : 'SRM_IMPORT'),
          articleDescription: final?.articleDescription  ?? undefined,
        });
      }

      if (action === 'INSERTED') counts.inserted++; else counts.skipped++;

    } catch (err: any) {
      action = 'ERROR';
      itemError = err?.message ? String(err.message).slice(0, 500) : 'Unknown error';
      counts.errors++;
      console.error(`[SRM Hook] Error for ${designNumber}:`, err.message);
      onProgress({ designNumber, success: false, error: err.message });
    }

    if (runId) {
      itemLogs.push({ runId, pptNumber: req.presentation_no, srmDesignNumber: designNumber, flatId: itemFlatId, action, errorMessage: itemError });
    }

    // Rate-limit gap between consecutive Gemini calls (skip after last image)
    if (i < req.images.length - 1) {
      await new Promise(r => setTimeout(r, VLM_ENRICH_DELAY_MS));
    }
  }

  // ── Finalize the audit record (best-effort) ─────────────────────────────────
  if (runId) {
    try {
      if (itemLogs.length > 0) {
        await prisma.srmSyncRunItem.createMany({ data: itemLogs });
      }
      await prisma.srmSyncRun.update({
        where: { id: runId },
        data: {
          completedAt: new Date(),
          inserted:    counts.inserted,
          skipped:     counts.skipped,
          errors:      counts.errors,
        },
      });
    } catch (e: any) {
      console.error('[SRM Hook] Failed to finalize sync-run record:', e?.message);
    }
  }

  console.log(`[SRM Hook] Batch complete — presentation: ${req.presentation_no} | inserted:${counts.inserted} skipped:${counts.skipped} errors:${counts.errors}`);
}

// ─── Retry: Re-run VLM on already-inserted records ─────────────────────────

/**
 * A record that needs VLM re-extraction.
 * The DB row already exists — we only need its id, imageUrl, and majorCategory.
 */
export interface SrmRetryRecord {
  id: string;
  designNumber: string;
  imageUrl: string;
  majorCategory: string | null;
}

/**
 * Re-run VLM extraction on a list of already-inserted records.
 *
 * Used by both retry endpoints:
 *   - retry/:jobId          → retries failed images from a previous job
 *   - retry-presentation    → retries all SRM_IMPORT images for a presentation_no
 *
 * Runs sequentially (same rate-limit gap as the main batch).
 * Calls onProgress after each image — same shape as processSrmWebhookBatch.
 */
export async function retrySrmVlmForRecords(
  records: SrmRetryRecord[],
  onProgress: SrmWebhookProgressCallback,
): Promise<void> {
  console.log(`[SRM Retry] Starting — ${records.length} record(s) to re-extract`);

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    try {
      const success = await enrichSrmRowWithVlm(rec.id, rec.imageUrl, rec.majorCategory);

      const final = await prisma.extractionResultFlat.findUnique({
        where:  { id: rec.id },
        select: { extractionStatus: true, articleDescription: true },
      });

      onProgress({
        designNumber:       rec.designNumber,
        id:                 rec.id,
        success,
        extractionStatus:   final?.extractionStatus   ?? (success ? 'COMPLETED' : 'SRM_IMPORT'),
        articleDescription: final?.articleDescription  ?? undefined,
      });
    } catch (err: any) {
      console.error(`[SRM Retry] Error for ${rec.designNumber}:`, err.message);
      onProgress({ designNumber: rec.designNumber, id: rec.id, success: false, error: err.message });
    }

    if (i < records.length - 1) {
      await new Promise(r => setTimeout(r, VLM_ENRICH_DELAY_MS));
    }
  }

  console.log(`[SRM Retry] Complete — ${records.length} record(s) processed`);
}
