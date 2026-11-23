/**
 * FG -> Fabric mapping page (Admin -> Expenses area). Read-only; see
 * services/fgFabricMappingService.ts for the mapping rules.
 */

import { Request, Response } from 'express';
import {
  getFgFabricMapping,
  filterFgFabricMapping,
  fgFabricMappingStats,
  fgFabricMappingOptions,
  type FgFabricMappingFilters,
} from '../services/fgFabricMappingService';

function filtersFrom(req: Request): FgFabricMappingFilters {
  const q = (k: string) => {
    const v = req.query[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const mapped = q('fabricMapped');
  return {
    search: q('search')?.slice(0, 200),
    fgDiv: q('fgDiv'),
    fgMajCat: q('fgMajCat'),
    fabricMapped: mapped === 'YES' || mapped === 'NO' ? mapped : undefined,
    fabDiv: q('fabDiv'),
    fabVendor: q('fabVendor'),
    month: q('month'),
  };
}

/** GET /expense/fg-fabric-mapping — one page of rows, the cards and the filter options. */
export async function listFgFabricMapping(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(req.query.pageSize) || 50));
  const { rows: all, loadedAt } = await getFgFabricMapping(req.query.fresh === '1');
  const rows = filterFgFabricMapping(all, filtersFrom(req));
  return res.json({
    success: true,
    data: {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      stats: fgFabricMappingStats(rows),
      options: fgFabricMappingOptions(all),
      loadedAt: new Date(loadedAt).toISOString(),
    },
  });
}

const EXPORT_COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'FG ART NO', key: 'fgArtNo', width: 14 },
  { header: 'FG ART DESC', key: 'fgArtDesc', width: 40 },
  { header: 'FG DIV', key: 'fgDiv', width: 10 },
  { header: 'FG SUB DIV', key: 'fgSubDiv', width: 12 },
  { header: 'FG MAJ CAT', key: 'fgMajCat', width: 16 },
  { header: 'FG VENDOR', key: 'fgVendor', width: 28 },
  { header: 'FG CREATED DATE', key: 'fgCreatedDate', width: 14 },
  { header: 'BODY NO', key: 'bodyArticle', width: 14 },
  { header: 'CREATED BY', key: 'createdBy', width: 18 },
  { header: 'FABRIC MAPPED', key: 'fabricMapped', width: 10 },
  { header: 'FABRIC ART NO', key: 'fabArtNo', width: 14 },
  { header: 'FABRIC ART DESC', key: 'fabArtDesc', width: 40 },
  { header: 'FABRIC DIV', key: 'fabDiv', width: 12 },
  { header: 'FABRIC UOM', key: 'fabUom', width: 8 },
  { header: 'FABRIC VENDOR', key: 'fabVendor', width: 28 },
  { header: 'FABRIC RATE', key: 'fabRate', width: 10 },
  { header: 'FABRIC IN APP', key: 'fabricInApp', width: 10 },
];

/** GET /expense/fg-fabric-mapping/export — every filtered row as .xlsx. */
export async function exportFgFabricMapping(req: Request, res: Response) {
  const { rows: all } = await getFgFabricMapping();
  const rows = filterFgFabricMapping(all, filtersFrom(req));

  const ExcelJS = (await import('exceljs')).default;
  const filename = `FG_FABRIC_MAPPING_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const ws = wb.addWorksheet('FG to Fabric');
  ws.columns = EXPORT_COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  for (const r of rows) {
    ws.addRow({
      ...r,
      fabRate: r.fabRate == null ? null : Number(r.fabRate),
      fabricInApp: r.fabricMapped === 'NO' ? '' : r.fabricInApp ? 'YES' : 'NO',
    }).commit();
  }
  ws.commit();
  await wb.commit();
}
