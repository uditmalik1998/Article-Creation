/**
 * Run: npm run test:set-link
 *
 * The set link writes a part's old article (BISMT) = its parent's article number
 * with Z_ART_PATCH_RFC_V69. Only a real APPLIED counts as linked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bismtChange, interpretLinkResponse } from '../src/services/setLinkService';

// Shapes copied from the proxy (21-Oct-2026).
const applied = { EV_JSON: '{"matnr":"000000001240063901","ok":true,"applied":1,"matkl":"240207004","merge":true,"results":[{"fn":"BISMT","route":"MARA","klart":"","class":"","status":"APPLIED"}]}' };
const notFound = { EV_JSON: '{"matnr":"000000001240063901","ok":false,"matkl":"240207004","plan":[{"fn":"BISMT","route":"NONE","status":"INVALID","msg":"BISMT value not found in MARA"}]}' };
const testMode = { EV_JSON: '{"matnr":"000000001240063901","ok":true,"test_mode":true,"plan":[{"fn":"BISMT","route":"MARA","klart":"","class":""}]}' };

test('IV_CHANGES is BISMT=<parent number> without leading zeros', () => {
    assert.equal(bismtChange('000000001124040155'), 'BISMT=1124040155');
    assert.equal(bismtChange(' 1124040155 '), 'BISMT=1124040155');
});

test('only ok:true with BISMT APPLIED is a link', () => {
    assert.deepEqual(interpretLinkResponse(true, 200, applied), { ok: true, message: 'BISMT applied' });
});

test('SAP refusal keeps its reason', () => {
    assert.deepEqual(interpretLinkResponse(true, 200, notFound), { ok: false, message: 'BISMT value not found in MARA' });
});

test('an article missing in SAP reports NOT_IN_MARA', () => {
    const missing = { EV_JSON: '{"matnr":"000000001124040151","ok":false,"err":"NOT_IN_MARA"}' };
    assert.deepEqual(interpretLinkResponse(true, 200, missing), { ok: false, message: 'NOT_IN_MARA' });
});

test('a test-mode plan is not a link', () => {
    assert.equal(interpretLinkResponse(true, 200, testMode).ok, false);
});

test('HTTP failure (e.g. Cloudflare 524) is not a link', () => {
    const r = interpretLinkResponse(false, 524, undefined, 'A timeout occurred');
    assert.equal(r.ok, false);
    assert.match(r.message, /^HTTP 524/);
});
