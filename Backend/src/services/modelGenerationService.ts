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
  // The style shoot is ALWAYS a full-body head-to-toe frame, whatever the garment's
  // catalogue framing is. That deliberate break in crop level is what keeps it from
  // reading as a duplicate of the front view (a waist-down style shoot next to a
  // waist-down front view is the same photo with a different foot forward).
  const isStyleShoot = viewDirection.toLowerCase() === 'style_shoot';
  // The three catalogue views of bottomwear are waist-down. Everything in the prompt that
  // implies a visible head (facial expression, hairstyle, "wearing a white t-shirt in
  // every view") quietly argues for a wider crop, and the model splits the difference by
  // returning a chest-down shot. On these views those cues are suppressed instead.
  const isWaistDownView = bodytype === 'Lower-Body' && !isCloseup && !isStyleShoot;
  // Feet are only in frame when the shot reaches the feet. An Upper-Body (waist-up)
  // shot must NOT show feet/footwear — mentioning sneakers there drags the crop down
  // to a full body. So footwear is only instructed when the frame actually shows feet.
  // The closeup is a tight detail crop: naming footwear there pulls the crop back out
  // to a full/half body shot, which is exactly how it ends up cloning the front view.
  // The style shoot is head-to-toe, so it always frames the feet.
  const framesFeet = (bodytype !== 'Upper-Body' && !isCloseup) || isStyleShoot;

  let framingDesc: string;
  if (isCloseup) {
    framingDesc = 'tight on-model detail crop — the camera is moved right in on ONE detail area of the garment, which fills most of the frame. This is NOT a full-body, waist-down, waist-up, or any other body shot, and it must NOT match the crop level of the other views';
  } else if (isStyleShoot) {
    framingDesc = 'FULL BODY head-to-toe editorial photoshoot on a real human model (head, face, torso, legs and feet in clean sneakers ALL in frame, never barefoot). This view is intentionally framed WIDER than the front/back/side views of this product — do NOT crop it to waist-down or waist-up';
  } else {
    switch (bodytype) {
      case 'Full-Body': framingDesc = 'full body fashion photoshoot, head to toe on a real human model (feet in clean sneakers, never barefoot)'; break;
      case 'Upper-Body': framingDesc = 'upper body fashion photoshoot, waist up on a real human model (head, torso, arms visible), do NOT show below the waist'; break;
      case 'Lower-Body': framingDesc = 'lower body fashion photoshoot — the frame starts AT THE WAISTBAND and ends just below the sneakers. Nothing above the waist is in the picture: no torso, no chest, no t-shirt, no arms, no head. This is a half shot of the legs, not a person with the head cropped off'; break;
      default: framingDesc = 'DETECT the garment type from SOURCE_IMAGE, then use ONE consistent framing for this product: bottomwear (trousers/jeans/shorts/skirt) → HALF SHOT, waist down to the feet, cropped cleanly at the waist (upper body NOT shown); tops/shirts/t-shirts → upper-body shot, waist up; dresses/one-piece/full outfits → full body head to toe. Use the SAME framing across the front, back and side views — NEVER mix full-body and half/waist-down between those three. (The style shoot and the closeup are deliberately framed differently and are handled by their own rules.)';
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
  // The hem/cuff is deliberately NOT offered as a bottomwear close-up subject: the crop
  // rules below forbid the hem and feet from appearing (that is what made the closeup
  // drift back into a full leg shot), so naming it as a subject would contradict them.
  const closeupSubject = isLower
    ? 'the waistband, belt loops, a pocket, or the fabric weave of the bottomwear (NOT a collar, neckline, or sleeve — this is a bottom garment)'
    : bodytype === 'auto'
      ? 'the most characteristic detail of the garment — DETECT THE GARMENT TYPE FROM SOURCE_IMAGE FIRST: if it is bottomwear (trousers/jeans/shorts/skirt) zoom in on the waistband, belt loops, a pocket, or the fabric weave (NOT collar/neckline/sleeve which do not exist on bottomwear); if it is topwear (shirt/t-shirt/jacket/top) zoom in on the collar, placket, chest area, or a sleeve cuff'
      : 'the collar, placket, chest, neckline, or a sleeve cuff of the garment';

  // What must stay OUT of the close-up frame — the concrete test for "tight enough".
  const closeupExclusion = isLower
    ? 'Do NOT show the full length of the legs, the hem, or the feet — if sneakers or the hem are visible, you have zoomed out far too much. At most, frame from just above the waistband down to roughly mid-thigh.'
    : bodytype === 'auto'
      ? 'Do NOT show the whole garment: for bottomwear the full leg length, the hem, and the feet must be out of frame (at most, just above the waistband down to mid-thigh); for topwear the full torso and the model\'s full face must be out of frame (at most, the collarbone down to mid-chest).'
      : 'Do NOT show the full torso down to the waist and do NOT show the model\'s full face — at most, frame from around the collarbone to mid-chest.';
  const closeupAdjoiningBody = isLower
    ? 'a strip of the torso in the paired white t-shirt, the hip, and the top of the thigh'
    : bodytype === 'auto'
      ? 'the hip and top of the thigh for bottomwear, or part of the shoulder and upper arm for topwear'
      : 'part of the shoulder or upper arm';

  // Garment-type guard appended to back/side views — works for ALL bodytype values
  // including 'auto'. Reinforces Rule #1 at the view level.
  const garmentTypeGuard = ` GARMENT-TYPE GUARD: Refer to Rule #1 — if the SOURCE_IMAGE shows ONLY bottomwear, the model wears a simple plain solid PLAIN WHITE crew-neck t-shirt (white ONLY, the identical one every time) as a neutral complement${isWaistDownView ? ', though on this waist-down crop it is almost entirely out of frame — do NOT widen the shot to show it' : ''}; do NOT add a jacket, hoodie, or printed top, and do NOT change the t-shirt colour between views. If the SOURCE_IMAGE shows ONLY a top, pair it with the same simple plain mid-blue denim jeans in every view. The SOURCE garment is always the hero.`;

  // How the 180° turn is described depends on whether the head is inside the frame at
  // all. On a waist-down (bottomwear) crop it is not — and ordering "the back of the head
  // and hair face the camera" there directly contradicts the waist-down framing rule. The
  // model resolves that conflict by pulling the camera back to a full body, which is why
  // the back view used to come out with the garment far smaller than in the other views.
  const backTurnCue = isLower
    ? `the model has turned a FULL 180° so their back is to the camera: you are looking at the seat / rear rise of the bottomwear, the backs of the legs, and the heels of the sneakers. The head, hair, and shoulders are NOT in this frame at all — it stays a waist-down crop. Do NOT zoom out, step the camera back, or widen the shot to bring the head or upper body into view.`
    : bodytype === 'auto'
      ? `the model has turned a FULL 180° to face directly AWAY from the camera. The face, chin, and any front-of-body detail are COMPLETELY out of view; you are looking at the model's spine/back and the REVERSE side of the garment. If — and only if — the head falls inside this view's framing, it is the back of the head and hair that face the camera. Do NOT widen the shot or pull the camera back just to fit the head in: keep the EXACT same crop level as the other views.`
      : `the model has turned a FULL 180° to face directly AWAY from the camera. The back of the head and hair face the camera; the face, chin, and any front-of-body detail are COMPLETELY out of view. You are looking at the model's spine/back and the REVERSE side of the garment.`;

  // Independently of the crop level, the garment must sit at the same distance from the
  // camera in every view — otherwise one view reads as a "small" thumbnail of the product.
  const backScaleLock = ' ⚠️ SCALE LOCK: the garment must fill the SAME proportion of the frame as it does in the front view — same camera distance, same crop level, same size on the canvas. A back view where the garment looks smaller, further away, or more zoomed-out than the front view is a HARD FAILURE.';

  // Same problem as the back view: on a waist-down crop the face is not in frame, so
  // "the face appears in true profile" would push the camera back out. For bottomwear the
  // 90° turn is described entirely through the legs and the side seam instead.
  const sideProfileCue = isLower
    ? `Rotate the model exactly 90° so the body is in TRUE PROFILE and the OUTER SIDE SEAM of the bottomwear faces the camera squarely. The head and face are NOT in this frame at all — it stays a waist-down crop, so do NOT widen or step the camera back to bring them in. What must read clearly: the side seam running from the waistband to the hem, the outer thigh and calf line, the side pocket opening, the side silhouette of the leg, and the feet in profile with one leg partly behind the other. Both legs must NOT be side by side facing the camera — that is a front view, and it is a HARD FAILURE here.`
    : `Rotate the model exactly 90° so one shoulder points directly toward the camera. The face appears in true profile with only one eye visible. What must read clearly: the shoulder line, the armhole and sleeve from the side, the side seam, and the full side silhouette of the garment.`;

  const viewMap: Record<string, string> = {
    front: `Front-facing model pose: the model faces the camera directly and the FULL FRONT of the garment is clearly visible. Follow the FRAMING & CAMERA rule for HOW MUCH of the body to show — do not add or remove body beyond what that rule specifies. A real human body must always be visibly wearing the garment (never floating or empty fabric)${framesFeet ? ', with the feet in clean simple casual sneakers (never barefoot)' : ''}.${garmentTypeGuard}`,
    back: `TRUE 180° REAR VIEW — THIS IS THE HARDEST CONSTRAINT, OBEY IT ABSOLUTELY: ${backTurnCue}
DO NOT simply repeat the front. Any feature that identifies the FRONT of the garment MUST be ABSENT from this image: no front drawstring / tie / bow, no front zip fly, no front slant hand-pockets, no chest print, no buttons/placket facing the camera. If the front had a drawstring bow, it is now hidden behind the body and must NOT appear.
RECONSTRUCT the back plausibly from standard garment construction even though the SOURCE_IMAGE only shows the front: show the BACK of the garment — for a top: back yoke, centre-back seam, shoulder blades, back collar; for bottomwear: the seat/rear rise, centre-back seam, back waistband/belt loops, and back patch pockets where such a garment normally has them. Keep colour, fabric and pattern identical to the source, but the composition must unmistakably read as the BACK. A front-facing or near-front / slightly-turned result is a HARD FAILURE.${isLower ? ' Show the waistband from behind at the very top of the frame, then the seat, the backs of the legs, and the heels — cropped at the waist exactly like the front view. The paired plain white crew-neck t-shirt is only visible as the small strip that falls over the waistband, if at all.' : ''}${backScaleLock}${garmentTypeGuard}`,
    left_side: `STRICT 90-DEGREE LEFT-SIDE PROFILE: ${sideProfileCue} The model's LEFT side faces the camera and the body spans left-to-right across the frame. This must NOT be a near-front, slight-turn, or three-quarter angle — it must be a genuine 90° side view. The side view must look VISUALLY DISTINCT from the front view.${garmentTypeGuard}`,
    side: `STRICT 90-DEGREE SIDE PROFILE: ${sideProfileCue} This is NOT a three-quarter, 45°, near-front, or slightly-turned angle — anything less than a genuine 90° rotation is a HARD FAILURE, because it makes this view a near-duplicate of the front view. Someone looking at this image alone must be able to tell instantly that it is a side view.${garmentTypeGuard}`,
    three_quarter: `Three-quarter (45-degree) angle model pose showing the front and one side together. The model is rotated approximately 45° from the camera.${garmentTypeGuard}`,
    style_shoot: `EDITORIAL STYLE SHOOT — FULL BODY, HEAD TO TOE, FACE VISIBLE. This is the ONLY view of this product that is framed head-to-toe, and that is exactly what makes it different from the other four: the complete model must be in frame from the top of the head down to the sneakers, standing on the studio floor with clear space above the head and below the feet. The model's face is fully visible. Do NOT crop it waist-down, do NOT crop it waist-up, do NOT cut off the head, the chin, or the feet. ${isLower
      ? 'Even though the other views of this bottomwear are waist-down half shots, THIS ONE IS NOT — the face, torso, and the paired plain white crew-neck t-shirt are all fully visible here.'
      : bodytype === 'Upper-Body'
        ? 'Even though the other views of this top are waist-up shots, THIS ONE IS NOT — the legs, the paired plain mid-blue denim jeans, and the sneakers are all fully visible here.'
        : 'Whatever crop the other views of this product use (waist-down for bottomwear, waist-up for a top), THIS ONE IS NOT cropped that way — the whole model, head to sneakers, is in frame.'}
POSE — the one view where the pose is expressive rather than catalogue-neutral: the model is caught mid-movement, relaxed and confident — mid-stride walking toward the camera, weight shifted onto one leg with the body angled roughly 30-45° off camera, a hand in a pocket, or a natural turn of the shoulders. The energy should read as a fashion campaign lookbook shot, not a passport photo.
STRICT LIMITS — the pose, the body angle and the WIDER full-body crop are the ONLY things that change. Everything else stays locked to the other views: the IDENTICAL flat solid studio backdrop colour (no street, no interior, no location, no window, no props, no furniture, no set dressing), the identical soft even studio lighting (no moody, dramatic, or coloured light), the identical garment, the identical paired complementary garment, the identical footwear, hairstyle and skin tone. The SOURCE garment must stay the clear focus and fully readable at full-body distance — never obscured, folded away, cropped, or turned out of view by the pose, and never hidden behind an arm or a bag.${garmentTypeGuard}`,
    closeup: `TIGHT ON-MODEL DETAIL CROP — this must look like a DIFFERENT SHOT from the front view, not a copy of it. Move the camera IN CLOSE on ${closeupSubject} until that detail area alone fills most of the frame.
CROP DISCIPLINE (this is the whole point of this view): the detail area must occupy AT LEAST 60% of the frame. The garment must be cut off by the frame edges — you should NOT be able to see the whole garment from top to bottom. ${closeupExclusion} If this image could be mistaken for a smaller version of the front view, it is a HARD FAILURE.
HUMAN PRESENCE (still mandatory): a real body must clearly be wearing the garment inside this tight crop — the model's hand or forearm resting on/near the detail area plus the adjoining body (${closeupAdjoiningBody}) filling the edges of the frame. Never a fabric-only macro, floating fabric, or a laid-flat product shot. Keep the human presence by including a hand and body contours INSIDE the tight crop — do NOT achieve it by zooming out.
Emphasise fabric weave, stitching, hardware, and any print/stripe pattern at close range.${garmentTypeGuard}`,
  };

  const isBackView = viewDirection.toLowerCase() === 'back';
  const closeupAreaHint = isLower
    ? 'the waistband / belt loops / pocket / fabric weave'
    : bodytype === 'auto'
      ? 'the most relevant detail area (waistband/belt loops/pocket for bottomwear; collar/placket/chest for topwear — detect from SOURCE_IMAGE)'
      : 'the collar / placket / chest area';
  const framingRule = isStyleShoot
    ? `FULL-BODY SHOT, HEAD-TO-TOE — this view ONLY. EXACT COMPOSITION:
  • TOP EDGE of the frame = clear empty backdrop ABOVE the top of the model's head (leave visible headroom — the head must not touch or cross the top edge).
  • BOTTOM EDGE = just below the soles of the sneakers.
  • Between them: the WHOLE person — head, FACE (fully visible, looking toward the camera or slightly off it), neck, shoulders, torso, arms, hips, both legs, feet.
  • ⚠️ THE HEAD AND FACE MUST BE IN THIS IMAGE. A cropped forehead, a chin-down crop, a headless body, or a shot that starts at the neck is a HARD FAILURE — this is the ONE view of the set where the model's full figure and face are shown.
This frame is intentionally WIDER than the other views of this product${isLower ? ' (which are waist-down half shots)' : bodytype === 'Upper-Body' ? ' (which are waist-up shots)' : ''} — do NOT match their crop level here. The garment still reads clearly at full-body distance.`
    : isCloseup
    ? `TIGHT DETAIL CROP centred on ${closeupAreaHint} — that area alone must fill AT LEAST 60% of the frame, with the garment running off the frame edges. This is deliberately a DIFFERENT crop level from the front/back/side views: those show the body, this one shows the detail. ${closeupExclusion} A REAL HUMAN MODEL MUST still be unmistakable inside that tight crop — the model's hand/forearm and a portion of the adjoining body wearing the garment. NEVER a fabric-only macro, floating fabric, or a laid-flat product shot. If the model would be lost, re-frame onto a hand-on-garment detail — do NOT zoom out to a body shot to solve it.`
    : bodytype === 'Lower-Body'
      // For back view of bottomwear, show waistband-to-hem; for all other views also waist-down only.
      ? `HALF SHOT — WAIST DOWN ONLY${isBackView ? ', REAR VIEW' : ''}. EXACT COMPOSITION, MEASURE IT BEFORE YOU RENDER:
  • TOP EDGE of the frame = the WAISTBAND of the ${isBackView ? 'bottomwear seen from behind' : 'bottomwear'}. The waistband sits in the TOP 10-15% of the image.
  • BOTTOM EDGE of the frame = just below the soles of the sneakers.
  • Between them: ${isBackView ? 'the seat/rear rise, the backs of both legs, and the heels' : 'the hips, both thighs, both legs, and the feet in clean sneakers'} — the bottomwear fills the frame.
  • ⚠️ ABSOLUTELY NOTHING ABOVE THE WAISTBAND IS IN THIS PICTURE: no chest, no white t-shirt body, no shoulders, no arms above the elbow, no neck, no chin, no head. At most a thin strip of the t-shirt hem may fall over the waistband.
  • SELF-CHECK: if a viewer could see the model's chest, chin, or head, the crop is WRONG — recompose tighter at the waist. A chest-down or head-cropped-but-torso-visible shot is a HARD FAILURE, not an acceptable compromise.
A REAL human lower body MUST be visibly wearing the garment — NEVER floating, empty, or laid-flat trousers, and never barefoot. Use this identical waist-down framing for the front, back and side views of the product.`
      : bodytype === 'Upper-Body'
        ? 'WAIST-UP SHOT: show ONLY from the waist up — the lower body must NOT appear. The model\'s UPPER BODY (head, face, torso, arms) wearing the garment (plus the neutral complementary bottom where it enters frame) MUST be clearly visible — never floating or empty fabric, never a headless crop. Use this identical waist-up framing for the front, back and side views of the product.'
        : bodytype === 'Full-Body'
          ? 'FULL-BODY SHOT, HEAD-TO-TOE: the COMPLETE model must be in frame from head to feet, fully clothed, with the upper body (head, torso, arms) AND the feet in clean sneakers all visible. Do NOT crop to waist-down-only or waist-up-only, NEVER show floating/empty fabric, and never barefoot. Use this identical full-body framing for the front, back and side views of the product.'
          : 'DETECT the garment type from SOURCE_IMAGE and frame the FRONT, BACK and SIDE views of this product IDENTICALLY (this consistency is the top priority — never full-body in one of those and waist-down in another):\n  • BOTTOMWEAR (trousers/jeans/shorts/skirt): HALF-BODY WAIST-DOWN shot — show from the waist down to the feet, cropped cleanly at the waist, in front/back/side alike. The upper body must NOT appear. A REAL human lower body (hips, thighs, legs, and feet in clean sneakers) MUST be clearly visible wearing the garment — NEVER floating, empty, or laid-flat trousers, and never barefoot.\n  • TOPWEAR (shirt/t-shirt/top): waist-UP upper-body shot in front/back/side; do NOT show below the waist.\n  • DRESS / one-piece / full outfit: full body head-to-toe in front/back/side.\nWhatever framing the garment type calls for, apply the EXACT SAME crop level to those three views. The STYLE SHOOT (always full body head-to-toe) and the CLOSEUP (always a tight detail crop) are the two deliberate exceptions and follow their own rules above.';

  // Each view is generated by its own independent API call, so without this block the
  // model has no idea the other four exist and happily returns two near-identical frames
  // (the front/closeup collision). Spelling out the whole shot list and marking which
  // slot this call is filling gives it something concrete to differentiate against.
  const SHOT_LIST_VIEWS = ['front', 'back', 'side', 'style_shoot', 'closeup'];
  const catalogueCrop = isLower
    ? 'WAIST-DOWN half shot (frame starts at the waistband — no chest, no head)'
    : bodytype === 'Upper-Body'
      ? 'WAIST-UP shot'
      : bodytype === 'Full-Body'
        ? 'FULL-BODY shot'
        : "the product's standard catalogue crop (see FRAMING & CAMERA)";
  const shotIndex = SHOT_LIST_VIEWS.indexOf(viewDirection.toLowerCase());
  const shotListBlock = shotIndex === -1
    ? ''
    : `\n\nSHOT LIST — THIS PRODUCT GETS EXACTLY 5 IMAGES AND NO TWO MAY LOOK ALIKE:
1. FRONT — ${catalogueCrop}, model square to the camera (0°).
2. BACK — ${catalogueCrop}, model turned a full 180°, back to the camera.
3. SIDE — ${catalogueCrop}, model turned a full 90°, true profile.
4. STYLE SHOOT — FULL BODY head-to-toe with the FACE VISIBLE (wider than 1-3), expressive editorial pose, body ~30-45° off the camera.
5. CLOSEUP — tight detail crop, one garment detail filling most of the frame (much closer than 1-3).
➡️ YOU ARE GENERATING IMAGE ${shotIndex + 1} OF 5: THE ${SHOT_LIST_VIEWS[shotIndex].toUpperCase().replace('_', ' ')}. Follow the FRAMING & CAMERA section above for it.
⚠️ ANTI-DUPLICATION RULE: your output must be instantly distinguishable from the other four at a glance. It must differ from each of them in body angle, crop level, or both — the other four in this set are ${SHOT_LIST_VIEWS.filter((_, i) => i !== shotIndex).map((v) => v.replace('_', ' ')).join(', ')}. Producing an image that could be mistaken for any of those is a HARD FAILURE. In particular: the closeup must never look like a smaller front view, the style shoot must never look like a wider front view, and the side must never look like a slightly-turned front view.`;

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
- If the source shows ONLY bottomwear (trousers, jeans, shorts, skirt): the model must wear the SOURCE bottomwear as the FEATURED garment. Pair it with a simple, plain, solid PLAIN WHITE basic crew-neck t-shirt (colour = white ONLY, nothing printed, branded, or elaborate). ⚠️ CONSISTENCY: wherever this t-shirt IS visible, it must be the EXACT SAME plain white t-shirt in every view — do NOT change its colour, shade, or style between views (never switch it to grey, black, or any other colour). In views cropped at the waist it is simply not visible, and that is fine. The top is a neutral complement only; the bottomwear is the hero. Do NOT add a jacket, blazer, hoodie, or any bulky upper garment.
- If the source shows ONLY a top/shirt: the model must wear the SOURCE top as the FEATURED garment. Pair it with simple plain mid-blue denim jeans as a neutral complement. ⚠️ CONSISTENCY: this EXACT SAME pair of jeans MUST be worn IDENTICALLY in every view — do NOT change its colour or style between views. Do NOT add a jacket or any additional top layer.
- If the source shows a full outfit: preserve both pieces exactly as shown.
- The FEATURED garment from SOURCE_IMAGE must always be the visual focus — never let the complementary piece draw more attention than it.
- ⚠️ THE PAIRING RULE ABOVE IS ABOUT WHAT THE MODEL IS WEARING, **NOT** ABOUT WHAT IS IN FRAME. It never overrides the FRAMING & CAMERA section below. ${isWaistDownView ? 'This shot is cropped at the waist, so the white t-shirt is simply OUT OF FRAME — at most a thin strip of its hem falls over the waistband. That is correct and expected. NEVER widen, raise, or pull back the crop in order to show the t-shirt, the chest, or the face.' : 'If the framing crops a garment out of the picture, that is correct — never widen or move the crop just to make the complementary piece visible.'}

MODEL DETAILS (STRICT):
- Description: ${modelDesc}${isWaistDownView ? ' — NOTE: only this model\'s LOWER BODY is inside the frame for this shot. Their face, expression and hair are irrelevant here because the head is not in the picture at all.' : '\n- Expression: Neutral, confident'}
- Pose: Professional fashion pose${framesFeet ? '\n- Footwear: clean, simple, neutral casual sneakers appropriate to the outfit — the model is NEVER barefoot, and the SAME footwear is worn in every view.' : ''}
- Styling consistency: the paired/complementary garment (the neutral top or bottom from Rule #1), footwear (when in frame)${isWaistDownView ? '' : ', hairstyle'}, and skin tone MUST stay identical across all views of this product.

FRAMING & CAMERA:
- Framing: ${framingDesc}
- View: ${viewInstr}
- ${framingRule}${shotListBlock}

IMAGE SIZE (STRICT):
- Final output: 2:3 aspect ratio
- Center the model/garment on the canvas

BACKGROUND (READ CAREFULLY — CONSISTENCY IS CRITICAL):
- The backdrop MUST be a COMPLETELY FLAT, UNIFORM, SOLID SINGLE COLOUR filling the entire frame edge-to-edge and corner-to-corner — like a solid paint fill / plain seamless studio wall. NO gradient, NO glow, NO halo, NO vignette, NO darkening toward the edges or corners, NO lighting falloff. Every pixel of the background is the SAME colour.
- ${backgroundColor
    ? `That solid colour MUST be EXACTLY ${backgroundColor}. This exact colour is FIXED for this product and MUST be pixel-identical in every view (front, back, side, style shoot, closeup) — the entire product set is shot on the identical solid backdrop. Do NOT pick, invent, brighten, darken, warm, cool, or shift to any other colour. Keep it soft, muted and clean so the garment stands out clearly against it.`
    : `Use ONE soft, PALE, low-saturation PASTEL solid colour that complements the garment (e.g. pale lilac, soft mint, pale buttery yellow, blush, powder blue, warm off-white) — light and airy, never bold, deep, golden, warm-dark, or saturated. Use the SAME solid colour for every view of this product.`}
- Matte and completely textureless — no seams, no floor line, no horizon, no props, no patterns, no banding, no shadows cast on the backdrop.
- Bright, soft, EVEN studio lighting on the model, with only a faint soft contact shadow${framesFeet ? ' near the feet' : ''} — no hard shadows, no moody/dramatic/spotlight lighting. The backdrop itself stays a flat even colour regardless of the lighting on the model.

GARMENT PRESERVATION RULES (ABSOLUTE):
- Color: ${colorInstr}
- Fabric texture, weave/knit structure, and surface grain MUST remain fully intact and unchanged from the SOURCE_IMAGE — this holds true even when the color above is being changed; a colour change must never flatten or smooth away the woven texture
- Pattern MUST match the SOURCE_IMAGE exactly at the same scale: replicate the same stripe/print WIDTH, SPACING, and DENSITY relative to the garment's width — do not widen, thin, stretch, respace, or redraw the pattern at a different scale. Count and reproduce the same number of visible stripes/repeats as the source. Stripes must stay straight and run in their original direction (e.g. vertical), following the natural drape of the fabric — no unnatural warping, twisting, or curving around body contours.
- NO redesign, NO styling alteration, NO added accessories (see Rule #1 above for garment pairing rules)
- MODEL MUST ALWAYS BE PRESENT: A real human fashion model wearing the garment must always appear in the image. Never generate floating fabric, an empty/laid-flat garment, or a garment with no human body inside it. The model must be well-posed. (This does NOT mean the head must be in frame — when the FRAMING & CAMERA rule calls for a waist-down or detail crop, the head is correctly outside the frame; never widen the shot just to include it.)
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
3. THE STYLING — the paired/complementary garment (e.g. the plain white t-shirt), the footwear, the hairstyle, and the model's skin tone MUST be IDENTICAL to the reference wherever they are visible. If the reference model wears a plain white t-shirt and sneakers, this view must show the SAME plain white t-shirt and the SAME sneakers — do NOT change the top's colour/style or the shoes between views. ⚠️ This is a "keep them the same" rule, NOT a "make them visible" rule: if this view's framing crops the t-shirt, the hair or the face out of the picture, leave them out. Never widen the crop to bring a styling element into frame.
4. ${viewDirection.toLowerCase() === 'closeup'
        ? `THE FRAMING / CROP LEVEL — ⚠️ DO **NOT** MATCH IT. This output is the CLOSEUP: it is deliberately framed DIFFERENTLY from every other view. Whatever crop the reference uses, this image must be MUCH TIGHTER — camera moved right in so a single garment detail fills most of the frame, with the garment running off the frame edges. Reproducing the reference's crop level, or producing anything that looks like a slightly-zoomed copy of it, is a HARD FAILURE. Take colour, backdrop and styling from the reference; take the CROP from the "closeup" description below.`
        : viewDirection.toLowerCase() === 'style_shoot'
        ? `THE FRAMING / CROP LEVEL — ⚠️ DO **NOT** MATCH IT. This output is the STYLE SHOOT: it is deliberately framed WIDER than every other view. Whatever crop the reference uses, this image is a FULL BODY head-to-toe frame — the top of the head, the face, the torso, both legs and the feet in sneakers all inside the frame. The reference is almost certainly cropped at the waist with no head in it — do NOT copy that crop. Pull the camera back until the WHOLE model fits, head and face included, with headroom above. Returning the reference's crop level, or a full-length body with the head cut off, is a HARD FAILURE. Take colour, backdrop and styling from the reference; take the CROP from the "style_shoot" description below.`
        : `THE FRAMING / CROP LEVEL — show the SAME AMOUNT of the body as the reference: if the reference is a waist-down HALF shot, this view MUST also be waist-down; if it is a waist-up shot, this view is also waist-up; if full-body, this view is also full-body. All views of this product must show the identical portion of the body — do NOT switch between full-body and half/waist-down across views. The garment must also sit at the SAME distance from the camera and fill the SAME proportion of the frame as in the reference — never smaller, further away, or more zoomed-out.`}
⚠️ CRITICAL — POSE/ANGLE (this is SEPARATE from crop level above): The reference image's POSE, BODY ANGLE, and CAMERA ANGLE are COMPLETELY IRRELEVANT and must NOT influence this output${['closeup', 'style_shoot'].includes(viewDirection.toLowerCase()) ? ', and neither must its crop level (see point 4).' : ' — but its CROP LEVEL (point 4) MUST be matched.'} This output is the "${viewDirection}" view — its pose/angle must match the "${viewDirection}" description precisely and must look CLEARLY AND OBVIOUSLY DIFFERENT in body position from the reference. If the reference is a front view, this output must NOT look like a front view. Copying the reference pose or producing a near-identical body angle is a FAILURE.${
        viewDirection.toLowerCase() === 'back'
          ? ` \n⚠️⚠️ THIS IS THE BACK VIEW: the VIEW_CONSISTENCY_REFERENCE almost certainly shows the FRONT of this garment. You must render the EXACT OPPOSITE — the model turned a full 180° with their back to the camera, and the front-identifying features seen in the reference (drawstring/tie, front fly, front slant pockets, chest print, buttons/placket, the face) MUST be absent. Take ONLY colour, pattern and fabric from the reference; take the POSE from the "back" description and show the reverse of the garment.\n⚠️ Do NOT widen the shot or move the camera back for this view: match the reference's crop level and camera distance EXACTLY, so the garment is the SAME SIZE on the canvas as in the reference.${bodytype === 'Lower-Body' ? ' This is a waist-down crop — the head and upper body stay OUT of frame, exactly as in the reference.' : ''}`
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
