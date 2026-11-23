/**
 * FG -> Fabric mapping: every approved FG article with the fabric article it
 * is made from (extraction_results_flat.fabric_article_number =
 * fabric_article_data.fabric_article_number, both trimmed).
 *
 * The whole mapping is ~33k rows and the query takes ~0.4 s, so it is loaded
 * once and cached for a few minutes; search, filters, cards, paging and the
 * Excel download all run over that cached list.
 *
 * Rules (same as the V2Pulse "NOMINATED FABRIC TO PO CREATION" report):
 *  - one row per FG article number, the latest updated_at wins;
 *  - one row per fabric article number, an APPROVED row first, then latest;
 *  - fabric division / UOM come from the fabric's m_fab_div, else the FG's fab_div;
 *  - a fabric missing from fabric_article_data still shows, from the FG's own
 *    fabric fields, flagged fabricInApp = false;
 *  - FG articles without a fabric are listed too (fabricMapped = 'NO');
 *  - created_at is UTC in a timestamp-without-time-zone column, shown in IST.
 */

import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

export interface FgFabricMappingRow {
  fgArtNo: string;
  fgArtDesc: string | null;
  fgDiv: string | null;
  fgSubDiv: string | null;
  fgMajCat: string | null;
  fgVendor: string | null;
  fgCreatedDate: string | null; // YYYY-MM-DD, IST
  fgImageUrl: string | null;
  bodyArticle: string | null;
  createdBy: string | null;
  fabricMapped: 'YES' | 'NO';
  fabArtNo: string | null;
  fabArtDesc: string | null;
  fabDiv: string | null;
  fabUom: string | null;
  fabVendor: string | null;
  fabRate: string | null;
  fabImageUrl: string | null;
  fabricInApp: boolean;
}

const MAPPING_SQL = `
with fg as (
  select distinct on (trim(article_number)) *
  from public.extraction_results_flat
  where approval_status = 'APPROVED' and nullif(trim(article_number), '') is not null
  order by trim(article_number), updated_at desc),
fab as (
  select distinct on (trim(fabric_article_number)) *
  from public.fabric_article_data
  where nullif(trim(fabric_article_number), '') is not null
  order by trim(fabric_article_number), (approval_status = 'APPROVED') desc, updated_at desc)
select
  trim(g.article_number)                                    as "fgArtNo",
  g.article_description                                     as "fgArtDesc",
  g.division                                                as "fgDiv",
  g.sub_division                                            as "fgSubDiv",
  g.major_category                                          as "fgMajCat",
  g.vendor_name                                             as "fgVendor",
  to_char(((g.created_at at time zone 'UTC') at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as "fgCreatedDate",
  g.image_url                                               as "fgImageUrl",
  nullif(trim(g.body_article), '')                          as "bodyArticle",
  g.user_name                                               as "createdBy",
  case when nullif(trim(g.fabric_article_number), '') is null then 'NO' else 'YES' end as "fabricMapped",
  nullif(trim(g.fabric_article_number), '')                 as "fabArtNo",
  coalesce(f.fabric_article_description, g.fabric_article_description) as "fabArtDesc",
  case upper(trim(coalesce(f.m_fab_div, g.fab_div)))
    when 'K' then 'KNITS' when 'W' then 'WOVEN' when 'DNM' then 'DENIM'
    when 'RFD_K' then 'RFD KNITS' when 'RFD_W' then 'RFD WOVEN' end as "fabDiv",
  case upper(trim(coalesce(f.m_fab_div, g.fab_div)))
    when 'K' then 'KG' when 'RFD_K' then 'KG'
    when 'W' then 'MTR' when 'RFD_W' then 'MTR' when 'DNM' then 'MTR' end as "fabUom",
  coalesce(f.vendor_name, g.m_fab_vdr)                      as "fabVendor",
  coalesce(f.fabric_rate::text, g.vendor_fabric_rate::text) as "fabRate",
  f.image_url                                               as "fabImageUrl",
  (f.id is not null)                                        as "fabricInApp"
from fg g
left join fab f on trim(f.fabric_article_number) = trim(g.fabric_article_number)
order by g.created_at desc nulls last, trim(g.article_number)
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

export interface FgFabricMappingFilters {
  search?: string;
  fgDiv?: string;
  fgMajCat?: string;
  fabricMapped?: 'YES' | 'NO';
  fabDiv?: string;
  fabVendor?: string;
  month?: string; // YYYY-MM of the FG created date (IST)
}

export function filterFgFabricMapping(rows: FgFabricMappingRow[], f: FgFabricMappingFilters): FgFabricMappingRow[] {
  const term = f.search?.trim().toUpperCase();
  return rows.filter((r) => {
    if (f.fgDiv && r.fgDiv !== f.fgDiv) return false;
    if (f.fgMajCat && r.fgMajCat !== f.fgMajCat) return false;
    if (f.fabricMapped && r.fabricMapped !== f.fabricMapped) return false;
    if (f.fabDiv && r.fabDiv !== f.fabDiv) return false;
    if (f.fabVendor && r.fabVendor !== f.fabVendor) return false;
    if (f.month && !(r.fgCreatedDate ?? '').startsWith(f.month)) return false;
    if (term) {
      const hay = [r.fgArtNo, r.fgArtDesc, r.fabArtNo, r.fabArtDesc, r.fabVendor];
      if (!hay.some((v) => v && v.toUpperCase().includes(term))) return false;
    }
    return true;
  });
}

/** The four cards, over whatever rows the filters left. */
export function fgFabricMappingStats(rows: FgFabricMappingRow[]) {
  let withFabric = 0;
  const fabrics = new Set<string>();
  for (const r of rows) {
    if (r.fabricMapped === 'YES') {
      withFabric++;
      if (r.fabArtNo) fabrics.add(r.fabArtNo);
    }
  }
  return {
    fgArticles: rows.length,
    withFabric,
    withoutFabric: rows.length - withFabric,
    distinctFabrics: fabrics.size,
  };
}

/** Filter dropdown values, from the whole (unfiltered) mapping. */
export function fgFabricMappingOptions(rows: FgFabricMappingRow[]) {
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  const fgDivs = new Set<string>();
  const fgMajCats = new Set<string>();
  const fabDivs = new Set<string>();
  const fabVendors = new Set<string>();
  const months = new Set<string>();
  for (const r of rows) {
    if (r.fgDiv) fgDivs.add(r.fgDiv);
    if (r.fgMajCat) fgMajCats.add(r.fgMajCat);
    if (r.fabDiv) fabDivs.add(r.fabDiv);
    if (r.fabVendor) fabVendors.add(r.fabVendor);
    if (r.fgCreatedDate) months.add(r.fgCreatedDate.slice(0, 7));
  }
  return {
    fgDivs: sorted(fgDivs),
    fgMajCats: sorted(fgMajCats),
    fabDivs: sorted(fabDivs),
    fabVendors: sorted(fabVendors),
    months: sorted(months).reverse(),
  };
}
