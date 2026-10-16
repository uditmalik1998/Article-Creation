/**
 * Run: npm run test:set-mc
 * (node's built-in runner; this backend has no test framework of its own.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SetMcIndex,
    resolveSetMc,
    setProblems,
    parseSetMcMasterRows,
    fillSetMcDefaults,
    type SetMcRow,
} from '../src/services/setMcMasterService';

const row = (r: Partial<SetMcRow>): SetMcRow => ({
    setMajCat: 'S-JB_B_SUIT_SL', rowType: 'PART', partPosition: 'UPPER', partMajCat: null,
    sMcCode: '', sMcDes: '', div: 'KIDS', subDiv: null, hsnCode: null, status: 'ACT', ...r,
});

const ROWS: SetMcRow[] = [
    row({ rowType: 'PARENT', partPosition: null, sMcCode: '131830101', sMcDes: 'S-JB_B_SUIT_SL', subDiv: 'KB-SETS', hsnCode: '620342' }),
    row({ partMajCat: 'JB_TEES_SL', sMcCode: '131830102', sMcDes: 'S-JB_TEES_SL', subDiv: 'KB-U', hsnCode: '61091000' }),
    row({ partMajCat: 'JB_H_BERMUDA', partPosition: 'LOWER', sMcCode: '131830103', sMcDes: 'S-JB_H_BERMUDA', subDiv: 'KB-L', hsnCode: null }),
    row({ partMajCat: 'JB_T_BERMUDA', partPosition: 'LOWER', sMcCode: '131830104', sMcDes: 'S-JB_T_BERMUDA', status: 'INACT' }),
    row({ setMajCat: 'S-L_N_SUIT', rowType: 'PARENT', partPosition: null, sMcCode: '124120101', sMcDes: 'S-L_N_SUIT', status: 'INACT', hsnCode: '1' }),
    row({ setMajCat: 'S-L_N_SUIT', partMajCat: 'L_SHIRT', sMcCode: '124120102', sMcDes: 'S-L_SHIRT', hsnCode: '1' }),
];
const IDX = new SetMcIndex(ROWS);

test('a set category has an ACT parent row; case and spaces do not matter', () => {
    assert.equal(IDX.isSetCategory(' s-jb_b_suit_sl '), true);
    assert.equal(IDX.isSetCategory('S-L_N_SUIT'), false); // INACT
    assert.equal(IDX.isSetCategory('JB_TEES_SL'), false); // a part, not a set
    assert.equal(IDX.isSetCategory(null), false);
    assert.deepEqual(IDX.setCategories(), ['S-JB_B_SUIT_SL']);
});

test('the plain category is not a set: only its S- copy gets the set flow', () => {
    assert.equal(IDX.isSetCategory('JB_B_SUIT_SL'), false);
    assert.equal(IDX.parentMc('JB_B_SUIT_SL'), null);
    assert.equal(resolveSetMc(IDX, 'NONE', 'JB_B_SUIT_SL', null), null);
    assert.deepEqual(resolveSetMc(IDX, 'PARENT', 'JB_B_SUIT_SL', null), {
        error: 'JB_B_SUIT_SL is not an active set category in the Set MC Master.',
    });
});

test('parent and part MCs come from the set; inactive parts and sets give none', () => {
    assert.deepEqual(IDX.parentMc('S-JB_B_SUIT_SL'), { mcCode: '131830101', mcDes: 'S-JB_B_SUIT_SL', div: 'KIDS', subDiv: 'KB-SETS', hsnCode: '620342' });
    assert.equal(IDX.partMc('S-JB_B_SUIT_SL', 'jb_tees_sl')?.mcCode, '131830102');
    assert.equal(IDX.partMc('S-JB_B_SUIT_SL', 'JB_T_BERMUDA'), null); // INACT part
    assert.equal(IDX.partMc('S-JB_B_SUIT_SL', 'L_LEGGING'), null); // not a part of this set
    assert.equal(IDX.partMc('S-L_N_SUIT', 'L_SHIRT'), null); // INACT set
    assert.deepEqual(IDX.allowedParts('S-JB_B_SUIT_SL').map((p) => p.majorCategory), ['JB_TEES_SL', 'JB_H_BERMUDA']);
});

test('resolveSetMc: parent -> set MC, part -> its S- MC in the parent set, normal -> null', () => {
    assert.deepEqual(resolveSetMc(IDX, 'PARENT', 'S-JB_B_SUIT_SL', null), IDX.parentMc('S-JB_B_SUIT_SL'));
    assert.equal((resolveSetMc(IDX, 'CHILD', 'JB_TEES_SL', 'S-JB_B_SUIT_SL') as any).mcCode, '131830102');
    assert.equal(resolveSetMc(IDX, 'NONE', 'JB_TEES_SL', null), null);
    assert.deepEqual(resolveSetMc(IDX, 'CHILD', 'L_LEGGING', 'S-JB_B_SUIT_SL'), {
        error: 'L_LEGGING is not a part of S-JB_B_SUIT_SL in the Set MC Master.',
    });
    assert.deepEqual(resolveSetMc(IDX, 'PARENT', 'S-L_N_SUIT', null), {
        error: 'S-L_N_SUIT is not an active set category in the Set MC Master.',
    });
});

test('setProblems lists every part that cannot be created, and a missing HSN', () => {
    assert.deepEqual(setProblems(IDX, 'S-JB_B_SUIT_SL', [{ label: 'KS-1-T', majorCategory: 'JB_TEES_SL' }]), []);
    assert.deepEqual(setProblems(IDX, 'S-JB_B_SUIT_SL', [
        { label: 'KS-1-B', majorCategory: 'JB_H_BERMUDA' },
        { label: 'KS-1-O', majorCategory: 'L_LEGGING' },
    ]), [
        'KS-1-B: S-JB_H_BERMUDA has no HSN code in the Set MC Master.',
        'KS-1-O: L_LEGGING is not a part of S-JB_B_SUIT_SL in the Set MC Master.',
    ]);
    assert.deepEqual(setProblems(IDX, 'S-L_N_SUIT', []), ['S-L_N_SUIT is not an active set category in the Set MC Master.']);
});

test('parseSetMcMasterRows: reads the template columns and normalises them', () => {
    const { rows, errors } = parseSetMcMasterRows([
        { rowNo: 5, cells: ['s-jb_b_suit_sl', 'parent', '', '', '131830101', 'S-JB_B_SUIT_SL', 'KIDS', 'KB-SETS', '620342', ''] },
        { rowNo: 6, cells: ['S-JB_B_SUIT_SL', 'PART', 'upper', 'JB_TEES_SL ', '131830102', 'S-JB_TEES_SL ', '', '', '', 'inact'] },
        { rowNo: 7, cells: ['', '', '', '', '', '', '', '', '', ''] },
    ]);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
        setMajCat: 'S-JB_B_SUIT_SL', rowType: 'PARENT', partPosition: null, partMajCat: null, sMcCode: '131830101',
        sMcDes: 'S-JB_B_SUIT_SL', div: 'KIDS', subDiv: 'KB-SETS', hsnCode: '620342', status: 'ACT',
    });
    assert.equal(rows[1].partMajCat, 'JB_TEES_SL');
    assert.equal(rows[1].sMcDes, 'S-JB_TEES_SL');
    assert.equal(rows[1].partPosition, 'UPPER');
    assert.equal(rows[1].status, 'INACT');
});

test('parseSetMcMasterRows: rejects bad rows with their Excel row number', () => {
    const { errors } = parseSetMcMasterRows([
        { rowNo: 5, cells: ['S-JB_SUIT', 'PARENT', '', '', '13188010', 'S-JB_SUIT', '', '', '', 'ACT'] },
        { rowNo: 6, cells: ['S-JB_SUIT', 'PART', 'LOWER', '', '131880105', 'S-JB_FRML_PANT', '', '', '', 'ACT'] },
        { rowNo: 7, cells: ['S-JB_SUIT', 'PART', 'OTHER', 'TIE', '131880106', 'S_TIE', '', '', '', 'ACT'] },
        { rowNo: 8, cells: ['S-JB_SUIT', 'SET', '', '', '131880101', 'S-JB_SUIT', '', '', '', 'ON'] },
        { rowNo: 9, cells: ['S-YB_SUIT', 'PART', 'UPPER', 'JB_SHIRT_HS', '131930104', 'S-JB_SHIRT_HS', '', '', '', 'ACT'] },
        { rowNo: 10, cells: ['S-JB_SUIT', 'PARENT', '', '', '131880101', 'S-JB_SUIT', '', '', '', 'ACT'] },
    ]);
    assert.deepEqual(errors, [
        'Row 5: S_MC_CODE "13188010" must be 9 digits.',
        'Row 6: PART_MAJ_CAT is required on a PART row.',
        'Row 7: S_MC_DES "S_TIE" must start with "S-".',
        'Row 8: ROW_TYPE must be PARENT or PART (got "SET").',
        'Row 8: STATUS must be ACT or INACT (got "ON").',
        'Row 10: S-JB_SUIT has more than one PARENT row.',
        'S-YB_SUIT has PART rows but no PARENT row.',
    ]);
});

test('parseSetMcMasterRows: the set must be the S- category and the part its normal category', () => {
    const { errors } = parseSetMcMasterRows([
        { rowNo: 5, cells: ['JB_SUIT', 'PARENT', '', '', '131880101', 'S-JB_SUIT', '', '', '', 'ACT'] },
        { rowNo: 6, cells: ['S-JB_SUIT', 'PARENT', '', '', '131880101', 'S-JB_SUIT', '', '', '', 'ACT'] },
        { rowNo: 7, cells: ['S-JB_SUIT', 'PART', 'UPPER', 'S-JB_SHIRT_HS', '131880104', 'S-JB_SHIRT_HS', '', '', '', 'ACT'] },
    ]);
    assert.deepEqual(errors, [
        'Row 5: SET_MAJ_CAT "JB_SUIT" must be the S- set category (S-JB_SUIT); the plain category keeps the normal flow.',
        'Row 7: PART_MAJ_CAT "S-JB_SHIRT_HS" must be the part\'s normal category (JB_SHIRT_HS), not the S- one.',
    ]);
});

test('parseSetMcMasterRows: a repeated (set, part) is an error', () => {
    const { errors } = parseSetMcMasterRows([
        { rowNo: 5, cells: ['S-IB_B_SUIT_FS', 'PARENT', '', '', '135670101', 'S-IB_B_SUIT_FS', '', '', '', ''] },
        { rowNo: 6, cells: ['S-IB_B_SUIT_FS', 'PART', 'UPPER', 'IB_TEES_FS', '135670102', 'S-IB_TEES_FS', '', '', '', ''] },
        { rowNo: 7, cells: ['S-IB_B_SUIT_FS', 'PART', 'UPPER', 'IB_TEES_FS', '135670103', 'S-IB_TEES_FS', '', '', '', ''] },
    ]);
    assert.deepEqual(errors, ['Row 7: IB_TEES_FS is listed twice for S-IB_B_SUIT_FS.']);
});

test('fillSetMcDefaults: blank HSN / sub-div / div come from the category (the S- copy for a parent)', () => {
    const lookup = new Map([
        ['S-JB_B_SUIT_SL', { div: 'KIDS', subDiv: 'KB-SETS', hsnCode: '620342' }],
        ['JB_TEES_SL', { div: 'KIDS', subDiv: 'KB-U', hsnCode: '61091000' }],
    ]);
    const out = fillSetMcDefaults([
        row({ rowType: 'PARENT', div: null, sMcCode: '131830101', sMcDes: 'S-JB_B_SUIT_SL' }),
        row({ partMajCat: 'JB_TEES_SL', div: null, subDiv: 'MINE', sMcCode: '131830102', sMcDes: 'S-JB_TEES_SL' }),
        row({ partMajCat: 'JB_MODI_JACKET', div: null, sMcCode: '131840106', sMcDes: 'S-JB_MODI_JACKET' }),
    ], lookup);
    assert.deepEqual([out[0].div, out[0].subDiv, out[0].hsnCode], ['KIDS', 'KB-SETS', '620342']);
    assert.deepEqual([out[1].subDiv, out[1].hsnCode], ['MINE', '61091000']); // a filled value is kept
    assert.deepEqual([out[2].subDiv, out[2].hsnCode], [null, null]); // unknown category stays blank
});
