/**
 * Run: npm run test:combo-fields
 *
 * recomputeComboParent writes COMBO_SUMMED_FIELDS / COMBO_MIRRORED_FIELDS with
 * prisma.extractionResultFlat.update. Prisma rejects a field the model no longer has, and
 * TypeScript cannot see it (the names are read dynamically). A merge from main that drops a
 * column (cmtpCost, cmpCost, fabCost, ... on 15-Oct) would silently break every set parent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMBO_SUMMED_FIELDS, COMBO_MIRRORED_FIELDS } from '../src/services/comboLinkService';

const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const model = /model ExtractionResultFlat \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
const columns = new Set(
    model.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
        .map((l) => l.split(/\s+/)[0]),
);

test('the schema model was found', () => {
    assert.ok(columns.size > 100, `ExtractionResultFlat has ${columns.size} fields`);
    assert.ok(columns.has('setGroupId') && columns.has('comboRole'));
});

test('every summed set field is a column of ExtractionResultFlat', () => {
    assert.deepEqual(COMBO_SUMMED_FIELDS.filter((f) => !columns.has(f)), []);
});

test('every mirrored set field is a column of ExtractionResultFlat', () => {
    assert.deepEqual(COMBO_MIRRORED_FIELDS.filter((f) => !columns.has(f)), []);
});

test('a set adds up every costing-card value of its parts', () => {
    // one field of each card, plus a card total
    for (const f of ['autoBgt', 'roughV2', 'finalCost', 'cuttingBgtPrVal', 'totalFinalPrVal',
        'labelAutoBgt', 'bTrimTotalRoughV2', 'printVendorCost', 'vaddTotalFinalCost', 'boppNetPrice']) {
        assert.ok(COMBO_SUMMED_FIELDS.includes(f), `${f} is not summed`);
    }
    // a per-unit rate is not summed
    assert.ok(!COMBO_SUMMED_FIELDS.includes('labelRate'));
});

test('every costing column of ExtractionResultFlat is summed for a set', () => {
    const costing = /(AutoBgt|RoughV2|VdrCost|FinalCost|VendorCost|NetPrice|BgtPrVal|ActPrVal|VendorPrVal|FinalPrVal)$/;
    const missing = [...columns].filter((c) => costing.test(c) && !COMBO_SUMMED_FIELDS.includes(c));
    assert.deepEqual(missing, []);
});
