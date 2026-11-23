/**
 * FG -> Fabric mapping: every approved FG article number with the fabric
 * article number it uses (extraction_results_flat.fabric_article_number).
 *
 * One row per FG article number (trimmed), the latest updated_at wins. FG
 * articles without a fabric are listed too, with fabArtNo = null.
 *
 * The list is ~33k short rows, so it is loaded once and cached for a few
 * minutes; search, paging and the Excel download run over that cached list.
 */

import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

export interface FgFabricMappingRow {
  fgArtNo: string;
  fabArtNo: string | null;
}

const MAPPING_SQL = `
select fg."fgArtNo", fg."fabArtNo"
from (
  select distinct on (trim(article_number))
    trim(article_number)                      as "fgArtNo",
    nullif(trim(fabric_article_number), '')   as "fabArtNo",
    created_at
  from public.extraction_results_flat
  where approval_status = 'APPROVED' and nullif(trim(article_number), '') is not null
  order by trim(article_number), updated_at desc
) fg
order by fg.created_at desc nulls last, fg."fgArtNo"
`;

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; rows: FgFabricMappingRow[] } | null = null;
let inflight: Promise<FgFabricMappingRow[]> | null = null;

/** The full mapping, from a 5-minute cache. `fresh` forces a reload. */
export async function getFgFabricMapping(fresh = false): Promise<{ rows: FgFabricMappingRow[]; loadedAt: number }> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return { rows: cache.rows, loadedAt: cache.at };
  if (!inflight) {
    inflight = withPrismaRetry(() => prisma.$queryRawUnsafe<FgFabricMappingRow[]>(MAPPING_SQL))
      .then((rows) => {
        cache = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const rows = await inflight;
  return { rows, loadedAt: cache?.at ?? Date.now() };
}

/** Rows whose FG or fabric article number contains `search`. */
export function filterFgFabricMapping(rows: FgFabricMappingRow[], search?: string): FgFabricMappingRow[] {
  const term = search?.trim().toUpperCase();
  if (!term) return rows;
  return rows.filter((r) => r.fgArtNo.toUpperCase().includes(term) || (r.fabArtNo ?? '').toUpperCase().includes(term));
}

export function countWithFabric(rows: FgFabricMappingRow[]): number {
  let n = 0;
  for (const r of rows) if (r.fabArtNo) n++;
  return n;
}
