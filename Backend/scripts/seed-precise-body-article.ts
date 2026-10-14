/**
 * Seed script: loads COMPILE SHEET- OF BODY FAB CONSUMPTION Excel
 * into precise_body_article_consumption table.
 *
 * Run: npx ts-node scripts/seed-precise-body-article.ts <path-to-excel>
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const WIDTH_COLS = [15,16,17,18,19,42,43,44,46,48,50,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,76,78,82,92,94,96];

function toStr(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return (s === '' || s === '-') ? null : s;
}

function toDec(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === '' || s === '-') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

async function main() {
    const filePath = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\COMPILE SHEET- OF BODY  FAB CONSUMPTION-UPDATED-07.10.2026.xlsx';
    console.log(`Loading: ${filePath}`);

    const wb = XLSX.readFile(filePath, { cellDates: true });
    const ws = wb.Sheets['Sheet1'];
    const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

    // Row index 3 (0-based) = row 4 in Excel = header row
    const headerRow = raw[3] as any[];

    // Build column index map from header values
    const colIdx: Record<string, number> = {};
    headerRow.forEach((h, i) => {
        if (h !== null && h !== undefined) colIdx[String(h)] = i;
    });

    // Data starts at row index 5 (0-based) = row 6 in Excel
    const dataRows = raw.slice(5).filter((r: any) => r[0] || r[2]); // must have DIVISION or MAJOR_CATEGORY

    console.log(`Found ${dataRows.length} data rows`);

    // Clear existing data
    await prisma.$executeRawUnsafe('TRUNCATE TABLE public.precise_body_article_consumption RESTART IDENTITY');
    console.log('Table truncated');

    const BATCH = 200;
    let inserted = 0;

    for (let i = 0; i < dataRows.length; i += BATCH) {
        const chunk = dataRows.slice(i, i + BATCH);
        const values: any[] = [];

        for (const row of chunk) {
            const widthVals: Record<string, number | null> = {};
            for (const w of WIDTH_COLS) {
                widthVals[`width_${w}`] = toDec(row[colIdx[String(w)]]);
            }

            values.push({
                division:               String(row[colIdx['DIVISION']] ?? '').trim(),
                sub_division:           String(row[colIdx['SUB_DIVISION']] ?? '').trim(),
                major_category:         String(row[colIdx['MAJOR_CATEGORY']] ?? '').trim(),
                macro_body_description: String(row[colIdx['MACRO BODY DESCRIPTION']] ?? '').trim(),
                micro_body_article_number: String(row[colIdx['MICRO BODY ARTTICLE NUMBER']] ?? '').trim(),
                m_neck_type:          toStr(row[colIdx['M_NECK_TYPE']]),
                m_neck_style:         toStr(row[colIdx['M_NECK_STYLE']]),
                m_collar_type:        toStr(row[colIdx['M_COLLAR_TYPE']]),
                m_collar_style:       toStr(row[colIdx['M_COLLAR_STYLE']]),
                m_sleeves_main_style: toStr(row[colIdx['M_SLEEVES_MAIN_STYLE']]),
                m_sleeve_fold:        toStr(row[colIdx['M_SLEEVE_FOLD']]),
                m_placket:            toStr(row[colIdx['M_PLACKET']]),
                m_blt_type:           toStr(row[colIdx['M_BLT_TYPE']]),
                m_blt_style:          toStr(row[colIdx['M_BLT_STYLE']]),
                m_btm_fold:           toStr(row[colIdx['M_BTM_FOLD']]),
                m_pocket:             toStr(row[colIdx['M_POCKET']]),
                m_no_of_pocket:       toStr(row[colIdx['M_NO_OF_POCKET']]),
                m_extra_pocket:       toStr(row[colIdx['M_EXTRA_POCKET']]),
                m_length:             toStr(row[colIdx['M_LENGTH']]),
                m_fit:                toStr(row[colIdx['M_FIT']]),
                body_style:           toStr(row[colIdx['BODY STYLE']]),
                cutting_value:        toDec(row[colIdx['CUTTING_VALUE']]),
                stitching_sam:        toDec(row[colIdx['STITCHING_SAM']]),
                sam_val:              toDec(row[colIdx['SAM_VAL']]),
                st_val:               toDec(row[colIdx['ST. VAL']]),
                ironing_sam:          toDec(row[colIdx['IRONING_SAM']]),
                finishing_sam:        toDec(row[colIdx['FINISHING_SAM']]),
                finishig_cost:        toDec(row[colIdx['FINISHIG_COST']]),
                total_cmp_cost:       toDec(row[colIdx['total CMP COST']]),
                ...widthVals,
            });
        }

        // Build bulk INSERT
        const cols = Object.keys(values[0]);
        const placeholders = values.map((_, ri) =>
            `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(',')})`
        ).join(',');
        const flat = values.flatMap(v => cols.map(c => v[c]));

        await prisma.$executeRawUnsafe(
            `INSERT INTO public.precise_body_article_consumption (${cols.map(c => `"${c}"`).join(',')}, created_at, updated_at)
             VALUES ${placeholders.replace(/\)/g, ', NOW(), NOW())')}`,
            ...flat
        );

        inserted += chunk.length;
        process.stdout.write(`\rInserted ${inserted}/${dataRows.length}`);
    }

    console.log(`\nDone. ${inserted} rows loaded.`);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
