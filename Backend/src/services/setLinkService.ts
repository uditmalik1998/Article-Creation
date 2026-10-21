/**
 * Set article → SAP link: a set part's old article (MARA-BISMT) is set to its set
 * parent's article number with Z_ART_PATCH_RFC_V69, right after the part is created.
 *
 * Order (runApprovalSyncTick): the parent is created first; each part waits until
 * its parent has a SAP number, is created, and is then linked here.
 *
 *   IV_MATNR   = the part's article number (18 digits, zero padded)
 *   IV_CHANGES = "BISMT=<parent article number>"
 *
 * Success = EV_JSON ok:true with BISMT APPLIED. Writing the same BISMT again is
 * harmless, so a failed or timed-out link is simply retried (up to
 * SET_LINK_MAX_ATTEMPTS) by retryPendingSetLinks on every sync tick.
 */
import { prismaClient as prisma } from '../utils/prisma';
import { callProxy, unwrapBody } from './sapAttributePushService';

const SET_LINK_FM = process.env.SAP_SET_LINK_FM || 'Z_ART_PATCH_RFC_V69';
const SET_LINK_ENABLED = (process.env.SAP_SET_LINK_ENABLED || 'true').toLowerCase() === 'true';
// IV_TEST_MODE=X: SAP only plans the change. Nothing is written and no status is saved.
const SET_LINK_TEST_MODE = (process.env.SAP_SET_LINK_TEST_MODE || 'false').toLowerCase() === 'true';
// Same SAP system the articles are created in (ZMM_ART_CREATION_RFC runs on prod).
const SET_LINK_ENV = (process.env.SAP_SET_LINK_ENV || process.env.SAP_ENV || 'prod').toLowerCase();
export const SET_LINK_MAX_ATTEMPTS = 5;

const padMatnr = (matnr: string): string => String(matnr || '').trim().padStart(18, '0');

/** IV_CHANGES for one part: its parent's article number without leading zeros. */
export function bismtChange(parentArticleNumber: string): string {
    return `BISMT=${String(parentArticleNumber || '').trim().replace(/^0+/, '')}`;
}

/** Read the proxy's answer. ok only when SAP really applied BISMT. */
export function interpretLinkResponse(httpOk: boolean, httpStatus: number, body: any, rawText = ''): { ok: boolean; message: string } {
    if (!httpOk) {
        // 524 = Cloudflare gave up waiting; SAP may still have written it (retry is harmless).
        return { ok: false, message: `HTTP ${httpStatus}: ${String(rawText).slice(0, 200)}` };
    }
    const inner = unwrapBody(body) ?? {};
    const rows: any[] = Array.isArray(inner.results) ? inner.results : Array.isArray(inner.plan) ? inner.plan : [];
    const bismt = rows.find((r) => String(r?.fn ?? '').toUpperCase() === 'BISMT');
    const status = String(bismt?.status ?? '').toUpperCase();
    if (inner.ok === true && status === 'APPLIED') return { ok: true, message: 'BISMT applied' };
    const why = bismt?.msg || bismt?.status || inner.err || inner.message || inner.error || (inner.ok === false ? 'ok:false' : 'no BISMT result');
    return { ok: false, message: String(why).slice(0, 300) };
}

type LinkOutcome = { ok: boolean; message: string; skipped?: boolean };

/** Link one created set part to its parent in SAP and record the outcome on the part. */
export async function linkSetPart(partId: string): Promise<LinkOutcome> {
    if (!SET_LINK_ENABLED) return { ok: false, skipped: true, message: 'set link disabled (SAP_SET_LINK_ENABLED=false)' };
    const part = await prisma.extractionResultFlat.findUnique({
        where: { id: partId },
        select: {
            comboRole: true, sapArticleId: true, setLinkAttempts: true,
            comboParent: { select: { sapArticleId: true } },
        },
    });
    const partNo = part?.sapArticleId?.trim();
    const parentNo = part?.comboParent?.sapArticleId?.trim();
    if (part?.comboRole !== 'CHILD' || !partNo || !parentNo) {
        return { ok: false, skipped: true, message: 'not a created set part with a created parent' };
    }

    const changes = bismtChange(parentNo);
    let outcome: LinkOutcome;
    try {
        const res = await callProxy(SET_LINK_FM, {
            IV_MATNR: padMatnr(partNo),
            IV_CHANGES: changes,
            IV_TEST_MODE: SET_LINK_TEST_MODE ? 'X' : '',
        }, SET_LINK_ENV);
        outcome = SET_LINK_TEST_MODE
            ? { ok: false, skipped: true, message: `test mode: ${res.rawText.slice(0, 300)}` }
            : interpretLinkResponse(res.ok, res.status, res.body, res.rawText);
    } catch (err: any) {
        outcome = { ok: false, message: `network error: ${String(err?.message ?? err).slice(0, 200)}` };
    }
    console.log(`[SetLink] ${partNo} ${changes} → ${outcome.ok ? 'LINKED' : outcome.skipped ? 'SKIPPED' : 'FAILED'}: ${outcome.message}`);
    if (outcome.skipped) return outcome;

    await prisma.extractionResultFlat.update({
        where: { id: partId },
        data: {
            setLinkStatus: outcome.ok ? 'LINKED' : 'FAILED',
            setLinkMessage: `${changes}: ${outcome.message}`,
            setLinkAttempts: (part.setLinkAttempts ?? 0) + 1,
            setLinkedAt: outcome.ok ? new Date() : null,
        },
    });
    return outcome;
}

/**
 * Link created set parts that are not linked yet: a part whose link failed, or a
 * part created before this flow (parent and part both in SAP). One by one.
 */
export async function retryPendingSetLinks(limit = 10): Promise<number> {
    if (!SET_LINK_ENABLED || SET_LINK_TEST_MODE) return 0;
    const pending = await prisma.extractionResultFlat.findMany({
        where: {
            comboRole: 'CHILD',
            sapSyncStatus: 'SYNCED',
            sapArticleId: { not: null },
            OR: [{ setLinkStatus: null }, { setLinkStatus: 'FAILED' }],
            setLinkAttempts: { lt: SET_LINK_MAX_ATTEMPTS },
            comboParent: { is: { sapSyncStatus: 'SYNCED', sapArticleId: { not: null } } },
        },
        select: { id: true },
        orderBy: { approvedAt: 'asc' },
        take: limit,
    });
    let linked = 0;
    for (const p of pending) {
        if ((await linkSetPart(p.id)).ok) linked++;
    }
    return linked;
}
