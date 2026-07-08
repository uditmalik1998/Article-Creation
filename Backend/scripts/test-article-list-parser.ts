import assert from 'assert';
import * as XLSX from 'xlsx';
import { parseArticleCodesFromText, parseArticleCodesFromXlsx, sourceKeyFor, outputKeyFor } from '../src/services/articleListParser';

// text parsing: strip header, trim, dedupe, drop blanks
const text = 'FINAL ART\n1110097922-BLACK\n 1110106859-DARK GREY \n1110097922-BLACK\n\n';
const fromText = parseArticleCodesFromText(text);
assert.deepStrictEqual(fromText, ['1110097922-BLACK', '1110106859-DARK GREY'], 'text parse/dedupe/trim/header-strip');

// xlsx parsing: single column named FINAL ART
const ws = XLSX.utils.aoa_to_sheet([['FINAL ART'], ['1110111001-MEDIUM MAROON'], ['1110111002-ROSE PINK']]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
const fromXlsx = parseArticleCodesFromXlsx(buf);
assert.deepStrictEqual(fromXlsx, ['1110111001-MEDIUM MAROON', '1110111002-ROSE PINK'], 'xlsx parse');

// key builders
assert.strictEqual(sourceKeyFor('1110097922-BLACK'), '1110097922-BLACK.jpg', 'source key');
assert.strictEqual(outputKeyFor('1110097922-BLACK', 'front'), '1110097922-BLACK/front.jpg', 'output key');

console.log('PASS: article list parser + key builders');
