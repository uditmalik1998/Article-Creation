/**
 * ksmlAssignService.ts
 *
 * Web-based port of the `drivers/v2_grouped_runner.py` MDM tool.
 *
 * Takes an uploaded Excel of (class, characteristic) pairs and assigns each
 * characteristic to its class in SAP via the standard, audit-clean BAPI wrapper
 * `Z_CLS_ADD_CHAR_BAPI` (KLART=026). Change docs (CDHDR/CDPOS) are written by
 * SAP automatically — same guarantee as the Python runner.
 *
 * Race-safety (mirrors the Python grouped runner exactly):
 *   - Pairs are GROUPED BY CLASS.
 *   - Classes run in parallel (bounded pool), but pairs WITHIN a class run
 *     strictly serially — so two concurrent BAPI_CLASS_CHANGE calls never touch
 *     the same class. This is what prevents the lost-update bug that the naive
 *     `mass_v2_bapi.py` hit (742 silently-lost inserts).
 *
 * Two phases, driven by the caller:
 *   - parseKsmlExcel(): pure parse + auto-detect columns. NEVER calls SAP.
 *   - runKsmlAssignment(): the live push. Only invoked on explicit commit.
 */

// ── SAP RFC proxy config (same endpoint/key as sapAttributePushService) ────────
const SAP_RFC_PROXY_URL = process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net';
const SAP_RFC_KEY       = process.env.SAP_RFC_KEY || 'v2-rfc-proxy-2026';
const SAP_RFC_USER_AGENT = process.env.SAP_RFC_USER_AGENT || 'v2-article-creation/1.0';
const KLART = '026'; // V2 article classes live on the batch class

export interface KsmlPair {
  mc: string;   // class number, e.g. "111010301"  → IV_CLASS
  attr: string; // characteristic name, e.g. "M_BODY_STYLE" → IV_ATNAM
}

export interface ParseResult {
  pairs: KsmlPair[];
  classes: number;
  detectedColumns: { classColumn: string | null; attrColumn: string | null };
  totalRows: number;
  skipped: number;
  warnings: string[];
  sample: KsmlPair[];
}

export interface AssignItemResult extends KsmlPair {
  status: 'added' | 'already' | 'failed';
  subrc: string;
  msg: string;
  attempt: number;
}

export interface AssignReport {
  env: string;
  test: boolean;
  classes: number;
  pairs: number;
  added: number;
  already: number;
  failed: number;
  durationMs: number;
  results: AssignItemResult[];
}

// ── Column auto-detection ──────────────────────────────────────────────────────
// Priority: exact-ish header match first, then a looser "contains" pass.
const CLASS_EXACT = /^(class|mc|iv_class|klasse|class[_ ]?no|class[_ ]?number|clint[_ ]?class)$/i;
const CLASS_LOOSE = /(class|klasse)/i;
const ATTR_EXACT  = /^(attr|attribute|characteristic|char|iv_atnam|atnam|char[_ ]?name|attribute[_ ]?name)$/i;
const ATTR_LOOSE  = /(attr|charac|atnam)/i;

function pickColumn(headers: string[], exact: RegExp, loose: RegExp, avoid?: RegExp): number {
  // Prefer an exact-ish match
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (exact.test(h) && !(avoid && avoid.test(h))) return i;
  }
  // Fall back to a loose "contains" match
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (loose.test(h) && !(avoid && avoid.test(h))) return i;
  }
  return -1;
}

/**
 * Parse the uploaded Excel buffer into (class, attr) pairs.
 * Auto-detects which columns hold the class and characteristic name.
 * NEVER calls SAP.
 */
export async function parseKsmlExcel(buffer: Buffer): Promise<ParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheets found in the uploaded Excel file.');

  const warnings: string[] = [];

  // Header row = first row that has any non-empty cell.
  let headerRowIdx = 1;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const anyValue = (row.values as unknown[]).some((v) => v != null && String(v).trim() !== '');
    if (anyValue) { headerRowIdx = r; break; }
  }

  const headerRow = ws.getRow(headerRowIdx);
  // exceljs row.values is 1-based (index 0 is undefined). Normalise to 0-based headers.
  const rawHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    rawHeaders[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const classIdx = pickColumn(rawHeaders, CLASS_EXACT, CLASS_LOOSE, /major/i);
  const attrIdx  = pickColumn(rawHeaders, ATTR_EXACT, ATTR_LOOSE);

  if (classIdx === -1 || attrIdx === -1) {
    throw new Error(
      `Could not auto-detect the class and characteristic columns. ` +
      `Found headers: [${rawHeaders.filter(Boolean).join(', ')}]. ` +
      `Expected a class column (e.g. "class"/"mc"/"IV_CLASS") and a characteristic column ` +
      `(e.g. "attr"/"attribute"/"characteristic"/"IV_ATNAM").`,
    );
  }

  const classColumn = rawHeaders[classIdx] || `col${classIdx + 1}`;
  const attrColumn  = rawHeaders[attrIdx]  || `col${attrIdx + 1}`;

  const seen = new Set<string>();
  const pairs: KsmlPair[] = [];
  let totalRows = 0;
  let skipped = 0;

  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const mc   = String(row.getCell(classIdx + 1).value ?? '').trim();
    const attr = String(row.getCell(attrIdx + 1).value ?? '').trim().toUpperCase();
    if (!mc && !attr) continue; // fully blank row
    totalRows++;
    if (!mc || !attr) { skipped++; continue; }
    const key = `${mc}::${attr}`;
    if (seen.has(key)) { skipped++; continue; } // dedupe
    seen.add(key);
    pairs.push({ mc, attr });
  }

  if (skipped > 0) warnings.push(`${skipped} row(s) skipped (blank class/characteristic or duplicate).`);
  if (pairs.length === 0) warnings.push('No valid (class, characteristic) pairs found.');

  const classes = new Set(pairs.map((p) => p.mc)).size;

  return {
    pairs,
    classes,
    detectedColumns: { classColumn, attrColumn },
    totalRows,
    skipped,
    warnings,
    sample: pairs.slice(0, 20),
  };
}

// ── Pre-flight: is the FM on this system? ───────────────────────────────────
export const KSML_FM = 'Z_CLS_ADD_CHAR_BAPI';

/**
 * Ask the chosen SAP system whether Z_CLS_ADD_CHAR_BAPI exists (read-only
 * RFC_GET_FUNCTION_INTERFACE). Without it every pair would fail with
 * FU_NOT_FOUND, so the commit stops before sending anything.
 * Returns `available: null` when the check itself could not run — the commit
 * then goes ahead as before rather than blocking on a proxy hiccup.
 */
export async function checkKsmlFmAvailable(env: string): Promise<{ available: boolean | null; detail: string }> {
  const url = `${SAP_RFC_PROXY_URL.replace(/\/$/, '')}/api/rfc/proxy?env=${env}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RFC-Key': SAP_RFC_KEY, 'User-Agent': SAP_RFC_USER_AGENT },
      body: JSON.stringify({ bapiname: 'RFC_GET_FUNCTION_INTERFACE', FUNCNAME: KSML_FM }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (Array.isArray(body?.PARAMS)) return { available: true, detail: '' };
    const msg = String(body?.EX_RETURN?.MESSAGE ?? text ?? '');
    if (/FU_NOT_FOUND/i.test(msg)) return { available: false, detail: msg };
    return { available: null, detail: msg.slice(0, 200) };
  } catch (e: any) {
    return { available: null, detail: String(e?.message || e) };
  }
}

// ── SAP call ────────────────────────────────────────────────────────────────
async function callAddCharBapi(
  env: string,
  mc: string,
  attr: string,
  test: boolean,
): Promise<{ subrc: string; msg: string }> {
  const url = `${SAP_RFC_PROXY_URL.replace(/\/$/, '')}/api/rfc/proxy?env=${env}`;
  const body = JSON.stringify({
    bapiname: 'Z_CLS_ADD_CHAR_BAPI',
    IV_CLASS: mc,
    IV_ATNAM: attr,
    IV_KLART: KLART,
    IV_TEST: test ? 'X' : ' ', // ' ' = live write, 'X' = SAP test mode (no commit)
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RFC-Key': SAP_RFC_KEY,
      'User-Agent': SAP_RFC_USER_AGENT,
    },
    body,
  });
  const rawText = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(rawText); } catch { parsed = undefined; }
  const msg = String(parsed?.EV_MSG ?? rawText ?? '').slice(0, 120);
  const subrc = String(parsed?.EV_SUBRC ?? (res.ok ? '' : 'HTTP'));
  return { subrc, msg };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Assign one pair, retrying on SAP enqueue collisions (BRONZE_BOT / locked). */
async function assignOne(env: string, p: KsmlPair, test: boolean): Promise<AssignItemResult> {
  for (let a = 0; a < 5; a++) {
    try {
      const { subrc, msg } = await callAddCharBapi(env, p.mc, p.attr, test);
      const lower = msg.toLowerCase();
      if (subrc === '0' && (msg.includes('Added') || msg.includes('already'))) {
        return { ...p, status: msg.includes('already') ? 'already' : 'added', subrc, msg, attempt: a + 1 };
      }
      if (msg.includes('BRONZE_BOT') || lower.includes('locked')) {
        await wait(2000);
        continue;
      }
      return { ...p, status: 'failed', subrc, msg, attempt: a + 1 };
    } catch (e: any) {
      if (a === 4) return { ...p, status: 'failed', subrc: 'EX', msg: String(e?.message || e).slice(0, 120), attempt: a + 1 };
      await wait(1000);
    }
  }
  return { ...p, status: 'failed', subrc: 'LOCKED', msg: 'still locked after retries', attempt: 5 };
}

/**
 * Run the live assignment. Classes run in parallel (bounded), pairs within a
 * class run serially. Only call this on an explicit commit.
 */
export async function runKsmlAssignment(
  pairs: KsmlPair[],
  env: string,
  opts: { test?: boolean; classConc?: number } = {},
): Promise<AssignReport> {
  const test = opts.test ?? false;
  const classConc = Math.max(1, Math.min(opts.classConc ?? 8, 16));
  const t0 = Date.now();

  // Group by class
  const byClass = new Map<string, KsmlPair[]>();
  for (const p of pairs) {
    const arr = byClass.get(p.mc) ?? [];
    arr.push(p);
    byClass.set(p.mc, arr);
  }
  const classKeys = [...byClass.keys()];

  const results: AssignItemResult[] = [];

  // Process one class: its pairs strictly serially.
  const processClass = async (mc: string): Promise<void> => {
    for (const p of byClass.get(mc)!) {
      results.push(await assignOne(env, p, test));
    }
  };

  // Bounded parallel pool over classes.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < classKeys.length) {
      const idx = cursor++;
      await processClass(classKeys[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(classConc, classKeys.length) }, worker));

  const added = results.filter((r) => r.status === 'added').length;
  const already = results.filter((r) => r.status === 'already').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return {
    env,
    test,
    classes: classKeys.length,
    pairs: pairs.length,
    added,
    already,
    failed,
    durationMs: Date.now() - t0,
    results,
  };
}
