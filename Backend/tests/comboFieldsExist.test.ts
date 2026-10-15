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
