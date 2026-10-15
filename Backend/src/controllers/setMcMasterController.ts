/**
 * Admin > Set MC Master (table set_mc_master): the SAP "S-" merchandise
 * categories of set articles. Same shape as the other masters: status,
 * template, download, upload (replaces the table). See setMcMasterService.
 */
import { Request, Response } from 'express';
import { prismaClient as prisma } from '../utils/prisma';
import {
    SET_MC_MASTER_HEADERS,
    fillSetMcDefaults,
    getSetMcIndex,
    invalidateSetMcCache,
    parseSetMcMasterRows,
    readSetMcRows,
    type SetMcRow,
} from '../services/setMcMasterService';

const SHEET = 'SET_MC_MASTER';
const TITLE = 'SET ARTICLE S- MC MASTER (one PARENT row per set, one PART row per allowed part)';

/** Title row 1, headers row 3, data from row 5 — the layout every master upload uses. */
function buildWorkbook(rows: (string | null)[][]) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET);
    ws.mergeCells('A1:J1');
    const titleCell = ws.getCell('A1');
    titleCell.value = TITLE;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: 'center' };
    ws.addRow([]);
    const headerRow = ws.addRow([...SET_MC_MASTER_HEADERS]);
    headerRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
        cell.alignment = { horizontal: 'center' };
    });
    ws.addRow([]);
    for (const r of rows) ws.addRow(r.map((v) => v ?? ''));
    ws.columns = [
        { width: 20 }, { width: 11 }, { width: 14 }, { width: 20 }, { width: 13 },
        { width: 24 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 9 },
    ];
    return wb;
}

async function sendWorkbook(res: Response, wb: any, filename: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
}

/** GET /api/admin/set-mc-master/status */
export const getSetMcMasterStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        const rows = await readSetMcRows();
        res.json({
            success: true,
            data: {
                total: rows.length,
                sets: rows.filter((r) => r.rowType === 'PARENT').length,
                activeSets: rows.filter((r) => r.rowType === 'PARENT' && r.status === 'ACT').length,
                parts: rows.filter((r) => r.rowType === 'PART').length,
                missingHsn: rows.filter((r) => r.status === 'ACT' && !r.hsnCode).length,
            },
        });
    } catch (error: any) {
        console.error('[SetMcMaster] Status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/admin/set-mc-master/template */
export const downloadSetMcMasterTemplate = async (_req: Request, res: Response): Promise<void> => {
    try {
        const wb = buildWorkbook([
            ['JB_B_SUIT_SL', 'PARENT', '', '', '131830101', 'S-JB_B_SUIT_SL', 'KIDS', '', '', 'ACT'],
            ['JB_B_SUIT_SL', 'PART', 'UPPER', 'JB_TEES_SL', '131830102', 'S-JB_TEES_SL', 'KIDS', '', '', 'ACT'],
            ['JB_B_SUIT_SL', 'PART', 'LOWER', 'JB_H_BERMUDA', '131830103', 'S-JB_H_BERMUDA', 'KIDS', '', '', 'ACT'],
        ]);
        const ws = wb.getWorksheet(SHEET);
        ws.addRow([]);
        const note = ws.addRow([
            'NOTE: headers in row 3, data from row 5. ROW_TYPE = PARENT (the set) or PART. PART_MAJ_CAT = the normal category the part is saved under. ' +
            'Blank SUB_DIV / HSN_CODE are filled from the normal category. STATUS = ACT or INACT. Upload replaces the whole table.',
        ]);
        ws.mergeCells(`A${note.number}:J${note.number}`);
        note.getCell(1).font = { italic: true, size: 10 };
        await sendWorkbook(res, wb, 'SET_MC_MASTER_TEMPLATE.xlsx');
    } catch (error: any) {
        console.error('[SetMcMaster] Template error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/admin/set-mc-master/download — the current table, re-uploadable as is. */
export const downloadSetMcMasterData = async (_req: Request, res: Response): Promise<void> => {
    try {
        const rows = await readSetMcRows();
        const wb = buildWorkbook(rows.map((r) => [
            r.setMajCat, r.rowType, r.partPosition, r.partMajCat, r.sMcCode, r.sMcDes, r.div, r.subDiv, r.hsnCode, r.status,
        ]));
        await sendWorkbook(res, wb, `SET_MC_MASTER_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error: any) {
        console.error('[SetMcMaster] Download error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/admin/set-mc-master/upload — replaces set_mc_master.
 * Any invalid row rejects the whole file (nothing is written).
 */
export const uploadSetMcMaster = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded. Send a .xlsx file as "file" field.' });
            return;
        }
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await wb.xlsx.load(req.file.buffer as any);
        const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
        if (!ws) {
            res.status(400).json({ success: false, error: 'No worksheets found in the uploaded Excel file.' });
            return;
        }
        const cell = (row: any, c: number): string => {
            let v = row.getCell(c).value;
            if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
            if (v && typeof v === 'object' && 'text' in v) v = (v as any).text;
            return v == null ? '' : String(v).trim();
        };
        const input: { rowNo: number; cells: string[] }[] = [];
        for (let r = 5; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const cells = SET_MC_MASTER_HEADERS.map((_, i) => cell(row, i + 1));
            if (cells[0].startsWith('NOTE:')) continue;
            input.push({ rowNo: r, cells });
        }

        const parsed = parseSetMcMasterRows(input);
        if (parsed.errors.length > 0) {
            res.status(400).json({
                success: false,
                error: `The file has ${parsed.errors.length} problem(s); nothing was saved.`,
                problems: parsed.errors.slice(0, 100),
            });
            return;
        }
        if (parsed.rows.length === 0) {
            res.status(400).json({ success: false, error: 'No data rows found from row 5.' });
            return;
        }

        // Blank DIV / SUB_DIV / HSN_CODE come from the normal category (major_category_details).
        const details = await prisma.majorCategoryDetails.findMany({
            where: { mcStatus: 'ACT' },
            select: { mcDes: true, div: true, subDiv: true, hsnCode: true },
        });
        const lookup = new Map(details
            .filter((d) => d.mcDes)
            .map((d) => [d.mcDes!.trim().toUpperCase(), { div: d.div, subDiv: d.subDiv, hsnCode: d.hsnCode }]));
        const rows: SetMcRow[] = fillSetMcDefaults(parsed.rows, lookup);

        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`TRUNCATE TABLE public.set_mc_master RESTART IDENTITY`;
            await tx.$executeRaw`
                INSERT INTO public.set_mc_master
                    (set_maj_cat, row_type, part_position, part_maj_cat, s_mc_code, s_mc_des, div, sub_div, hsn_code, status, created_at)
                SELECT v."setMajCat", v."rowType", v."partPosition", v."partMajCat", v."sMcCode", v."sMcDes",
                       v.div, v."subDiv", v."hsnCode", v.status, NOW()
                FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                    AS v("setMajCat" text, "rowType" text, "partPosition" text, "partMajCat" text, "sMcCode" text,
                         "sMcDes" text, div text, "subDiv" text, "hsnCode" text, status text)`;
        });
        invalidateSetMcCache();

        const sets = rows.filter((r) => r.rowType === 'PARENT');
        const missingHsn = rows.filter((r) => r.status === 'ACT' && !r.hsnCode).map((r) => r.sMcDes);
        console.log(`[SetMcMaster] Replaced set_mc_master — ${rows.length} rows, ${sets.length} sets.`);
        res.json({
            success: true,
            message: `Set MC Master uploaded: ${sets.length} sets (${sets.filter((s) => s.status === 'ACT').length} active), ` +
                `${rows.length - sets.length} parts.` +
                (missingHsn.length ? ` ${missingHsn.length} active row(s) have no HSN code — those sets cannot be submitted until it is filled.` : ''),
            data: {
                uploadedAt: new Date().toISOString(),
                fileName: req.file.originalname,
                total: rows.length,
                sets: sets.length,
                activeSets: sets.filter((s) => s.status === 'ACT').length,
                parts: rows.length - sets.length,
                missingHsn: missingHsn.length,
                missingHsnList: missingHsn.slice(0, 50),
            },
        });
    } catch (error: any) {
        console.error('[SetMcMaster] Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /api/approver/set-categories — active set categories (the article screen's set check). */
export const getActiveSetCategories = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.json({ success: true, data: (await getSetMcIndex()).setCategories() });
    } catch (error: any) {
        console.error('[SetMcMaster] Set categories error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
