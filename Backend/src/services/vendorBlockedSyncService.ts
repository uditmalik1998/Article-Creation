/**
 * vendorBlockedSyncService.ts (2026-11-24)
 *
 * Copies v2srm `vendors.purchasing_blocked` into our master_vendor_details.purchasing_blocked.
 * Runs daily at 06:00 and 12:00 IST (index.ts). Read-only on v2srm.
 *
 * - v2srm codes are mostly 10-digit with leading zeros ("0000200370"); ours have none
 *   ("200370"), so both sides are matched on ltrim(code, '0'). v2srm has a few codes
 *   twice (with and without zeros) — they always agree; a blocked one wins if not.
 * - Only updates existing rows — the DAB vendor sync (02:00) owns inserting vendors and
 *   never touches purchasing_blocked.
 * - A vendor not found in v2srm is set back to NULL (= unknown), never false.
 * - Raw SQL on purpose: Prisma's @updatedAt would otherwise bump synced_at (the DAB sync time).
 */

import { prismaClient as prisma } from '../utils/prisma';

const SRM_SUPABASE_URL = 'https://pymdqnnwwxrgeolvgvgv.supabase.co';
const PAGE_SIZE = 1000;

export interface VendorBlockedSyncResult {
  fetched: number;
  updated: number;
  clearedToNull: number;
  blocked: number;
  durationMs: number;
  startedAt: string;
  error?: string;
}

let lastResult: VendorBlockedSyncResult | null = null;
let running = false;

export const getLastVendorBlockedSyncResult = () => lastResult;
export const isVendorBlockedSyncRunning = () => running;

const normCode = (code: unknown): string => String(code ?? '').trim().replace(/^0+/, '');

/** All v2srm vendors → Map(normalised code → purchasing_blocked). */
export async function fetchV2srmBlockedFlags(): Promise<Map<string, boolean>> {
  // Same key order as articleModelSourceService: service key, then anon key, then the public
  // v2srm anon key also hard-coded in srmSyncService — so prod needs no new setting
  // (the anon key can read v2srm `vendors`, checked 2026-11-24).
  const key = process.env.SRM_SUPABASE_SERVICE_KEY
    || process.env.SRM_SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRxbm53d3hyZ2VvbHZndmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMzU0NzYsImV4cCI6MjA2ODkxMTQ3Nn0.jUrb0jIg6qjj2Rlh9DxYesSnbstoD4uoDCswqOqAkUM';

  const flags = new Map<string, boolean>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${SRM_SUPABASE_URL}/rest/v1/vendors`
      + `?select=vendor_code,purchasing_blocked&order=vendor_code.asc`
      + `&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`v2srm vendors HTTP ${res.status} ${res.statusText}`);
    const rows = (await res.json()) as { vendor_code: string | null; purchasing_blocked: boolean | null }[];
    for (const r of rows) {
      const code = normCode(r.vendor_code);
      if (!code || r.purchasing_blocked == null) continue;
      flags.set(code, (flags.get(code) ?? false) || r.purchasing_blocked === true);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return flags;
}

/**
 * Save & Submit guard (FG / Fabric / GM, 2026-11-24): returns a user-facing message when
 * any of the given articles has a purchasing-blocked vendor, else null. NULL flag = allowed.
 */
export async function blockedVendorSubmitMessage(
  articles: { vendorCode: string | null; designNumber?: string | null; id: string }[],
): Promise<string | null> {
  const codes = [...new Set(articles.map((a) => normCode(a.vendorCode)).filter(Boolean))];
  if (codes.length === 0) return null;
  const rows = await prisma.$queryRaw<{ code: string; vendor_name: string | null }[]>`
    SELECT ltrim(vendor_code, '0') AS code, vendor_name
      FROM public.master_vendor_details
     WHERE purchasing_blocked = true
       AND ltrim(vendor_code, '0') = ANY(${codes}::text[])`;
  if (rows.length === 0) return null;
  const nameByCode = new Map(rows.map((r) => [r.code, r.vendor_name]));
  const hits = articles
    .filter((a) => nameByCode.has(normCode(a.vendorCode)))
    .map((a) => {
      const code = normCode(a.vendorCode);
      const name = nameByCode.get(code);
      return `${a.designNumber || a.id}: vendor ${code}${name ? ` (${name})` : ''}`;
    });
  return `Vendor is blocked for purchasing — pick another vendor before Save & Submit. ${hits.join('; ')}`;
}

export async function syncVendorPurchasingBlocked(): Promise<VendorBlockedSyncResult> {
  if (running) throw new Error('Purchasing-blocked sync already in progress');
  running = true;
  const start = Date.now();
  const startedAt = new Date().toISOString();
  try {
    const flags = await fetchV2srmBlockedFlags();
    if (flags.size === 0) throw new Error('v2srm returned no vendors — nothing changed');

    const codes = [...flags.keys()];
    const values = codes.map((c) => flags.get(c)!);

    // purchasing_blocked_synced_at = when this run checked the vendor against v2srm
    // (stamped on every matched row, changed or not).
    const updated = await prisma.$executeRaw`
      UPDATE public.master_vendor_details m
         SET purchasing_blocked = s.b,
             purchasing_blocked_synced_at = now()
        FROM unnest(${codes}::text[], ${values}::boolean[]) AS s(code, b)
       WHERE ltrim(m.vendor_code, '0') = s.code`;
    // Not in v2srm → unknown; synced_at cleared too (it was never confirmed).
    const clearedToNull = await prisma.$executeRaw`
      UPDATE public.master_vendor_details
         SET purchasing_blocked = NULL,
             purchasing_blocked_synced_at = NULL
       WHERE (purchasing_blocked IS NOT NULL OR purchasing_blocked_synced_at IS NOT NULL)
         AND NOT (ltrim(vendor_code, '0') = ANY(${codes}::text[]))`;

    const result: VendorBlockedSyncResult = {
      fetched: flags.size,
      updated,
      clearedToNull,
      blocked: values.filter(Boolean).length,
      durationMs: Date.now() - start,
      startedAt,
    };
    lastResult = result;
    console.log(`[VendorBlocked] Done — v2srm vendors:${result.fetched} (blocked ${result.blocked}) updated:${updated} cleared:${clearedToNull} in ${result.durationMs}ms`);
    return result;
  } catch (err: any) {
    lastResult = {
      fetched: 0, updated: 0, clearedToNull: 0, blocked: 0,
      durationMs: Date.now() - start, startedAt, error: err?.message ?? 'Unknown error',
    };
    console.error('[VendorBlocked] Sync failed:', err?.message);
    throw err;
  } finally {
    running = false;
  }
}
