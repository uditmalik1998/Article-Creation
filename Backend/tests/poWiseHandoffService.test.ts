/**
 * Run: npm run test:handoff
 * (node's built-in runner; this backend has no test framework of its own.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffArticle, istToday, sendHandoffToPoWise, type HandoffArticle } from '../src/services/poWiseHandoffService';

const GENERIC = {
    majorCategory: 'M_JEANS', mcCode: '112020705', articleDescription: 'M JEANS SLIM',
    vendorCode: '200229', vendorName: 'V L K ASSOCIATES PVT LTD', designNumber: '26010-C',
};
const VARIANTS = [
    { id: 'v1', variantSize: '32', colour: 'JET BLACK', variantColor: 'JB', vendorCode: '200229', mrp: { toNumber: () => 699 } },
    { id: 'v2', variantSize: '34', colour: null, variantColor: 'JET BLACK', vendorCode: '200229', mrp: '' },
    { id: 'v3', variantSize: '36', colour: 'JET BLACK', vendorCode: '200229', mrp: 699 },
];
const NOW = new Date('2026-09-28T20:00:00Z'); // 01:30 on 29-Sep in IST

const silent = { log() {}, warn() {}, error() {} };
const noSleep = async () => {};

test('istToday uses the IST date, as SAP stamps ERSDA', () => {
    assert.equal(istToday(NOW), '2026-09-29');
    assert.equal(istToday(new Date('2026-09-28T10:00:00Z')), '2026-09-28');
});

test('builds one generic from the variants SAP created, and only those', () => {
    const a = buildHandoffArticle(GENERIC, '0000001112133320', VARIANTS, [
        { id: 'v1', success: true, sapArticleNumber: '000001112133320007' },
        { id: 'v2', success: true, sapArticleNumber: '1112133320008' },
        { id: 'v3', success: false },                                  // SAP rejected it
        { id: 'other-generic', success: true, sapArticleNumber: '1115106433099' }, // not this generic's
    ], NOW);
    assert.deepEqual(a, {
        generic: '1112133320',
        major_category: 'M_JEANS', mc_code: '112020705', description: 'M JEANS SLIM',
        vendor_code: '200229', vendor_name: 'V L K ASSOCIATES PVT LTD', vendor_design_no: '26010-C',
        variants: [
            // colour is what was sent to SAP as V2_COLOR: colour first, then variantColor
            { var_article: '1112133320007', color: 'JET BLACK', size: '32', mrp: 699, vendor_code: '200229', created_on: '2026-09-29' },
            // a blank MRP is null, never Rs 0
            { var_article: '1112133320008', color: 'JET BLACK', size: '34', mrp: null, vendor_code: '200229', created_on: '2026-09-29' },
        ],
    });
});

test('nothing to send without a generic number or a created variant', () => {
    assert.equal(buildHandoffArticle(GENERIC, null, VARIANTS, [{ id: 'v1', success: true, sapArticleNumber: '1112133320007' }]), null);
    assert.equal(buildHandoffArticle(GENERIC, '1112133320', VARIANTS, [{ id: 'v1', success: false }]), null);
    assert.equal(buildHandoffArticle(GENERIC, '1112133320', VARIANTS, [{ id: 'v1', success: true }]), null);
});

const ARTICLE: HandoffArticle = buildHandoffArticle(GENERIC, '1112133320', VARIANTS, [{ id: 'v1', success: true, sapArticleNumber: '1112133320007' }], NOW)!;

function fakeFetch(responses: Array<number | 'throw'>) {
    const calls: any[] = [];
    const impl = async (url: string, init: any) => {
        calls.push({ url, init });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (r === 'throw') throw new Error('ECONNRESET');
        return { ok: r >= 200 && r < 300, status: r, text: async () => '{"success":true}' };
    };
    return { impl, calls };
}

test('sends with the secret header to the default PO-Wise function', async () => {
    const f = fakeFetch([200]);
    const r = await sendHandoffToPoWise([ARTICLE, null], { env: { PO_WISE_HANDOFF_SECRET: 's3cret' }, fetchImpl: f.impl, sleep: noSleep, log: silent });
    assert.deepEqual(r, { sent: true, attempts: 1, status: 200 });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/article-created-handoff');
    assert.equal(f.calls[0].init.headers['X-Handoff-Secret'], 's3cret');
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.source, 'article-creation');
    assert.deepEqual(body.articles, [ARTICLE]);
});

test('retries a 5xx and a network error, then succeeds', async () => {
    const f = fakeFetch([503, 'throw', 200]);
    const r = await sendHandoffToPoWise([ARTICLE], { env: { PO_WISE_HANDOFF_SECRET: 's' }, fetchImpl: f.impl, sleep: noSleep, log: silent });
    assert.equal(r.sent, true);
    assert.equal(r.attempts, 3);
});

test('does not retry a 401 — it will fail the same way again', async () => {
    const f = fakeFetch([401]);
    const r = await sendHandoffToPoWise([ARTICLE], { env: { PO_WISE_HANDOFF_SECRET: 's' }, fetchImpl: f.impl, sleep: noSleep, log: silent });
    assert.equal(r.sent, false);
    assert.equal(r.attempts, 1);
    assert.equal(r.status, 401);
});

test('gives up after three attempts without throwing', async () => {
    const f = fakeFetch(['throw']);
    const r = await sendHandoffToPoWise([ARTICLE], { env: { PO_WISE_HANDOFF_SECRET: 's' }, fetchImpl: f.impl, sleep: noSleep, log: silent });
    assert.equal(r.sent, false);
    assert.equal(f.calls.length, 3);
});

test('is off without a secret, or when disabled, and sends nothing', async () => {
    const f = fakeFetch([200]);
    assert.equal((await sendHandoffToPoWise([ARTICLE], { env: {}, fetchImpl: f.impl, log: silent })).reason, 'no secret');
    assert.equal((await sendHandoffToPoWise([ARTICLE], { env: { PO_WISE_HANDOFF_SECRET: 's', PO_WISE_HANDOFF_ENABLED: 'false' }, fetchImpl: f.impl, log: silent })).reason, 'disabled');
    assert.equal((await sendHandoffToPoWise([null], { env: { PO_WISE_HANDOFF_SECRET: 's' }, fetchImpl: f.impl, log: silent })).reason, 'nothing to send');
    assert.equal(f.calls.length, 0);
});

test('never rejects, even when building the payload throws', async () => {
    const r = await sendHandoffToPoWise(() => { throw new Error('bug'); }, { env: { PO_WISE_HANDOFF_SECRET: 's' }, log: silent });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'unexpected error');
});
