import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// Every generated view is normalized to these EXACT pixel dimensions (2:3 portrait)
// before it leaves runSingleGeneration, so all five views of an article are pixel-
// identical in size — the model's aspectRatio config keeps the ratio at 2:3 but does
// NOT guarantee identical pixel dimensions across views. Overridable via env.
const OUTPUT_WIDTH = Number(process.env.MODELGEN_OUTPUT_WIDTH) || 1024;
const OUTPUT_HEIGHT = Number(process.env.MODELGEN_OUTPUT_HEIGHT) || 1536;

// Resize a generated view to the fixed OUTPUT_WIDTH×OUTPUT_HEIGHT. Gemini already
// returns 2:3, so 'cover' is effectively a clean resize with no meaningful crop; it
// also guards against any view that comes back at a slightly different aspect.
async function normalizeOutput(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  } catch (e: any) {
    console.warn('[ModelGen] normalizeOutput failed, returning original buffer:', e?.message || e);
    return buf;
  }
}

// Lazily create the client so dotenv has run by the time we need the key.
let _aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!_aiClient) {
    const apiKey = process.env.GEMINIAPI_KEY || process.env.GOOGLE_API_KEY || '';
    console.log('[ModelGen] API key check — GEMINIAPI_KEY present:', !!process.env.GEMINIAPI_KEY, '| GOOGLE_API_KEY present:', !!process.env.GOOGLE_API_KEY);
    if (!apiKey) throw new Error('GEMINIAPI_KEY is not set. Add it to .env');
    console.log('[ModelGen] GoogleGenAI client created, key starts with:', apiKey.slice(0, 6) + '...');
    _aiClient = new GoogleGenAI({ apiKey });
  }
  return _aiClient;
}
const MAX_RETRIES = 2;
const MAX_WORKERS = 4;

// Two fixed studio backdrops, chosen per ARTICLE (from its garment colour) so that all
// of an article's views share the SAME backdrop. Rule: a DARK garment gets a LIGHT
// backdrop; a LIGHT garment gets a slightly DEEPER backdrop — so the product always
// stands out against the background. Both are overridable via env.
export const LIGHT_BACKDROP = process.env.MODELGEN_BG_LIGHT || 'soft light powder blue (like #D8E6F2)';
export const DEEPER_BACKDROP = process.env.MODELGEN_BG_DEEP || 'soft muted slate blue-grey (like #A9B8C9)';

const DARK_COLOR_WORDS = ['black', 'navy', 'charcoal', 'maroon', 'burgundy', 'wine', 'brown', 'coffee', 'chocolate', 'espresso', 'olive', 'forest', 'bottle', 'indigo', 'midnight', 'ink', 'jet', 'dark', 'deep', 'teal', 'emerald', 'rust', 'plum', 'aubergine'];
const LIGHT_COLOR_WORDS = ['white', 'offwhite', 'off white', 'cream', 'ivory', 'beige', 'ecru', 'natural', 'oatmeal', 'sand', 'stone', 'champagne', 'pearl', 'pale', 'light', 'pastel', 'powder', 'mint', 'lemon', 'sky', 'blush', 'peach', 'lavender', 'lilac', 'silver', 'chalk'];

// Decide the backdrop for a whole article from its garment colour name. Deterministic,
// so every view of the article resolves to the SAME backdrop. Dark words are checked
// first (e.g. "light navy" is treated as dark → light backdrop). Unknown/blank colour
// falls back to the light backdrop.
export function backgroundForGarment(colorName?: string): string {
  const c = (colorName || '').toLowerCase().trim();
  if (c) {
    if (DARK_COLOR_WORDS.some((w) => c.includes(w))) return LIGHT_BACKDROP;   // dark garment → light backdrop
    if (LIGHT_COLOR_WORDS.some((w) => c.includes(w))) return DEEPER_BACKDROP; // light garment → deeper backdrop
  }
  return LIGHT_BACKDROP;
}

// Back-compat shim for existing call sites that pass a filename/seed we no longer use.
// Prefer backgroundForGarment(colorName). Defaults to the light backdrop.
export function pickBackgroundColor(_seed?: string): string {
  return LIGHT_BACKDROP;
}

// When the SOURCE_IMAGE shows a two-piece set (e.g. jacket + trousers), a colour swap
// must recolour ONLY the featured product and leave the complementary piece its ORIGINAL
// colour. This returns the scoping clause appended to the colour instructions. 'full' /
// 'unknown' / undefined → no scoping (recolour the whole featured garment as before).
function recolorScopeText(featuredGarment?: string): string {
  if (featuredGarment === 'top')
    return ' ⚠️ RECOLOUR ONLY THE UPPER GARMENT (the top/shirt/jacket — the featured product). The LOWER garment (trousers/pants/shorts/skirt) MUST keep its EXACT ORIGINAL colour from the SOURCE_IMAGE — do NOT recolour, tint, or shift the lower garment in any way. Only the upper garment changes colour.';
  if (featuredGarment === 'bottom')
    return ' ⚠️ RECOLOUR ONLY THE LOWER GARMENT (the trousers/pants/shorts/skirt — the featured product). The UPPER garment (top/shirt/jacket) MUST keep its EXACT ORIGINAL colour from the SOURCE_IMAGE — do NOT recolour, tint, or shift the upper garment in any way. Only the lower garment changes colour.';
  return '';
}

export function buildPrompt(
  gender: string,
  bodytype: string,
  imageCount: string,
  viewDirection: string = 'front',
  broachPlacement?: string,
  specialInstructions?: string,
  colorName?: string,
  hasColorImage?: boolean,
  attributesText?: string,
  hasStyleReference?: boolean,
  backgroundColor?: string,
  featuredGarment?: string
): string {
  const genderLower = (gender || '').toLowerCase();
  // Use a light-skinned model for dark garments so the product is clearly visible
  // against the model's skin (dark garment on dark skin = invisible product).
  const isDarkGarment = !!(colorName && DARK_COLOR_WORDS.some(w => colorName.toLowerCase().includes(w)));
  const skinNote = isDarkGarment ? ', fair/light skin tone' : '';
  let modelDesc: string;
  switch (genderLower) {
    case 'male': modelDesc = `a professional male fashion model${skinNote}`; break;
    case 'kid boy': modelDesc = `a young boy model, age 8${skinNote}`; break;
    case 'kid girl': modelDesc = `a young girl model, age 8${skinNote}`; break;
    default: modelDesc = `a professional female fashion model${skinNote}`;
  }

  const isCloseup = viewDirection.toLowerCase() === 'closeup';

  let framingDesc: string;
  if (isCloseup) {
    framingDesc = 'extreme close-up macro fashion detail shot — NOT a full-body or upper-body shot';
  } else {
    switch (bodytype) {
      case 'Full-Body': framingDesc = 'full body fashion photoshoot, head to toe'; break;
      case 'Upper-Body': framingDesc = 'upper body fashion photoshoot, waist up, do NOT show below the waist'; break;
      case 'Lower-Body': framingDesc = 'lower body fashion photoshoot, waist down to feet, do NOT show above the waist, crop tightly at the waist'; break;
      default: framingDesc = 'DETECT the garment type from SOURCE_IMAGE, then use ONE consistent framing for EVERY view of this product: bottomwear (trousers/jeans/shorts/skirt) → HALF SHOT, waist down to the feet, cropped cleanly at the waist (upper body NOT shown); tops/shirts/t-shirts → upper-body shot, waist up; dresses/one-piece/full outfits → full body head to toe. Use the SAME framing across front, back, side, and three-quarter — NEVER mix full-body and half/waist-down across views.';
    }
  }

  const recolorScope = recolorScopeText(featuredGarment);
  const colorInstr = hasColorImage
    ? `The garment MUST be recolored to match the dominant color of the COLOR_REFERENCE image included in this request. Sample the color from COLOR_REFERENCE and apply it uniformly to the entire garment in every view. Ignore the shape, pattern, texture, or content of COLOR_REFERENCE — use it ONLY as a color swatch. This overrides the source image color. This is a COLOR SWAP ONLY: the fabric's weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the SOURCE_IMAGE must stay pixel-faithful and fully intact — do not flatten, smooth, or simplify the fabric into a solid untextured block of color.${recolorScope}`
    : colorName
      ? `The garment's base color MUST change to ${colorName} in every view (front, back, side, closeup). This is a COLOR SWAP ONLY: the fabric's weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the SOURCE_IMAGE must stay pixel-faithful and fully intact — do not flatten, smooth, or simplify the fabric into a solid untextured block of color.${recolorScope}`
      : `The garment color MUST be IDENTICAL to the SOURCE_IMAGE. Do not change or shift the color in any view.`;

  // Bottomwear (trousers/shorts/skirts) needs its own close-up subject — collar/placket/
  // sleeve don't exist on a bottom. For 'auto' bodytype (article-list jobs), we instruct
  // the AI to detect the garment type from the source image and choose accordingly.
  const isLower = bodytype === 'Lower-Body';
  const closeupSubject = isLower
    ? 'the waistband, belt loops, a pocket, the hem/cuff, or the fabric weave of the bottomwear (NOT a collar, neckline, or sleeve — this is a bottom garment)'
    : bodytype === 'auto'
      ? 'the most characteristic detail of the garment — DETECT THE GARMENT TYPE FROM SOURCE_IMAGE FIRST: if it is bottomwear (trousers/jeans/shorts/skirt) zoom in on the waistband, belt loops, a pocket, the hem/cuff, or the fabric weave (NOT collar/neckline/sleeve which do not exist on bottomwear); if it is topwear (shirt/t-shirt/jacket/top) zoom in on the collar, placket, chest area, or a sleeve cuff'
      : 'the collar, placket, chest, neckline, or a sleeve cuff of the garment';

  // Garment-type guard appended to back/side views — works for ALL bodytype values
  // including 'auto'. Reinforces Rule #1 at the view level.
  const garmentTypeGuard = ' GARMENT-TYPE GUARD: Refer to Rule #1 — if the SOURCE_IMAGE shows ONLY bottomwear, pair it with a simple plain solid PLAIN WHITE crew-neck t-shirt (white ONLY — the identical white t-shirt in every view) as a neutral complement; do NOT add a jacket, hoodie, or printed top, and do NOT change the t-shirt colour between views. If the SOURCE_IMAGE shows ONLY a top, pair it with the same simple plain mid-blue denim jeans in every view. The SOURCE garment is always the hero.';

  const viewMap: Record<string, string> = {
    front: `Front-facing model pose showing the full front of the garment clearly. The model faces the camera directly, standing naturally with feet in clean simple casual sneakers (NEVER barefoot). Follow the FRAMING & CAMERA framing rule for how much of the body to show (a real human body must always be visibly wearing the garment — never floating or empty fabric).${garmentTypeGuard}`,
    back: `TRUE 180° REAR VIEW — THIS IS THE HARDEST CONSTRAINT, OBEY IT ABSOLUTELY: the model has turned a FULL 180° to face directly AWAY from the camera. The back of the head and hair face the camera; the face, chin, and any front-of-body detail are COMPLETELY out of view. You are looking at the model's spine/back and the REVERSE side of the garment.
DO NOT simply repeat the front. Any feature that identifies the FRONT of the garment MUST be ABSENT from this image: no front drawstring / tie / bow, no front zip fly, no front slant hand-pockets, no chest print, no buttons/placket facing the camera. If the front had a drawstring bow, it is now hidden behind the body and must NOT appear.
RECONSTRUCT the back plausibly from standard garment construction even though the SOURCE_IMAGE only shows the front: show the BACK of the garment — for a top: back yoke, centre-back seam, shoulder blades, back collar; for bottomwear: the seat/rear rise, centre-back seam, back waistband/belt loops, and back patch pockets where such a garment normally has them. Keep colour, fabric and pattern identical to the source, but the composition must unmistakably read as the BACK. A front-facing or near-front / slightly-turned result is a HARD FAILURE.${isLower ? ' Show the waistband from behind at the top of the frame. Pair with the SAME plain white crew-neck t-shirt (white only, identical in every view), seen from the back — no jacket.' : ''}${garmentTypeGuard}`,
    left_side: `STRICT 90-DEGREE LEFT-SIDE PROFILE: Rotate the model exactly 90° so the left shoulder points directly toward the camera and the body spans left-to-right across the frame. The face must appear in true profile with only one eye visible and the nose pointing to the left edge of the frame. This must NOT be a near-front, slight-turn, or three-quarter angle — it must be a genuine 90° side view clearly showing the full side silhouette of the garment. The side view must look VISUALLY DISTINCT from the front view.${garmentTypeGuard}`,
    side: `STRICT 90-DEGREE SIDE PROFILE: Rotate the model exactly 90° so one shoulder points directly toward the camera. The face appears in true profile with only one eye visible. This is NOT a three-quarter or near-front angle — it must be a genuine 90° side view clearly showing the full side silhouette. The side view must look VISUALLY DISTINCT from the front view.${garmentTypeGuard}`,
    three_quarter: `Three-quarter (45-degree) angle model pose showing the front and one side together. The model is rotated approximately 45° from the camera.${garmentTypeGuard}`,
    closeup: `ON-MODEL HALF-BODY DETAIL SHOT — A REAL HUMAN MODEL MUST BE CLEARLY VISIBLE, THIS IS MANDATORY: frame a partial-body crop of the SAME model wearing the garment, zoomed on ${closeupSubject}. A recognisable human presence is REQUIRED — at minimum the model's hand(s) resting on/near that area AND a portion of the adjoining body (${isLower ? "the model's torso in the paired neutral t-shirt above the waistband, the hips, and upper thighs" : 'the shoulders, chest, and upper arms'}) must be in frame, so it unmistakably reads as a person wearing the garment. This is NOT a fabric-only macro, NOT floating fabric, and NOT a laid-flat product shot — if no human body is visible it is a HARD FAILURE. Keep it noticeably tighter/closer than the full-body views while still showing the model, and emphasise fabric weave, stitching, and any print/stripe pattern. Do NOT show the model's full face (crop above the chest or keep the head out of frame).${garmentTypeGuard}`,
  };

  const isBackView = viewDirection.toLowerCase() === 'back';
  const closeupAreaHint = isLower
    ? 'the waistband / pocket / hem / fabric weave'
    : bodytype === 'auto'
      ? 'the most relevant detail area (waistband/pocket/hem for bottomwear; collar/placket/chest for topwear — detect from SOURCE_IMAGE)'
      : 'the collar / placket / chest area';
  const framingRule = isCloseup
    ? `Partial-body crop centred on ${closeupAreaHint}, clearly tighter and closer than the front/back/side views. A REAL HUMAN MODEL MUST be visible and unmistakable — include the model's hand(s) and a portion of the adjoining body/limbs wearing the garment. The full head-to-toe body and the full face must NOT be in frame, but the shot must obviously read as a person wearing the garment: NEVER a fabric-only macro, floating fabric, or a laid-flat product shot. If no human body is visible in the result, it is a HARD FAILURE — zoom out slightly rather than lose the model.`
    : bodytype === 'Lower-Body'
      // For back view of bottomwear, show waistband-to-hem; for all other views also waist-down only.
      ? isBackView
        ? 'Show the complete bottomwear from waistband to hem. The waistband must be visible at the top of frame. Upper body (bare or clothed) must NOT appear above the waistband — crop at the waist.'
        : 'Show ONLY from waist down to feet. Upper body must NOT appear in the frame.'
      : bodytype === 'Upper-Body'
        ? 'Show ONLY from waist up. Lower body must NOT appear in the frame.'
        : bodytype === 'Full-Body'
          ? 'Full garment must be visible, head to toe, no cropping.'
          : 'DETECT the garment type from SOURCE_IMAGE and frame EVERY view of this product IDENTICALLY (this consistency is the top priority — never full-body in one view and waist-down in another):\n  • BOTTOMWEAR (trousers/jeans/shorts/skirt): HALF-BODY WAIST-DOWN shot — show from the waist down to the feet, cropped cleanly at the waist, in front/back/side/three-quarter alike. The upper body must NOT appear. A REAL human lower body (hips, thighs, legs, and feet in clean sneakers) MUST be clearly visible wearing the garment — NEVER floating, empty, or laid-flat trousers, and never barefoot.\n  • TOPWEAR (shirt/t-shirt/top): waist-UP upper-body shot in every view; do NOT show below the waist.\n  • DRESS / one-piece / full outfit: full body head-to-toe in every view.\nWhatever framing the garment type calls for, apply the EXACT SAME crop level to all four model views.';

  const attributesBlock = attributesText
    ? `\n\nGARMENT ATTRIBUTES (from catalog data — the generated garment MUST stay consistent with these):\n- ${attributesText}`
    : '';

  let viewInstr = viewMap[viewDirection.toLowerCase()] || 'Front-facing fashion model pose.';
  viewInstr += broachPlacement
    ? ` The broach should be prominently displayed on the ${broachPlacement} of the garment.`
    : ' No broach is to be included in the image.';
  viewInstr += specialInstructions
    ? ` Additional instructions: ${specialInstructions}`
    : ' No additional special instructions.';
  viewInstr += hasStyleReference
    ? ` A VIEW_CONSISTENCY_REFERENCE image is attached — use it ONLY to lock the garment's color, pattern scale, and fabric texture. DO NOT copy its pose, body angle, crop, or framing in any way. The pose for THIS image is "${viewDirection}" as defined above — it must look clearly and obviously different from the reference image's pose. A side view must look like a side view, not a front view. Copying the reference pose is a FAILURE.`
    : '';

  return `You are a world-class fashion photographer and AI fashion director.

PRIMARY OBJECTIVE:
Generate a hyper-realistic fashion photoshoot image by strictly preserving the garment from the SOURCE_IMAGE.

⚠️ RULE #1 — GARMENT STYLING (READ BEFORE ANYTHING ELSE):
Examine the SOURCE_IMAGE first to determine what garment is being featured.
- If the source shows ONLY bottomwear (trousers, jeans, shorts, skirt): the model must wear the SOURCE bottomwear as the FEATURED garment. Pair it with a simple, plain, solid PLAIN WHITE basic crew-neck t-shirt (colour = white ONLY, nothing printed, branded, or elaborate). ⚠️ CONSISTENCY: this EXACT SAME plain white t-shirt MUST be worn IDENTICALLY in EVERY view (front, back, side, three-quarter, closeup) — do NOT change its colour, shade, or style between views (never switch it to grey, black, or any other colour). The top is a neutral complement only; the bottomwear is the hero. Do NOT add a jacket, blazer, hoodie, or any bulky upper garment.
- If the source shows ONLY a top/shirt: the model must wear the SOURCE top as the FEATURED garment. Pair it with simple plain mid-blue denim jeans as a neutral complement. ⚠️ CONSISTENCY: this EXACT SAME pair of jeans MUST be worn IDENTICALLY in every view — do NOT change its colour or style between views. Do NOT add a jacket or any additional top layer.
- If the source shows a full outfit: preserve both pieces exactly as shown.
- The FEATURED garment from SOURCE_IMAGE must always be the visual focus — never let the complementary piece draw more attention than it.

MODEL DETAILS (STRICT):
- Description: ${modelDesc}
- Expression: Neutral, confident
- Pose: Professional fashion pose
- Footwear: clean, simple, neutral casual sneakers appropriate to the outfit — the model is NEVER barefoot, and the SAME footwear is worn in every view.
- Styling consistency: the paired/complementary garment (the neutral top or bottom from Rule #1), footwear, hairstyle, and skin tone MUST stay identical across all views of this product.

FRAMING & CAMERA:
- Framing: ${framingDesc}
- View: ${viewInstr}
- ${framingRule}

IMAGE SIZE (STRICT):
- Final output: 2:3 aspect ratio
- Center the model/garment on the canvas

BACKGROUND (READ CAREFULLY — CONSISTENCY IS CRITICAL):
- The backdrop MUST be a COMPLETELY FLAT, UNIFORM, SOLID SINGLE COLOUR filling the entire frame edge-to-edge and corner-to-corner — like a solid paint fill / plain seamless studio wall. NO gradient, NO glow, NO halo, NO vignette, NO darkening toward the edges or corners, NO lighting falloff. Every pixel of the background is the SAME colour.
- ${backgroundColor
    ? `That solid colour MUST be EXACTLY ${backgroundColor}. This exact colour is FIXED for this product and MUST be pixel-identical in every view (front, back, side, three-quarter, closeup) — the entire product set is shot on the identical solid backdrop. Do NOT pick, invent, brighten, darken, warm, cool, or shift to any other colour. Keep it soft, muted and clean so the garment stands out clearly against it.`
    : `Use ONE soft, PALE, low-saturation PASTEL solid colour that complements the garment (e.g. pale lilac, soft mint, pale buttery yellow, blush, powder blue, warm off-white) — light and airy, never bold, deep, golden, warm-dark, or saturated. Use the SAME solid colour for every view of this product.`}
- Matte and completely textureless — no seams, no floor line, no horizon, no props, no patterns, no banding, no shadows cast on the backdrop.
- Bright, soft, EVEN studio lighting on the model, with only a faint soft contact shadow near the feet — no hard shadows, no moody/dramatic/spotlight lighting. The backdrop itself stays a flat even colour regardless of the lighting on the model.

GARMENT PRESERVATION RULES (ABSOLUTE):
- Color: ${colorInstr}
- Fabric texture, weave/knit structure, and surface grain MUST remain fully intact and unchanged from the SOURCE_IMAGE — this holds true even when the color above is being changed; a colour change must never flatten or smooth away the woven texture
- Pattern MUST match the SOURCE_IMAGE exactly at the same scale: replicate the same stripe/print WIDTH, SPACING, and DENSITY relative to the garment's width — do not widen, thin, stretch, respace, or redraw the pattern at a different scale. Count and reproduce the same number of visible stripes/repeats as the source. Stripes must stay straight and run in their original direction (e.g. vertical), following the natural drape of the fabric — no unnatural warping, twisting, or curving around body contours.
- NO redesign, NO styling alteration, NO added accessories (see Rule #1 above for garment pairing rules)
- MODEL MUST ALWAYS BE PRESENT: A real human fashion model wearing the garment must always appear in the image. Never generate floating fabric, a headless garment, or a garment without a visible human body. The model must be fully present and well-posed.
- REMOVE all price tags, swing tags, hang tags, size tags, care/brand labels, stickers, barcodes, and any dangling tags or strings from the garment. Even if such tags ARE visible in the SOURCE_IMAGE, the generated garment must appear completely clean and tag-free, as if worn — never render a price tag or label on the product.

QUALITY STANDARD:
- Ultra-HD realism
- Marketplace catalog quality (Myntra/Ajio/Zara)
- Clean, sharp, commercial-ready output${attributesBlock}`;
}

export async function runSingleGeneration(
  imageBuffer: Buffer,
  mimeType: string,
  gender: string,
  bodytype: string,
  imageCount: string,
  viewDirection: string,
  patternBuffer?: Buffer,
  patternMime?: string,
  accessoryBuffer?: Buffer,
  accessoryMime?: string,
  broachPlacement?: string,
  specialInstructions?: string,
  colorName?: string,
  colorImageBuffer?: Buffer,
  colorImageMime?: string,
  attributesText?: string,
  styleReferenceBuffer?: Buffer,
  styleReferenceMime?: string,
  backgroundColor?: string,
  featuredGarment?: string
): Promise<Buffer> {
  const hasColorImage = !!(colorImageBuffer && colorImageMime);
  const recolorScope = recolorScopeText(featuredGarment);
  const colorLockInstruction = hasColorImage
    ? `MANDATORY COLOR (FROM IMAGE): The garment in the output MUST be recolored to match the dominant color of the COLOR_REFERENCE image that follows. Use COLOR_REFERENCE ONLY as a color swatch — ignore its shape, pattern, and content. This overrides the source image color and any text color name. This is a COLOR SWAP ONLY — the fabric's weave/knit texture, stripe or print pattern, yarn grain, and surface detail from the source image MUST be preserved pixel-faithfully; do not flatten or smooth the fabric into a solid untextured block of color.${recolorScope}`
    : colorName
      ? `MANDATORY COLOR: Recolor ONLY the base garment color to ${colorName} — apply it as the new uniform base tone. This is a COLOR SWAP ONLY: do NOT flatten, smooth, or simplify the fabric — the weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the source image MUST remain fully intact and pixel-faithful, just tinted to ${colorName} instead of the original color. The output must still look like a textured woven/knit fabric, never a flat solid-color block.${recolorScope}`
      : `COLOR PRESERVE: Keep the garment color exactly as shown in the source image. Do not change, shift, or neutralize the color.`;

  const hasStyleReference = !!(styleReferenceBuffer && styleReferenceMime);
  const promptText = buildPrompt(gender, bodytype, imageCount, viewDirection, broachPlacement, specialInstructions, colorName, hasColorImage, attributesText, hasStyleReference, backgroundColor, featuredGarment);

  const parts: any[] = [
    { text: colorLockInstruction },
    { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
  ];

  if (patternBuffer && patternMime) {
    parts.push({ inlineData: { mimeType: patternMime, data: patternBuffer.toString('base64') } });
    parts.push({ text: 'Apply the pattern to the garment.' });
  } else {
    parts.push({ text: 'Render the garment on a professional fashion model.' });
  }

  // Color reference image: provide right before the accessory so Gemini reads the
  // explicit "this is a color swatch, ignore content" instruction adjacent to the bytes.
  if (hasColorImage) {
    parts.push({ text: 'COLOR_REFERENCE follows. Use ONLY the dominant color from this image for the garment. Ignore its shape, pattern, and any objects depicted — treat it strictly as a color swatch.' });
    parts.push({ inlineData: { mimeType: colorImageMime as string, data: (colorImageBuffer as Buffer).toString('base64') } });
  }

  if (accessoryBuffer && accessoryMime) {
    parts.push({ inlineData: { mimeType: accessoryMime, data: accessoryBuffer.toString('base64') } });
  }

  // A previously generated view of this SAME garment, provided so all views of one
  // garment agree with each other on color and pattern scale instead of each being
  // an independent re-interpretation of the source photo. This must NEVER be read as
  // a pose reference — only as a color/pattern/texture swatch.
  if (hasStyleReference) {
    parts.push({
      text: `VIEW_CONSISTENCY_REFERENCE follows — a fashion photo already generated for a DIFFERENT view of this EXACT same garment. Use it to lock FOUR things ONLY:
1. THE GARMENT — match its color, stripe/print pattern width/spacing/density, and fabric texture exactly. Do NOT redraw the pattern at a different scale or shift the color.
2. THE BACKDROP — the solid studio background color must be identical to this reference. Do NOT switch to a different background color.
3. THE STYLING — the paired/complementary garment (e.g. the plain white t-shirt), the footwear, the hairstyle, and the model's skin tone MUST be IDENTICAL to the reference. If the reference model wears a plain white t-shirt and sneakers, this view must show the SAME plain white t-shirt and the SAME sneakers — do NOT change the top's colour/style or the shoes between views.
4. THE FRAMING / CROP LEVEL — show the SAME AMOUNT of the body as the reference: if the reference is a waist-down HALF shot, this view MUST also be waist-down; if it is a waist-up shot, this view is also waist-up; if full-body, this view is also full-body. All views of this product must show the identical portion of the body — do NOT switch between full-body and half/waist-down across views.
⚠️ CRITICAL — POSE/ANGLE (this is SEPARATE from crop level above): The reference image's POSE, BODY ANGLE, and CAMERA ANGLE are COMPLETELY IRRELEVANT and must NOT influence this output — but its CROP LEVEL (point 4) MUST be matched. This output is the "${viewDirection}" view — its pose/angle must match the "${viewDirection}" description precisely and must look CLEARLY AND OBVIOUSLY DIFFERENT in body position from the reference. If the reference is a front view, this output must NOT look like a front view. Copying the reference pose or producing a near-identical body angle is a FAILURE.${
        viewDirection.toLowerCase() === 'back'
          ? ` \n⚠️⚠️ THIS IS THE BACK VIEW: the VIEW_CONSISTENCY_REFERENCE almost certainly shows the FRONT of this garment. You must render the EXACT OPPOSITE — the model turned 180° with their back and the back of their head to the camera, and the front-identifying features seen in the reference (drawstring/tie, front fly, front slant pockets, chest print, buttons/placket, the face) MUST be absent. Take ONLY colour, pattern and fabric from the reference; take the POSE from the "back" description and show the reverse of the garment.`
          : ''
      }`,
    });
    parts.push({ inlineData: { mimeType: styleReferenceMime as string, data: (styleReferenceBuffer as Buffer).toString('base64') } });
  }

  parts.push({ text: promptText });

  const ai = getAIClient();
  const imageSizeKB = Math.round(imageBuffer.length / 1024);
  const base64SizeKB = Math.round((imageBuffer.length * 4 / 3) / 1024);
  console.log(`[ModelGen] Calling Gemini model: ${GEMINI_IMAGE_MODEL}, view: ${viewDirection}, gender: ${gender}, bodytype: ${bodytype}`);
  console.log(`[ModelGen] color mode: ${hasColorImage ? 'IMAGE' : colorName ? `NAME(${colorName})` : 'SOURCE'} | style reference: ${hasStyleReference} | background: ${backgroundColor ?? 'auto-pastel'}`);
  console.log(`[ModelGen] Image size: ${imageSizeKB} KB | base64 payload: ~${base64SizeKB} KB | Parts count: ${parts.length}`);

  let response: any;
  try {
    response = await (ai.models as any).generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: [Modality.IMAGE],
        // Enforce the 2:3 portrait ratio at the API level — the model ignores
        // aspect-ratio wording in the text prompt, so it must be set here.
        imageConfig: { aspectRatio: '2:3' },
        safetySettings: [
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        ],
      },
    });
  } catch (apiErr: any) {
    console.error('[ModelGen] Gemini API call threw an error:', apiErr?.message || apiErr);
    if (apiErr?.cause) console.error('[ModelGen] Root cause:', apiErr.cause?.message || apiErr.cause);
    if (apiErr?.status) console.error('[ModelGen] HTTP status:', apiErr.status);
    if (apiErr?.statusText) console.error('[ModelGen] HTTP statusText:', apiErr.statusText);
    try { console.error('[ModelGen] Error JSON:', JSON.stringify(apiErr, Object.getOwnPropertyNames(apiErr))); } catch {}
    throw apiErr;
  }

  console.log('[ModelGen] Raw response keys:', Object.keys(response || {}));
  const candidates = response?.candidates || [];
  console.log('[ModelGen] Candidates count:', candidates.length);

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci];
    console.log(`[ModelGen] Candidate[${ci}] finishReason:`, candidate?.finishReason);
    const cparts = candidate?.content?.parts || [];
    console.log(`[ModelGen] Candidate[${ci}] parts count:`, cparts.length);
    for (let pi = 0; pi < cparts.length; pi++) {
      const part = cparts[pi];
      console.log(`[ModelGen] Candidate[${ci}] part[${pi}] keys:`, Object.keys(part || {}), '| has inlineData:', !!part?.inlineData, '| has text:', !!part?.text);
      if (part?.inlineData?.data) {
        console.log('[ModelGen] Found image data in candidate', ci, 'part', pi, '— size (bytes):', Buffer.from(part.inlineData.data, 'base64').length);
        // Normalize to fixed 2:3 pixel dimensions so every view of an article matches.
        return await normalizeOutput(Buffer.from(part.inlineData.data, 'base64'));
      }
      if (part?.text) {
        console.log(`[ModelGen] Candidate[${ci}] part[${pi}] text snippet:`, part.text.slice(0, 200));
      }
    }
  }

  // Log full raw response to spot unexpected structure
  console.error('[ModelGen] No image data found. Full response:', JSON.stringify(response, null, 2).slice(0, 3000));
  throw new Error('No image data found in Gemini model response.');
}

async function safeGenerate(
  file: Express.Multer.File,
  view: string,
  gender: string,
  bodytype: string,
  imageCount: string,
  patternFile?: Express.Multer.File,
  accessoryFile?: Express.Multer.File,
  broachPlacement?: string,
  specialInstructions?: string,
  colorName?: string,
  colorImageFile?: Express.Multer.File
): Promise<Buffer> {
  // Pick the backdrop from the garment colour (dark → light backdrop, light → deeper),
  // so every view of this garment shares the same background.
  const backgroundColor = backgroundForGarment(colorName);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(`[ModelGen] safeGenerate attempt ${attempt + 1}/${MAX_RETRIES} — file: ${file.originalname}, view: ${view}`);
    try {
      const buf = await runSingleGeneration(
        file.buffer,
        file.mimetype,
        gender,
        bodytype,
        imageCount,
        view,
        patternFile?.buffer,
        patternFile?.mimetype,
        accessoryFile?.buffer,
        accessoryFile?.mimetype,
        broachPlacement,
        specialInstructions,
        colorName,
        colorImageFile?.buffer,
        colorImageFile?.mimetype,
        undefined, // attributesText — not used in the batch pipeline
        undefined, // styleReferenceBuffer
        undefined, // styleReferenceMime
        backgroundColor
      );
      console.log(`[ModelGen] safeGenerate SUCCESS on attempt ${attempt + 1} — file: ${file.originalname}, view: ${view}`);
      return buf;
    } catch (err: any) {
      lastError = err;
      console.error(`[ModelGen] safeGenerate attempt ${attempt + 1} FAILED — file: ${file.originalname}, view: ${view}, error:`, err?.message);
      if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastError!;
}

export interface GenerationResult {
  fileName: string;
  view: string;
  output: Buffer | string;
}

export async function runBatchPipeline(
  files: Express.Multer.File[],
  gender: string,
  bodytype: string,
  imageCount: string,
  patternFile?: Express.Multer.File,
  accessoryFile?: Express.Multer.File,
  broachPlacement?: string,
  specialInstructions?: string,
  colorName?: string,
  colorImageFile?: Express.Multer.File
): Promise<GenerationResult[]> {
  const views =
    imageCount === '1'
      ? ['front']
      : ['front', 'back', 'left_side', 'closeup'];

  const tasks: Array<{ file: Express.Multer.File; view: string }> = [];
  for (const f of files) {
    for (const v of views) {
      tasks.push({ file: f, view: v });
    }
  }

  const results: GenerationResult[] = [];

  // Process in batches of MAX_WORKERS to limit concurrency
  for (let i = 0; i < tasks.length; i += MAX_WORKERS) {
    const batch = tasks.slice(i, i + MAX_WORKERS);
    const settled = await Promise.allSettled(
      batch.map(({ file, view }) =>
        safeGenerate(file, view, gender, bodytype, imageCount, patternFile, accessoryFile, broachPlacement, specialInstructions, colorName, colorImageFile)
          .then(buf => ({ fileName: file.originalname, view, output: buf }))
      )
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      const { file, view } = batch[j];
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ fileName: file.originalname, view, output: `Error: ${r.reason?.message || 'Unknown error'}` });
      }
    }
  }

  return results;
}

export function ensureOutputFolder(baseDir: string): { todayStr: string; hitFolder: string; hitIndex: string } {
  const todayStr = new Date().toISOString().slice(0, 10);
  const generatedDir = path.join(baseDir, 'model-generation', todayStr);

  // Clean up old date folders (keep only today)
  const rootDir = path.join(baseDir, 'model-generation');
  if (fs.existsSync(rootDir)) {
    for (const folder of fs.readdirSync(rootDir)) {
      if (folder !== todayStr) {
        try { fs.rmSync(path.join(rootDir, folder), { recursive: true }); } catch { /* ignore */ }
      }
    }
  }

  fs.mkdirSync(generatedDir, { recursive: true });

  const existing = fs.existsSync(generatedDir)
    ? fs.readdirSync(generatedDir).filter(f => /^\d+$/.test(f) && fs.statSync(path.join(generatedDir, f)).isDirectory())
    : [];

  const hitIndex = String(existing.length + 1);
  const hitFolder = path.join(generatedDir, hitIndex);
  fs.mkdirSync(hitFolder, { recursive: true });

  return { todayStr, hitFolder, hitIndex };
}
