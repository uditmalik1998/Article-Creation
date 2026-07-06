/**
 * SAP Attribute Push Service
 *
 * After ZMM_ART_CREATION_RFC creates an article (MARA + variants), this
 * service writes the article's characteristic attributes into standard SAP
 * AUSP (KLART=026) via the V64 + link chain:
 *
 *   1. RFC_READ_TABLE MARA -> MATKL   (authoritative class lookup)
 *   2. Z_LINK_MATNR_CLASS              (idempotent class link to MATKL-class)
 *   3. Z_ART_PATCH_RFC_V64             (KSML-aware writer; routes to AUSP)
 *
 * On atomic-fail (V64 returns ok:false because >=1 attr is NIC/LOCKED), the
 * driver filters to PLANNED-only attrs and retries once. Anything still NIC
 * is reported back so the UI/audit can show which attrs were rejected.
 *
 * Replaces the legacy V61/ZCT04 path. CT04 (CABN/KLAH) stays the master
 * catalog maintained by the MDM team; AUSP is the per-object value store.
 */

import { getSapFieldMappings } from './sapSyncService';

export type AttributePushResult = {
  ok: boolean;
  matnr: string;
  matkl?: string;
  writtenCount: number;
  nicCount: number;
  lockedCount: number;
  errorMessage?: string;
  planLog?: Array<{ atnam: string; value: string; status: string; route?: string }>;
};

const SAP_RFC_PROXY_URL =
  process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net';

const SAP_RFC_KEY =
  process.env.SAP_RFC_KEY || 'v2-rfc-proxy-2026';

const SAP_ENV = (process.env.SAP_ENV || 'prod').toLowerCase();

const SAP_ATTRIBUTE_PUSH_ENABLED =
  (process.env.SAP_ATTRIBUTE_PUSH_ENABLED || 'true').toLowerCase() === 'true';

const SAP_RFC_USER_AGENT =
  process.env.SAP_RFC_USER_AGENT || 'v2-article-creation/1.0';

const padMatnr = (matnr: string): string => String(matnr || '').trim().padStart(18, '0');

const sapValue = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text ? text : null;
};

type ProxyResponse = {
  ok: boolean;
  status: number;
  body: any;
  rawText: string;
};

const callProxy = async (bapiname: string, body: Record<string, unknown>, env: string = SAP_ENV): Promise<ProxyResponse> => {
  const url = `${SAP_RFC_PROXY_URL.replace(/\/$/, '')}/api/rfc/proxy?env=${env}`;
  const payload = JSON.stringify({ bapiname, ...body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RFC-Key': SAP_RFC_KEY,
      'User-Agent': SAP_RFC_USER_AGENT,
    },
    body: payload,
  });
  const rawText = await res.text();
  let parsed: any = undefined;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // proxy occasionally returns plain text on hard failures
  }
  return { ok: res.ok, status: res.status, body: parsed, rawText };
};

const fetchMatkl = async (matnr: string, env?: string): Promise<string | null> => {
  const padded = padMatnr(matnr);
  const res = await callProxy('RFC_READ_TABLE', {
    QUERY_TABLE: 'MARA',
    FIELDS: [{ FIELDNAME: 'MATKL' }],
    OPTIONS: [{ TEXT: `MATNR = '${padded}'` }],
    ROWCOUNT: 1,
    DELIMITER: '^',
  }, env);
  if (!res.ok) return null;

  // Proxy returns SAP-style { DATA: [{ WA: 'matkl_value' }], FIELDS: [...] }
  const dataRows = res.body?.DATA || res.body?.data || res.body?.ET_DATA;
  if (!Array.isArray(dataRows) || dataRows.length === 0) return null;
  const first = dataRows[0];
  const raw = first?.WA ?? first?.wa ?? first?.MATKL ?? first?.matkl;
  const text = sapValue(raw);
  if (!text) return null;
  // strip delimiter padding if present
  return text.split('^')[0].trim() || null;
};

const linkMatnrToClass = async (matnr: string, matkl: string, env?: string): Promise<{ ok: boolean; message: string }> => {
  const res = await callProxy('Z_LINK_MATNR_CLASS', {
    IV_MATNR: padMatnr(matnr),
    IV_CLASS: matkl,
    IV_KLART: '026',
  }, env);
  if (!res.ok) {
    return { ok: false, message: `Z_LINK_MATNR_CLASS HTTP ${res.status}: ${res.rawText.slice(0, 200)}` };
  }
  // "already linked" returned by FM is treated as success (idempotent)
  const msg = sapValue(res.body?.EV_MESSAGE ?? res.body?.MESSAGE ?? res.body?.message) || '';
  const rc = res.body?.EV_RC ?? res.body?.RC ?? 0;
  if (rc !== 0 && rc !== '0' && !/already.*link/i.test(msg)) {
    return { ok: false, message: msg || `link rc=${rc}` };
  }
  return { ok: true, message: msg || 'linked' };
};

type PlanRow = { atnam: string; value: string; status: string; route?: string };

// The RFC proxy wraps the FM's structured output inside EV_JSON (a JSON string):
//   { "EV_JSON": "{ \"ok\": false, \"plan\": [ { \"fn\": \"M_YARN\", \"status\": \"PLANNED\" } ] }" }
// Unwrap it so callers see the inner object. Falls back to the raw body if
// there's no EV_JSON (older/other response shapes).
const unwrapBody = (body: any): any => {
  if (body && typeof body.EV_JSON === 'string') {
    try { return JSON.parse(body.EV_JSON); } catch { /* keep raw */ }
  }
  return body;
};

const parsePlan = (body: any): PlanRow[] => {
  const inner = unwrapBody(body);
  // The FM returns `plan[]` (status PLANNED/LOCKED) on a dry/blocked response,
  // but `results[]` (status APPLIED) once it actually writes. Read whichever is present.
  const raw = inner?.results ?? inner?.plan ?? inner?.ET_PLAN ?? inner?.PLAN ?? inner?.ET_RESULT ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((row: any) => ({
    atnam: String(row.fn ?? row.ATNAM ?? row.atnam ?? '').trim(),
    value: String(row.value ?? row.VALUE ?? row.ATWRT ?? '').trim(),
    status: String(row.status ?? row.STATUS ?? '').trim().toUpperCase(),
    route: row.route ?? row.ROUTE,
  })).filter((r: PlanRow) => r.atnam);
};

// Article-attribute patch function module. Defaults to the version the rest of
// the app uses (V64). The MDM "Pool B" handover references V65 — set
// SAP_ART_PATCH_FM=Z_ART_PATCH_RFC_V65 in .env to switch without a code change.
const SAP_ART_PATCH_FM = process.env.SAP_ART_PATCH_FM || 'Z_ART_PATCH_RFC_V64';

const callV64 = async (matnr: string, ivChanges: string, testMode = '', env?: string): Promise<{ ok: boolean; plan: PlanRow[]; raw: any }> => {
  const res = await callProxy(SAP_ART_PATCH_FM, {
    IV_MATNR: padMatnr(matnr),
    IV_CHANGES: ivChanges,
    IV_TEST_MODE: testMode,
  }, env);
  const plan = parsePlan(res.body);
  const inner = unwrapBody(res.body);
  const okFlag = res.ok && (inner?.ok === true || inner?.EV_OK === 'X' || inner?.OK === true);
  return { ok: !!okFlag, plan, raw: res.body };
};

const buildChangesString = (item: Record<string, unknown>): { changes: string; count: number } => {
  const mappings = getSapFieldMappings();
  const seen = new Set<string>();
  const parts: string[] = [];

  const snakeToCamel = (value: string): string =>
    value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  for (const m of mappings) {
    const apiName = m.apiName.trim();
    // Only push real characteristic attrs (M_*, NET_WEIGHT, DSG_NO etc). Skip
    // article-master fields handled by ZMM_ART_CREATION_RFC (VENDOR, MC_CD,
    // MAJOR_CATEGORY etc) and anything already routed in buildSapFormBody.
    if (!apiName) continue;
    if (seen.has(apiName)) continue;
    const direct = item[m.attribute];
    const camel = item[snakeToCamel(m.attribute)];
    const value = sapValue(direct ?? camel);
    if (!value) continue;
    seen.add(apiName);
    // V64 IV_CHANGES delimiter is `|` for rows and `=` for key=value
    const safeValue = value.replace(/\|/g, '/').replace(/=/g, '-');
    parts.push(`${apiName}=${safeValue}`);
  }

  return { changes: parts.join('|'), count: parts.length };
};

const tallyPlan = (plan: PlanRow[]) => {
  let writtenCount = 0;
  let nicCount = 0;
  let lockedCount = 0;
  for (const row of plan) {
    const s = row.status.toUpperCase();
    if (s === 'APPLIED' || s === 'PLANNED' || s === 'OK') writtenCount++;
    else if (s === 'NIC') nicCount++;
    else if (s === 'LOCKED' || s === 'REJECT') lockedCount++;
  }
  return { writtenCount, nicCount, lockedCount };
};

export const isAttributePushEnabled = (): boolean => SAP_ATTRIBUTE_PUSH_ENABLED;

export const pushAttributesViaV64 = async (
  matnr: string,
  item: Record<string, unknown>
): Promise<AttributePushResult> => {
  const result: AttributePushResult = {
    ok: false,
    matnr: padMatnr(matnr),
    writtenCount: 0,
    nicCount: 0,
    lockedCount: 0,
  };

  if (!SAP_ATTRIBUTE_PUSH_ENABLED) {
    result.errorMessage = 'attribute push disabled (SAP_ATTRIBUTE_PUSH_ENABLED=false)';
    return result;
  }

  const built = buildChangesString(item);
  if (built.count === 0) {
    result.ok = true;
    result.errorMessage = 'no characteristic attributes to push';
    return result;
  }

  // Per-ATNAM lookup of the ORIGINAL "ATNAM=value" parts, so the atomic-fail
  // retry rebuilds from real values (SAP's plan rows echo an empty value).
  const partByAtnam = new Map<string, string>();
  for (const seg of built.changes.split('|')) {
    const idx = seg.indexOf('=');
    if (idx > 0) partByAtnam.set(seg.slice(0, idx).trim().toUpperCase(), seg);
  }

  try {
    // Step 1: lookup MATKL authoritatively
    const matkl = await fetchMatkl(matnr);
    if (!matkl) {
      result.errorMessage = 'MATKL lookup failed (RFC_READ_TABLE MARA returned no row)';
      return result;
    }
    result.matkl = matkl;

    // Step 2: link matnr to MATKL-class (idempotent)
    const link = await linkMatnrToClass(matnr, matkl);
    if (!link.ok) {
      result.errorMessage = `class link failed: ${link.message}`;
      return result;
    }

    // Step 3: V64 write
    const first = await callV64(matnr, built.changes, '');
    result.planLog = first.plan;

    if (first.ok) {
      const tally = tallyPlan(first.plan);
      result.ok = true;
      result.writtenCount = tally.writtenCount;
      result.nicCount = tally.nicCount;
      result.lockedCount = tally.lockedCount;
      return result;
    }

    // Atomic-fail path: filter to PLANNED-only and retry once — rebuild from the
    // ORIGINAL values (partByAtnam), NOT p.value which SAP returns empty.
    const planned = first.plan.filter((p) => p.status === 'PLANNED');
    if (planned.length > 0) {
      const filtered = planned
        .map((p) => partByAtnam.get(p.atnam.trim().toUpperCase()))
        .filter(Boolean)
        .join('|');
      const second = await callV64(matnr, filtered, '');
      result.planLog = second.plan;
      const tally = tallyPlan(second.plan);
      result.ok = second.ok;
      result.writtenCount = tally.writtenCount;
      result.nicCount = (first.plan.length - planned.length) + tally.nicCount;
      result.lockedCount = tally.lockedCount;
      if (!second.ok) {
        result.errorMessage = `V64 retry returned ok:false (${tally.writtenCount} written, ${tally.nicCount} nic)`;
      }
      return result;
    }

    const tally = tallyPlan(first.plan);
    result.writtenCount = 0;
    result.nicCount = tally.nicCount;
    result.lockedCount = tally.lockedCount;
    result.errorMessage = `V64 atomic-fail: 0 PLANNED, ${tally.nicCount} NIC, ${tally.lockedCount} LOCKED`;
    return result;
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message : 'unknown V64 push error';
    return result;
  }
};

/**
 * Push a RAW map of SAP characteristic names → values onto one article.
 *
 * Unlike pushAttributesViaV64 (which maps camelCase DB fields via
 * getSapFieldMappings), this takes the SAP ATNAMs directly — used by the
 * "Pool B" Excel uploader, whose column headers ARE the SAP characteristic
 * names (M_FAB_DIV, M_YARN, …). Same proven chain: MATKL lookup → class link →
 * patch FM → atomic-fail retry on PLANNED-only.
 *
 * @param changes { ATNAM: value } — empty values are skipped
 * @param opts.test true → SAP test mode (no permanent write)
 */
export const pushRawAttributesToSap = async (
  matnr: string,
  changes: Record<string, string>,
  opts: { test?: boolean; env?: string } = {},
): Promise<AttributePushResult> => {
  const env = opts.env; // undefined → callProxy falls back to SAP_ENV
  const result: AttributePushResult = {
    ok: false,
    matnr: padMatnr(matnr),
    writtenCount: 0,
    nicCount: 0,
    lockedCount: 0,
  };

  if (!SAP_ATTRIBUTE_PUSH_ENABLED) {
    result.errorMessage = 'attribute push disabled (SAP_ATTRIBUTE_PUSH_ENABLED=false)';
    return result;
  }

  // Build IV_CHANGES ("ATNAM=value|ATNAM=value") directly from the raw map.
  // Also keep a per-ATNAM lookup of the ORIGINAL value so the atomic-fail retry
  // can rebuild the payload from real values — SAP's returned plan rows echo an
  // EMPTY value, so retrying from them would blank every field.
  const seen = new Set<string>();
  const parts: string[] = [];
  const partByAtnam = new Map<string, string>();
  for (const [rawKey, rawVal] of Object.entries(changes)) {
    const atnam = String(rawKey || '').trim().toUpperCase();
    const value = sapValue(rawVal);
    if (!atnam || !value || seen.has(atnam)) continue;
    seen.add(atnam);
    const safeValue = value.replace(/\|/g, '/').replace(/=/g, '-');
    const part = `${atnam}=${safeValue}`;
    parts.push(part);
    partByAtnam.set(atnam, part);
  }
  if (parts.length === 0) {
    result.ok = true;
    result.errorMessage = 'no non-empty attributes to push';
    return result;
  }
  const ivChanges = parts.join('|');
  const testMode = opts.test ? 'X' : '';

  try {
    const matkl = await fetchMatkl(matnr, env);
    if (!matkl) {
      result.errorMessage = 'MATKL lookup failed (RFC_READ_TABLE MARA returned no row)';
      return result;
    }
    result.matkl = matkl;

    const link = await linkMatnrToClass(matnr, matkl, env);
    if (!link.ok) {
      result.errorMessage = `class link failed: ${link.message}`;
      return result;
    }

    const first = await callV64(matnr, ivChanges, testMode, env);
    result.planLog = first.plan;
    if (first.ok) {
      const tally = tallyPlan(first.plan);
      result.ok = true;
      result.writtenCount = tally.writtenCount;
      result.nicCount = tally.nicCount;
      result.lockedCount = tally.lockedCount;
      return result;
    }

    // Atomic-fail: retry PLANNED-only once — rebuild from the ORIGINAL values
    // (partByAtnam), NOT p.value which SAP returns empty.
    const planned = first.plan.filter((p) => p.status === 'PLANNED');
    if (planned.length > 0) {
      const filtered = planned
        .map((p) => partByAtnam.get(p.atnam.trim().toUpperCase()))
        .filter(Boolean)
        .join('|');
      const second = await callV64(matnr, filtered, testMode, env);
      result.planLog = second.plan;
      const tally = tallyPlan(second.plan);
      result.ok = second.ok;
      result.writtenCount = tally.writtenCount;
      result.nicCount = (first.plan.length - planned.length) + tally.nicCount;
      result.lockedCount = tally.lockedCount;
      if (!second.ok) result.errorMessage = `patch retry ok:false (${tally.writtenCount} written, ${tally.nicCount} nic)`;
      return result;
    }

    const tally = tallyPlan(first.plan);
    result.nicCount = tally.nicCount;
    result.lockedCount = tally.lockedCount;
    // Empty/unrecognised plan → surface the raw SAP response so we can see WHY
    // (e.g. FM not found on this env, or a different response shape).
    let rawSnippet = '';
    try { rawSnippet = JSON.stringify(first.raw).slice(0, 400); } catch { rawSnippet = String(first.raw).slice(0, 400); }
    result.errorMessage =
      `atomic-fail: 0 PLANNED, ${tally.nicCount} NIC, ${tally.lockedCount} LOCKED` +
      (first.plan.length === 0 ? ` | empty plan — SAP raw: ${rawSnippet}` : '');
    return result;
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message : 'unknown patch error';
    return result;
  }
};
