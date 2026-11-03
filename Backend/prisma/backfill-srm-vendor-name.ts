/**
 * backfill-srm-vendor-name.ts
 *
 * One-time backfill: populate vendorName (and normalise vendorCode to last 6 digits)
 * for all existing SRM records by matching on pptNumber → presentation_no.
 *
 * Rules:
 *  - Skip records that have no pptNumber
 *  - Vendor code is normalised to last 6 digits (e.g. "0000200251" → "200251")
 *  - Only updates fields that are currently null/wrong — never overwrites non-null vendorName
 *
 * Run: npx ts-node prisma/backfill-srm-vendor-name.ts
 */

import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const SRM_API_BASE = 'https://pymdqnnwwxrgeolvgvgv.supabase.co/functions/v1/srm-presentation-images-api';
const SRM_API_KEY  = process.env.SRM_API_KEY || 'v2@123';
const SRM_SUPABASE_KEY = process.env.SRM_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRxbm53d3hyZ2VvbHZndmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMzU0NzYsImV4cCI6MjA2ODkxMTQ3Nn0.jUrb0jIg6qjj2Rlh9DxYesSnbstoD4uoDCswqOqAkUM';
const PAGE_SIZE = 1000;

/** Normalise vendor code to last 6 digits (e.g. "0000200251" → "200251") */
function normaliseVendorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 6 ? digits.slice(-6) : digits || null;
}

interface SrmRow {
  presentation_no: string;
  vendor_code: string;
  vendor_name?: string | null;
}

async function fetchAllSrmRows(): Promise<SrmRow[]> {
  const allRows: SrmRow[] = [];
  let page = 1;

  while (true) {
    const url = `${SRM_API_BASE}?page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        'apikey': SRM_SUPABASE_KEY,
        'Authorization': `Bearer ${SRM_SUPABASE_KEY}`,
        'x-api-key': SRM_API_KEY,
      },
    });
    if (!res.ok) throw new Error(`SRM API HTTP ${res.status}`);
    const json: any = await res.json();
    const rows: SrmRow[] = json.rows ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }

  return allRows;
}

async function main() {
  console.log('Fetching all rows from SRM API...');
  const srmRows = await fetchAllSrmRows();
  console.log(`Fetched ${srmRows.length} rows from SRM API`);

  // Build lookup map: presentation_no → { vendor_code (normalised), vendor_name }
  const srmMap = new Map<string, { vendorCode: string | null; vendorName: string | null }>();
  for (const row of srmRows) {
    if (!row.presentation_no) continue;
    srmMap.set(row.presentation_no, {
      vendorCode: normaliseVendorCode(row.vendor_code),
      vendorName: row.vendor_name || null,
    });
  }
  console.log(`Built SRM map with ${srmMap.size} unique presentation numbers`);

  // Fetch all SRM records that are missing vendorName OR have un-normalised vendorCode
  const records = await prisma.extractionResultFlat.findMany({
    where: {
      source: 'SRM',
      pptNumber: { not: null },   // skip records with no presentation number
    },
    select: { id: true, pptNumber: true, vendorCode: true, vendorName: true },
  });
  console.log(`Found ${records.length} SRM records in DB with a pptNumber`);

  let updated = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const rec of records) {
    if (!rec.pptNumber) { skipped++; continue; }

    const srmData = srmMap.get(rec.pptNumber);
    if (!srmData) { noMatch++; continue; }

    const patch: Record<string, any> = {};

    // Normalise vendorCode (strip leading zeros)
    const normCode = srmData.vendorCode;
    if (normCode && rec.vendorCode !== normCode) patch.vendorCode = normCode;

    // Set vendorName if missing
    if (srmData.vendorName && !rec.vendorName) patch.vendorName = srmData.vendorName;

    if (Object.keys(patch).length === 0) { skipped++; continue; }

    await prisma.extractionResultFlat.update({ where: { id: rec.id }, data: patch });
    updated++;

    if (updated % 50 === 0) console.log(`  Updated ${updated}...`);
  }

  console.log(`\nDone!`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped} (already correct)`);
  console.log(`  No match: ${noMatch} (pptNumber not found in SRM API)`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
