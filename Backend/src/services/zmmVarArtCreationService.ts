/**
 * zmmVarArtCreationService.ts
 *
 * SAP RFC integration for Variant Article Creation.
 * Calls ZMM_VAR_ART_CREATION_RFC with a JSON body after a generic article
 * is successfully created via ZMM_ART_CREATION_RFC.
 *
 * Each variant gets its own RFC call with:
 *   GENERIC_ARTICLE  = SAP article number returned from generic creation
 *   VAR1CHAR1/VAR1VAL1 = V2_SIZE / size value
 *   VAR1CHAR2/VAR1VAL2 = V2_COLOR / color value
 *   + pricing, vendor, and static org fields
 */

import type { SapSyncItemResult } from './sapSyncService';
import { mapWithConcurrency } from '../utils/concurrency';

// ─── Config ───────────────────────────────────────────────────────────────────

// Hard timeout per variant RFC call so a hung SAP endpoint can't stall the worker.
const SAP_RFC_TIMEOUT_MS = parseInt(process.env.SAP_RFC_TIMEOUT_MS || '120000', 10);
// Parallel SAP RFC calls ("lanes"). Shared setting with the generic RFC service.
const SAP_RFC_CONCURRENCY = parseInt(process.env.SAP_RFC_CONCURRENCY || '7', 10);

const ZMM_VAR_RFC_ENABLED =
    (process.env.ZMM_RFC_ENABLED ?? process.env.SAP_SYNC_ENABLED ?? 'true').toLowerCase() === 'true';

// Fixed SAP org values — do not change per variant
const SAP_SITE       = process.env.SAP_SITE        || 'DH24';
const SAP_PUR_GRP    = process.env.SAP_PUR_GRP     || '124';
const SAP_SALES_ORG  = process.env.SAP_SALES_ORG   || '1100';
const SAP_SALES_UNIT = process.env.SAP_SALES_UNIT  || 'EA';
const SAP_TAX_CODE   = process.env.SAP_TAX_CODE    || 'J2';

// Proxy URL used for both variant RFC calls and SoT validation
const SAP_RFC_PROXY_URL = process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net/api/rfc/proxy';
const SAP_RFC_PROXY_KEY = process.env.SAP_RFC_PROXY_KEY || 'v2-rfc-proxy-2026';
const SAP_RFC_PROXY_ENV = process.env.SAP_RFC_PROXY_ENV || 'prod';
const SAP_SIZE_VALIDATION_ENABLED =
    (process.env.SAP_SIZE_VALIDATION_ENABLED ?? 'true').toLowerCase() === 'true';

async function validateVariantSizeOnSap(
    genericSapArt: string,
    variantSize: string
): Promise<{ ok: boolean; matkl: string; message: string }> {
    if (!SAP_SIZE_VALIDATION_ENABLED) {
        return { ok: true, matkl: '', message: 'validation disabled' };
    }
    const padded = String(genericSapArt).replace(/^0+/, '').padStart(18, '0');
    const url = SAP_RFC_PROXY_ENV
        ? `${SAP_RFC_PROXY_URL}?env=${encodeURIComponent(SAP_RFC_PROXY_ENV)}`
        : SAP_RFC_PROXY_URL;
    const body = {
        bapiname: 'Z_ART_VALIDATE_VARIANT_SIZE',
        IM_GENERIC_ARTICLE: padded,
        IM_SIZE: variantSize,
    };
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-RFC-Key': SAP_RFC_PROXY_KEY },
            body: JSON.stringify(body),
        });
        const j: any = await r.json().catch(() => ({}));
        const allowed = String(j?.EX_ALLOWED ?? '').toUpperCase() === 'X';
        const rc = Number(j?.EX_RC ?? 0);
        const msg = String(j?.EX_MSG ?? '');
        return {
            ok: allowed && rc === 0,
            matkl: String(j?.EX_MATKL ?? ''),
            message: allowed ? 'OK' : msg || `Size '${variantSize}' not permitted (RC=${rc})`,
        };
    } catch (err) {
        const m = err instanceof Error ? err.message : 'unknown error';
        console.warn(`[ZMM_VAR_RFC] SAP size-validation call failed (fail-open): ${m}`);
        return { ok: true, matkl: '', message: `validation skipped: ${m}` };
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FlatVariant = {
    id: string;
    genericArticleId?: string | null;
    variantSize?: string | null;
    variantColor?: string | null;
    colour?: string | null;
    vendorCode?: string | null;
    rate?: unknown;          // NET_PRICE
    mrp?: unknown;           // MRP_TYPE
    weight?: unknown;        // WEIGHT_NET_G (kg)
    variantWeight?: unknown; // variant-specific weight override
    [key: string]: unknown;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    // Prisma Decimal → plain number string
    if (typeof v === 'object' && typeof (v as any).toNumber === 'function') {
        const n: number = (v as any).toNumber();
        return isNaN(n) ? '' : String(n);
    }
    return String(v).trim();
};

/** Build the IM_DATA row for one variant RFC call */
function buildVariantPayload(
    genericSapArtNum: string,
    variant: FlatVariant
): Record<string, string> {
    // FROM_DATE: today in YYYYMMDD format
    const now = new Date();
    const dd   = String(now.getDate()).padStart(2, '0');
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const fromDate = `${yyyy}${mm}${dd}`;

    // VENDOR: pad to 10 digits with leading zeros
    const vendorRaw = toStr(variant.vendorCode).replace(/\D/g, '');
    const vendor = vendorRaw ? vendorRaw.padStart(10, '0') : '';

    return {
        // ── Dynamic — from variant record ─────────────────
        GENERIC_ARTICLE: genericSapArtNum,
        VAR1CHAR1:       'V2_COLOR',
        VAR1VAL1:        toStr(variant.colour ?? variant.variantColor), // color value e.g. "A_MIX"
        VAR1CHAR2:       'V2_SIZE',
        VAR1VAL2:        toStr(variant.variantSize),                    // size value e.g. "XL"
        VENDOR:          vendor,
        NET_PRICE:       toStr(variant.rate),
        MRP_TYPE:        toStr(variant.mrp),
        FROM_DATE:       fromDate,
        // ── Fixed SAP org values ──────────────────────────
        VARIANT_ARTICLE: '',
        SITE:            SAP_SITE,
        PUR_GRP:         SAP_PUR_GRP,
        SALES_ORG:       SAP_SALES_ORG,
        SALES_UNIT:      SAP_SALES_UNIT,
        TO_DATE:         '99991231',
        OLD_MAT_NO:      '',
        TAX_CODE:        SAP_TAX_CODE,
        WEIGHT_NET_G:    (() => {
            const raw = toStr(variant.variantWeight);
            const num = parseFloat(raw);
            return isNaN(num) ? '0.000' : num.toFixed(3);
        })(),
    };
}

/** Parse the RFC JSON response into a normalised outcome.
 *
 * New proxy response shape:
 *   { "EX_RETURN": [{ "TYPE": "S"|"E", "FIELD": "<article_number>", "MESSAGE": "..." }] }
 *
 * Legacy shape (flat root keys) also handled for backwards compatibility.
 */
function parseVariantRfcResponse(
    statusCode: number,
    body: string
): { ok: boolean; sapArticleNumber?: string; fabricArticleNumber?: string; fabricArticleDescription?: string; message: string } {
    let parsed: Record<string, unknown> | undefined;

    try {
        parsed = JSON.parse(body);
    } catch {
        return {
            ok: false,
            message: body.trim() || `SAP returned HTTP ${statusCode} with no body`,
        };
    }

    // ── New format: EX_RETURN array from the RFC proxy ────────────────────────
    const exReturn = Array.isArray(parsed?.EX_RETURN) ? parsed!.EX_RETURN as Record<string, unknown>[] : null;
    if (exReturn && exReturn.length > 0) {
        const first = exReturn[0];
        const type    = toStr(first?.TYPE).toUpperCase();            // "S" or "E"
        const sapArt  = toStr(first?.FIELD).trim();                  // variant article number
        const msgText = toStr(first?.MESSAGE ?? first?.MSG ?? '').trim();

        const isHttpOk  = statusCode >= 200 && statusCode < 300;
        const isSuccess = isHttpOk && type === 'S';

        const message = msgText || (isSuccess ? `Variant created: ${sapArt}` : `SAP error (TYPE=${type})`);

        console.log(`[ZMM_VAR_RFC] EX_RETURN parsed: TYPE=${type} FIELD=${sapArt} MESSAGE=${msgText}`);

        return {
            ok: isSuccess,
            sapArticleNumber:         isSuccess && sapArt ? sapArt : undefined,
            fabricArticleNumber:      isSuccess && sapArt ? sapArt : undefined,
            fabricArticleDescription: msgText || undefined,
            message,
        };
    }

    // ── Legacy flat response (fallback) ───────────────────────────────────────
    const sapArt = toStr(
        parsed?.FIELD ??
        parsed?.SAP_ART ??
        parsed?.VARIANT_ARTICLE ??
        parsed?.ArticleNumber ??
        parsed?.ARTICLE_NUMBER ??
        ''
    );

    const sapMessageText = toStr(parsed?.sapMessage ?? parsed?.Message ?? parsed?.MESSAGE ?? parsed?.message ?? parsed?.MSG ?? '');
    const msgTyp  = toStr(parsed?.MSG_TYP ?? '').toUpperCase();
    const sapType = toStr(parsed?.sapType ?? parsed?.SAPTYPE ?? '').toUpperCase();
    const statusFlag = parsed?.Status ?? parsed?.status;

    const message = sapMessageText ||
        (sapArt ? `Variant created: ${sapArt}` : `SAP response HTTP ${statusCode} — ${JSON.stringify(parsed)}`);

    const isHttpOk     = statusCode >= 200 && statusCode < 300;
    const isStatusOk   = statusFlag !== false && statusFlag !== 'false' && statusFlag !== 0 && statusFlag !== '0';
    const isSapTypeOk  = !sapType || sapType === 'S' || sapType === 'SUCCESS';
    const isBusinessOk = isStatusOk && isSapTypeOk && msgTyp !== 'E' && msgTyp !== 'ERROR';
    const ok = isHttpOk && (sapArt ? true : isBusinessOk);

    return {
        ok,
        sapArticleNumber:         sapArt || undefined,
        fabricArticleNumber:      sapArt || undefined,
        fabricArticleDescription: sapMessageText || undefined,
        message,
    };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calls ZMM_VAR_ART_CREATION_RFC for every variant in the map.
 *
 * @param variantsByGenericId  Map<genericDbId, FlatVariant[]>
 * @param genericSapArticleMap Map<genericDbId, sapArticleNumber>  (from generic creation results)
 */
export async function syncVariantsToSapViaRfc(
    variantsByGenericId: Map<string, FlatVariant[]>,
    genericSapArticleMap: Map<string, string>
): Promise<SapSyncItemResult[]> {
    if (!ZMM_VAR_RFC_ENABLED) {
        console.log('[ZMM_VAR_RFC] Disabled via ZMM_RFC_ENABLED / SAP_SYNC_ENABLED env var');
        const results: SapSyncItemResult[] = [];
        for (const variants of variantsByGenericId.values()) {
            for (const v of variants) {
                results.push({ id: v.id, success: false, message: 'ZMM_VAR_ART_CREATION_RFC sync is disabled' });
            }
        }
        return results;
    }

    // IMPORTANT: variants of the SAME generic share one SAP material-group lock, so
    // they MUST be created sequentially — firing them in parallel makes all but one
    // fail with "The group data for the material … is locked". Different generics
    // are independent, so we parallelise ACROSS generics (up to SAP_RFC_CONCURRENCY)
    // while keeping each generic's own variants strictly one-at-a-time.
    const entries = Array.from(variantsByGenericId.entries());
    const perGeneric = await mapWithConcurrency(entries, SAP_RFC_CONCURRENCY, async ([genericId, variants]): Promise<SapSyncItemResult[]> => {
        const genericSapArt = genericSapArticleMap.get(genericId);
        if (!genericSapArt) {
            console.warn(`[ZMM_VAR_RFC] Skipping ${variants.length} variant(s) for genericId=${genericId}: no SAP article number`);
            return variants.map((v) => ({ id: v.id, success: false, message: 'Generic article SAP number not available; variant skipped' }));
        }

        const out: SapSyncItemResult[] = [];
        for (const variant of variants) { // sequential within a generic (shared SAP lock)
            // const variantSizeStr = toStr(variant.variantSize);
            // if (variantSizeStr) {
            //     const check = await validateVariantSizeOnSap(genericSapArt, variantSizeStr);
            //     if (!check.ok) {
            //         console.warn(
            //             `[ZMM_VAR_RFC] ❌ Pre-flight SoT BLOCKED variantId=${variant.id} ` +
            //             `size='${variantSizeStr}' matkl='${check.matkl}' — ${check.message}`
            //         );
            //         out.push({
            //             id: variant.id,
            //             success: false,
            //             message: `Pre-flight ZART_GRID_VALUES rejected: ${check.message}`,
            //         });
            //         continue;
            //     }
            // }

            const imDataRow = buildVariantPayload(genericSapArt, variant);
            const requestBody = {
                bapiname: 'ZMM_VAR_ART_CREATION_RFC',
                IM_DATA: [imDataRow],
            };
            const proxyUrl = SAP_RFC_PROXY_ENV
                ? `${SAP_RFC_PROXY_URL}?env=${encodeURIComponent(SAP_RFC_PROXY_ENV)}`
                : SAP_RFC_PROXY_URL;

            console.log(
                `[ZMM_VAR_RFC] Creating variant → variantDbId=${variant.id}\n` +
                `  URL: ${proxyUrl}\n` +
                `  Full payload: ${JSON.stringify(requestBody, null, 2)}\n` +
                `  Variant DB fields: variantSize=${variant.variantSize} colour=${variant.colour} variantColor=${variant.variantColor} vendorCode=${variant.vendorCode} rate=${variant.rate} mrp=${variant.mrp}`
            );

            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), SAP_RFC_TIMEOUT_MS);
            try {
                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-RFC-Key': SAP_RFC_PROXY_KEY,
                    },
                    body: JSON.stringify(requestBody),
                    signal: ctrl.signal,
                });

                const responseText = await response.text();
                console.log(
                    `[ZMM_VAR_RFC] RAW SAP response (status=${response.status}) for variantId=${variant.id}:`,
                    responseText
                );

                const outcome = parseVariantRfcResponse(response.status, responseText);

                if (outcome.ok) {
                    console.log(
                        `[ZMM_VAR_RFC] ✅ Variant created: ${outcome.sapArticleNumber ?? 'no art num'}` +
                        ` fabricArticleNumber=${outcome.fabricArticleNumber ?? '-'}` +
                        ` for variantId=${variant.id}`
                    );
                    out.push({
                        id: variant.id,
                        success: true,
                        statusCode: response.status,
                        message: outcome.message,
                        sapArticleNumber: outcome.sapArticleNumber,
                        fabricArticleNumber: outcome.fabricArticleNumber,
                        fabricArticleDescription: outcome.fabricArticleDescription,
                    });
                } else {
                    console.warn(`[ZMM_VAR_RFC] ❌ SAP rejected variantId=${variant.id}: ${outcome.message}`);
                    out.push({
                        id: variant.id,
                        success: false,
                        statusCode: response.status,
                        message: outcome.message,
                    });
                }
            } catch (err) {
                const isTimeout = err instanceof Error && err.name === 'AbortError';
                const msg = err instanceof Error ? err.message : 'Unknown network error';
                console.error(`[ZMM_VAR_RFC] ${isTimeout ? 'TIMEOUT' : 'Network error'} for variantId=${variant.id}:`, msg);
                out.push({
                    id: variant.id,
                    success: false,
                    message: isTimeout
                        ? `ZMM_VAR_ART_CREATION_RFC timed out after ${Math.round(SAP_RFC_TIMEOUT_MS / 1000)}s`
                        : `ZMM_VAR_ART_CREATION_RFC network error: ${msg}`,
                });
            } finally {
                clearTimeout(timer);
            }
        }
        return out;
    });

    return perGeneric.flat();
}
