/**
 * Fabric VLM — Gemini extraction of the 14 FAB attributes (M_FAB_DIV … M_LYCRA)
 * from a fabric swatch photo, written into fabric_article_data.m_* columns.
 *
 * The FG pipeline (raw_articles → enrichSrmRowWithVlm → extraction_results_flat)
 * uses garment prompts; fabric swatches need their own prompt, so this service
 * calls Gemini directly with:
 *   - the allowed codes per attribute from fabric_maj_cat_grid_values (same list
 *     the Fabric FAB card dropdowns use), as a responseSchema enum, so Gemini can
 *     only answer with a valid code or null;
 *   - rules that make the printed label (QUALITY / GSM / WIDTH …) win over guessing.
 *
 * Used by:
 *   - fabricRawDataService (cron) right after a fabric_article_data row is created;
 *   - test-api endpoint: single-article extract (Postman testing). No backfill (user, 2026-11-20).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { prismaClient as prisma } from '../utils/prisma';
import { calculateCost } from './costCalculator';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CALL_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 1; // no retry on failure (user, 2026-11-20)
const GRID_CACHE_MS = 10 * 60_000;
/** Answers below this confidence (0-100) are not stored. FABRIC_VLM_MIN_CONFIDENCE overrides. */
const MIN_CONFIDENCE = Number(process.env.FABRIC_VLM_MIN_CONFIDENCE ?? 40);

/** Turned off with FABRIC_VLM_ENABLED=false (default on). */
export function isFabricVlmEnabled(): boolean {
  return String(process.env.FABRIC_VLM_ENABLED ?? 'true').toLowerCase() !== 'false';
}

// ── Attribute catalogue ─────────────────────────────────────────────────────

type FabricField =
  | 'mFabDiv' | 'mYarn' | 'mFabMainMvgr1' | 'mFabMainMvgr2' | 'mWeave01' | 'mWeave02' | 'mCount'
  | 'mGsm' | 'mOunz' | 'mConstruction' | 'mComposition' | 'mFinish' | 'mWidth' | 'mLycra';

interface FabricAttrDef {
  sap: string;          // key Gemini answers with (SAP name)
  field: FabricField;   // fabric_article_data Prisma field
  gridKey: string;      // normalised fabric_maj_cat_grid_values.characteristic
  rule: string;         // per-attribute guidance in the prompt
}

// Order = Fabric FAB card order.
const ATTRS: FabricAttrDef[] = [
  { sap: 'M_FAB_DIV', field: 'mFabDiv', gridKey: 'MFABDIV',
    rule: 'Fabric type. K = knit (loops, stretchy; jersey/rib/fleece look); W = woven (warp x weft grid); DNM = denim (twill, indigo/coloured warp, white weft). RFD_* only if the label says ready-for-dyeing / greige.' },
  { sap: 'M_YARN', field: 'mYarn', gridKey: 'MYARN',
    rule: "Main fibre of the yarn. Prefer the label's composition (100% POLYESTER -> P; cotton/poly blend: CP if cotton is the larger share, PC if polyester is larger)." },
  { sap: 'M_FAB_MAIN_MVGR_1', field: 'mFabMainMvgr1', gridKey: 'FABMAINMVGR1',
    rule: 'Main look: SLD solid, PRT print, CHK check, STP stripe, OD over-dyed; DNM_* versions for denim.' },
  { sap: 'M_FAB_MAIN_MVGR_2', field: 'mFabMainMvgr2', gridKey: 'FABMAINMVGR2',
    rule: 'Detailed look, consistent with M_FAB_MAIN_MVGR_1 (SLD -> SLD; PRT -> a PRT_* value; STP -> H_STP / V_STP / E_STP; CHK -> YD_CHK / PRT_CHK / IND_CHK).' },
  { sap: 'M_WEAVE_01', field: 'mWeave01', gridKey: 'WEAVE01',
    rule: "Base weave / knit structure (SJ single jersey, PIQ pique, RIB, INL interlock, FLC fleece, TRY terry, POP poplin, TWL twill, OXF oxford, DBY dobby, JAQ jacquard, LINN linen …). Use the label's QUALITY name when it matches a code." },
  { sap: 'M_WEAVE_02', field: 'mWeave02', gridKey: 'WEAVE02',
    rule: "Secondary structure / effect (1*1 or 2*2 rib, MLNG melange, SLUB, JAQ, DBY, HNYCMB, HRNGBN …). Use '-' when there is no secondary effect." },
  { sap: 'M_COUNT', field: 'mCount', gridKey: 'MCOUNT',
    rule: 'Yarn count. Only from a printed label; otherwise null.' },
  { sap: 'M_GSM', field: 'mGsm', gridKey: 'MGSM',
    rule: 'GSM band. A GSM number on the label (e.g. 190) -> the band containing it (180-200). Otherwise estimate only when confident, else null.' },
  { sap: 'M_OUNZ', field: 'mOunz', gridKey: 'MOUNZ',
    rule: 'Weight in ounces - denim only. Only from the label; otherwise null.' },
  { sap: 'M_CONSTRUCTION', field: 'mConstruction', gridKey: 'MCONSTRUCTION',
    rule: 'Ends x picks (e.g. 132*72), woven only. Only from the label; otherwise null.' },
  { sap: 'M_COMPOSITION', field: 'mComposition', gridKey: 'MCOMPOSITION',
    rule: 'Fibre composition. Prefer the label text; otherwise null.' },
  { sap: 'M_FINISH', field: 'mFinish', gridKey: 'MFINISH',
    rule: 'Finish (BIO, SLCN silicon, PCH_FNSH peach, BRSHG brushing …). Only if the label says so or it is clearly visible; otherwise null.' },
  { sap: 'M_WIDTH', field: 'mWidth', gridKey: 'MWIDTH',
    rule: 'Width in inches. A width on the label (e.g. 63") -> the NEAREST allowed value (62"). Otherwise null.' },
  { sap: 'M_LYCRA', field: 'mLycra', gridKey: 'MLYCRA',
    rule: 'N_LYC unless the label / composition mentions lycra, spandex or elastane (then 2W_LYC; 4W_LYC only if 4-way is stated).' },
];

const normKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── Allowed values (fabric_maj_cat_grid_values), cached ─────────────────────

type GridEntry = { code: string; full: string };
let gridCache: { at: number; map: Map<string, GridEntry[]> } | null = null;

async function getFabricGrid(): Promise<Map<string, GridEntry[]>> {
  if (gridCache && Date.now() - gridCache.at < GRID_CACHE_MS) return gridCache.map;
  const rows = await prisma.$queryRaw<{ characteristic: string; code: string; full_form: string | null }[]>`
    SELECT characteristic, code, full_form FROM public.fabric_maj_cat_grid_values ORDER BY characteristic, code
  `;
  const map = new Map<string, GridEntry[]>();
  for (const r of rows) {
    const key = normKey(r.characteristic || '');
    const code = String(r.code ?? '').trim();
    if (!key || !code) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ code, full: String(r.full_form ?? '').trim() || code });
  }
  gridCache = { at: Date.now(), map };
  return map;
}

// ── Prompt + schema ─────────────────────────────────────────────────────────

export interface FabricHints {
  fabricText?: string | null;    // SRM "fabric" free text, if any
  majorCategory?: string | null;
  division?: string | null;
  designNumber?: string | null;
}

function buildPrompt(grid: Map<string, GridEntry[]>, hints: FabricHints): string {
  const context = [
    hints.division ? `Division: ${hints.division}` : null,
    hints.majorCategory ? `Major category: ${hints.majorCategory}` : null,
    hints.designNumber ? `Design / quality no.: ${hints.designNumber}` : null,
    hints.fabricText ? `Vendor's fabric description: ${hints.fabricText}` : null,
  ].filter(Boolean).join('\n');

  const sections = ATTRS.map((a) => {
    const vals = grid.get(a.gridKey) ?? [];
    const list = vals.map((v) => (v.full && v.full !== v.code ? `${v.code}=${v.full}` : v.code)).join(' | ');
    return `### ${a.sap}\nRule: ${a.rule}\nAllowed (CODE=MEANING): ${list || '(free text)'}`;
  }).join('\n\n');

  return [
    'You are a senior textile technologist for an Indian apparel retailer. The image is a FABRIC swatch',
    '(often on a card with a printed label: QUALITY / GSM / WIDTH / COMPOSITION).',
    '',
    'TASK: fill every attribute below with ONE code from its allowed list.',
    'RULES:',
    '1. Read the printed label first - label text beats visual guessing. Map label text to the closest allowed code.',
    "2. Return the CODE (left of '='), never the meaning, never free text.",
    '3. If you cannot tell with reasonable confidence, return null. Do not invent values.',
    '4. Numbers on the label: convert to the allowed band / nearest allowed value (GSM 190 -> 180-200; width 63" -> 62").',
    '5. Keep attributes consistent (knit structures only when M_FAB_DIV = K; construction only for woven; ounces only for denim).',
    '6. The MAJOR CATEGORY code names the fabric: <division>_<yarn>_<weave>, e.g. K_P_JAQ = knit, polyester, jacquard;',
    '   W_C_POP = woven, cotton, poplin. Use it for M_FAB_DIV / M_YARN / M_WEAVE_01 unless the image or label clearly says otherwise.',
    "7. Also return 'label_text' = all text you can read on the label, and 'confidence' 0-100 per attribute",
    '   (0 = not visible / guessed). Return null for any attribute you would score below 40.',
    context ? `\nCONTEXT (may help, the image still wins):\n${context}` : '',
    '',
    sections,
  ].join('\n');
}

function buildResponseSchema(grid: Map<string, GridEntry[]>) {
  const properties: Record<string, any> = {};
  for (const a of ATTRS) {
    const codes = (grid.get(a.gridKey) ?? []).map((v) => v.code);
    properties[a.sap] = codes.length > 0
      ? { type: 'STRING', enum: codes, nullable: true }
      : { type: 'STRING', nullable: true };
  }
  properties.label_text = { type: 'STRING', nullable: true };
  properties.confidence = {
    type: 'OBJECT',
    properties: Object.fromEntries(ATTRS.map((a) => [a.sap, { type: 'INTEGER' }])),
  };
  return {
    type: 'OBJECT',
    properties,
    required: [...ATTRS.map((a) => a.sap), 'label_text', 'confidence'],
  };
}

// ── Gemini call ─────────────────────────────────────────────────────────────

async function fetchImage(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('Image fetch returned 0 bytes');
  return { data: buf.toString('base64'), mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg' };
}

/** Snap a model answer to an allowed code (exact code, then full form); '-' / unknown → null. */
function snap(value: unknown, allowed: GridEntry[]): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || /^-+$/.test(s)) return null;
  if (allowed.length === 0) return s;
  const up = s.toUpperCase();
  const byCode = allowed.find((v) => v.code.toUpperCase() === up);
  if (byCode) return byCode.code === '-' ? null : byCode.code;
  const byFull = allowed.find((v) => v.full.toUpperCase() === up);
  if (byFull) return byFull.code === '-' ? null : byFull.code;
  return null;
}

export interface FabricExtraction {
  ok: boolean;
  model: string;
  values: Partial<Record<FabricField, string>>;   // snapped, non-null only
  raw: Record<string, unknown> | null;            // Gemini JSON as returned
  labelText: string | null;
  confidence: Record<string, number> | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  ms: number;
  error?: string;
}

export async function extractFabricFromImage(imageUrl: string, hints: FabricHints = {}): Promise<FabricExtraction> {
  const started = Date.now();
  const base: FabricExtraction = {
    ok: false, model: MODEL, values: {}, raw: null, labelText: null, confidence: null,
    inputTokens: 0, outputTokens: 0, cost: 0, ms: 0,
  };
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { ...base, error: 'GOOGLE_API_KEY not configured', ms: Date.now() - started };

  try {
    const [grid, image] = await Promise.all([getFabricGrid(), fetchImage(imageUrl)]);
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: buildResponseSchema(grid),
        ...(MODEL.includes('2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      } as any,
    });
    const prompt = buildPrompt(grid, hints);

    let lastErr: any = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const call = model.generateContent([{ inlineData: image }, { text: prompt }]);
        const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Gemini timeout')), CALL_TIMEOUT_MS));
        const result: any = await Promise.race([call, timeout]);
        const text = result.response.text();
        const raw = JSON.parse(text) as Record<string, unknown>;
        const usage = result.response.usageMetadata ?? {};
        const inputTokens = Number(usage.promptTokenCount ?? 0);
        const outputTokens = Number(usage.candidatesTokenCount ?? 0);

        const conf = (raw.confidence ?? {}) as Record<string, unknown>;
        const values: Partial<Record<FabricField, string>> = {};
        for (const a of ATTRS) {
          const c = Number(conf[a.sap]);
          if (Number.isFinite(c) && c < MIN_CONFIDENCE) continue; // low confidence → leave empty
          const v = snap(raw[a.sap], grid.get(a.gridKey) ?? []);
          if (v) values[a.field] = v;
        }
        return {
          ok: true, model: MODEL, values, raw,
          labelText: raw.label_text != null ? String(raw.label_text) : null,
          confidence: (raw.confidence as Record<string, number>) ?? null,
          inputTokens, outputTokens,
          cost: calculateCost(inputTokens, outputTokens, MODEL).totalCost,
          ms: Date.now() - started,
        };
      } catch (err: any) {
        lastErr = err;
        console.warn(`[FabricVLM] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
      }
    }
    return { ...base, error: String(lastErr?.message ?? 'Gemini failed').slice(0, 500), ms: Date.now() - started };
  } catch (err: any) {
    return { ...base, error: String(err?.message ?? err).slice(0, 500), ms: Date.now() - started };
  }
}

// ── Write into fabric_article_data ──────────────────────────────────────────

/**
 * Runs the extraction for one fabric_article_data row and fills its FAB columns.
 * overwrite=false (default): only empty columns are filled — a value a user already
 * typed is never replaced. MVGR-1 follows MVGR-2 via m_fabric_main_mvgr_mapping
 * (same rule as the FAB card) when a mapping row exists.
 */
export async function extractIntoFabricArticle(
  fabricArticleId: string,
  opts: { overwrite?: boolean; hints?: FabricHints } = {},
): Promise<FabricExtraction & { updatedFields: string[] }> {
  const row = await prisma.fabricArticleData.findUnique({ where: { id: fabricArticleId } });
  if (!row) throw new Error(`fabric_article_data ${fabricArticleId} not found`);
  if (!row.imageUrl) {
    return {
      ok: false, model: MODEL, values: {}, raw: null, labelText: null, confidence: null,
      inputTokens: 0, outputTokens: 0, cost: 0, ms: 0, error: 'No image URL', updatedFields: [],
    };
  }

  const ex = await extractFabricFromImage(row.imageUrl, {
    majorCategory: row.majorCategory, division: row.division, designNumber: row.designNumber, ...opts.hints,
  });
  // Failure: nothing is written to the article (error stays in fabric_raw_data.extracted_data).
  if (!ex.ok) return { ...ex, updatedFields: [] };

  // MVGR-2 → MVGR-1 from the mapping table (keeps the pair consistent with the card).
  if (ex.values.mFabMainMvgr2) {
    try {
      const m = await prisma.$queryRaw<{ mvgr1: string | null }[]>`
        SELECT mvgr1 FROM public.m_fabric_main_mvgr_mapping WHERE upper(mvgr2) = upper(${ex.values.mFabMainMvgr2}) LIMIT 1
      `;
      if (m[0]?.mvgr1) ex.values.mFabMainMvgr1 = m[0].mvgr1;
    } catch { /* mapping is optional */ }
  }

  const data: Record<string, string> = {};
  for (const [field, value] of Object.entries(ex.values) as [FabricField, string][]) {
    const current = (row as any)[field];
    const isEmpty = current == null || String(current).trim() === '';
    if (opts.overwrite || isEmpty) data[field] = value;
  }
  const updatedFields = Object.keys(data);
  // fabric_ai_attributes = the AI's 14 values, flat and keyed by SAP name — what the Fabric FAB
  // card's AI RESULT column reads (FAB_AI_KEY): {"M_FAB_DIV":"K","M_YARN":"P", …}; null = not read.
  await prisma.fabricArticleData.update({
    where: { id: fabricArticleId },
    data: { ...data, fabricAiAttributes: aiAttributesJson(ex.values) as any },
  });
  console.log(`[FabricVLM] ${fabricArticleId}: ${updatedFields.length} field(s) filled in ${ex.ms}ms ($${ex.cost})`);
  return { ...ex, updatedFields };
}

/** fabric_article_data.fabric_ai_attributes: all 14 SAP keys, value or null. */
export function aiAttributesJson(values: Partial<Record<FabricField, string>>): Record<string, string | null> {
  return Object.fromEntries(ATTRS.map((a) => [a.sap, values[a.field] ?? null]));
}

/** Full extraction log stored in fabric_raw_data.extracted_data (label text, confidence, tokens, cost, raw answer). */
export function extractionToJson(ex: FabricExtraction & { updatedFields?: string[] }) {
  return {
    vlm: {
      ok: ex.ok, model: ex.model, error: ex.error ?? null, at: new Date().toISOString(),
      values: ex.values, updatedFields: ex.updatedFields ?? [], labelText: ex.labelText,
      confidence: ex.confidence, raw: ex.raw,
      inputTokens: ex.inputTokens, outputTokens: ex.outputTokens, cost: ex.cost, ms: ex.ms,
    },
  };
}
