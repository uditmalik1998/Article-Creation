import 'dotenv/config';
import { resolveArticleForGeneration } from './src/services/articleModelSourceService';
import { runSingleGeneration } from './src/services/modelGenerationService';
import { storageService } from './src/services/storageService';
import { outputKeyFor } from './src/services/articleListParser';

async function main() {
  const code = '1110106859';
  console.log(`\n=== resolve ${code} ===`);
  const r = await resolveArticleForGeneration(code);
  console.log('found:', r.found, '| gender:', r.gender, '| bodytype:', r.bodytype, '| colour:', r.colorName);
  console.log('attributes:', r.attributesText);
  console.log('imageUrl:', (r.imageUrl||'').slice(0,80));
  if (!r.found) { console.log('resolve failed:', r.reason); process.exit(1); }

  console.log('\n=== fetch source over HTTP ===');
  const res = await fetch(r.imageUrl!);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/jpeg';
  console.log('fetched', buf.length, 'bytes', mime);

  console.log('\n=== generate (front, auto framing) ===');
  const gen = await runSingleGeneration(buf, mime, r.gender!, r.bodytype!, '5', 'front',
    undefined, undefined, undefined, undefined, undefined, undefined, r.colorName, undefined, undefined, r.attributesText);
  console.log('generated', gen.length, 'bytes');

  console.log('\n=== upload ===');
  const url = await storageService.uploadModelImage(outputKeyFor(code, 'front'), gen, 'image/png');
  console.log('url:', url);
  console.log('\n✅ DB-DRIVEN PIPELINE OK');
}
main().catch(e => { console.error('FAIL:', e?.message || e); process.exit(1); });
