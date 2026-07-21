/**
 * Deterministic logic test for the model-generation prompts.
 *
 * This does NOT call Gemini. It runs the full chain — classify the article
 * (deriveBodyFraming) → pick the backdrop (backgroundForGarment) → build the prompt
 * (buildPrompt) — then checks each of the 6 reported gaps against the resulting text.
 * It proves what INSTRUCTIONS we send, not what the AI renders.
 *
 * Run:  npx ts-node --transpile-only scripts/test-generation-logic.ts
 */
import { buildPrompt, backgroundForGarment } from '../src/services/modelGenerationService';
import { deriveBodyFraming } from '../src/services/articleModelSourceService';

// Mirrors the runtime chain: resolver decides bodytype, then buildPrompt runs.
function promptFor(view: string, colorName: string, majorCategory: string, articleType: string) {
  const bodytype = deriveBodyFraming(majorCategory, articleType);
  const bg = backgroundForGarment(colorName);
  const p = buildPrompt('male', bodytype, '5', view, undefined, undefined, colorName, false, '', view !== 'front', bg);
  return { p, bodytype };
}

type Check = { gap: string; pass: boolean; detail: string };
const results: Check[] = [];
const add = (gap: string, pass: boolean, detail: string) => results.push({ gap, pass, detail });

// ── Gap 1: same backdrop across views + adaptive dark/light + colour-lock ────
{
  const bgs = ['front', 'back', 'side', 'three_quarter', 'closeup'].map(() => backgroundForGarment('LIGHT BEIGE'));
  add('1 · same-SKU background', new Set(bgs).size === 1, `backdrop across 5 views: ${new Set(bgs).size === 1 ? 'IDENTICAL' : 'DIFFERENT'} (${bgs[0]})`);

  const darkBg = backgroundForGarment('BLACK');
  const lightBg = backgroundForGarment('LIGHT BEIGE');
  add('1 · adaptive dark/light rule', darkBg !== lightBg && /D8E6F2/i.test(darkBg) && /A9B8C9/i.test(lightBg), `dark→"${darkBg}"  light→"${lightBg}"`);

  const { p } = promptFor('front', 'LIGHT BEIGE', 'SHIRT', 'SHIRT');
  add('1 · garment colour-lock text present', /IDENTICAL to the SOURCE_IMAGE|MUST change to|COLOR SWAP ONLY/.test(p), 'colour-lock instruction present');
}

// ── Gap 2: back-side image instruction ──────────────────────────────────────
{
  const { p } = promptFor('back', 'LIGHT BEIGE', 'SHIRT', 'SHIRT');
  add('2 · back-side instruction', /BACK of the garment|ENTIRE BACK|back yoke/i.test(p), 'shows the garment back');
  add('2 · strong "turn around" wording', /face away|facing away|faces the camera|180|rear view|back of the head/i.test(p), 'explicit rear/180 turn present');
}

// ── Gap 3: bottom-category framing (top vs bottom must differ) ───────────────
{
  const top = promptFor('front', 'WHITE', 'SHIRT', 'SHIRT');
  const bottom = promptFor('front', 'NAVY', 'TROUSER', 'TROUSER');
  const bottomForcesLower = bottom.bodytype === 'Lower-Body' && /ONLY from waist down|waist down to feet/i.test(bottom.p);
  add('3 · bottom gets lower-body framing', bottomForcesLower && top.bodytype !== bottom.bodytype,
    `shirt→bodytype="${top.bodytype}"  trouser→bodytype="${bottom.bodytype}"`);
}

// ── Gap 4: bottom close-up targets bottom features ──────────────────────────
{
  const { p } = promptFor('closeup', 'NAVY', 'TROUSER', 'TROUSER');
  const topParts = /\b(collar|placket|neckline|sleeve)\b/i.test(p.split('closeup')[0] + (p.match(/close-up on[^\n]*/i)?.[0] || ''));
  const bottomParts = /waistband|belt loops|hem|pocket/i.test(p);
  add('4 · bottom close-up targets bottom features', bottomParts, bottomParts ? 'close-up targets waistband/pocket/hem/fabric' : 'still top-only features');
}

// ── Gap 5: product-tag removal ──────────────────────────────────────────────
{
  const { p } = promptFor('front', 'LIGHT BEIGE', 'SHIRT', 'SHIRT');
  add('5 · product-tag removal instruction', /swing tag|price tag|hang ?tag|barcode|brand label|size tag|REMOVE all/i.test(p), 'tag-removal rule present');
}

// ── Gap 6: model repositioning for back view ────────────────────────────────
{
  const { p } = promptFor('back', 'LIGHT BEIGE', 'SHIRT', 'SHIRT');
  add('6 · back-view repositioning', /face away|faces the camera|180|turned to face directly AWAY|back of the head/i.test(p), 'explicit turn-away present');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n══════════ MODEL-GENERATION LOGIC TEST ══════════\n');
let pass = 0;
for (const r of results) {
  if (r.pass) pass++;
  console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'}  Gap ${r.gap}`);
  console.log(`        ${r.detail}\n`);
}
console.log('──────────────────────────────────────────────────');
console.log(`RESULT: ${pass}/${results.length} checks pass\n`);
