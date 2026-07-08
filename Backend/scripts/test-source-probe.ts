import 'dotenv/config';
import { storageService } from '../src/services/storageService';
import { sourceKeyFor } from '../src/services/articleListParser';

// Paste ~10 real FINAL ART codes from IMAGES PENDING.xlsx here before running.
const SAMPLE = [
  '1110097922-BLACK',
  '1110106859-DARK GREY',
  '1110109892-BLACK',
  '1110111001-MEDIUM MAROON',
  '1110111002-ROSE PINK',
];

async function main() {
  let found = 0;
  for (const code of SAMPLE) {
    const key = sourceKeyFor(code);
    const img = await storageService.fetchApprovedImage(key);
    const ok = !!img;
    if (ok) found++;
    console.log(`${ok ? 'FOUND' : 'MISS '}  ${key}${ok ? `  (${img!.buffer.length} bytes, ${img!.mime})` : ''}`);
  }
  console.log(`\n${found}/${SAMPLE.length} source images found with key format "{FINAL_ART}.jpg".`);
  if (found === 0) {
    console.error('All misses — the key format is likely wrong. Inspect real filenames in the APPROVED bucket before the full run.');
    process.exit(1);
  }
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
