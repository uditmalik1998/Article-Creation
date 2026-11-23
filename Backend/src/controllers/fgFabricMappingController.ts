/**
 * FG -> Fabric mapping (Admin -> Expenses -> Fabric & body). Read-only; see
 * services/fgFabricMappingService.ts.
 */

import { Request, Response } from 'express';
import { getFgFabricMapping, filterFgFabricMapping, countWithFabric } from '../services/fgFabricMappingService';

const searchFrom = (req: Request) =>
  typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : undefined;

/** GET /expense/fg-fabric-mapping?search=&page=&pageSize= */
export async function listFgFabricMapping(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(req.query.pageSize) || 50));
  const { rows: all, loadedAt } = await getFgFabricMapping(req.query.fresh === '1');
  const rows = filterFgFabricMapping(all, searchFrom(req));
  return res.json({
    success: true,
    data: {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      withFabric: countWithFabric(rows),
      loadedAt: new Date(loadedAt).toISOString(),
    },
  });
}

/** GET /expense/fg-fabric-mapping/export?search= — the (filtered) list as .xlsx. */
export async function exportFgFabricMapping(req: Request, res: Response) {
  const { rows: all } = await getFgFabricMapping();
  const rows = filterFgFabricMapping(all, searchFrom(req));

  const ExcelJS = (await import('exceljs')).default;
  const filename = `FG_FABRIC_MAPPING_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const ws = wb.addWorksheet('FG to Fabric');
  ws.columns = [
    { header: 'FG ART NO', key: 'fgArtNo', width: 16 },
    { header: 'FABRIC ART NO', key: 'fabArtNo', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  for (const r of rows) ws.addRow(r).commit();
  ws.commit();
  await wb.commit();
}
