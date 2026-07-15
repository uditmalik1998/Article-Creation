import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs';
import path from 'path';

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

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

function buildPrompt(
  gender: string,
  bodytype: string,
  imageCount: string,
  viewDirection: string = 'front',
  broachPlacement?: string,
  specialInstructions?: string,
  colorName?: string,
  hasColorImage?: boolean,
  attributesText?: string,
  hasStyleReference?: boolean
): string {
  const genderLower = (gender || '').toLowerCase();
  let modelDesc: string;
  switch (genderLower) {
    case 'male': modelDesc = 'a professional male fashion model'; break;
    case 'kid boy': modelDesc = 'a young boy model, age 8'; break;
    case 'kid girl': modelDesc = 'a young girl model, age 8'; break;
    default: modelDesc = 'a professional female fashion model';
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
      default: framingDesc = 'fashion photoshoot; automatically choose the best framing for the garment shown in the SOURCE_IMAGE — full body (head to toe) for dresses, one-piece sets, or bottomwear worn full; upper body (waist up) for tops, shirts, and t-shirts; lower body (waist down) for standalone trousers/shorts/skirts';
    }
  }

  const colorInstr = hasColorImage
    ? `The garment MUST be recolored to match the dominant color of the COLOR_REFERENCE image included in this request. Sample the color from COLOR_REFERENCE and apply it uniformly to the entire garment in every view. Ignore the shape, pattern, texture, or content of COLOR_REFERENCE — use it ONLY as a color swatch. This overrides the source image color. This is a COLOR SWAP ONLY: the fabric's weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the SOURCE_IMAGE must stay pixel-faithful and fully intact — do not flatten, smooth, or simplify the fabric into a solid untextured block of color.`
    : colorName
      ? `The garment's base color MUST change to ${colorName} in every view (front, back, side, closeup). This is a COLOR SWAP ONLY: the fabric's weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the SOURCE_IMAGE must stay pixel-faithful and fully intact — do not flatten, smooth, or simplify the fabric into a solid untextured block of color.`
      : `The garment color MUST be IDENTICAL to the SOURCE_IMAGE. Do not change or shift the color in any view.`;

  const viewMap: Record<string, string> = {
    front: 'Front-facing model pose showing the front of the garment clearly.',
    back: 'Back-facing model pose showing the back of the garment clearly.',
    left_side: 'Left side profile model pose showing the side fit of the garment.',
    side: 'Side profile model pose showing the side fit and full silhouette of the garment.',
    three_quarter: 'Three-quarter (45-degree) angle model pose showing the front and one side together.',
    closeup: 'Tightly cropped macro close-up on one representative section of the garment (e.g. collar, placket, chest, or sleeve cuff) — frame it like a product-detail shot: fabric weave, stitching, buttons, and print/stripe pattern fill most of the frame at high magnification.',
  };

  const framingRule = isCloseup
    ? 'Crop TIGHT on the fabric/collar/placket area — the model\'s full body, full garment, legs, and most of the face must NOT be in frame. This must look like a zoomed-in product-detail shot, clearly tighter and closer than the front/back/side views, not another full or upper-body shot.'
    : bodytype === 'Lower-Body'
      ? 'Show ONLY from waist down to feet. Upper body must NOT appear in the frame.'
      : bodytype === 'Upper-Body'
        ? 'Show ONLY from waist up. Lower body must NOT appear in the frame.'
        : bodytype === 'Full-Body'
          ? 'Full garment must be visible, head to toe, no cropping.'
          : 'Frame the model so the ENTIRE garment is fully visible and well-composed; choose full/upper/lower framing to suit the garment type.';

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
    ? ` A VIEW_CONSISTENCY_REFERENCE image is attached — copy ONLY its color, pattern scale, and fabric texture from it. Its pose, body angle, and framing are IRRELEVANT and must be IGNORED. This output's pose/angle must follow the "${viewDirection}" instruction above and must look visibly different from the reference image's pose — do not reproduce the same body orientation, camera angle, or crop as the reference.`
    : '';

  return `You are a world-class fashion photographer and AI fashion director.

PRIMARY OBJECTIVE:
Generate a hyper-realistic fashion photoshoot image by strictly preserving the garment from the SOURCE_IMAGE.

MODEL DETAILS (STRICT):
- Description: ${modelDesc}
- Expression: Neutral, confident
- Pose: Professional fashion pose

FRAMING & CAMERA:
- Framing: ${framingDesc}
- View: ${viewInstr}
- ${framingRule}

IMAGE SIZE (STRICT):
- Final output: 2:3 aspect ratio
- Center the model/garment on the canvas

BACKGROUND:
- Simple solid color studio background
- Neutral tone complementing the garment (white, off-white, light grey, beige)
- Soft studio lighting, clean even illumination

GARMENT PRESERVATION RULES (ABSOLUTE):
- Color: ${colorInstr}
- Fabric texture, weave/knit structure, and surface grain MUST remain fully intact and unchanged from the SOURCE_IMAGE — this holds true even when the color above is being changed; a colour change must never flatten or smooth away the woven texture
- Pattern MUST match the SOURCE_IMAGE exactly at the same scale: replicate the same stripe/print WIDTH, SPACING, and DENSITY relative to the garment's width — do not widen, thin, stretch, respace, or redraw the pattern at a different scale. Count and reproduce the same number of visible stripes/repeats as the source. Stripes must stay straight and run in their original direction (e.g. vertical), following the natural drape of the fabric — no unnatural warping, twisting, or curving around body contours.
- NO redesign, NO styling alteration, NO added accessories

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
  styleReferenceMime?: string
): Promise<Buffer> {
  const hasColorImage = !!(colorImageBuffer && colorImageMime);
  const colorLockInstruction = hasColorImage
    ? `MANDATORY COLOR (FROM IMAGE): The garment in the output MUST be recolored to match the dominant color of the COLOR_REFERENCE image that follows. Use COLOR_REFERENCE ONLY as a color swatch — ignore its shape, pattern, and content. This overrides the source image color and any text color name. This is a COLOR SWAP ONLY — the fabric's weave/knit texture, stripe or print pattern, yarn grain, and surface detail from the source image MUST be preserved pixel-faithfully; do not flatten or smooth the fabric into a solid untextured block of color.`
    : colorName
      ? `MANDATORY COLOR: Recolor ONLY the base garment color to ${colorName} — apply it as the new uniform base tone. This is a COLOR SWAP ONLY: do NOT flatten, smooth, or simplify the fabric — the weave/knit structure, stripe or print pattern, yarn grain, and surface texture from the source image MUST remain fully intact and pixel-faithful, just tinted to ${colorName} instead of the original color. The output must still look like a textured woven/knit fabric, never a flat solid-color block.`
      : `COLOR PRESERVE: Keep the garment color exactly as shown in the source image. Do not change, shift, or neutralize the color.`;

  const hasStyleReference = !!(styleReferenceBuffer && styleReferenceMime);
  const promptText = buildPrompt(gender, bodytype, imageCount, viewDirection, broachPlacement, specialInstructions, colorName, hasColorImage, attributesText, hasStyleReference);

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
      text: `VIEW_CONSISTENCY_REFERENCE follows — a fashion photo already generated for a DIFFERENT view of this EXACT same garment. Use it for exactly ONE purpose: match its color, its stripe/print pattern width/spacing/density, and its fabric texture. Do NOT redraw the pattern at a different scale or shift the color.
IGNORE EVERYTHING ELSE about this reference image: its pose, body angle, camera angle, crop, and framing are NOT to be copied. This output is the "${viewDirection}" view — its pose and framing MUST follow the View instruction below and MUST look visibly different from this reference photo's pose. Reproducing the same body orientation/angle as the reference is a FAILURE.`,
    });
    parts.push({ inlineData: { mimeType: styleReferenceMime as string, data: (styleReferenceBuffer as Buffer).toString('base64') } });
  }

  parts.push({ text: promptText });

  const ai = getAIClient();
  const imageSizeKB = Math.round(imageBuffer.length / 1024);
  const base64SizeKB = Math.round((imageBuffer.length * 4 / 3) / 1024);
  console.log(`[ModelGen] Calling Gemini model: ${GEMINI_IMAGE_MODEL}, view: ${viewDirection}, gender: ${gender}, bodytype: ${bodytype}`);
  console.log(`[ModelGen] color mode: ${hasColorImage ? 'IMAGE' : colorName ? `NAME(${colorName})` : 'SOURCE'} | style reference: ${hasStyleReference}`);
  console.log(`[ModelGen] Image size: ${imageSizeKB} KB | base64 payload: ~${base64SizeKB} KB | Parts count: ${parts.length}`);

  let response: any;
  try {
    response = await (ai.models as any).generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: [Modality.IMAGE],
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
        return Buffer.from(part.inlineData.data, 'base64');
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
        colorImageFile?.mimetype
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
