import { VLMProvider, FashionExtractionRequest } from '../../../types/vlm';
import { EnhancedExtractionResult, AttributeData, CmpSamMinutes } from '../../../types/extraction';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { FULL_WEAVE_CLASSIFICATION_GUIDANCE } from '../prompts/fabricWeaveGuidance';

// "ai_sam" block → minutes per process; anything that is not a sane positive number becomes null.
function parseAiSam(raw: any): CmpSamMinutes | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: any): number | null => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
  };
  const out = { cutting: num(raw.cutting), stitching: num(raw.stitching), ironing: num(raw.ironing), finishing: num(raw.finishing) };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * Multi-step JSON repair for malformed Gemini responses.
 *
 * Gemini occasionally returns JSON with:
 *   1. Unquoted property names  →  { key: "val" }   instead of  { "key": "val" }
 *   2. Trailing commas          →  { "a": 1, }
 *   3. Truncated output         →  missing closing braces
 *   4. Single-quoted strings    →  { 'key': 'val' }
 *
 * Each step is tried in order; we return as soon as JSON.parse succeeds.
 * Throws if all repair attempts fail so the caller can bubble up the error.
 */
function repairAndParseJson(raw: string): any {
  // Step 1 — remove trailing commas before } or ]
  const step1 = raw.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(step1); } catch { /* continue */ }

  // Step 2 — quote unquoted property names  (e.g.  key:  →  "key":  )
  const step2 = step1.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  try { return JSON.parse(step2); } catch { /* continue */ }

  // Step 3 — replace single-quoted string delimiters with double quotes
  // (careful: only swap outermost quotes, not apostrophes inside values)
  const step3 = step2.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
  try { return JSON.parse(step3); } catch { /* continue */ }

  // Step 4 — truncated output: close any unclosed braces/brackets
  let step4 = step3;
  step4 = step4.replace(/,?\s*"[^"]*$/, '').replace(/,\s*$/, ''); // drop incomplete trailing token
  const openBraces   = (step4.match(/\{/g) || []).length;
  const closeBraces  = (step4.match(/\}/g) || []).length;
  const openBrackets = (step4.match(/\[/g) || []).length;
  const closeBrackets = (step4.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) step4 += ']';
  for (let i = 0; i < openBraces - closeBraces; i++) step4 += '}';
  return JSON.parse(step4); // throws if still invalid — caller handles it
}

export interface GoogleVisionConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
}

export class GoogleVisionProvider implements VLMProvider {
  public readonly name = 'Google Gemini Vision';
  private config: GoogleVisionConfig;
  private client: GoogleGenerativeAI | null = null;

  constructor(config?: Partial<GoogleVisionConfig>) {
    this.config = {
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTokens: 65536,  
      temperature: 0.0,
      timeout: 300000,
      ...config
    };
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    } else {
      console.warn('Google Vision provider: GOOGLE_API_KEY not configured');
    }
  }

  async extractAttributes(request: FashionExtractionRequest): Promise<EnhancedExtractionResult> {
    const startTime = Date.now();

    if (!this.client) {
      throw new Error('Google Vision API client not initialized. Please set GOOGLE_API_KEY');
    }

    try {
      const imageData = await this.resolveImageToBase64(request.image);
      const prompt = this.buildPrompt(request);
      let response: Awaited<ReturnType<typeof this.callGeminiVision>> | null = null;
      // Retry at most once, and only on a timeout or a 5xx server error.
      const MAX_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          response = await this.callGeminiVision(imageData, prompt);
          break;
        } catch (err: any) {
          const retryable = this.isRetryableGeminiError(err);
          console.warn(`Gemini extraction attempt ${attempt}/${MAX_ATTEMPTS} failed${retryable ? '' : ' (not retried)'}: ${err?.message}`);
          if (attempt < MAX_ATTEMPTS && retryable) await new Promise(r => setTimeout(r, 1000));
          else throw err;
        }
      }

      const { attributes, extractedMetadata, rawGeminiResponse, aiSam } = await this.parseResponse(response!.content, request.schema);

      const confidence = this.calculateConfidence(attributes);

      const processingTime = Date.now() - startTime;
      return {
        attributes,
        confidence,
        tokensUsed: response!.tokensUsed,
        inputTokens: response!.inputTokens || 0,
        outputTokens: response!.outputTokens || 0,
        apiCost: response!.apiCost || 0,
        modelUsed: this.config.model as any,
        processingTime,
        discoveries: [],
        discoveryStats: {
          totalFound: 0,
          highConfidence: 0,
          schemaPromotable: 0,
          uniqueKeys: 0
        },
        extractedMetadata: extractedMetadata || undefined,
        rawGeminiResponse: rawGeminiResponse || null,
        aiSam: aiSam ?? null,
      };
    } catch (error) {
      console.error(`❌ [Google Vision] Extraction failed:`, error instanceof Error ? error.message : 'Unknown error');
      throw new Error(`Google Vision extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** Timeout (our own wrapper) or a 5xx from the Gemini API — everything else (4xx, bad input) fails at once. */
  private isRetryableGeminiError(err: any): boolean {
    const msg = String(err?.message ?? '');
    if (/timeout/i.test(msg)) return true;
    const status = Number(err?.status ?? err?.response?.status);
    if (status >= 500 && status < 600) return true;
    return /\[5\d\d\b/.test(msg); // SDK messages look like "[503 Service Unavailable] ..."
  }

  /**
   * Separate comprehensive extraction call for image_extraction_raw_data column.
   * Uses a free-form prompt to extract every visually identifiable attribute
   * as a flat key-value JSON — independent of the schema/dropdown constraint flow.
   */
  async extractAllAttributes(imageData: string): Promise<Record<string, any> | null> {
    if (!this.client) return null;

    const prompt = `You are a fashion AI analyst. Extract attributes comprehensively from this garment.

Guidelines:
- Extract all visible attributes with high confidence
- Focus on clearly visible features
- Be precise with colors, patterns, and materials
- Note construction details
- Identify styling elements

Priority order:
1. Color and pattern accuracy
2. Fabric identification
3. Construction details
4. Fit and styling
5. All other visible features

Return a flat JSON object with every attribute as a key-value pair. Include as many attributes as you can identify. Examples of keys to include (but not limited to):
color, pattern, fabric, fit, sleeve_length, neck_type, collar, placket, pocket_type, button_type, zipper, wash, length, hem_type, waistband, print_type, embroidery, embellishments, lining, stitching, hardware, silhouette, garment_type, brand_visible, care_label, size_label, weight_feel, texture, sheen, stretch, layering, closure_type, cuff_style, bottom_fold, drawcord, patches, season_feel, occasion_type

Return JSON only, no markdown. Just the flat key-value JSON object.`;

    try {
      const resolvedImage = await this.resolveImageToBase64(imageData);
      const response = await this.callGeminiVision(resolvedImage, prompt);
      const clean = (response.content || '').replace(/```json\n?|\n?```/g, '').trim();
      if (!clean) return null;
      try {
        return JSON.parse(clean);
      } catch {
        return repairAndParseJson(clean);
      }
    } catch (err: any) {
      console.warn(`[Google Vision] extractAllAttributes failed: ${err?.message}`);
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.client !== null && !!process.env.GOOGLE_API_KEY;
  }

  async configure(config: Partial<GoogleVisionConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    this.initializeClient();
  }

  private async resolveImageToBase64(imageData: string): Promise<string> {
    if (!imageData.startsWith('http://') && !imageData.startsWith('https://')) {
      return imageData; // already base64 — pass through unchanged
    }
    const response = await fetch(imageData);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL ${imageData}: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private buildPrompt(request: FashionExtractionRequest): string {
    const { schema, categoryName, department, subDepartment, majorCategory } = request;

    const categoryContext = categoryName
      ? `\nCATEGORY: ${categoryName} (${department}/${subDepartment})`
      : '';

    // Build schema with allowed values — short forms only to reduce token count
    const schemaDefinition = schema.map(item => {
      const allowedValues = item.allowedValues?.length
        ? ` [${item.allowedValues.map(av => {
          if (typeof av === 'string') return av;
          return av.shortForm || av.fullForm || '';
        }).filter(Boolean).join('|')}]`
        : '';
      return `${item.key}${allowedValues}`;
    }).join('\n');

    // CMP COST card "AI SAM": minutes per process, estimated from the image (no BGT benchmark is sent —
    // 2026-10-30: Gemini copied the rough_cmp_cost_master numbers when they were supplied).
    const aiSamSection = `
# AI GARMENT SAM ESTIMATION — OPERATION-BASED IE APPROACH

## ROLE

You are a Senior Industrial Engineer (IE) with expertise in garment manufacturing, garment construction, production engineering, operation breakdown, and Standard Allowed Minute (SAM) estimation.

Your task is to analyze the uploaded garment image and calculate realistic manufacturing SAM for four departments:

1. Cutting
2. Stitching
3. Ironing
4. Finishing

You must follow an operation-based estimation methodology similar to an experienced garment factory IE.

Do not estimate SAM merely by identifying the garment category. Analyze its actual construction and manufacturing requirements.

---

## STAGE 1: GARMENT CONSTRUCTION ANALYSIS

First, carefully inspect the uploaded garment image.

Identify all visible construction details, including:

- Garment type and category.
- Fabric type, appearance, thickness, and characteristics.
- Number of panels and garment components.
- Collar or hood construction.
- Front opening, placket, buttons, zippers, or other closures.
- Pockets and pocket construction.
- Sleeve type, sleeve attachment, cuffs, and hems.
- Waistbands, elastic, drawstrings, lining, and trims.
- Seams, topstitching, reinforcement, and decorative stitching.
- Checks, stripes, prints, embroidery, and pattern matching.
- Any additional construction details that increase manufacturing complexity.

IMPORTANT:
Do not assume that hidden construction details are absent. Where the image does not provide enough information, use reasonable garment-industry assumptions without inventing unnecessary components.

---

## STAGE 2: OPERATION-WISE TIME ESTIMATION

Internally break down the garment into individual manufacturing operations.

For each operation, estimate the required time based on:

- Operation complexity.
- Number of components involved.
- Fabric handling difficulty.
- Sewing or processing requirements.
- Machine operation requirements.
- Handling and positioning time.
- Skilled operator performance.
- Practical production-line working conditions.

Do not use one generic time value for an entire garment.

### A. CUTTING SAM

Consider the following operations where applicable:

- Fabric spreading and handling.
- Marker and pattern preparation.
- Pattern placement and alignment.
- Fabric checks or stripe matching.
- Cutting garment panels.
- Cutting sleeves, collars, cuffs, pockets, hoods, and other components.
- Component separation and bundling.

Increase cutting SAM when fabric matching, multiple panels, or complex components require additional handling.

### B. STITCHING SAM

This department requires the most detailed construction analysis.

Identify and estimate all applicable operations, such as:

- Shoulder joining.
- Side seam joining.
- Sleeve construction.
- Sleeve attachment.
- Sleeve closing.
- Collar construction and attachment.
- Hood panel joining and hood attachment.
- Front placket construction.
- Button and buttonhole operations.
- Pocket preparation and attachment.
- Cuff construction and attachment.
- Hemming.
- Topstitching.
- Reinforcement stitching.
- Elastic and drawstring attachment.
- Lining and trim attachment.
- Other visible garment construction operations.

IMPORTANT:
- Do not underestimate stitching SAM by considering only the main body seams.
- A hood, pocket, placket, cuff, lining, or additional construction detail must contribute to the estimate when present.
- Avoid counting the same operation twice.
- Do not include operations that are not required by the garment.

### C. IRONING SAM

Consider:

- Intermediate pressing where required.
- Seam opening and pressing.
- Collar and cuff pressing.
- Hood and placket pressing.
- Sleeve and body pressing.
- Final garment ironing.
- Fabric-specific pressing requirements.

### D. FINISHING SAM

Consider:

- Thread trimming.
- Button, zipper, and accessory checking.
- Measurement checking.
- Garment appearance inspection.
- Loose thread removal.
- Final quality checking.
- Folding and finishing preparation.

---

## STAGE 3: FACTORY BENCHMARK CALIBRATION

If factory-approved SAM benchmarks or similar garment records are supplied, use them as the primary calibration reference.

Apply these rules:

1. Identify the closest matching garment category and construction type.
2. Compare its components and complexity with the uploaded garment.
3. Use relevant approved BGT SAM values as reference points.
4. Adjust the estimate for additional or missing construction operations.
5. Do not blindly copy benchmarks from a different garment type.
6. Do not use BGT PR VAL, costing values, or monetary amounts as SAM minutes.
7. If no relevant benchmark exists, estimate using the construction and operation analysis.

A benchmark is a calibration reference, not a replacement for garment analysis.

---

## STAGE 4: SAM ESTIMATION RULES

Follow these rules strictly:

- Estimate realistic manufacturing time under efficient industrial production conditions.
- Assume trained operators using appropriate industrial machinery.
- Do not assume unrealistic perfect production conditions.
- Do not assign generic low default values.
- Do not inflate SAM without construction-based justification.
- Account for all visible construction complexity.
- Estimate each department independently.
- Use positive numeric values only.
- Round each department estimate to a maximum of two decimal places.
- Calculate total SAM by adding the four departmental values.
- Do not force the estimate to match a predetermined target.
- Do not claim the estimate is factory-approved or time-study validated.

If image details are unclear, use reasonable conservative assumptions.

---

## STAGE 5: INTERNAL VALIDATION

Before returning the result, verify:

1. Have all visible garment components been considered?
2. Has every major stitching operation been accounted for?
3. Have additional features such as pockets, hoods, collars, cuffs, plackets, and closures been considered?
4. Has fabric complexity been reflected in cutting and stitching?
5. Are ironing and finishing estimates appropriate for the garment?
6. Have duplicate operations been avoided?
7. Are the estimates consistent with relevant factory benchmarks, if provided?
8. Does total SAM exactly equal the sum of all four departments?

Do not expose internal reasoning or operation-wise calculations in the final output.

---

## STAGE 6: STRICT JSON OUTPUT

Put the result in the "ai_sam" field of the main JSON output (do not return it as a separate JSON document, and keep all other output fields). Inside "ai_sam", do not include Markdown, explanations, operation breakdowns, comments, or additional fields.

Use exactly this structure:

"ai_sam": {
  "cutting": number,
  "stitching": number,
  "ironing": number,
  "finishing": number,
  "total_sam": number
}

There are no default or target values.

All values must be numeric and positive.

The total_sam must equal:

cutting + stitching + ironing + finishing
`;

    return `YOU ARE A FASHION GARMENT IMAGE ATTRIBUTE EXTRACTION
AND STRICT DATABASE VALIDATION SYSTEM.

Your task is to accurately extract ${schema.length} garment
attributes from the uploaded image using the supplied
Division, Sub-Division, Major Category, attribute definitions
and database grid values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. GARMENT CATEGORY CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Division: ${department || 'not supplied'}
Sub-Division: ${subDepartment || 'not supplied'}
Major Category: ${majorCategory || categoryName || 'not supplied'}
Garment Category: ${categoryName || "garment"}

${categoryContext}

Use this category context to understand the intended
garment type, construction and applicable attributes.

Do not change the supplied category codes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. IMAGE ANALYSIS RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyze the uploaded image carefully before assigning values.

Identify only visually supported garment characteristics,
including:

• Garment type and silhouette
• Fabric appearance and construction
• Neckline, collar, hood, sleeves and cuffs
• Waistband, hem and closures
• Pockets, panels, seams and layering
• Prints, embroidery, trims and embellishments
• Visible styling and design details

Distinguish garment construction from surface appearance.

Do not classify printed designs as embroidery.
Do not classify fabric texture or weave as print.
Do not confuse cut-and-sew panels with fabric layers.
Do not infer hidden details without reliable evidence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. STRICT DATABASE VALUE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ATTRIBUTE DATABASE:
${schemaDefinition}

GRID VALUES FOR SELECTED CATEGORY:
The allowed lists in the attribute database above are already
the grid values for the selected Division, Sub-Division and
Major Category.

For every extracted attribute:

1. Return only an exact value from its applicable allowed list.
2. For grid-controlled attributes, use only values supplied
   for the selected Division, Sub-Division and Major Category.
3. Match exact spelling, capitalization and formatting.
4. Do not invent, paraphrase, approximate or normalize values.
5. Do not select a value merely because it exists in the grid.
   It must match the garment image and category context.
6. Never use values from another category or division.
7. If no valid value can be established, return null.
8. Never return generic values such as YES, NO, PRESENT,
   VISIBLE, STANDARD or UNKNOWN.
9. Do not add, remove or rename output attribute keys.
10. Preserve the required output data types.

The database defines valid values.
The image provides visual evidence.
The category context determines applicability.
The grid restricts valid choices.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. CATEGORY-SPECIFIC ATTRIBUTE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

M_AGE_GROUP:

Return exactly ONE of these four values:

"GEN X   (46-61Y)"
"MILLENIALS (30-45Y)"
"GEN Z (13-29Y)"
"ALL GROUP"

Do not return any other age group, age range,
generation name, combination or modified spelling.

Determine the intended target age group using the garment's
design, styling, proportions, category context and supplied
major-category information.

Do not estimate the wearer's actual age.
Do not assume that every garment belongs to GEN Z.
Do not select ALL GROUP simply because the image is ambiguous.

If the garment is genuinely designed for all age groups,
select ALL GROUP.

If the intended age group cannot be determined reliably,
return null, unless the application explicitly requires
one of the four values for every record.

For M_AGE_GROUP, never return a value outside the
four listed options.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. PATTERN CLASSIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use only the allowed PATTERN values.

Apply the supplied PATTERN definitions to identify
silhouette, construction, layers and design structure.

Important distinctions:

• BASIC = genuinely simple garment construction
• CARGO = visible utility cargo pockets
• JOGGER = jogger construction with elasticated/cuffed hems
• CUT AND SEW = assembled from multiple fabric pieces
• LAYER = multiple fabric layers, not multiple panels
• PRINTED/AOP/ABSTRACT = use only if explicitly allowed
  under PATTERN

Do not default to BASIC.
Do not classify a printed motif as a construction pattern.
If no valid pattern can be established, return null.

PATTERN DEFINITIONS:
  • 1 LAYER = single-layer garment construction
  • 2 CUT N SEW = two fabric panels stitched together
  • 2 HORIZONTAL CUT N SEW = two panels joined horizontally
  • 2 LAYER = two fabric layers (outer + lining/overlay)
  • 2 VERTICAL CUT N SEW = two panels joined vertically
  • 3 CUT N SEW = three stitched panels
  • 3 HORIZONTAL CUT N SEW = three panels joined horizontally
  • 3 LAYER = three fabric layers
  • 3 VERTICAL CUT N SEW = three panels joined vertically
  • 4 LAYER = four fabric layers
  • A LINE = fitted top, flared bottom (A-shape)
  • AFGHANI = dropped crotch, gathered bottom
  • ANGARAKHA = wrap-style overlapping panels with ties
  • ASYMMETRICAL = uneven hem/neck/panel design
  • BIKER = biker-inspired styling
  • BOMBER = short jacket with ribbed cuffs/hem
  • BASIC = simple, clean design with no structure
  • CUT AND SEW = garment assembled from multiple pieces (C&S)
  • CAPRI = cropped bottoms below knee
  • CARGO = utility pockets
  • CHURIDAR = fitted bottom with gathers at ankle
  • CROP = short length exposing waist
  • DHOTI = draped bottom with pleats
  • DRAWER = loose bottom with elastic waistband
  • DANGRI = dungaree/bib-front one-piece
  • ENGINIEERED STRIPE = intentionally placed stripes (use dataset spelling)
  • 1_LYR / 2_LYR / 3_LYR / 4_LYR = fabric layer count (use dataset spelling if present)
  • 2_C&S / 3_C&S = number of cut-and-sew panels (use dataset spelling if present)
  • H_C&S = horizontal cut & sew (panels joined horizontally)
  • V_C&S = vertical cut & sew (panels joined vertically)
  • FEEDING = nursing openings
  • FISH CUT = fitted, flared at bottom
  • FLAIR = wide, flowing bottom
  • FRONT OPEN = full front opening (zip/button)
  • FRONT OPEN BUTTON = front open with buttons
  • FROCK = dress
  • FROCK STYLE = frock silhouette
  • FRK / FRK_STL = frock / frock style (use dataset spelling if present)
  • FRNCH = french styling or seams (use dataset spelling if present)
  • FRENCHY = frenchy style
  • HIGH N LOW = shorter front, longer back hem
  • HALTER = straps tie behind neck
  • H&L = high–low hem (use dataset spelling if present)
  • JODHPURI = structured traditional style
  • JOGGER = elastic waist + cuffed hem
  • JHABLA = loose infant/kids top
  • JACKET = outerwear
  • KAFTAN = loose flowing garment
  • KARACHI = loose traditional silhouette
  • KOTI = sleeveless vest-style
  • MONKEY = full-body one-piece (kidswear)
  • OFF SHOULDER = neckline exposing shoulders
  • OFF_SHLDR = off-shoulder (use dataset spelling if present)
  • PHULKARI = traditional embroidered floral pattern
  • CHIKANKARI = lucknow embroidery style (use dataset spelling if present)
  • PHULKARI = traditional embroidered floral pattern
  • PINTUCK = narrow stitched folds
  • PLEATED = structured pleats
  • PUFFER = padded quilted jacket
  • PUSH UP = enhancing/lifting structure (innerwear)
  • RVSL = reversible (use dataset spelling if present)
  • SEAMLESS = minimal/no seams
  • SMKNG = smocking elastic stitch texture (use dataset spelling if present)
  • SHRG = shirring elastic gathers (use dataset spelling if present)
  • ROMPER = one-piece top + shorts
  • RUFFLES = gathered flounces
  • REVERSIBLE = wearable both sides
  • SEAMLESS = minimal/no seams
  • SMOKING = smocking elastic stitch texture
  • STOLE = long narrow scarf
  • THONGS = minimal-coverage innerwear
  • TRUNK = fitted men’s innerwear
  • TUBE = strapless straight neckline
  • TUNIC = long top below hips
  • WIRED = support wires (bras)
  • WITH_INNER = attached inner/lining (use dataset spelling if present)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. EMBROIDERY CLASSIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return embroidery attributes only when embroidery
is visibly identifiable.

Distinguish thread work, beads, sequins, stones,
mirrors, metallic work, cutwork and other techniques
using the supplied definitions.

Do not classify printed motifs as embroidery.
Do not guess the embroidery technique from color alone.

EMBROIDERY TECHNIQUE DEFINITIONS:
  • DORI EMBROIDERY = raised cords/dori stitched on fabric; rope-like continuous lines, 3D, outline motifs
  • EMBROIDERY TAPE = flat narrow tapes stitched onto fabric; ribbon-like, smooth, low height
  • GOTTA PATTI = shiny metallic gold/silver ribbons cut into shapes and stitched; high shine, traditional motifs
  • LACE ALL OVER PRINT = full surface covered with lace texture/pattern; continuous repeating lace
  • SWAROVSKI WORK = small precision-cut crystals; sharp sparkle and refraction
  • STONE WORK = stones attached; raised texture, less sharp shine than crystals
  • CUT WORK = fabric cut-outs with stitched edges; visible holes/negative space patterns
  • MIRROR WORK = small mirror pieces stitched with thread borders; bright reflective spots
  • ZARI EMBROIDERY = metallic thread stitching; dense, gold/silver thread sheen
  • SEQUINS WORK = flat shiny discs; soft shimmer, overlapping discs
  • BEADS = small beads stitched; rounded texture, raised points
  • THREAD WORK = embroidery only with thread; no stones/beads/mirrors


EMBROIDERY TYPE DEFINITIONS:
  • BRAND EMBROIDERY = brand logo/name/wordmark; clean precise lettering, corporate look
  • FLORAL EMBROIDERY = flowers/leaves/vines; organic curves, botanical motifs
  • PAISLEY EMBROIDERY = teardrop/mango-shaped motifs; intricate inner details, traditional
  • TROPICAL EMBROIDERY = palm leaves/exotic flowers/fruits; bright, vacation theme
  • CARTOON EMBROIDERY = playful characters/icons; bold outlines, simplified shapes
  • ANIMAL EMBROIDERY = animals/birds/insects; realistic or stylized motifs


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. PRINT CLASSIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return print attributes only when a visible printed
motif or graphic is present.

Do not treat weave, knit structure, jacquard,
fabric grain or embroidery as print.

Use only the allowed print technique values.
Do not infer a specific printing process unless
the image provides sufficient evidence.

If no print is visible:
print_type = null
print_style = null
print_placement = null

PRINT TECHNIQUE DEFINITIONS:
  • DISCHARGE PRINT = dye removed from dyed fabric to create lighter/white designs; soft, breathable, vintage look, no ink feel
  • FLOCK PRINT = velvety raised texture using short fiber particles; suede/velour touch, luxury surface
  • FOIL PRINT = metallic foil heat-pressed onto fabric; glossy gold/silver, high shine
  • BAGRU PRINT = traditional Rajasthan hand block print using natural dyes; ethnic, earthy, heritage textile
  • DIGITAL PRINT = inkjet high‑resolution, complex designs; sharp details, photo‑realistic, unlimited colors
  • ROTARY PRINT = industrial rotating cylinder print; seamless repeats, mass‑produced, consistent alignment
  • PIGMENT PRINT = pigment ink sits on top of fabric; matte finish, slightly stiff hand feel
  • HOOD (HOODIE CONSTRUCTION) = garment feature (attached hood); NOT a print technique
  • SUBLIMATION PRINT = heat‑transfer ink becomes part of fabric (polyester); no texture, vibrant colors, all‑over
  • RUBBER PRINT = thick elastic raised print; rubbery touch, bold graphics, streetwear
  • PLASTIC SOLE PRINT = heavy PVC‑based print; very solid, glossy, 3D effect, high thickness
  • KHADI FABRIC = hand‑spun/hand‑woven natural fabric (cotton/silk); breathable, handcrafted textile
  • SHIMMER PRINT = sparkle/glitter particles; festive shine, glamorous texture
  • PUFF PRINT = heat‑reactive ink raises when cured; soft 3D effect
  • EMBOSS PRINT = pressed/raised pattern without heavy ink; tonal, luxury minimal texture
  • REFLECTIVE PRINT = ink reflects light; sportswear/safety, night visibility


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. ATTRIBUTE VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before returning the response, validate every attribute:

• Is the value supported by the image?
• Is it applicable to the selected major category?
• Is it present in the allowed database values?
• If grid-controlled, is it present in the supplied grid?
• Is its spelling and formatting an exact match?
• Is it assigned to the correct output key?

If any check fails, return null for that attribute.

NOT IN DATASET — ALWAYS RETURN NULL:
BK LESS, MUFFLER, SHRUG, SHRUGS, WITH INNER.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. AI SAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${aiSamSection}

SAM is a separate numeric estimation field.
Do not validate SAM values against garment attribute
database lists or grid values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. FIELD-SPECIFIC AND BOARD/TAG (OCR) RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    🔎 Belt rule: choose father_belt from allowed list based on waistband (elastic/inner/outer/fixed/adjustable). If elastic, also choose child_belt_detail when visible.

    NECK DETAIL DEFINITIONS (use ONLY if visible):
      • DTM RIB NK = DYED/ DYEABLE RIB NECK (same color as garment)
      • CNT RIB NK = CONTRAST RIB NECK
      • RAW EDGE NK = RAW EDGE NECK
      • ZARA NK = ZARA NECK
      • BRAND RIB NK = BRAND RIB NECK
      • LOGO RIB NK = LOGO RIB NECK
      • TPNG RIB NK = TIPPING RIB NECK
      • JACQ RIB NK = JAQUARD RIB NECK
      • RIB TPNG NK = RIB TIPPING NECK
      • RIB CUT TPNG NK = RIB CUT TIPPING NECK
      • RN HUD = ROUND NECK HOOD
      • VN HUD = V-NECK HOOD
      • HNL_NK 2 BTN = HENLEY NECK – 2 BUTTON
      • HNL_NK 3 BTN = HENLEY NECK – 3 BUTTON
      • HNL_NK 5 BTN = HENLEY NECK – 5 BUTTON
      • RN ZIP = ROUND NECK ZIP
      • ENVLP NK = ENVELOPE NECK
      • MANDARIAN NK = MANDARIN NECK
      • SNAP BTN SHLDR NK = SNAP BUTTON SHOULDER NECK

   CHILD BELT DETAIL DEFINITIONS (use ONLY if visible):
     • SLF GTHR BLT = self fabric waistband gathered with elastic
     • SLF RELX BLT = soft self fabric waistband with relaxed/loose elastic
     • TOP BLT TPNG = tipping line along top edge
     • DTM RIB BLT = ribbed waistband dyed to match garment color
     • CNT RIB BLT = ribbed waistband in contrast color
     • TPNG RIB BLT = ribbed waistband with tipping lines
     • BRND RIB BLT = ribbed waistband with branding pattern/text
     • SELF C&S BLT = self fabric cut-and-sew waistband (non-rib)
     • RIB & SLF C&S BLT = mixed rib + self fabric waistband
     • SLF CTRT BLT = self fabric waistband in contrast color
     • RIB CTRT BLT = ribbed waistband in contrast color
     • BRND ELS BLT = elastic waistband with branding
     • BRND LG BLT = waistband with brand logo
     • ELS CTRT BLT = elastic waistband in contrast color
     • CTRT_FLAT_KNIT = flat-knit waistband in contrast color
     • ROLL_UP = roll-up waistband/hem detail

STEP 2: ZONE-BY-ZONE DETAILED INSPECTION
├─ NECK/COLLAR AREA:
│   • What type of neckline? (crew/v-neck/collar/hooded/turtleneck)
│   • Collar style if present? (spread/point/button-down/mandarin)
│   • Any neck details? (ribbing/binding/trim/placket)
│
├─ FRONT CLOSURE:
│   • How does it close? (buttons/zipper/pullover/snap/hook)
│   • Placket type? (hidden/exposed/fly front/no placket)
│   • If zipper is at the neckline/front opening, placket MUST be a ZIP PLACKET (ZIP PLKT / CON. ZIP PLKT / GOLD ZIP PLKT / SLV ZIP PLKT)
│   • Button material and count? (plastic/metal/wooden)
│   • Zipper type and color? (metal/plastic/exposed/hidden)
│
├─ SLEEVES (if applicable):
│   • Length? (sleeveless/short/3-4/long/extra long)
│   • Style? (set-in/raglan/dolman/cap)
│   • Cuff type? (plain/ribbed/button/elastic)
│
├─ POCKETS:
│   • How many pockets total? Count each one
│   • Type? (patch/welt/flap/zipper/5-pocket denim/kangaroo)
│   • Placement? (chest/side/back/coin)
│   • Do NOT confuse a neckline zipper/placket with a pocket. If no pocket bag is visible, return pocket_type = null.
│
├─ FIT & SILHOUETTE:
│   • Overall fit? (skinny/slim/regular/relaxed/oversized/loose)
│   • Length? (cropped/regular/long/extra long/full length)
│   • Rise (for bottoms)? (low/mid/high)
│   • For jeans: STRAIGHT FIT = consistent leg width from thigh to hem; REGULAR FIT = slightly relaxed through thigh with gentle taper
│   • If unsure between regular vs straight, return null (do NOT guess)
│   • Jeans rule: straight/regular cut → REG FIT; tapered/streamlined cut → SLIM FIT
│   • For jeans: STRAIGHT FIT = consistent leg width from thigh to hem; REGULAR FIT = slightly relaxed through thigh with gentle taper
│   • If unsure between regular vs straight, return null (do NOT guess)
│
├─ FABRIC & WASH:
│   • Fabric appearance? (denim/cotton/knit/woven/synthetic)
│   • Wash effect? (rinse/stone/acid/vintage/distressed/clean)
│   • Texture visible? (smooth/textured/brushed/raw)
│   • Denim rule: Do NOT use TWILL weave for denim/jeans (twill is for shirts/trousers only)
│
├─ MACRO MVGR (macro_mvgr) — VISUAL ONLY:
│   • This is the BROAD fabric design/surface category visible on the garment
│   • Ask: "What is the overall macro-level design or surface treatment of this fabric?"
│   • Examples: Is it plain? Printed (AOP/chest print)? Structured (jacquard/stripe/check)?
│   • ONLY return a value from the macro_mvgr allowed values list
│   • This is a VISUAL attribute — look at the garment surface, NOT the board/tag
│   • If the fabric surface shows no clear design category → return null
│   • Do NOT guess; if unsure → null
│
├─ MAIN MVGR (main_mvgr) — VISUAL ONLY:
│   • This is the SPECIFIC/DETAILED fabric design sub-category (more detailed than macro_mvgr)
│   • Ask: "What is the exact specific design detail within the macro category?"
│   • Use these detailed definitions for accurate classification:
│   
│   BASIC FABRIC TYPES:
│   • SOLID: Single uniform color with no patterns or designs
│   • YARN-DYED CHECKS: Checks created by weaving pre-dyed yarns (pattern is part of fabric, not printed)
│   • ENGINEERING STRIPE: Stripes placed in a planned/structured way (not evenly repeated)
│   • HORIZONTAL STRIPE: Stripes running left to right across the fabric
│   • VERTICAL STRIPE: Stripes running top to bottom along the fabric
│   • CHECK PRINT: Printed check pattern (not woven like yarn-dyed checks)
│   
│   PRINT CATEGORIES:
│   • ANIMAL PRINT: Patterns inspired by animal skins (leopard, zebra, etc.)
│   • ALL OVER PRINT - ABSTRACT: Non-realistic, artistic shapes and forms
│   • ALL OVER PRINT - BOOTY (BUTI): Small traditional Indian motifs repeated evenly
│   • ALL OVER PRINT - CLOUD: Soft, cloud-like shapes or sky-inspired patterns
│   • ALL OVER PRINT - FLORAL: Repeating flower-based designs
│   • ALL OVER PRINT - GEOMETRIC: Shapes like squares, triangles, circles in repetition
│   • ALL OVER PRINT - TROPICAL: Palm leaves, exotic plants, beach-inspired prints
│   • ALL OVER PRINT - ANIMAL: Repeating animal or animal-skin patterns
│   • ALL OVER PRINT - CARTOON: Animated or character-based prints
│   • ALL OVER PRINT - CAMOUFLAGE: Military-style irregular patch patterns
│   • ALL OVER PRINT - NUMERIC: Repeating numbers or digits
│   • ALL OVER PRINT - ALPHABETICAL: Letters or text-based repeating patterns
│   • ALL OVER PRINT - SCARF: Designs inspired by scarf layouts (often bordered + ornate)
│   • ALL OVER PRINT - PAISLEY: Curved teardrop-shaped traditional motif
│   • ALL OVER PRINT - BANDHANI: Tie-dye style dotted patterns (traditional Indian)
│   • ALL OVER PRINT AHMEDABAD: Regional print style from Ahmedabad (often block print-inspired)
│   • ALL OVER PRINT JAIPURI: Traditional Jaipur-style prints (floral, block prints, ethnic motifs)
│   
│   • Examples: If macro = AOP (all over print), what specific type? (AOP_TRPL / AOP_ABST / AOP_GMTL etc.)
│   • If macro = OD (over dyed), what variant? (OD_PLN / OD_OMBRE / OD_T&D etc.)
│   • ONLY return a value from the main_mvgr allowed values list
│   • main_mvgr must be CONSISTENT with macro_mvgr (same design family)
│   • If macro_mvgr is PLN (plain) → main_mvgr should also be PLN
│   • Do NOT output a main_mvgr value that contradicts the macro_mvgr value
│   • If no specific sub-category matches → return null
│
├─ M_FAB2 (m_fab2) — VISUAL ONLY:
│   • This is the FABRIC CONSTRUCTION / KNIT STRUCTURE of the fabric itself
│   • Ask: "How is this fabric constructed at the structural level?"
│   • Examples: Is it a plain knit? Jacquard? Loop knit? Mesh? Flat-back?
│   • Applies mainly to KNIT garments (t-shirts, sweatshirts, activewear, knitwear)
│   • ONLY return a value from the m_fab2 allowed values list
│   • This is different from weave (which is woven structure) — m_fab2 is about knit construction
│   • If garment is WOVEN (shirts, trousers, denim) → m_fab2 is usually null
│   • If knit structure is not clearly visible → return null
│   • Do NOT guess; exact visual match or null
│
├─ WEAVE — VISUAL ONLY:
│   • This is the FABRIC WEAVE/TEXTURE/SURFACE TREATMENT of the fabric
│   • Ask: "What is the visible surface texture and weave pattern of this fabric?"
│   • Use these detailed definitions for accurate classification:
│   
${FULL_WEAVE_CLASSIFICATION_GUIDANCE}
│   
│   • ONLY return a value from the weave allowed values list
│   • Use ONLY the exact definitions above for classification
│   • If no weave type clearly matches the visible surface → return null
│   • Do NOT guess; exact visual match or null
│
├─ EMBELLISHMENTS:
│   • Embroidery? Where and what design?
│   • Patches? Type and location?
│   • Prints? Type (graphic/stripe/floral), style, placement?
│   • Hardware? (rivets/studs/grommets/chains)
│
└─ BOTTOM DETAILS:
    • Hem style? (raw/folded/cuffed/ribbed)
    • Bottom fold/cuff present?
    • Drawcord? Where located?
    • Belt/waistband type? (elastic/inner elastic/outer elastic/fixed/adjustable)

BOTTOM_FOLD DEFINITIONS (use ONLY if visible):
  • BTM_ELS = BOTTOM ELASTIC
  • BTM_RIB = BOTTOM RIB
  • BTM OPEN = BOTTOM OPEN
  • SLF FOLD = SELF FOLD
  • UP_ FOLD = UP FOLD
  • TPNG = TIPPING
  • BTM_FRNG = BOTTOM FLARING
  • CONT_BTM_FLD = CONTRAST BOTTOM FOLD
  • RAW_EDGE = RAW EDGE
  • WITH ELASTIC & ADJUSTER = WITH ELASTIC & ADJUSTER
  • SMOKING = SMOCKING
  • SCALOP = SCALOP
  • LACE FINISH = LACE FINISH
  • RAW EDGE W OLOCK = RAW EDGE W O'LOCK
  • WD_ADJSTR = WAISTBAND ADJUSTER

STEP 3: TAG/LABEL READING (Critical for metadata)
├─ Look for WHITE BOARD/TAG in image
├─ OCR MODE = SCANNER:
│   • Read ALL visible board/tag text top-to-bottom, left-to-right (like a flatbed scanner)
│   • Preserve punctuation, dots, slashes, hyphens, and spacing exactly (e.g., "M.JEANS", "30-36", "L/XL")
│   • Do not hallucinate missing characters; if any character is unclear, leave the entire field null
│   • If multiple boards are present, use the closest/clearest board only
├─ Extract (OCR ONLY): Division, Vendor name, Design number, PPT number, Rate/Price, Size, Major category, GSM, G-Weight
│   • G-Weight may appear as "Weight", "G-Weight", "Numeric/G", "WT", "Fabric Weight", "Garment Weight", "G.WT", or similar variations
│   • For G-Weight return NUMERIC ONLY (digits/decimal only, no unit/suffix/prefix)
│   • Example: "Numeric/G: 180G" → weight = "180"
├─ If the board has "FAB" or "FABRIC" line, parse into yarn_01, yarn_02, fabric_main_mvgr:
│   • If the FAB line ends with a bracketed token (e.g., "(...)") then IGNORE the bracket content
│     and output ONLY yarn_01 (from the first token). Set yarn_02 = null and fabric_main_mvgr = null.
│   • Split FAB value into 1–3 parts using separators (/ , - , | , space)
│   • 1 part → yarn_01 only; yarn_02 = null; fabric_main_mvgr = null
│   • 2 parts → first token is yarn_01 (preferred) OR yarn_02 (if only yarn_02 matches). Do NOT swap order.
│     Second token must match EITHER weave OR fabric_main_mvgr. If it matches only a yarn value, set yarn_02
│     and leave weave/fabric_main_mvgr null.
│   • 3 parts → yarn_01 = first; yarn_02 = second; fabric_main_mvgr = last
│   • Each part MUST match the allowed values for its attribute exactly; otherwise return null for that part
│   • If a token is not in the allowed list (e.g., abbreviations like "IMP"), return null (do not guess)
│   • If FAB contains "IMP" or "IMPORTED" → yarn_01 MUST be IMP (Imported). Do NOT output CP or any other yarn.
│     If IMP is not in allowed values, return null for yarn_01.
│   • If FAB indicates Imported, set weave = null (do NOT guess weave).
│   • If FAB has "LCE" or "LCR" in brackets, set lycra_non_lycra = LCR (only if LCR is an allowed value).
├─ FABRIC_MAIN_MVGR EXTRACTION (VISUAL FALLBACK):
│   • PRIORITY 1: If FAB/FABRIC line exists on board, extract fabric_main_mvgr from it as above (OCR first)
│   • PRIORITY 2: If NO FAB/FABRIC line exists on board, use VISUAL ANALYSIS:
│     - Examine the garment's visible fabric characteristics (print patterns, weave type, texture, design)
│     - Use the detailed FABRIC CLASSIFICATION GUIDANCE provided above  
│     - Match visible characteristics to fabric_main_mvgr classification options
│     - Provide 65-85% confidence for visual fabric classification
│     - ONLY return null if fabric is completely obscured or unidentifiable
├─ Return division/gsm/yarn_01/yarn_02/fabric_main_mvgr under the attributes section using those keys
├─ Look for BRAND LABELS on garment
└─ Check CARE LABELS and SIZE TAGS
• For SIZE, preserve exactly what is written on the board (e.g., "S-XXL")
• For MAJOR CATEGORY, use OCR only (do NOT infer from garment). Preserve exact text/punctuation from the board (e.g., "M.JEANS").

COLOR OCR (SPECIAL RULE):
• PRIORITY 1: Read colour from the WHITE BOARD/TAG — look for CLR/COLOR/COLOUR labeled field OR any standalone colour code token (e.g., L_BL, ECRU, WHT, NVY, BLK)
• PRIORITY 2: If no colour on board, look at the garment/fabric itself and extract its colour
• Return the colour value exactly as written on the board — do NOT require database validation, do NOT return null just because a value is not in an allowed list
• Only return null if there is genuinely no colour information anywhere in the image (board or garment)
• Do NOT use OCR for any other attribute except: division, vendor_name, design_number, rate, size, major_category, gsm, weight, yarn_01, yarn_02, fabric_main_mvgr
• Size must be returned exactly as written (e.g., "S-XXL", "30-36"), no normalization

LYCRA / NON-LYCRA (STRICT):
• Prefer OCR tags (e.g., LCR/LCE) when present; map to LCR only if allowed values include LCR
• If no OCR clue, set lycra_non_lycra only when stretch is visually obvious (leggings, body-hugging knits).
• If unsure, return null (do NOT guess)

WASH RULE (CRITICAL):
• Wash must be extracted from the garment appearance (fade/stone/acid/distressed) using ONLY WASH allowed values
• Do NOT output generic terms like "clean" or "solid" for wash
• If unsure, return null
• If the garment is clearly denim and no wash effect is visible, use RINSE

MACRO MVGR RULE (CRITICAL):
• macro_mvgr = the broad visual design category of the fabric surface (e.g., PLN=plain, PRT=print, AOP=all-over-print, OD=over-dyed, STRT=structure, JAQ=jacquard)
• VISUAL ONLY — read from the garment surface appearance, NOT from the board/tag
• Use ONLY values from the macro_mvgr allowed values list — NO free text, NO generic terms
• If the garment surface is clearly one solid colour with no print/texture/structure → PLN
• If there is a print covering the whole garment → AOP
• If there is a chest/placement print only → PRT_CHEST (if in allowed values)
• If unsure or no match → null
• Do NOT use values from main_mvgr or m_fab2 lists for this field

MAIN MVGR RULE (CRITICAL):
• main_mvgr = the specific/detailed sub-type of the macro design (e.g., AOP_TRPL, OD_OMBRE, STRT, JAQ)
• VISUAL ONLY — examine the fabric surface in detail
• main_mvgr MUST be consistent with macro_mvgr:
  - If macro = PLN → main = PLN (or null)
  - If macro = AOP → main must be an AOP_* variant
  - If macro = OD → main must be an OD_* variant
  - If macro = STRT → main = STRT
  - If macro = JAQ → main = JAQ
• NEVER output a main_mvgr that contradicts macro_mvgr
• Use ONLY values from the main_mvgr allowed values list
• If no exact sub-category match is visible → null

M_FAB2 RULE (CRITICAL):
• m_fab2 = the fabric knit construction/structure (e.g., STRT=structure knit, JAQ=jacquard knit, LP_KNIT=loop knit, MESH=mesh, 1X1=1x1 rib)
• VISUAL ONLY — look at the fabric texture and knit structure closely
• Applies ONLY to KNIT garments (t-shirts, polos, sweatshirts, hoodies, knitwear, activewear)
• For WOVEN garments (formal shirts, trousers, denim) → m_fab2 = null
• If the knit structure is not clearly visible or identifiable → null
• Use ONLY values from the m_fab2 allowed values list — NO free text
• Do NOT confuse fabric construction (m_fab2) with fabric design (macro_mvgr/main_mvgr)

PATCH TYPE RULE (CRITICAL):
• Perform a close-up inspection of the patch area (mentally zoom/crop the patch) before deciding patch type
• Read any characters on the patch like OCR; prioritize detecting digits even if text is small or partially visible
• If the patch prominently contains numeric characters (0-9), classify PATCH TYPE as NUM (NUMERIC)
• This is true even if words are also present (e.g., "07 Athletic" → NUM)
• Use BRAND LOGO only when there are NO numbers and the patch is purely a brand/logo mark
• If uncertain, return null
• If the patch/text is blurry or unreadable, return null (never guess BRAND LOGO)
• Also set metadata.patchDigitsPresent = true if ANY digits are visible on the patch
• If metadata.patchDigitsPresent is true, PATCH TYPE MUST be NUM (do not output BRAND LOGO)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. FINAL OUTPUT REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return valid JSON only, in exactly the OUTPUT FORMAT below.

• Preserve all existing attribute keys.
• Use exact database values for categorical attributes.
• Use null for unsupported or invalid values.
• Put explanations only in each attribute's "reasoning" field;
  no Markdown or comments anywhere.
• Do not add fields beyond the OUTPUT FORMAT below.
• Keep ai_sam in its existing required structure.
• Ensure the JSON is syntactically valid.
• Ensure every output value matches its required data type.

📝 OUTPUT FORMAT (JSON only, no markdown):

{
  "metadata": {
    "vendorName": "string or null",
    "designNumber": "string or null",
    "pptNumber": "string or null",
    "price": "string or null",
    "size": "string or null",
    "majorCategory": "string or null",
    "patchText": "string or null",
    "patchDigitsPresent": "true | false | null"
  },
  "ai_sam": { "cutting": "minutes as a number, e.g. 1.2", "stitching": "minutes", "ironing": "minutes", "finishing": "minutes", "total_sam": "sum of the four" },
  "attributes": {
    "attribute_key": {
      "rawValue": "DATABASE VALUE or null",
      "schemaValue": "SAME AS RAW VALUE",
      "visualConfidence": 75,
      "reasoning": "what you saw + which database value matched"
    }
  },
  "all_extracted_attributes": {
    "any_visually_identifiable_key": "value as a plain string"
  }
}

IMPORTANT: In "all_extracted_attributes", include EVERY fashion/product attribute you can identify from the image that is NOT already listed in the "attributes" section above. Use descriptive key names (snake_case). Values must be plain strings. Include anything you can visually observe: garment construction details, embellishments, hardware, fabric texture, silhouette, styling details, care symbols, brand elements, etc. Do NOT repeat keys that are already in "attributes". If nothing additional is found, return an empty object {}.

Return the final JSON only.`;
  }

  private async callGeminiVision(imageData: string, prompt: string): Promise<{
    content: string;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    apiCost: number;
  }> {
    if (!this.client) {
      throw new Error('Google Vision client not initialized');
    }

    const model = this.client.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        maxOutputTokens: 32768,  // High limit to cover thinking tokens + full JSON response
        temperature: this.config.temperature,
        // 2.5-pro requires thinking mode (cannot disable). 2.5-flash can disable with budget 0.
        ...(this.config.model.includes('2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
      } as any
    });

    // Extract base64 data and mime type
    const base64Match = (/^data:(image\/[a-z]+);base64,(.+)$/).exec(imageData);
    if (!base64Match) {
      throw new Error('Invalid image data format');
    }

    const [, mimeType, base64Data] = base64Match;

    // Add timeout wrapper around generateContent
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Gemini API timeout (${this.config.timeout}ms) - request took too long`)), this.config.timeout);
    });

    const resultPromise = model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data
        }
      }
    ]);

    const result = await Promise.race([resultPromise, timeoutPromise]);

    const response = (result as any).response;
    const text = response.text();

    // Gemini API provides usageMetadata with actual token counts
    const usage = response.usageMetadata;
    let tokensUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    if (usage) {
      // Use actual token counts from API response
      inputTokens = usage.promptTokenCount || 0;
      // For thinking models (gemini-2.5-pro), thinking tokens are billed as output tokens.
      // Always include thoughtsTokenCount in the output count so cost is accurate.
      const thinkingTokens = (usage as any).thoughtsTokenCount || 0;
      const candidateTokens = usage.candidatesTokenCount || 0;
      outputTokens = thinkingTokens + candidateTokens
        || Math.max(0, (usage.totalTokenCount || 0) - inputTokens);
      tokensUsed = usage.totalTokenCount || (inputTokens + outputTokens);
    } else {
      // Fallback to estimation if usage data not available
      // Image tokens: ~258 tokens per image (Gemini's average)
      // Text tokens: ~4 characters per token
      const imageTokens = 258; // Standard estimate for images
      const promptTokens = Math.ceil(prompt.length / 4);
      const outputTokensEst = Math.ceil(text.length / 4);
      inputTokens = imageTokens + promptTokens;
      outputTokens = outputTokensEst;
      tokensUsed = inputTokens + outputTokens;
    }

    // Calculate API cost
    const { calculateApiCost } = require('../../../utils/costCalculator');
    const apiCost = calculateApiCost(inputTokens, outputTokens, this.config.model);

    return {
      content: text,
      tokensUsed,
      inputTokens,
      outputTokens,
      apiCost
    };
  }

  private async parseResponse(content: string, schema: any[]): Promise<{ attributes: AttributeData; extractedMetadata?: any; rawGeminiResponse?: any; aiSam?: CmpSamMinutes | null }> {
    try {
      const cleanContent = (content || '').replace(/```json\n?|\n?```/g, '').trim();
      if (!cleanContent) {
        throw new Error('Empty response from Google Vision provider');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(cleanContent);
      } catch {
        // Gemini occasionally returns malformed JSON. Apply a multi-step repair
        // pipeline before giving up, then re-throw if all attempts fail.
        parsed = repairAndParseJson(cleanContent);
      }

      const extractedMetadata = parsed.metadata || null;
      const aiSam = parseAiSam(parsed.ai_sam);
      const attributeSource = parsed.attributes || parsed;

      const attributes: AttributeData = {};

      const metadataMapping: Record<string, string> = {
        'vendorName': 'vendor_name',
        'vendorCode': 'vendor_code',
        'designNumber': 'design_number',
        'pptNumber': 'ppt_number',
        'price': 'rate',
        'size': 'size',
        'majorCategory': 'major_category',
        'division': 'division',
        'gsm': 'gsm',
        'g_weight': 'weight',
        'weight': 'weight',
        'wt': 'weight',
        'fabric weight': 'weight',
        'garment weight': 'weight',
        'fab weight': 'weight',
        'g.wt': 'weight',
        'g wt': 'weight'
      };

      const metadataObj = extractedMetadata && typeof extractedMetadata === 'object' ? extractedMetadata : null;
      const mergedMetadata = metadataObj ? { ...metadataObj } : {};

      const metadataLower = mergedMetadata
        ? Object.fromEntries(Object.entries(mergedMetadata).map(([k, v]) => [String(k).toLowerCase(), v]))
        : {} as Record<string, any>;

      const metadataAliases: Record<string, string[]> = {
        vendor_code: ['vendorcode', 'vendor_code', 'vendor code', 'vendor id', 'vendor no', 'vendor_number', 'vendor number', 'vendor'],
        vendor_name: ['vendorname', 'vendor_name', 'vendor name', 'vendor', 'brand'],
        design_number: ['designnumber', 'design_number', 'design number', 'design_no', 'design no', 'design'],
        ppt_number: ['pptnumber', 'ppt_number', 'ppt number', 'ppt_no', 'ppt no', 'ppt'],
        rate: ['rate', 'price', 'mrp', 'cost'],
        size: ['size', 'sizes', 'size_range', 'size range', 'size-range', 'siz'],
        major_category: ['majorcategory', 'major_category', 'major category', 'category'],
        gsm: ['gsm', 'gsm_value', 'gsm value', 'g/m2', 'g/m²', 'gram per square meter'],
        weight: ['weight', 'g_weight', 'g-weight', 'gweight', 'numeric/g', 'numeric / g', 'num/g', 'wt', 'fabric weight', 'garment weight', 'fab weight', 'g.wt', 'g wt']
      };

      const extractNumericWeight = (input: unknown): string | null => {
        if (input === null || input === undefined) return null;
        const value = String(input).trim();
        if (!value) return null;
        const normalized = value.replace(/,/g, '');
        const match = normalized.match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : null;
      };

      const resolveNumericGWeightFromOcr = (): string | null => {
        const directCandidates = [
          mergedMetadata?.g_weight,
          mergedMetadata?.['g-weight'],
          mergedMetadata?.gweight,
          mergedMetadata?.weight,
          mergedMetadata?.wt,
          mergedMetadata?.['fabric weight'],
          mergedMetadata?.['garment weight'],
          mergedMetadata?.['fab weight'],
          mergedMetadata?.['g.wt'],
          mergedMetadata?.['g wt'],
          metadataLower['g_weight'],
          metadataLower['g-weight'],
          metadataLower['gweight'],
          metadataLower['weight'],
          metadataLower['wt'],
          metadataLower['fabric weight'],
          metadataLower['garment weight'],
          metadataLower['fab weight'],
          metadataLower['g.wt'],
          metadataLower['g wt']
        ];

        for (const candidate of directCandidates) {
          const parsed = extractNumericWeight(candidate);
          if (parsed) return parsed;
        }

        const rawLines = Array.isArray(mergedMetadata?.rawLines)
          ? (mergedMetadata?.rawLines as unknown[]).map(v => String(v))
          : [];

        const taggedLine = rawLines.find(line => /g-?\s*weight|weight|fabric\s+weight|garment\s+weight|fab\s+weight|numeric\s*\/\s*g|wt\.?|g\.?\s*wt/i.test(line));
        if (taggedLine) {
          const parsed = extractNumericWeight(taggedLine);
          if (parsed) return parsed;
        }

        return null;
      };

      const resolveMetadataValue = (schemaKey: string) => {
        const directKey = Object.keys(metadataMapping).find(k => metadataMapping[k] === schemaKey);
        let value = directKey && mergedMetadata ? (mergedMetadata as any)[directKey] : null;
        if (!value && directKey) {
          value = metadataLower[directKey.toLowerCase()];
        }
        if (!value && metadataAliases[schemaKey]) {
          for (const alias of metadataAliases[schemaKey]) {
            const found = metadataLower[alias.toLowerCase()];
            if (found) {
              value = found;
              break;
            }
          }
        }
        if (value && schemaKey === 'design_number') {
          const designStr = String(value).trim();
          // Remove trailing PLAN token (e.g., "ABC123 PLAN" or "ABC123 - PLAN")
          value = designStr.replace(/\s*[-_]?\s*PLAN\s*$/i, '').trim() || null;
        }
        return value ?? null;
      };

      if (mergedMetadata && typeof mergedMetadata === 'object') {
        const majorMeta = resolveMetadataValue('major_category');
        if (majorMeta && !('majorCategory' in mergedMetadata) && !('major_category' in mergedMetadata)) {
          (mergedMetadata as any).majorCategory = majorMeta;
        }
      }

      const getColorFamily = (value?: string | null): string | null => {
        if (!value) return null;
        const v = value.toLowerCase();
        if (v.includes('blu') || v.includes('blue') || v.includes('navy') || v.includes('sky') || v.includes('denim')) return 'blue';
        if (v.includes('gry') || v.includes('gray') || v.includes('grey') || v.includes('ash') || v.includes('charcoal')) return 'grey';
        if (v.includes('blk') || v.includes('black') || v.includes('jet')) return 'black';
        if (v.includes('wht') || v.includes('white') || v.includes('ivory')) return 'white';
        if (v.includes('red') || v.includes('maroon') || v.includes('wine') || v.includes('burg')) return 'red';
        if (v.includes('grn') || v.includes('green') || v.includes('olive') || v.includes('mint')) return 'green';
        if (v.includes('ylw') || v.includes('yellow') || v.includes('mustard')) return 'yellow';
        if (v.includes('org') || v.includes('orange') || v.includes('rust')) return 'orange';
        if (v.includes('pnk') || v.includes('pink') || v.includes('rose') || v.includes('peach')) return 'pink';
        if (v.includes('prp') || v.includes('purple') || v.includes('violet') || v.includes('lav')) return 'purple';
        if (v.includes('brn') || v.includes('brown') || v.includes('choco') || v.includes('tan')) return 'brown';
        if (v.includes('beige') || v.includes('cream') || v.includes('sand') || v.includes('nude')) return 'beige';
        return null;
      };

      for (const schemaItem of schema) {
        const key = schemaItem.key;

        if (['weight', 'g_weight', 'gweight', 'g-weight'].includes(String(key).toLowerCase())) {
          const numericWeight = resolveNumericGWeightFromOcr();
          attributes[key] = numericWeight ? {
            rawValue: numericWeight,
            schemaValue: numericWeight,
            visualConfidence: 95,
            isNewDiscovery: false,
            mappingConfidence: 95,
            reasoning: 'G-Weight extracted from white board/tag OCR (numeric-only)'
          } : null;
          continue;
        }

        if (key === 'gsm') {
          const ocrGsm = mergedMetadata?.gsm || mergedMetadata?.['gsm'] || metadataLower['gsm'] || null;
          const numericGsm = ocrGsm ? extractNumericWeight(ocrGsm) : null;
          attributes[key] = numericGsm ? {
            rawValue: numericGsm,
            schemaValue: numericGsm,
            visualConfidence: 95,
            isNewDiscovery: false,
            mappingConfidence: 95,
            reasoning: 'GSM extracted from white board/tag OCR (numeric-only)'
          } : null;
          continue;
        }

        // SIZE: prefer OCR board value exactly as written, fall back to AI response
        if (key === 'size') {
          const ocrSize = mergedMetadata?.size || metadataLower?.['size'] || null;
          const ocrSizeStr = ocrSize ? String(ocrSize).trim() : null;
          if (ocrSizeStr) {
            attributes[key] = {
              rawValue: ocrSizeStr,
              schemaValue: ocrSizeStr,
              visualConfidence: 95,
              isNewDiscovery: false,
              mappingConfidence: 95,
              reasoning: 'Size read directly from board/tag OCR'
            };
          } else {
            // fallback: use AI-extracted value without strict validation
            const aiSizeRaw = this.normalizeNullValue(attributeSource?.[key]?.rawValue ?? attributeSource?.[key]?.schemaValue ?? null);
            attributes[key] = aiSizeRaw ? {
              rawValue: aiSizeRaw,
              schemaValue: aiSizeRaw,
              visualConfidence: attributeSource?.[key]?.visualConfidence ?? 75,
              isNewDiscovery: false,
              mappingConfidence: 75,
              reasoning: 'Size inferred from AI analysis'
            } : null;
          }
          continue;
        }

        if (key === 'colour') {
          const visualRaw = this.normalizeNullValue(attributeSource?.[key]?.rawValue ?? attributeSource?.[key]?.schemaValue ?? null);
          // For colour: if no allowed values, accept any value (free-text colour codes like L_BL, ECRU, etc.)
          const hasAllowedValues = schemaItem.allowedValues && schemaItem.allowedValues.length > 0;
          const visualValidated = visualRaw
            ? (hasAllowedValues ? this.validateAgainstAllowedValues(visualRaw, schemaItem) : visualRaw)
            : null;

          // Board/OCR colour: use directly without validation (board codes are authoritative)
          const metadataColor = mergedMetadata?.colour || mergedMetadata?.color || mergedMetadata?.clr || mergedMetadata?.['colour'] || null;
          let boardValidated: string | null = metadataColor ? String(metadataColor).trim() || null : null;

          // If still no board colour, scan raw lines for colour-code pattern
          if (!boardValidated && Array.isArray(mergedMetadata?.rawLines)) {
            const colourCodePattern = /^[A-Z][A-Z0-9_]{1,10}$/;
            for (const line of (mergedMetadata.rawLines as string[])) {
              const token = String(line).trim();
              if (colourCodePattern.test(token)) {
                boardValidated = token;
                break;
              }
            }
          }

          let finalColor: string | null = null;
          let reasoning = 'Colour not confidently matched';
          let confidence = 0;

          if (boardValidated && visualValidated) {
            const boardFamily = getColorFamily(boardValidated);
            const visualFamily = getColorFamily(visualValidated);

            if (!boardFamily || !visualFamily || boardFamily === visualFamily) {
              finalColor = boardValidated;
              reasoning = 'Board colour matches garment colour family; using board value';
              confidence = 85;
            } else {
              finalColor = visualValidated;
              reasoning = 'Board colour conflicts with garment appearance; using visual colour';
              confidence = attributeSource?.[key]?.visualConfidence ?? 78;
            }
          } else if (boardValidated) {
            finalColor = boardValidated;
            reasoning = 'Colour read from white board/tag (OCR)';
            confidence = 85;
          } else if (visualValidated) {
            finalColor = visualValidated;
            reasoning = 'Colour inferred from garment appearance';
            confidence = attributeSource?.[key]?.visualConfidence ?? 75;
          }

          attributes[key] = finalColor ? {
            rawValue: finalColor,
            schemaValue: finalColor,
            visualConfidence: confidence,
            isNewDiscovery: false,
            mappingConfidence: confidence,
            reasoning
          } : null;
          continue;
        }

        if (attributeSource[key]) {
          const rawValue = this.normalizeNullValue(attributeSource[key].rawValue);
          const schemaValue = this.normalizeNullValue(attributeSource[key].schemaValue);

          // 🚨 STRICT VALIDATION: Only accept values from allowed list
          const validatedValue = this.validateAgainstAllowedValues(rawValue, schemaItem);

          const fallbackConfidence = validatedValue ? (key === 'colour' || key === 'wash' ? 80 : 70) : 0;
          const visualConfidence = validatedValue
            ? (attributeSource[key].visualConfidence ?? fallbackConfidence)
            : 0;
          attributes[key] = {
            rawValue: validatedValue,
            schemaValue: validatedValue || schemaValue,
            visualConfidence,
            isNewDiscovery: false,
            mappingConfidence: visualConfidence,
            reasoning: validatedValue
              ? attributeSource[key].reasoning
              : `Value "${rawValue}" not found in allowed list - set to null`
          };
        } else if (mergedMetadata && Object.values(metadataMapping).includes(key)) {
          const value = resolveMetadataValue(key);

          if (value) {
            attributes[key] = {
              rawValue: value,
              schemaValue: value,
              visualConfidence: 95,
              isNewDiscovery: false,
              mappingConfidence: 95,
              reasoning: 'Extracted from visible tag/board'
            };
          } else {
            attributes[key] = null;
          }
        } else {
          attributes[key] = null;
        }
      }

      // Ensure major_category is populated from OCR metadata when available
      if (attributes.major_category === null) {
        const majorFromMeta = resolveMetadataValue('major_category');
        if (majorFromMeta) {
          attributes.major_category = {
            rawValue: majorFromMeta,
            schemaValue: majorFromMeta,
            visualConfidence: 95,
            isNewDiscovery: false,
            mappingConfidence: 95,
            reasoning: 'Extracted from visible tag/board'
          };
        }
      }

      // If FAB indicates Imported (yarn_01 = IMP/IMPORTED), force weave to null
      const yarnValue = attributes.yarn_01?.schemaValue || attributes.yarn_01?.rawValue || '';
      const yarnLower = typeof yarnValue === 'string' ? yarnValue.toLowerCase() : String(yarnValue).toLowerCase();
      if (yarnLower === 'imp' || yarnLower === 'imported') {
        attributes.weave = null;
      }

      // Denim rule: TWILL weave not allowed for jeans/denim
      const majorValue = String(attributes.major_category?.schemaValue || attributes.major_category?.rawValue || '').toLowerCase();
      const weaveValue = String(attributes.weave?.schemaValue || attributes.weave?.rawValue || '').toLowerCase();
      if (majorValue.includes('jean') || majorValue.includes('denim')) {
        if (weaveValue === 'twl' || weaveValue === 'twill' || weaveValue.includes('twill')) {
          attributes.weave = null;
        }
      }

      // Fallback: if wash missing, default to RINSE (dataset-safe) in simplified flow
      if (attributes.wash === null) {
        attributes.wash = {
          rawValue: 'RINSE',
          schemaValue: 'RINSE',
          visualConfidence: 70,
          isNewDiscovery: false,
          mappingConfidence: 70,
          reasoning: 'Wash not detected; defaulted to RINSE'
        };
      }

      // Print sanity: if no supporting print details, nullify print_type
      const printTypeKey = Object.keys(attributes).find(k => k.toLowerCase() === 'print_type');
      const printStyleKey = Object.keys(attributes).find(k => k.toLowerCase() === 'print_style');
      const printPlacementKey = Object.keys(attributes).find(k => k.toLowerCase() === 'print_placement');

      if (printTypeKey) {
        const hasPrintType = !!attributes[printTypeKey]?.rawValue;
        const hasPrintStyle = printStyleKey ? !!attributes[printStyleKey]?.rawValue : false;
        const hasPrintPlacement = printPlacementKey ? !!attributes[printPlacementKey]?.rawValue : false;
        const patternKey = Object.keys(attributes).find(k => k.toLowerCase() === 'pattern');
        const patternVal = patternKey ? String(attributes[patternKey]?.rawValue || '').toLowerCase() : '';

        if (hasPrintType && !hasPrintStyle && !hasPrintPlacement) {
          // If garment appears plain/basic, prefer null for print_type
          if (!patternVal || patternVal.includes('basic')) {
            attributes[printTypeKey] = null;
          }
        }
      }

      // Patch type override: if digits are visible on patch, force NUM
      const patchTypeKey = Object.keys(attributes).find(k => {
        const lower = k.toLowerCase();
        return lower === 'patch_type' || lower === 'patches_type';
      });

      if (patchTypeKey) {
        const patchMetaDigits = (mergedMetadata as any)?.patchDigitsPresent ??
          (mergedMetadata as any)?.patch_digits_present ??
          (mergedMetadata as any)?.patch_digits ?? null;
        const patchMetaText = (mergedMetadata as any)?.patchText ?? (mergedMetadata as any)?.patch_text ?? null;
        const patchDigitsFromMeta = typeof patchMetaDigits === 'boolean'
          ? patchMetaDigits
          : (typeof patchMetaDigits === 'string' ? /true/i.test(patchMetaDigits) : null);
        const patchDigitsFromText = typeof patchMetaText === 'string' ? /\d/.test(patchMetaText) : false;
        const reasoningText = typeof attributes[patchTypeKey]?.reasoning === 'string'
          ? attributes[patchTypeKey]?.reasoning
          : '';
        const digitsInReasoning = /\d/.test(reasoningText);

        if (patchDigitsFromMeta === true || patchDigitsFromText || digitsInReasoning) {
          attributes[patchTypeKey] = {
            rawValue: 'NUM',
            schemaValue: 'NUM',
            visualConfidence: Math.max(attributes[patchTypeKey]?.visualConfidence || 0, 75),
            isNewDiscovery: false,
            mappingConfidence: Math.max(attributes[patchTypeKey]?.mappingConfidence || 0, 75),
            reasoning: 'Patch contains numeric characters; PATCH TYPE forced to NUM'
          };
        }
      }

      return { attributes, extractedMetadata: mergedMetadata, rawGeminiResponse: parsed, aiSam };
    } catch (error) {
      console.error('❌ [Google Vision] Failed to parse response:', error);
      throw new Error(`Failed to parse Google Vision response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 🚨 STRICT VALIDATION: Check if value exists in allowed values list
   * Returns the value if valid, null if not found in list
   */
  private validateAgainstAllowedValues(value: any, schemaItem: any): any {
    if (value === null || value === undefined) return null;

    // If no allowed values defined, accept any value (for TEXT type attributes)
    if (!schemaItem.allowedValues || schemaItem.allowedValues.length === 0) {
      return value;
    }

    const valueStr = String(value).trim();

    const allowedPairs = schemaItem.allowedValues.map((av: any) => {
      if (typeof av === 'string') return { shortForm: av, fullForm: av };
      return { shortForm: av.shortForm || '', fullForm: av.fullForm || av.shortForm || '' };
    }).filter((p: any) => p.shortForm || p.fullForm);

    const tryMatch = (candidate: string): string | null => {
      if (!candidate) return null;
      // Exact shortForm match
      const exactShort = allowedPairs.find((p: any) => p.shortForm === candidate);
      if (exactShort) return exactShort.shortForm;
      // Exact fullForm match
      const exactFull = allowedPairs.find((p: any) => p.fullForm === candidate);
      if (exactFull) return exactFull.shortForm || exactFull.fullForm;
      // Case-insensitive match
      const lower = candidate.toLowerCase();
      const ciShort = allowedPairs.find((p: any) => p.shortForm?.toLowerCase() === lower);
      if (ciShort) return ciShort.shortForm;
      const ciFull = allowedPairs.find((p: any) => p.fullForm?.toLowerCase() === lower);
      if (ciFull) return ciFull.shortForm || ciFull.fullForm;
      return null;
    };

    let matchedValue = tryMatch(valueStr);

    if (!matchedValue && schemaItem.key === 'colour') {
      const aliasMap: Record<string, string> = {
        'sky': 'SKY BLUE',
        'skyblue': 'SKY BLUE',
        'sky blue': 'SKY BLUE',
        'lt sky': 'LIGHT SKY BLUE',
        'light sky': 'LIGHT SKY BLUE',
        'light sky blue': 'LIGHT SKY BLUE',
        'denim blue': 'DENIM BLUE',
        'navy': 'NAVY BLUE',
        'navy blue': 'NAVY BLUE'
      };
      matchedValue = tryMatch(aliasMap[valueStr.toLowerCase()]);
    }

    if (!matchedValue && schemaItem.key === 'wash') {
      const aliasMap: Record<string, string> = {
        'clean': 'RINSE',
        'normal': 'RINSE',
        'plain': 'RINSE'
      };
      matchedValue = tryMatch(aliasMap[valueStr.toLowerCase()]);
    }

    if (!matchedValue && schemaItem.key === 'yarn_01') {
      const aliasMap: Record<string, string> = {
        'imported': 'IMP',
        'imp': 'IMP'
      };
      matchedValue = tryMatch(aliasMap[valueStr.toLowerCase()]);
    }

    if (matchedValue) {
      return matchedValue;
    }

    if (schemaItem.key === 'major_category') {
      return valueStr;
    }

    return null;
  }

  /**
   * Normalize null/missing value variations to null
   */
  private normalizeNullValue(value: any): any {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;

    const lowerValue = value.toLowerCase().trim();
    const nullVariants = [
      'no_packet', 'no_placket', 'no plackets', 'no placket',
      'not visible', 'cannot determine', 'n/a', 'na',
      'not applicable', 'none', 'not found', 'unknown'
    ];

    if (nullVariants.includes(lowerValue)) {
      return null;
    }

    return value;
  }

  private calculateConfidence(attributes: AttributeData): number {
    const values = Object.values(attributes).filter(attr => attr !== null);
    if (values.length === 0) return 0;

    const totalConfidence = values.reduce((sum, attr) => sum + (attr?.visualConfidence || 0), 0);
    return Math.round(totalConfidence / values.length);
  }
}
