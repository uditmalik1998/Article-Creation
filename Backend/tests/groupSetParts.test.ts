/**
 * Run: npm run test:set-export
 *
 * Costing exports list each set's parent followed by its parts, so a selected set
 * card exports as one readable block (parent, then part 1, part 2, ...).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSetParts } from '../src/services/comboLinkService';

const r = (id: string, comboRole = 'NONE', comboParentId: string | null = null, comboChildOrder: number | null = null) =>
    ({ id, comboRole, comboParentId, comboChildOrder });

test('a parent is followed by its parts in child order; other rows keep their place', () => {
    const rows = [r('B2', 'CHILD', 'S1', 2), r('N1'), r('S1', 'PARENT'), r('B1', 'CHILD', 'S1', 1), r('N2')];
    assert.deepEqual(groupSetParts(rows).map((x) => x.id), ['N1', 'S1', 'B1', 'B2', 'N2']);
});

test('a part whose parent is not in the export stays where it was', () => {
    const rows = [r('N1'), r('P9', 'CHILD', 'MISSING', 1), r('N2')];
    assert.deepEqual(groupSetParts(rows).map((x) => x.id), ['N1', 'P9', 'N2']);
});

test('two sets keep their own parts', () => {
    const rows = [r('S1', 'PARENT'), r('S2', 'PARENT'), r('C2', 'CHILD', 'S2', 1), r('C1', 'CHILD', 'S1', 1)];
    assert.deepEqual(groupSetParts(rows).map((x) => x.id), ['S1', 'C1', 'S2', 'C2']);
});
