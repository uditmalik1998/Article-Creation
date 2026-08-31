/**
 * vendorMasterSyncService.ts
 *
 * Fetches all vendor records from the DAB API (ET_Supplier_Master) and
 * upserts them into the master_vendor_details table.
 *
 * Pagination: API returns 100 records per page; follow `nextLink` until absent.
 * Upsert key: vendor_code — safe to re-run at any time.
 */

import { prismaClient as prisma } from '../utils/prisma';

const DAB_API_BASE = 'https://my-dab-app.azurewebsites.net/api/ET_Supplier_Master';

interface DabVendorRow {
  ID: number;
  VENDOR_CODE: number | string;
  VENDOR_NAME?: string | null;
  VENDOR_CITY?: string | null;
  VENDOR_REGION?: string | null;
  MERGE_VENDOR_CODE?: number | string | null;
  MERGE_VENDOR_NAME?: string | null;
  MERGE_VENDOR_CITY?: string | null;
  MERGE_VENDOR_REGION?: string | null;
}

interface DabApiResponse {
  value: DabVendorRow[];
  // OData APIs may use either key
  nextLink?: string | null;
  '@odata.nextLink'?: string | null;
}

export interface VendorSyncResult {
  upserted: number;
  pages: number;
  durationMs: number;
  startedAt: string;
  error?: string;
}

// In-memory record of the most recent sync attempt
let lastSyncResult: VendorSyncResult | null = null;
let syncInProgress = false;

export function getLastVendorSyncResult(): VendorSyncResult | null {
  return lastSyncResult;
}

export function isVendorSyncInProgress(): boolean {
  return syncInProgress;
}

/** Normalise a raw vendor code value to a plain string */
function toStr(val: number | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s || null;
}

/** Fetch one page from the API */
async function fetchPage(url: string): Promise<DabApiResponse> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000), // 30s per page
  });
  if (!res.ok) {
    throw new Error(`DAB API HTTP ${res.status} — ${res.statusText}`);
  }
  return res.json() as Promise<DabApiResponse>;
}

/**
 * Sync all vendor records from the DAB API into master_vendor_details.
 * Returns a result summary.
 */
export async function syncVendorMaster(): Promise<VendorSyncResult> {
  if (syncInProgress) {
    throw new Error('Sync already in progress');
  }

  const start = Date.now();
  const startedAt = new Date().toISOString();
  let upserted = 0;
  let pages = 0;
  let nextUrl: string | null = DAB_API_BASE;

  syncInProgress = true;
  console.log('[VendorSync] Starting vendor master sync from DAB API…');

  try {
    while (nextUrl) {
      const data = await fetchPage(nextUrl);
      pages++;

      const rows = data.value ?? [];
      if (rows.length === 0) break;

      await prisma.$transaction(
        rows.map((row) =>
          prisma.masterVendorDetail.upsert({
            where: { vendorCode: String(row.VENDOR_CODE) },
            update: {
              vendorName:        toStr(row.VENDOR_NAME),
              vendorCity:        toStr(row.VENDOR_CITY),
              vendorRegion:      toStr(row.VENDOR_REGION),
              mergeVendorCode:   toStr(row.MERGE_VENDOR_CODE),
              mergeVendorName:   toStr(row.MERGE_VENDOR_NAME),
              mergeVendorCity:   toStr(row.MERGE_VENDOR_CITY),
              mergeVendorRegion: toStr(row.MERGE_VENDOR_REGION),
              syncedAt:          new Date(),
            },
            create: {
              vendorCode:        String(row.VENDOR_CODE),
              vendorName:        toStr(row.VENDOR_NAME),
              vendorCity:        toStr(row.VENDOR_CITY),
              vendorRegion:      toStr(row.VENDOR_REGION),
              mergeVendorCode:   toStr(row.MERGE_VENDOR_CODE),
              mergeVendorName:   toStr(row.MERGE_VENDOR_NAME),
              mergeVendorCity:   toStr(row.MERGE_VENDOR_CITY),
              mergeVendorRegion: toStr(row.MERGE_VENDOR_REGION),
            },
          })
        )
      );

      upserted += rows.length;
      console.log(`[VendorSync] Page ${pages} — upserted ${rows.length} rows (total: ${upserted})`);

      // Support both OData @odata.nextLink and plain nextLink
      nextUrl = (data['@odata.nextLink'] ?? data.nextLink) ?? null;
    }

    const durationMs = Date.now() - start;
    console.log(`[VendorSync] Done — ${upserted} records in ${pages} pages (${durationMs}ms)`);
    lastSyncResult = { upserted, pages, durationMs, startedAt };
    return lastSyncResult;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const error = err?.message ?? 'Unknown error';
    console.error(`[VendorSync] Failed after ${pages} pages: ${error}`);
    lastSyncResult = { upserted, pages, durationMs, startedAt, error };
    throw err;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Returns the count of records in master_vendor_details
 * plus the most recent syncedAt timestamp.
 */
export async function getVendorMasterStatus(): Promise<{
  count: number;
  lastSyncedAt: Date | null;
}> {
  const [count, latest] = await Promise.all([
    prisma.masterVendorDetail.count(),
    prisma.masterVendorDetail.findFirst({
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
  ]);
  return { count, lastSyncedAt: latest?.syncedAt ?? null };
}
