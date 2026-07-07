/**
 * zmmArtCreationService.ts
 *
 * New SAP RFC integration for Generic Article Creation.
 * Calls ZMM_ART_CREATION_RFC with a JSON body (not form-urlencoded).
 * Maps extractionResultFlat fields → RFC IM_DATA field names.
 *
 * Does NOT modify sapSyncService.ts (old integration preserved as-is).
 */

import { SapSyncItemResult } from './sapSyncService';
import { mapWithConcurrency } from '../utils/concurrency';
import { getMcCodeByMajorCategory, getHsnCodeByMcCode } from '../utils/mcCodeMapper';
import { PrismaClient } from '../generated/prisma';
import { FLAT_TO_RFC } from '../data/flatToRfcMap';

const prisma = new PrismaClient();

// Division-scoped cache: 'MENS' | 'LADIES' | 'KIDS' → { dbField → string[] }
const _dbValuesCache = new Map<string, Record<string, string[]>>();

// ─── Mandatory Grid cache (loaded once from DB per process lifetime) ──────────
// configured: all major categories that have ANY row in maj_cat_mandatory_grid
// active:     majorCategory → Set<rfcSapKey> that are is_active=true
type MandatoryGridCache = {
    configured: Set<string>;
    active: Map<string, Set<string>>;
};
let _mandatoryGridCache: MandatoryGridCache | null = null;

// The mandatory-grid Excel template uses some human-readable column names in Row 3
// that differ from the RFC parameter names used in FLAT_TO_RFC.
// This map normalises grid SAP keys → RFC keys so the filter works correctly.
const GRID_KEY_TO_RFC: Record<string, string> = {
    'AGE GROUP':           'M_AGE_GROUP',
    'SEGMENT':             'PRICE_BAND_CATEGORY',
    'COST':                'PURCH_PRICE',
    'ARTICLE FASHION TYPE':'FASHION_GRADE',
    'ARTICLE WEIGHT':      'G_WEIGHT',
    'BODY STYLE':          'M_BODY_STYLE', // Excel uses "BODY STYLE", RFC uses "M_BODY_STYLE"
    // M_* keys already match FLAT_TO_RFC exactly — no entry needed
};

async function loadMandatoryGridForRfc(): Promise<MandatoryGridCache> {
    if (_mandatoryGridCache) return _mandatoryGridCache;

    const rows = await prisma.$queryRaw<
        { major_category: string; sap_key: string; is_active: boolean }[]
    >`SELECT major_category, sap_key, is_active FROM maj_cat_mandatory_grid`;

    const configured = new Set<string>();
    const active = new Map<string, Set<string>>();

    for (const row of rows) {
        configured.add(row.major_category);
        if (row.is_active) {
            // Normalise grid key → RFC key (handles display-name mismatches)
            const rfcKey = GRID_KEY_TO_RFC[row.sap_key] ?? row.sap_key;
            if (!active.has(row.major_category)) active.set(row.major_category, new Set());
            active.get(row.major_category)!.add(rfcKey);
        }
    }

    _mandatoryGridCache = { configured, active };
    console.log(`[ZMM_RFC] Mandatory grid loaded: ${configured.size} major categories configured`);
    return _mandatoryGridCache;
}

/** Call this after an Admin mandatory-grid upload to force a reload on next RFC call. */
export function invalidateMandatoryGridCache(): void {
    _mandatoryGridCache = null;
}

// ─── Maj-Cat Grid Visible Fields cache ────────────────────────────────────────
// Maps attribute_name stored in maj_cat_grid_values → RFC key(s) in FLAT_TO_RFC.
// Many Excel names differ from the RFC parameter name — this is the bridge.
const EXCEL_ATTR_TO_RFC: Record<string, string[]> = {
    // ── Fabric (new attribute_name values stored in maj_cat_grid_values) ──────
    'M_FAB_DIV':            ['M_FAB_DIV'],
    'M_YARN':               ['M_YARN'],
    'M_FAB_MAIN_MVGR_1':    ['M_FAB_MAIN_MVGR_1'],   // replaces old 'FAB_MAIN_MVGR-1'
    'M_FAB_MAIN_MVGR_2':    ['M_FAB_MAIN_MVGR_2'],   // replaces old 'FAB-MAIN-MVGR-2'
    'M_WEAVE_01':           ['M_WEAVE_01'],            // replaces old 'WEAVE-01'
    'M_WEAVE_02':           ['M_WEAVE_02'],            // replaces old 'WEAVE 02'
    'M_IMP_ATBT':           ['M_IMP_ATBT'],
    'M_FAB_VDR':            ['M_FAB_VDR'],
    'M_COMPOSITION':        ['M_COMPOSITION'],
    'M_FINISH':             ['M_FINISH'],
    'M_CONSTRUCTION':       ['M_CONSTRUCTION'],
    'M_LYCRA':              ['M_LYCRA'],
    'M_GSM':                ['M_GSM'],
    'M_OUNZ':               ['M_OUNZ'],
    'M_WIDTH':              ['M_WIDTH'],
    'M_COUNT':              ['M_COUNT'],
    // ── Body ─────────────────────────────────────────────────────────────────
    'M_COLLAR_TYPE':        ['M_COLLAR_TYPE'],
    'M_COLLAR_STYLE':       ['M_COLLAR_STYLE'],
    'M_NECK_TYPE':          ['M_NECK_TYPE'],
    'M_NECK_STYLE':         ['M_NECK_STYLE'],
    'M_PLACKET':            ['M_PLACKET'],
    'M_BLT_TYPE':           ['M_BLT_TYPE'],
    'M_BLT_STYLE':          ['M_BLT_STYLE'],
    'M_SLEEVES_MAIN_STYLE': ['M_SLEEVES_MAIN_STYLE'],
    'M_SLEEVE_FOLD':        ['M_SLEEVE_FOLD'],
    'M_SET':                ['M_SET'],
    'M_BTM_FOLD':           ['M_BTM_FOLD'],
    'M_NO_OF_POCKET':       ['M_NO_OF_POCKET'],
    'M_POCKET':             ['M_POCKET'],
    'M_EXTRA_POCKET':       ['M_EXTRA_POCKET'],
    'M_FIT':                ['M_FIT'],
    'M_BODY_STYLE':         ['M_BODY_STYLE'],          // replaces old 'BODY STYLE' → 'M_PATTERN'
    'M_LENGTH':             ['M_LENGTH'],
    // ── VA Accessories ────────────────────────────────────────────────────────
    'M_DC_STYLE':           ['M_DC_STYLE'],
    'M_DC_SHAPE':           ['M_DC_SHAPE'],
    'M_BTN_TYPE':           ['M_BTN_TYPE'],
    'M_BTN_CLR':            ['M_BTN_CLR'],
    'M_ZIP_TYPE':           ['M_ZIP_TYPE'],
    'M_ZIP_COL':            ['M_ZIP_COL'],
    'M_PATCHE_TYPE':        ['M_PATCHE_TYPE'],
    'M_PATCH_STYLE':        ['M_PATCH_STYLE'],
    'M_HTRF_TYPE':          ['M_HTRF_TYPE'],
    'M_HTRF_STYLE':         ['M_HTRF_STYLE'],
    // ── VA Processing ─────────────────────────────────────────────────────────
    'M_PRINT_TYPE':         ['M_PRINT_TYPE'],
    'M_PRINT_STYLE':        ['M_PRINT_STYLE'],
    'M_PRINT_PLACEMENT':    ['M_PRINT_PLACEMENT'],
    'M_EMB_TYPE':           ['M_EMB_TYPE'],
    'M_EMBROIDERY_STYLE':   ['M_EMBROIDERY_STYLE'],
    'M_EMB_PLACEMENT':      ['M_EMB_PLACEMENT'],
    'M_WASH':               ['M_WASH'],
    // ── Business ──────────────────────────────────────────────────────────────
    'M_AGE_GROUP':          ['M_AGE_GROUP'],
    'M_NO_OF_SIZE':         ['M_NO_OF_SIZE'],
    'M_NO_OF_CLR':          ['M_NO_OF_CLR'],
    // Legacy / old attribute_name aliases (kept for backward compat)
    'AGE GROUP':            ['M_AGE_GROUP'],
    'BODY STYLE':           ['M_BODY_STYLE'],
    'FAB_MAIN_MVGR-1':      ['M_FAB_MAIN_MVGR_1'],
    'FAB-MAIN-MVGR-2':      ['M_FAB_MAIN_MVGR_2'],
    'WEAVE-01':             ['M_WEAVE_01'],
    'WEAVE 02':             ['M_WEAVE_02'],
};

// majorCategory → Set<rfcKey> derived from maj_cat_grid_values (Tier 2 visible fields)
type MajCatVisibleFields = Map<string, Set<string>>;
let _majCatVisibleCache: MajCatVisibleFields | null = null;

/**
 * Load which RFC keys are visible (Tier 2) per major category from maj_cat_grid_values.
 * A field is Tier 2 visible if maj_cat_grid_values has at least one row for
 * (major_category, attribute_name). Cached for the process lifetime.
 */
async function loadMajCatVisibleFieldsForRfc(): Promise<MajCatVisibleFields> {
    if (_majCatVisibleCache) return _majCatVisibleCache;

    const rows = await prisma.$queryRaw<
        { major_category: string; attribute_name: string }[]
    >`SELECT DISTINCT major_category, attribute_name FROM maj_cat_grid_values`;

    const map = new Map<string, Set<string>>();
    for (const row of rows) {
        const rfcKeys = EXCEL_ATTR_TO_RFC[row.attribute_name];
        if (!rfcKeys) continue;
        if (!map.has(row.major_category)) map.set(row.major_category, new Set());
        for (const rfc of rfcKeys) map.get(row.major_category)!.add(rfc);
    }

    _majCatVisibleCache = map;
    console.log(`[ZMM_RFC] Maj-cat visible fields loaded: ${map.size} major categories`);
    return map;
}

/** Call this after an Admin maj_cat_grid upload to force a reload on next RFC call. */
export function invalidateMajCatVisibleCache(): void {
    _majCatVisibleCache = null;
}

async function getDbValues(division: string): Promise<Record<string, string[]>> {
    const div = division.trim().toUpperCase();
    if (_dbValuesCache.has(div)) return _dbValuesCache.get(div)!;
    const rows = await prisma.sapAttributeValue.findMany({
        where: { majorCategory: div, isActive: true },
        select: { value: true, fieldConfig: { select: { dbField: true } } },
    });
    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
        const key = row.fieldConfig.dbField;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row.value);
    }
    _dbValuesCache.set(div, grouped);
    return grouped;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ZMM_RFC_URL = 'https://sap-api.v2retail.net/api/ZMM_ART_CREATION_RFC?env=prod';
// Hard timeout per SAP RFC call so a slow/unresponsive SAP endpoint can't hang the
// approval-sync worker indefinitely (the call aborts → failure → article retried).
const SAP_RFC_TIMEOUT_MS = parseInt(process.env.SAP_RFC_TIMEOUT_MS || '120000', 10);
// How many SAP RFC calls to run in parallel ("lanes"). Keep within SAP's capacity.
const SAP_RFC_CONCURRENCY = parseInt(process.env.SAP_RFC_CONCURRENCY || '6', 10);

const ZMM_RFC_ENABLED =
    (process.env.ZMM_RFC_ENABLED ?? process.env.SAP_SYNC_ENABLED ?? 'true').toLowerCase() === 'true';

// ─── Types ───────────────────────────────────────────────────────────────────

type FlatItem = { id: string; [key: string]: unknown };

type RfcResponse = {
    // New API format
    Status?: boolean | string;
    Env?: string;
    Message?: string;
    SuccessCount?: number;
    ErrorCount?: number;
    EX_DATA?: Array<{ SAP_ART?: string; MSG_TYP?: string; MESSAGE?: string }>;
    // Legacy flat format (old API)
    SAP_ART?: string;
    MSG_TYP?: string;
    [key: string]: unknown;
};

// ─── Field Mapping: extractionResultFlat (camelCase) → RFC JSON key ──────────
//
// FLAT_TO_RFC is now imported from the shared module (see top of file) so the
// MODIFY path (patch-bulk) sends identical SAP key names.

// RFC fields that should always be present (even as empty string) per the RFC contract
const RFC_ALWAYS_INCLUDE = new Set([
    'HSN_CODE', 'SUB_DIV', 'MC_CD', 'VENDOR', 'DSG_NO',
    'SEASON', 'ARTICLE_DES1',
]);

// RFC keys that are always sent to SAP if non-empty, regardless of grid visibility.
// These correspond to:
//   BOM fields  — always shown in the article card BOM section
//   freeText fields — always shown in the article card regardless of major category
const RFC_ALWAYS_SEND_IF_PRESENT = new Set([
    // BOM (always visible in card)
    'MRP',
    'PURCH_PRICE',
    'M_IMP_ATBT',          // IMP_ATBT
    // freeText fields (always visible in card, no dropdown filtering)
    'M_SHADE',             // shade
    'NET_WEIGHT',          // weight (renamed from G_WEIGHT in new API)
    'PRICE_BAND_CATEGORY', // segment
]);

// ─── Mandatory field validation ───────────────────────────────────────────────

const MANDATORY: Array<{ flat: string; label: string }> = [
    { flat: 'vendorCode',    label: 'Vendor Code' },
    { flat: 'mcCode',        label: 'MC Code' },
    { flat: 'designNumber',  label: 'Design Number' },
    { flat: 'mainMvgr',      label: 'Main MVGR' },
    { flat: 'mrp',           label: 'MRP' },
    { flat: 'impAtrbt2',     label: 'M_IMP_ATBT' },
];

// ─── Value validation against allowed values ──────────────────────────────────

// Maps RFC field name → DB field name in sap_attribute_value table
const RFC_TO_DB_FIELD: Record<string, string> = {
    M_FAB:                'weave',           // legacy alias
    M_WEAVE_01:           'weave',
    M_FAB2:               'mFab2',           // legacy alias
    M_WEAVE_02:           'mFab2',
    M_YARN:               'yarn1',
    M_FAB_MAIN_MVGR_1:    'mainMvgr',
    M_FAB_MAIN_MVGR_2:    'fabricMainMvgr',
    M_FAB_VDR:            'fabVdr',
    M_FINISH:             'finish',
    M_COMPOSITION:        'composition',
    M_LYCRA:              'lycra',
    M_GSM:                'gsm',
    M_WEAVE_2:            'fabricMainMvgr',  // legacy alias
    M_COLLAR:             'collar',           // legacy alias
    M_COLLAR_TYPE:        'collar',
    M_COLLAR_STYLE:       'collarStyle',
    M_POCKET:             'pocketType',
    M_PLACKET:            'placket',
    M_BTM_FOLD:           'bottomFold',
    M_NECK_TYPE:          'neck',
    M_NECK_BAND:          'neck',           // legacy alias
    M_NECK_STYLE:         'neckDetails',
    M_NECK_BAND_STYLE:    'neckDetails',    // legacy alias
    M_SLEEVES_MAIN_STYLE: 'sleeve',
    M_SLEEVE_FOLD:        'sleeveFold',
    M_FIT:                'fit',
    M_PATTERN:            'pattern',         // legacy alias
    M_BODY_STYLE:         'pattern',
    M_LENGTH:             'length',
    M_DC_SUB_STYLE:       'drawcord',
    M_DC_STYLE:           'drawcord',
    M_DC_SHAPE:           'dcShape',
    M_BTN_MAIN_MVGR:      'button',
    M_BTN_TYPE:           'button',
    M_BTN_CLR:            'btnColour',
    M_ZIP:                'zipper',
    M_ZIP_TYPE:           'zipper',
    M_ZIP_COL:            'zipColour',
    M_PATCH_TYPE:         'patchesType',
    M_PATCHES:            'patches',
    M_PATCH_STYLE:        'patches',
    M_PATCHE_TYPE:        'patchesType',
    M_HTRF_TYPE:          'htrfType',
    M_HTRF_STYLE:         'htrfStyle',
    M_EMBROIDERY:         'embroideryType',   // legacy alias
    M_EMBROIDERY_STYLE:   'embroideryType',
    M_EMB_TYPE:           'embroidery',
    M_EMB_PLACEMENT:      'embPlacement',
    M_PRINT_TYPE:         'printType',
    M_PRINT_PLACEMENT:    'printPlacement',
    M_PRINT_STYLE:        'printStyle',
    M_WASH:               'wash',
    M_AGE_GROUP:          'ageGroup',
    PRICE_BAND_CATEGORY:  'segment',
    M_FAB_DIV:            'fabDiv',
    M_IMP_ATBT:           'impAtrbt2',
    M_MAIN_MVGR:          'impAtrbt2',       // legacy alias
};

/**
 * Validates all field values in a built RFC payload against the allowed values
 * from the DB (sap_attribute_value), scoped to the article's division.
 * Returns an array of human-readable error strings (empty = all OK).
 */
async function validatePayloadValues(
    division: string,
    payload: Record<string, string>
): Promise<string[]> {
    const errors: string[] = [];
    const dbValues = await getDbValues(division);

    for (const [rfcField, value] of Object.entries(payload)) {
        if (!value) continue;
        if (RFC_ALWAYS_INCLUDE.has(rfcField)) continue;
        const dbField = RFC_TO_DB_FIELD[rfcField];
        if (!dbField) continue;
        const validValues = dbValues[dbField];
        if (!validValues || validValues.length === 0) continue;
        if (validValues.length === 1 && validValues[0] === '-') continue;
        const upperVal = value.toUpperCase();
        const isValid = validValues.some(v => v.toUpperCase() === upperVal);
        if (!isValid) {
            const MAX_SHOW = 5;
            const shown = validValues.slice(0, MAX_SHOW).join(', ');
            const extra = validValues.length > MAX_SHOW ? ` … +${validValues.length - MAX_SHOW} more` : '';
            errors.push(`• ${rfcField}: "${value}" is not valid — expected: ${shown}${extra}`);
        }
    }
    return errors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    // Prisma Decimal objects (decimal.js) — convert via toNumber() to get a clean numeric string
    if (typeof v === 'object' && typeof (v as any).toNumber === 'function') {
        const n: number = (v as any).toNumber();
        return isNaN(n) ? '' : String(n);
    }
    const s = String(v).trim();
    return s === '-' ? '' : s;  // dash = frontend placeholder, send empty to SAP
};

/**
 * Build the JSON body for ZMM_ART_CREATION_RFC.
 *
 * Mirrors the frontend 3-tier card visibility exactly:
 *
 *  RFC_ALWAYS_INCLUDE          → header/identity fields — always sent (even empty)
 *  RFC_ALWAYS_SEND_IF_PRESENT  → BOM + freeText fields — always sent if non-empty
 *  Tier 1 (mandatory grid)     → is_active=true for this major category → sent if non-empty
 *  Tier 2 (maj_cat_grid)       → has dropdown values for this major category → sent if non-empty
 *  Tier 3 (neither grid)       → NOT sent even if the DB has a value
 */
function buildRfcPayload(
    item: FlatItem,
    mandatoryGrid: MandatoryGridCache,
    majCatVisible: MajCatVisibleFields,
): Record<string, string> {
    const majorCategory = toStr(item.majorCategory);

    // Tier 1: SAP keys that are active (mandatory) for this major category
    const mandatoryKeys = mandatoryGrid.active.get(majorCategory) ?? new Set<string>();
    // Tier 2: SAP keys that have dropdown values for this major category
    const optionalKeys  = majCatVisible.get(majorCategory)        ?? new Set<string>();

    // Union: every RFC key that is visible in the article card
    const visibleKeys = new Set([...mandatoryKeys, ...optionalKeys]);

    const payload: Record<string, string> = {};

    for (const { rfc, flat } of FLAT_TO_RFC) {
        const val = toStr(item[flat]);

        if (RFC_ALWAYS_INCLUDE.has(rfc)) {
            // Header/identity fields — always present (even if empty)
            payload[rfc] = val;
        } else if (val && RFC_ALWAYS_SEND_IF_PRESENT.has(rfc)) {
            // BOM / freeText fields — always sent if the value is non-empty
            payload[rfc] = val;
        } else if (val && visibleKeys.has(rfc)) {
            // Tier 1 or Tier 2 field — visible in card AND has a value
            payload[rfc] = val;
        }
        // Tier 3: not in either grid → skip even if DB has a value
    }

    // Always re-derive MC_CD and HSN_CODE from majorCategory using the JSON source of truth.
    // Both DB fields (mcCode, hsnTaxCode) can be stale if set at extraction time with an old mapping.
    const freshMcCode = getMcCodeByMajorCategory(item.majorCategory as string | null);
    if (freshMcCode) {
        payload['MC_CD'] = freshMcCode;
        const freshHsn = getHsnCodeByMcCode(freshMcCode);
        if (freshHsn) {
            payload['HSN_CODE'] = freshHsn;
        }
    }

    return payload;
}

/**
 * Build the patch-bulk `Changes` payload for a MODIFY operation.
 *
 * Differs from buildRfcPayload (creation) in two ways:
 *   1. Sends EVERY applicable field on every modify (not just the diff), and
 *      includes EMPTY values ("") so a blanked field is cleared in SAP.
 *   2. "Applicable" = all identity/price/business fields (RFC_ALWAYS_INCLUDE ∪
 *      RFC_ALWAYS_SEND_IF_PRESENT) PLUS the garment characteristics that are
 *      VALID for this major category (mandatory ∪ maj_cat grid). Characteristics
 *      outside the article's class (Tier-3) are skipped, so one class-invalid
 *      field can't make SAP reject the whole modify.
 *
 * `item` should already have the user's edits merged in.
 */
export async function buildModifyChangesPayload(item: FlatItem): Promise<Record<string, string>> {
    const mandatoryGrid = await loadMandatoryGridForRfc();
    const majCatVisible = await loadMajCatVisibleFieldsForRfc();

    const majorCategory = toStr(item.majorCategory);
    const mandatoryKeys = mandatoryGrid.active.get(majorCategory) ?? new Set<string>();
    const optionalKeys = majCatVisible.get(majorCategory) ?? new Set<string>();
    const visibleKeys = new Set<string>([...mandatoryKeys, ...optionalKeys]);

    const payload: Record<string, string> = {};
    for (const { rfc, flat } of FLAT_TO_RFC) {
        const include =
            RFC_ALWAYS_INCLUDE.has(rfc) ||
            RFC_ALWAYS_SEND_IF_PRESENT.has(rfc) ||
            visibleKeys.has(rfc);
        if (include) payload[rfc] = toStr(item[flat]); // empties intentionally included
    }

    // Re-derive MC_CD / HSN_CODE from the major category (DB values can be stale).
    const freshMcCode = getMcCodeByMajorCategory(item.majorCategory as string | null);
    if (freshMcCode) {
        payload['MC_CD'] = freshMcCode;
        const freshHsn = getHsnCodeByMcCode(freshMcCode);
        if (freshHsn) payload['HSN_CODE'] = freshHsn;
    }

    return payload;
}

// ─── SAP response parsing ─────────────────────────────────────────────────────

/**
 * Parse the RFC JSON response and return a normalised outcome.
 * SAP is expected to return: { SAP_ART, MSG_TYP, MESSAGE }
 * MSG_TYP: S = success, E = error, W = warning, I = info
 */
function parseRfcResponse(
    statusCode: number,
    body: string
): { ok: boolean; sapArticleNumber?: string; message: string } {
    let parsed: RfcResponse | undefined;

    try {
        parsed = JSON.parse(body) as RfcResponse;
    } catch {
        // Non-JSON plain-text response
        return {
            ok: false,
            message: body.trim() || `SAP returned HTTP ${statusCode} with no body`,
        };
    }

    // New API: SAP_ART / MSG_TYP / MESSAGE are inside EX_DATA[0]
    // Legacy API: those fields sit at the top level — fall back for backward compat
    const exData = parsed?.EX_DATA?.[0];
    const sapArt = toStr(exData?.SAP_ART ?? parsed?.SAP_ART ?? parsed?.ArticleNumber ?? parsed?.ARTICLE_NUMBER ?? parsed?.artNo);
    const msgTyp = toStr(exData?.MSG_TYP ?? parsed?.MSG_TYP ?? parsed?.MsgType ?? parsed?.TYPE ?? parsed?.type ?? '').toUpperCase();
    const msgText = toStr(exData?.MESSAGE ?? parsed?.MESSAGE ?? parsed?.Message ?? parsed?.message ?? parsed?.MSG ?? parsed?.msg ?? parsed?.error ?? parsed?.Error ?? '');

    // New API: top-level Status (boolean) + SuccessCount / ErrorCount
    const statusFlag   = parsed?.Status ?? parsed?.status ?? parsed?.SUCCESS ?? parsed?.success;
    const successCount = typeof parsed?.SuccessCount === 'number' ? parsed.SuccessCount : undefined;
    const errorCount   = typeof parsed?.ErrorCount   === 'number' ? parsed.ErrorCount   : undefined;

    // When SAP returns an error (MSG_TYP='E' or Status=false) it sometimes puts the
    // offending RFC field name (e.g. "M_ZIP_TYPE", "M_BODY_STYLE") into SAP_ART
    // instead of a real article number.  Only accept SAP_ART as a real article number
    // when the response is clearly a success.
    const isErrorResponse =
        msgTyp === 'E' || msgTyp === 'ERROR' ||
        statusFlag === false || statusFlag === 'false' ||
        statusFlag === 0     || statusFlag === '0';
    const realSapArt = isErrorResponse ? '' : sapArt;

    // Log parsed fields to help debug
    console.log(`[ZMM_RFC] Parsed → SAP_ART="${sapArt}" (real="${realSapArt}") MSG_TYP="${msgTyp}" MESSAGE="${msgText}" Status="${statusFlag}" SuccessCount=${successCount} ErrorCount=${errorCount} | Full keys: ${Object.keys(parsed || {}).join(', ')}`);

    // Build readable message — prefer the per-row message; fall back to summary
    const messageParts: string[] = [];
    if (msgTyp)  messageParts.push(`[${msgTyp}]`);
    if (msgText) messageParts.push(msgText);
    // Append top-level summary (e.g. "1 created, 0 failed (of 1 rows).") if different from per-row text
    const summaryMsg = toStr(parsed?.Message ?? '');
    if (summaryMsg && summaryMsg !== msgText) messageParts.push(summaryMsg);
    const message = messageParts.join(' ') || (realSapArt ? `Article created: ${realSapArt}` : `SAP response HTTP ${statusCode} — ${JSON.stringify(parsed)}`);

    // Determine success:
    // - HTTP 2xx AND
    // - Status !== false (new API uses boolean true/false) AND
    // - SuccessCount > 0 (if present) AND ErrorCount === 0 (if present) AND
    // - MSG_TYP not 'E' (error)
    const isHttpOk = statusCode >= 200 && statusCode < 300;
    const isStatusOk = statusFlag !== false && statusFlag !== 'false' && statusFlag !== 0 && statusFlag !== '0';
    const hasSuccessCount = successCount !== undefined ? successCount > 0  : true;
    const hasNoErrors     = errorCount   !== undefined ? errorCount   === 0 : true;
    const isBusinessOk = isStatusOk && hasSuccessCount && hasNoErrors && msgTyp !== 'E' && msgTyp !== 'ERROR';
    // Only short-circuit on SAP_ART when it is a real article number (not an error field name)
    const ok = isHttpOk && (realSapArt ? true : isBusinessOk);

    return {
        ok,
        sapArticleNumber: realSapArt || undefined,
        message,
    };
}

// ─── Dry-run preview ────────────────────────────────────────────────────────

/**
 * Build and console.log the EXACT ZMM_ART_CREATION_RFC payload that WOULD be
 * sent for each item — WITHOUT calling SAP. Dev aid so the generic-creation
 * payload is visible locally (where the background sync worker doesn't run and
 * where hitting the hardcoded prod URL would create real articles).
 */
export async function previewRfcPayloads(items: FlatItem[]): Promise<void> {
    try {
        const mandatoryGrid = await loadMandatoryGridForRfc();
        const majCatVisible = await loadMajCatVisibleFieldsForRfc();
        for (const item of items) {
            const payload = buildRfcPayload(item, mandatoryGrid, majCatVisible);
            console.log(`\n========== [ZMM_RFC] PREVIEW PAYLOAD (dry-run, NO SAP call) for flat_id=${item.id} ==========`);
            console.log(`Would POST to : ${ZMM_RFC_URL}`);
            console.log(JSON.stringify({ IM_DATA: [payload] }, null, 2));
            console.log(`==================================================================================\n`);
        }
    } catch (err: any) {
        console.error('[ZMM_RFC] preview payload error:', err?.message);
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calls ZMM_ART_CREATION_RFC (JSON endpoint) for each approved item.
 * Returns the same SapSyncItemResult[] shape so the ApproverController
 * can treat this identically to the old syncApprovedItemsToSap.
 */
export async function syncArticlesToSapViaRfc(
    items: FlatItem[]
): Promise<SapSyncItemResult[]> {
    if (!ZMM_RFC_ENABLED) {
        console.log('[ZMM_RFC] Disabled via ZMM_RFC_ENABLED / SAP_SYNC_ENABLED env var');
        return items.map((item) => ({
            id: item.id,
            success: false,
            message: 'ZMM_ART_CREATION_RFC sync is disabled',
        }));
    }

    console.log(`\n[ZMM_RFC] syncArticlesToSapViaRfc called with ${items.length} item(s): ${items.map((i) => i.id).join(', ')}`);

    // Load both grids once for the entire batch (cached after first call)
    const mandatoryGrid = await loadMandatoryGridForRfc();
    const majCatVisible = await loadMajCatVisibleFieldsForRfc();

    // Process up to SAP_RFC_CONCURRENCY articles in parallel ("open more lanes").
    const results: SapSyncItemResult[] = await mapWithConcurrency(items, SAP_RFC_CONCURRENCY, async (item): Promise<SapSyncItemResult> => {
        // ── 1. Mandatory field check ──────────────────────────────────────────
        const missing = MANDATORY.filter((f) => {
            const val = toStr(item[f.flat]);
            // For MRP specifically, also reject zero value
            if (f.flat === 'mrp') return !val || val === '0';
            return !val;
        });
        if (missing.length > 0) {
            console.log(`[ZMM_RFC] ⏭️  Skipping flat_id=${item.id} — NO payload built (missing mandatory: ${missing.map((f) => f.label).join(', ')})`);
            return {
                id: item.id,
                success: false,
                message: `Missing mandatory fields: ${missing.map((f) => f.label).join(', ')}`,
            };
        }

        // ── 2. Build payload (filtered by card visibility: mandatory + optional grids) ──
        const payload = buildRfcPayload(item, mandatoryGrid, majCatVisible);

        console.log(`\n========== [ZMM_RFC] FULL PAYLOAD for flat_id=${item.id} ==========`);
        console.log(`API URL : ${ZMM_RFC_URL}`);
        console.log(JSON.stringify({ IM_DATA: [payload] }, null, 2));
        console.log(`====================================================================\n`);

        // ── 3. Call SAP RFC ──────────────────────────────────────────────────
        // New API expects: { "IM_DATA": [ { ...fields } ] }
        const requestBody = { IM_DATA: [payload] };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SAP_RFC_TIMEOUT_MS);
        try {
            const response = await fetch(ZMM_RFC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: ctrl.signal,
            });

            const responseText = await response.text();

            // Log full raw SAP response so we can see exactly what SAP returns
            console.log(`[ZMM_RFC] RAW SAP response (status=${response.status}) for flat_id=${item.id}:`, responseText);

            const outcome = parseRfcResponse(response.status, responseText);

            if (outcome.ok) {
                console.log(
                    `[ZMM_RFC] ✅ Article created: ${outcome.sapArticleNumber ?? 'no article number'} for flat_id=${item.id}`
                );
                return {
                    id: item.id,
                    success: true,
                    statusCode: response.status,
                    message: outcome.message,
                    sapArticleNumber: outcome.sapArticleNumber,
                };
            }
            console.warn(`[ZMM_RFC] ❌ SAP rejected flat_id=${item.id}: ${outcome.message}`);
            return {
                id: item.id,
                success: false,
                statusCode: response.status,
                message: outcome.message,
            };
        } catch (err) {
            const isTimeout = err instanceof Error && err.name === 'AbortError';
            const msg = err instanceof Error ? err.message : 'Unknown network error';
            console.error(`[ZMM_RFC] ${isTimeout ? 'TIMEOUT' : 'Network error'} for flat_id=${item.id}:`, msg);
            return {
                id: item.id,
                success: false,
                message: isTimeout
                    ? `ZMM_ART_CREATION_RFC timed out after ${Math.round(SAP_RFC_TIMEOUT_MS / 1000)}s`
                    : `ZMM_ART_CREATION_RFC network error: ${msg}`,
            };
        } finally {
            clearTimeout(timer);
        }
    });

    return results;
}
