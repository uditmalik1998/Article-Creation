/**
 * poWiseHandoffService.ts
 *
 * Tells PO-Wise about variants the moment SAP creates them.
 *
 * PO-Wise reads variants from its snowflake_variant_article_master mirror, which SAP reaches only
 * through Snowflake, 2 to 3 hours later. Until then PO-Wise says the size does not exist and a
 * buyer's draft blocks it. After ZMM_VAR_ART_CRT_V8 returns the new numbers we POST them to
 * PO-Wise's article-created-handoff function, which adds the rows it does not hold yet (add only,
 * so a retry or a duplicate call is harmless). PO-Wise's own SAP fast lane stays on as the safety
 * net, so a hand-off that fails costs minutes, not hours.
 *
 * NEVER FAILS ARTICLE CREATION. The send is fire-and-forget: callers `void` it, it catches
 * everything, and it only logs.
 *
 * Config (env):
 *   PO_WISE_HANDOFF_SECRET   required; without it the hand-off is off. Shared with PO-Wise's vault
 *                            secret ARTICLE_HANDOFF_SECRET. Never commit it. Set it as an Azure app
 *                            setting on v2-article-backend: deploy-backend.yml sets only the
 *                            settings it lists, so one set by hand survives every deploy.
 *   PO_WISE_HANDOFF_URL      optional; defaults to PO-Wise's production function.
 *   PO_WISE_HANDOFF_ENABLED  optional; 'false' turns it off without removing the secret.
 */

const DEFAULT_URL = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/article-created-handoff';
const TIMEOUT_MS = 15_000;
/** Waits before the 2nd and 3rd attempts. */
const RETRY_DELAYS_MS = [2_000, 8_000];

export interface HandoffVariant {
    var_article: string;
    color: string | null;
    size: string | null;
    mrp: number | null;
    vendor_code: string | null;
    created_on: string;
}

export interface HandoffArticle {
    generic: string;
    major_category: string | null;
    mc_code: string | null;
    description: string | null;
    vendor_code: string | null;
    vendor_name: string | null;
    vendor_design_no: string | null;
    variants: HandoffVariant[];
}

/** The generic's fields we read. Matches extraction_results_flat (Prisma) names. */
export interface HandoffGenericSource {
    majorCategory?: string | null;
    mcCode?: string | null;
    articleDescription?: string | null;
    vendorCode?: string | null;
    vendorName?: string | null;
    designNumber?: string | null;
}

export interface HandoffVariantSource {
    id: string;
    variantSize?: string | null;
    variantColor?: string | null;
    colour?: string | null;
    vendorCode?: string | null;
    mrp?: unknown;
}

export interface HandoffResult {
    id: string;
    success: boolean;
    sapArticleNumber?: string;
}

const text = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
};

/** Prisma Decimal, number or string to a number; blank to null (never 0). */
const money = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'object' && typeof (v as any).toNumber === 'function' ? (v as any).toNumber() : Number(String(v).trim());
    return String(v).trim() === '' || !Number.isFinite(n) ? null : n;
};

const stripZeros = (v: string) => v.trim().replace(/^0+/, '');

/** Today in IST as YYYY-MM-DD: SAP stamps the creation date (ERSDA) in IST. */
export function istToday(now: Date = new Date()): string {
    return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * One generic's hand-off, from the variants SAP just created. Only a success that carries a
 * number counts. Returns null when there is nothing to send (no SAP number, or no new variant).
 */
export function buildHandoffArticle(
    generic: HandoffGenericSource,
    genericSapNumber: string | null | undefined,
    variants: HandoffVariantSource[],
    results: HandoffResult[],
    now: Date = new Date(),
): HandoffArticle | null {
    const genericNo = stripZeros(String(genericSapNumber ?? ''));
    if (!genericNo) return null;
    const byId = new Map(variants.map((v) => [v.id, v]));
    const createdOn = istToday(now);
    const out: HandoffVariant[] = [];
    for (const r of results) {
        if (!r.success || !r.sapArticleNumber) continue;
        const v = byId.get(r.id);
        if (!v) continue;
        out.push({
            var_article: stripZeros(r.sapArticleNumber),
            // The same value sent to SAP as V2_COLOR, which is what MARA and PO-Wise hold.
            color: text(v.colour ?? v.variantColor),
            size: text(v.variantSize),
            mrp: money(v.mrp),
            vendor_code: text(v.vendorCode),
            created_on: createdOn,
        });
    }
    if (out.length === 0) return null;
    return {
        generic: genericNo,
        major_category: text(generic.majorCategory),
        mc_code: text(generic.mcCode),
        description: text(generic.articleDescription),
        vendor_code: text(generic.vendorCode),
        vendor_name: text(generic.vendorName),
        vendor_design_no: text(generic.designNumber),
        variants: out,
    };
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface SendOptions {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/** 5xx, 429 and network errors are worth another try; any other 4xx will fail the same way again. */
const retryable = (status: number) => status >= 500 || status === 429;

/**
 * Send the hand-off. Resolves to what happened; NEVER rejects. Retry-safe because PO-Wise adds
 * only rows it does not hold. Pass a builder function from a controller, so even a bug while
 * building the payload is caught here instead of in article creation.
 */
export async function sendHandoffToPoWise(
    articles: Array<HandoffArticle | null> | (() => Array<HandoffArticle | null>),
    opts: SendOptions = {},
): Promise<{ sent: boolean; attempts: number; status?: number; reason?: string }> {
    const env = opts.env ?? process.env;
    const log = opts.log ?? console;
    try {
        const built = typeof articles === 'function' ? articles() : articles;
        const list = built.filter((a): a is HandoffArticle => a !== null);
        if (list.length === 0) return { sent: false, attempts: 0, reason: 'nothing to send' };
        if ((env.PO_WISE_HANDOFF_ENABLED ?? 'true').toLowerCase() === 'false') {
            return { sent: false, attempts: 0, reason: 'disabled' };
        }
        const secret = (env.PO_WISE_HANDOFF_SECRET ?? '').trim();
        if (!secret) {
            log.warn('[PO_WISE_HANDOFF] PO_WISE_HANDOFF_SECRET is not set; PO-Wise will see these variants via Snowflake/fast lane instead');
            return { sent: false, attempts: 0, reason: 'no secret' };
        }
        const url = (env.PO_WISE_HANDOFF_URL ?? '').trim() || DEFAULT_URL;
        const fetchImpl: FetchLike = opts.fetchImpl ?? (globalThis.fetch as any);
        const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        const body = JSON.stringify({ source: 'article-creation', articles: list });
        const label = list.map((a) => `${a.generic}(${a.variants.length})`).join(',');

        let lastStatus: number | undefined;
        let lastReason = '';
        let attempts = 0;
        for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
            attempts = attempt;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            try {
                const res = await fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Handoff-Secret': secret },
                    body,
                    signal: ctrl.signal,
                });
                const txt = await res.text().catch(() => '');
                lastStatus = res.status;
                if (res.ok) {
                    log.log(`[PO_WISE_HANDOFF] ✅ ${label} → ${txt.slice(0, 300)}`);
                    return { sent: true, attempts: attempt, status: res.status };
                }
                lastReason = `HTTP ${res.status}: ${txt.slice(0, 300)}`;
                if (!retryable(res.status)) break;
            } catch (err: any) {
                lastReason = err?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : `network error: ${err?.message ?? err}`;
            } finally {
                clearTimeout(timer);
            }
            if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
        }
        log.error(`[PO_WISE_HANDOFF] ❌ ${label} not handed off (${lastReason}); PO-Wise's SAP fast lane will add them within minutes`);
        return { sent: false, attempts, status: lastStatus, reason: lastReason };
    } catch (err: any) {
        log.error(`[PO_WISE_HANDOFF] ❌ unexpected error (ignored): ${err?.message ?? err}`);
        return { sent: false, attempts: 0, reason: 'unexpected error' };
    }
}
