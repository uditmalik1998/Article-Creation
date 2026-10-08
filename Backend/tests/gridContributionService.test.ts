/**
 * Run: npm run test:grid-contribution
 * (node's built-in runner; this backend has no test framework of its own.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalChainKey,
  buildBlockDiff,
  fromBlockKey,
  kindFromRequestKind,
  parsePercent,
  toBlockKey,
  type BlockRow,
} from '../src/services/gridContributionService';

// The sheet's own example: M_TEES_HS -> M_FIT.
const FIT: BlockRow[] = [
  { id: 1, value: 'LOOSE_FIT', bgt: null, pd: 30, auto: 25 },
  { id: 2, value: 'REG_FIT', bgt: null, pd: 70, auto: 75 },
];

test('parsePercent accepts 0-100 with up to 2 decimals, blank as clear', () => {
  assert.deepEqual(parsePercent('50'), { value: 50 });
  assert.deepEqual(parsePercent(' 12.5% '), { value: 12.5 });
  assert.deepEqual(parsePercent(33.33), { value: 33.33 });
  assert.deepEqual(parsePercent(''), { value: null });
  assert.deepEqual(parsePercent(null), { value: null });
  assert.ok('error' in parsePercent('abc'));
  assert.ok('error' in parsePercent(101));
  assert.ok('error' in parsePercent(-1));
  assert.ok('error' in parsePercent('10.555'));
});

test('a block that adds up to 100 gives a diff of only the changed values', () => {
  const r = buildBlockDiff(FIT, 'BGT', { LOOSE_FIT: 50, REG_FIT: '50' });
  assert.ok(!('error' in r));
  assert.deepEqual(r.diff, { LOOSE_FIT: { old: null, new: 50 }, REG_FIT: { old: null, new: 50 } });
  assert.equal(r.total, 100);

  const pd = buildBlockDiff(FIT, 'PD', { LOOSE_FIT: 40, REG_FIT: 60 });
  assert.ok(!('error' in pd));
  assert.deepEqual(Object.keys(pd.diff).sort(), ['LOOSE_FIT', 'REG_FIT']);
});

test('the sum is checked on the merged block, not just what was sent', () => {
  // PD is 30/70 today; moving only LOOSE_FIT to 40 leaves 110.
  const r = buildBlockDiff(FIT, 'PD', { LOOSE_FIT: 40 });
  assert.ok('error' in r && /add up to 100/.test(r.error) && /110/.test(r.error));
});

test('a block not adding up to 100 is refused', () => {
  const r = buildBlockDiff(FIT, 'BGT', { LOOSE_FIT: 50, REG_FIT: 40 });
  assert.ok('error' in r && /add up to 100/.test(r.error));
});

test('clearing every value of a block is allowed', () => {
  const r = buildBlockDiff(FIT, 'PD', { LOOSE_FIT: '', REG_FIT: null });
  assert.ok(!('error' in r));
  assert.deepEqual(r.diff, { LOOSE_FIT: { old: 30, new: null }, REG_FIT: { old: 70, new: null } });
});

test('unknown values and no-op submissions are refused', () => {
  const unknown = buildBlockDiff(FIT, 'BGT', { SLIM_FIT: 100 });
  assert.ok('error' in unknown && /SLIM_FIT/.test(unknown.error));
  const noop = buildBlockDiff(FIT, 'PD', { LOOSE_FIT: 30, REG_FIT: 70 });
  assert.ok('error' in noop && /No % changed/.test(noop.error));
});

test('BGT and PD columns stay independent', () => {
  // Filling Bgt does not count the existing Pd values towards its sum.
  const r = buildBlockDiff(FIT, 'BGT', { LOOSE_FIT: 100, REG_FIT: 0 });
  assert.ok(!('error' in r));
  assert.deepEqual(r.diff.LOOSE_FIT, { old: null, new: 100 });
});

test('request kinds route to the contribution chain; ordinary requests do not', () => {
  assert.equal(kindFromRequestKind('BGT_CONT'), 'BGT');
  assert.equal(kindFromRequestKind('PD_CONT'), 'PD');
  assert.equal(kindFromRequestKind(null), null);
  assert.equal(approvalChainKey({ tableKey: 'major-category-grid', requestKind: 'PD_CONT' }), 'major-category-grid#contribution');
  assert.equal(approvalChainKey({ tableKey: 'major-category-grid', requestKind: null }), 'major-category-grid');
});

test('block keys round-trip', () => {
  assert.deepEqual(fromBlockKey(toBlockKey('M_TEES_HS', 'M_FIT')), { majorCategory: 'M_TEES_HS', attributeName: 'M_FIT' });
});
