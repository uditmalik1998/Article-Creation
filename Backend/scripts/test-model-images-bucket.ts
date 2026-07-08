import 'dotenv/config';
import assert from 'assert';
import { storageService } from '../src/services/storageService';

async function main() {
  const key = `__selftest__/roundtrip-${Date.now()}.txt`;
  const body = Buffer.from('model-images roundtrip ok');

  const url = await storageService.uploadModelImage(key, body, 'text/plain');
  console.log('uploaded ->', url);
  assert.ok(url && url.length > 0, 'uploadModelImage must return a URL');

  const missing = await storageService.fetchApprovedImage(`__definitely_missing__/${Date.now()}.jpg`);
  assert.strictEqual(missing, null, 'fetchApprovedImage must return null for a missing key');

  console.log('PASS: model-images upload + approved-miss handling');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
