/**
 * GM Size Master (table gm_size_master): valid sizes per GM major category.
 * Source: "GM_SIZE FINAL.xlsx", sheet "SIZE MASTER", headers row 3, data from row 6.
 * Columns: SEG | DIV | SUB-DIV | MAJCAT | MAJOR_CATEGORY_STATUS | SIZE
 * Upload replaces the entire table.
 */
import { Request, Response } from 'express';
import { prismaClient as prisma } from '../utils/prisma';

const SHEET = 'SIZE MASTER';
const HEADERS = ['SEG', 'DIV', 'SUB-DIV', 'MAJCAT', 'MAJOR_CATEGORY_STATUS', 'SIZE'] as const;

type GmSizeRow = { seg: string | null; div: string | null; subDiv: string | null; majCat: string; status: string | null; size: string };

function buildWorkbook(rows: (string | null)[][]) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET);
    // Row 1: title, row 2: blank, row 3: headers, rows 4-5: blank, data from row 6
    ws.mergeCells('A1:F1');
    const title = ws.getCell('A1');
    title.value = 'GM SIZE MASTER';
    title.font = { bold: true, size: 13 };
    title.alignment = { horizontal: 'center' };
    ws.addRow([]);
    const hdr = ws.addRow([...HEADERS]);
    hdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
        cell.alignment = { horizontal: 'center' };
    });
    ws.addRow([]); ws.addRow([]);
    for (const r of rows) ws.addRow(r.map((v) => v ?? ''));
    ws.columns = [{ width: 8 }, { width: 12 }, { width: 14 }, { width: 26 }, { width: 24 }, { width: 12 }];
    return wb;
}

async function sendWorkbook(res: Response, wb: any, filename: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
}

async function readRows(): Promise<GmSizeRow[]> {
    return prisma.$queryRaw<GmSizeRow[]>`
        SELECT seg, div, sub_div AS "subDiv", maj_cat AS "majCat", status, size
        FROM public.gm_size_master
        ORDER BY div, sub_div, maj_cat, size`;
}

/** GET /api/admin/gm-size-master/status */
export const getGmSizeMasterStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        const [total, cats, divs] = await Promise.all([
            prisma.$queryRaw<[{ n: bigint }]>`SELECT COUNT(*) AS n FROM public.gm_size_master`,
            prisma.$queryRaw<[{ n: bigint }]>`SELECT COUNT(DISTINCT maj_cat) AS n FROM public.gm_size_master`,
            prisma.$queryRaw<[{ n: bigint }]>`SELECT COUNT(DISTINCT div) AS n FROM public.gm_size_master`,
        ]);
        res.json({
            success: true,
            data: {
                total: Number(total[0].n),
                categories: Number(cats[0].n),
                divisions: Number(divs[0].n),
            },
        });
    } catch (error: any) {
        console.error('[GmSizeMaster] Status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/admin/gm-size-master/template */
export const downloadGmSizeMasterTemplate = async (_req: Request, res: Response): Promise<void> => {
    try {
        const wb = buildWorkbook([
            ['GM', 'FW', 'FW-KD', 'FW_K_SLIPPER', 'ACT', '1K'],
            ['GM', 'FW', 'FW-KD', 'FW_K_SLIPPER', 'ACT', '2K'],
            ['GM', 'FW', 'FW-MS', 'FW_M_CAS_SHOES', 'ACT', '7'],
            ['GM', 'LS', 'PC', 'LS_FACE_WASH', 'ACT', 'A'],
        ]);
        await sendWorkbook(res, wb, 'GM_SIZE_MASTER_TEMPLATE.xlsx');
    } catch (error: any) {
        console.error('[GmSizeMaster] Template error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/admin/gm-size-master/download */
export const downloadGmSizeMasterData = async (_req: Request, res: Response): Promise<void> => {
    try {
        const rows = await readRows();
        const wb = buildWorkbook(rows.map((r) => [r.seg, r.div, r.subDiv, r.majCat, r.status, r.size]));
        await sendWorkbook(res, wb, `GM_SIZE_MASTER_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error: any) {
        console.error('[GmSizeMaster] Download error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** POST /api/admin/gm-size-master/upload — replaces gm_size_master */
export const uploadGmSizeMaster = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded.' });
            return;
        }
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.file.buffer as any);
        const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
        if (!ws) {
            res.status(400).json({ success: false, error: 'No worksheets found in the uploaded file.' });
            return;
        }

        const cell = (row: any, c: number): string => {
            let v = row.getCell(c).value;
            if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
            if (v && typeof v === 'object' && 'text' in v) v = (v as any).text;
            return v == null ? '' : String(v).trim();
        };

        const rows: GmSizeRow[] = [];
        const errors: string[] = [];

        // Auto-detect the header row (col 4 = "MAJCAT" / "MAJ_CAT") then start data from the row after it.
        let dataStartRow = 2;
        for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
            const v = cell(ws.getRow(r), 4).toUpperCase().replace(/\s+/g, '_');
            if (v === 'MAJCAT' || v === 'MAJ_CAT' || v === 'MAJOR_CATEGORY') {
                dataStartRow = r + 1;
                break;
            }
        }

        for (let r = dataStartRow; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const [seg, div, subDiv, majCat, status, size] = HEADERS.map((_, i) => cell(row, i + 1));
            if (!majCat && !size) continue;
            // Skip stray header rows
            if (['MAJCAT', 'MAJ_CAT', 'MAJOR CATEGORY', 'MAJOR_CATEGORY'].includes(majCat.toUpperCase())) continue;
            if (!majCat) { errors.push(`Row ${r}: MAJCAT is required.`); continue; }
            if (!size) { errors.push(`Row ${r}: SIZE is required.`); continue; }
            rows.push({ seg: seg || null, div: div || null, subDiv: subDiv || null, majCat, status: status || null, size });
        }

        if (errors.length > 0) {
            res.status(400).json({ success: false, error: `${errors.length} problem(s) found — nothing saved.`, problems: errors.slice(0, 50) });
            return;
        }
        if (rows.length === 0) {
            res.status(400).json({ success: false, error: 'No data rows found. Data must start from row 6 (after two blank rows below the header).' });
            return;
        }

        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`TRUNCATE TABLE public.gm_size_master RESTART IDENTITY`;
            await tx.$executeRaw`
                INSERT INTO public.gm_size_master (seg, div, sub_div, maj_cat, status, size, created_at)
                SELECT v.seg, v.div, v."subDiv", v."majCat", v.status, v.size, NOW()
                FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                    AS v(seg text, div text, "subDiv" text, "majCat" text, status text, size text)`;
        });

        const cats = new Set(rows.map((r) => r.majCat)).size;
        console.log(`[GmSizeMaster] Replaced gm_size_master — ${rows.length} rows, ${cats} major categories.`);
        res.json({
            success: true,
            message: `GM Size Master uploaded: ${rows.length} sizes across ${cats} major categories.`,
            data: {
                uploadedAt: new Date().toISOString(),
                fileName: req.file.originalname,
                total: rows.length,
                categories: cats,
            },
        });
    } catch (error: any) {
        console.error('[GmSizeMaster] Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/admin/gm-size-master/sizes?majCat=FW_K_SLIPPER — sizes for a category */
export const getGmSizes = async (req: Request, res: Response): Promise<void> => {
    try {
        const majCat = (req.query.majCat as string | undefined)?.trim();
        if (!majCat) {
            res.status(400).json({ success: false, error: 'majCat query parameter required' });
            return;
        }
        const rows = await prisma.$queryRaw<{ size: string }[]>`
            SELECT size FROM public.gm_size_master
            WHERE maj_cat = ${majCat} AND (status IS NULL OR status NOT ILIKE 'inact')
            ORDER BY size`;
        res.json({ success: true, data: rows.map((r) => r.size) });
    } catch (error: any) {
        console.error('[GmSizeMaster] Sizes error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
