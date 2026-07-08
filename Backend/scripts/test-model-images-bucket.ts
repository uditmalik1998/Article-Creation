import 'dotenv/config';
import assert from 'assert';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { storageService } from '../src/services/storageService';

async function main() {
  const key = `__selftest__/roundtrip-${Date.now()}.txt`;
  const body = Buffer.from('model-images roundtrip ok');

  const url = await storageService.uploadModelImage(key, body, 'text/plain');
  console.log('uploaded ->', url);
  assert.ok(url && url.length > 0, 'uploadModelImage must return a URL');

  // fetchApprovedImage reads from the APPROVED bucket (not model-images) — a missing key must return null
  const missing = await storageService.fetchApprovedImage(`__definitely_missing__/${Date.now()}.jpg`);
  assert.strictEqual(missing, null, 'fetchApprovedImage must return null for a missing key');

  // Clean up the self-test object so runs don't leave debris in the bucket.
  // StorageService exposes no public delete, so this script builds its own
  // client from the same MODEL_IMAGES_R2_* env vars (same pattern as test-r2-connection.ts).
  const accountId = String(process.env.MODEL_IMAGES_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(process.env.MODEL_IMAGES_R2_BUCKET_NAME || 'model-images').trim();
  const cleanupClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: String(process.env.MODEL_IMAGES_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '').trim(),
      secretAccessKey: String(process.env.MODEL_IMAGES_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    },
  });
  await cleanupClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log('cleaned up ->', key);

  console.log('PASS: model-images upload + approved-miss handling');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
