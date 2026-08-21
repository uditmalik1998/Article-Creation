/**
 * Resolves a bare article number into everything the model-generation worker
 * needs, by reading extraction_results_flat:
 *   - source image URL (imageUrl)          → what to generate from
 *   - gender (from division / subDivision)  → male / female / kid boy / kid girl
 *   - colour (colour / variantColor)        → colour lock (null = preserve source)
 *   - garment attributes                    → injected into the prompt for fidelity
 *
 * Body type is intentionally NOT derived here — majorCategory is frequently null,
 * so framing is left to the AI ('auto'), which decides upper/lower/full from the
 * garment it sees.
 */
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';

export interface ResolvedArticle {
  articleCode: string;
  found: boolean;
  imageUrl?: string;
  gender?: string;      // 'male' | 'female' | 'kid boy' | 'kid girl'
  bodytype?: string;    // always 'auto' — AI decides framing
  colorName?: string;   // undefined = preserve source colour
  featuredGarment?: 'top' | 'bottom' | 'full' | 'unknown'; // which piece a colour swap targets
  attributesText?: string;
  reason?: string;      // populated when found === false
  // true when no row exists for the exact code (article+colour) but a sibling
  // row for the same base article number was found and reused as the source
  // image — colorName is then the user-requested colour and MUST be actively
  // enforced by the generation prompt instead of just preserved from source.
  isColorFallback?: boolean;
}

/** division (+ subDivision for kids) → model gender used by the prompt builder. */
function deriveGender(division?: string | null, subDivision?: string | null): string {
  const d = String(division || '').toUpperCase().trim();
  const s = String(subDivision || '').toUpperCase().trim();

  if (d === 'MENS' || d === 'MEN' || d === 'MW') return 'male';
  if (d === 'LADIES' || d === 'WOMENS' || d === 'WOMEN' || d === 'LW') return 'female';
  if (d === 'KIDS' || d.startsWith('KID') || d.startsWith('INFANT')) {
    if (s.startsWith('KB') || s.startsWith('IB') || s.includes('BOY')) return 'kid boy';
    if (s.startsWith('KG') || s.startsWith('IG') || s.includes('GIRL')) return 'kid girl';
    return 'kid boy';
  }
  return 'female'; // safe default
}

// Clear bottomwear / full-length keywords used to drive framing. Only confident matches
// change the framing; anything else stays 'auto' (let the AI choose) so we never crop a
// top wrongly.
const BOTTOM_WORDS = ['TROUSER', 'PANT', 'JEAN', 'DENIM', 'SHORT', 'SKIRT', 'LEGGING', 'JEGGING', 'CHINO', 'CARGO', 'CULOTTE', 'PALAZZO', 'JOGGER', 'TRACK PANT', 'TRACKPANT', 'PYJAMA', 'PAJAMA', 'CAPRI', 'DHOTI', 'LOWER', 'BOTTOM'];
const FULL_WORDS = ['DRESS', 'GOWN', 'JUMPSUIT', 'DUNGAREE', 'ROMPER', 'OVERALL', 'SAREE', 'ABAYA', 'KAFTAN', 'KURTA', 'NIGHTSUIT'];
// Clear upper-garment keywords — used to decide which piece a colour swap targets when
// the source shows a two-piece set (recolour only the featured product, never both).
const TOP_WORDS = ['SHIRT', 'T-SHIRT', 'TSHIRT', 'TEE', 'TOP', 'JACKET', 'SWEATSHIRT', 'HOODIE', 'SWEATER', 'PULLOVER', 'BLAZER', 'COAT', 'WAISTCOAT', 'CARDIGAN', 'POLO', 'BLOUSE', 'CROP TOP'];

/**
 * Decide WHICH garment a colour swap should target when the source photo contains two
 * pieces (e.g. a jacket + trousers flat-lay). We recolour ONLY the featured product —
 * the piece whose category the article actually is — and leave the complementary piece
 * its original colour. 'full' = one-piece (recolour whole outfit); 'unknown' = leave the
 * current whole-garment recolour behaviour (no reliable category signal).
 */
export function deriveFeaturedGarment(
  majorCategory?: string | null,
  articleType?: string | null,
): 'top' | 'bottom' | 'full' | 'unknown' {
  const hay = [majorCategory, articleType].map((x) => String(x || '').toUpperCase()).join(' ');
  if (!hay.trim()) return 'unknown';
  if (BOTTOM_WORDS.some((w) => hay.includes(w))) return 'bottom';
  if (FULL_WORDS.some((w) => hay.includes(w))) return 'full';
  if (TOP_WORDS.some((w) => hay.includes(w))) return 'top';
  return 'unknown';
}

// ── MAJOR_CAT_MASTER-driven framing/gender ──────────────────────────────────
// When the article's majorCategory code matches a row in major_cat_master, that
// row is the source of truth: its `frame` decides the model-image framing and its
// `div`/`idealFor` decide the model gender. Falls back to the flat-row heuristics
// (deriveBodyFraming / deriveGender / deriveFeaturedGarment) when there is no match.

/** major_cat_master.frame → bodytype used by the generation prompt. */
export function frameToBodytype(frame?: string | null): string | null {
  switch (String(frame || '').toLowerCase().trim()) {
    case 'upper': return 'Upper-Body';        // waist-up
    case 'lower': return 'Lower-Body';        // waist-down (half)
    case 'set':   return 'Full-Body';         // full outfit, head-to-toe
    case 'fw':    return 'Lower-Body';         // footwear → legs + feet focus
    default:      return null;
  }
}

/** major_cat_master.frame → which piece a colour swap targets. */
export function frameToFeatured(frame?: string | null): 'top' | 'bottom' | 'full' | 'unknown' | null {
  switch (String(frame || '').toLowerCase().trim()) {
    case 'upper': return 'top';
    case 'lower': return 'bottom';
    case 'set':   return 'full';
    case 'fw':    return 'unknown';
    default:      return null;
  }
}

/** Model gender from major_cat_master.div + idealFor (idealFor is more specific). */
export function genderFromDivIdeal(div?: string | null, idealFor?: string | null): string | null {
  const i = String(idealFor || '').toUpperCase().trim();
  const d = String(div || '').toUpperCase().trim();
  // idealFor is the most specific signal
  if (i.includes('GIRL')) return 'kid girl';
  if (i.includes('BOY')) return 'kid boy';
  if (i === 'MEN' || i === 'MENS') return 'male';
  if (i === 'WOMEN' || i === 'WOMENS') return 'female';
  if (i.includes('KID') || i.includes('INFANT')) return 'kid boy'; // kids & infants, unspecified
  // fall back to division
  if (d === 'MEN' || d === 'MENS') return 'male';
  if (d === 'WOMEN' || d === 'WOMENS' || d === 'LADIES') return 'female';
  if (d.includes('KID') || d.includes('INFANT')) return 'kid boy';
  return null;
}

/**
 * Resolve gender / bodytype / featuredGarment for an article row. Starts from the
 * flat-row heuristics, then — if the row's majorCategory code exists in
 * major_cat_master — overrides framing (from `frame`) and gender (from `div`/`idealFor`)
 * with the master's authoritative values.
 */
async function resolveFramingAndGender(row: Record<string, any>): Promise<{
  gender: string;
  bodytype: string;
  featuredGarment: 'top' | 'bottom' | 'full' | 'unknown';
}> {
  let gender = deriveGender(row.division, row.subDivision);
  let bodytype = deriveBodyFraming(row.majorCategory, row.articleType);
  let featuredGarment = deriveFeaturedGarment(row.majorCategory, row.articleType);

  const code = String(row.majorCategory || '').trim();
  if (code) {
    try {
      const master = await withPrismaRetry(() =>
        prisma.majorCatMaster.findFirst({
          where: { majCat: { equals: code, mode: 'insensitive' }, isActive: true },
          select: { frame: true, div: true, idealFor: true },
        })
      );
      if (master) {
        bodytype = frameToBodytype(master.frame) ?? bodytype;
        gender = genderFromDivIdeal(master.div, master.idealFor) ?? gender;
        featuredGarment = frameToFeatured(master.frame) ?? featuredGarment;
      }
    } catch {
      // Master lookup is best-effort — on any error keep the flat-row heuristics.
    }
  }

  return { gender, bodytype, featuredGarment };
}

/**
 * Decide framing (body type) from the article's category text. Bottomwear must be shot
 * waist-down and full-length one-pieces head-to-toe; everything else is left to the AI
 * ('auto'). This is what makes the Bottom-Category views (and their close-ups) correct.
 */
export function deriveBodyFraming(majorCategory?: string | null, articleType?: string | null): string {
  const hay = [majorCategory, articleType].map((x) => String(x || '').toUpperCase()).join(' ');
  if (!hay.trim()) return 'auto';
  if (BOTTOM_WORDS.some((w) => hay.includes(w))) return 'Lower-Body';
  if (FULL_WORDS.some((w) => hay.includes(w))) return 'Full-Body';
  return 'auto';
}

// Garment attributes worth reinforcing in the prompt, in [field, label] pairs.
// Null/blank values are skipped when the string is built.
const ATTR_FIELDS: Array<[string, string]> = [
  ['neck', 'neck'],
  ['neckDetails', 'neck details'],
  ['collar', 'collar'],
  ['collarStyle', 'collar style'],
  ['sleeve', 'sleeve'],
  ['sleeveFold', 'sleeve fold'],
  ['placket', 'placket'],
  ['fit', 'fit'],
  ['pattern', 'pattern'],
  ['length', 'length'],
  ['frontOpenStyle', 'front open style'],
  ['pocketType', 'pocket'],
  ['bottomFold', 'bottom fold'],
  ['printType', 'print type'],
  ['printPlacement', 'print placement'],
  ['embroidery', 'embroidery'],
  ['drawcord', 'drawcord'],
  ['wash', 'wash'],
];

function buildAttributesText(row: Record<string, any>): string | undefined {
  const parts: string[] = [];
  for (const [field, label] of ATTR_FIELDS) {
    const v = String(row[field] ?? '').trim();
    if (v && v.toUpperCase() !== 'NA' && v.toUpperCase() !== 'N/A') {
      parts.push(`${label}: ${v}`);
    }
  }
  return parts.length ? parts.join(', ') : undefined;
}

const ARTICLE_SELECT = {
  articleNumber: true,
  imageUrl: true,
  approvalStatus: true,
  division: true,
  subDivision: true,
  majorCategory: true,
  articleType: true,
  colour: true,
  variantColor: true,
  neck: true,
  neckDetails: true,
  collar: true,
  collarStyle: true,
  sleeve: true,
  sleeveFold: true,
  placket: true,
  fit: true,
  pattern: true,
  length: true,
  frontOpenStyle: true,
  pocketType: true,
  bottomFold: true,
  printType: true,
  printPlacement: true,
  embroidery: true,
  drawcord: true,
  wash: true,
} as const;

async function findRowsByArticleNumber(articleNumber: string): Promise<any[]> {
  const rows = await withPrismaRetry(() =>
    prisma.extractionResultFlat.findMany({
      where: { articleNumber: { equals: articleNumber, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: ARTICLE_SELECT,
    })
  );
  // Exclude raw Supabase srm-uploads URLs — that bucket is gone (404) so they are
  // permanently broken. Articles with only these URLs fall through to the R2 fallback.
  return rows.filter((r) => {
    const url = String(r.imageUrl || '').trim();
    if (!url) return false;
    if (url.includes('supabase.co/storage') && url.includes('srm-uploads')) return false;
    return true;
  });
}

const SRM_SUPABASE_URL = 'https://pymdqnnwwxrgeolvgvgv.supabase.co';
const SRM_SUPABASE_KEY = process.env.SRM_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRxbm53d3hyZ2VvbHZndmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzMzU0NzYsImV4cCI6MjA2ODkxMTQ3Nn0.jUrb0jIg6qjj2Rlh9DxYesSnbstoD4uoDCswqOqAkUM';

/**
 * Fetch division / sub_division / maj_category for an article from the v2srm
 * product_master table via the Supabase REST API.
 */
async function fetchProductMasterMeta(articleNumber: string): Promise<{
  division?: string; subDivision?: string; majorCategory?: string;
} | null> {
  try {
    const url = `${SRM_SUPABASE_URL}/rest/v1/product_master`
      + `?article_number=eq.${encodeURIComponent(articleNumber)}`
      + `&select=division,sub_division,maj_category&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SRM_SUPABASE_KEY,
        Authorization: `Bearer ${SRM_SUPABASE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows.length) return null;
    const r = rows[0];
    return {
      division:      r.division     || undefined,
      subDivision:   r.sub_division || undefined,
      majorCategory: r.maj_category || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Last-resort fallback: article has no extraction record (or no imageUrl in it),
 * so construct the source URL directly from the approved R2 bucket (article-master)
 * and pull gender / category metadata from the v2srm product_master table.
 */
async function tryApprovedR2Fallback(
  articleCode: string,
  baseArticleNumber: string,
  requestedColor?: string,
): Promise<ResolvedArticle> {
  const approvedUrlBase = (process.env.APPROVED_R2_PUBLIC_URL_BASE || '').replace(/\/$/, '');
  if (!approvedUrlBase) {
    return { articleCode, found: false, reason: 'not found in extraction data (no image)' };
  }

  const imageUrl = `${approvedUrlBase}/${baseArticleNumber}.jpg`;

  // Pull metadata from v2srm product_master for gender / bodytype derivation.
  const meta = await fetchProductMasterMeta(baseArticleNumber);
  const metaRow: Record<string, any> = meta
    ? { division: meta.division, subDivision: meta.subDivision, majorCategory: meta.majorCategory }
    : {};

  const { gender, bodytype, featuredGarment } = await resolveFramingAndGender(metaRow);

  return {
    articleCode,
    found: true,
    imageUrl,
    gender,
    bodytype,
    colorName: requestedColor || undefined,
    featuredGarment,
    attributesText: undefined,
    isColorFallback: !!requestedColor,
  };
}

/**
 * Look up one article number. Prefers an APPROVED row, else the most recent row;
 * in all cases requires a usable imageUrl. Returns { found: false, reason } when
 * the article isn't in extraction_results_flat or has no image.
 *
 * Resolution order:
 *  1. Exact match in extraction_results_flat (with imageUrl).
 *  2. Sibling colour variant in extraction_results_flat (dash-split base number).
 *  3. Approved R2 bucket directly (article-master) with metadata from v2srm
 *     product_master — for articles that were never run through Gemini extraction.
 *
 * The input code is typically "BASEARTICLE-COLOUR" (e.g. "1110097922-BLACK"). If
 * no row exists for that exact code, but a sibling row for the same base article
 * number DOES exist (extracted in a different colour), we reuse that sibling's
 * photo as the source image and force-recolour it to the colour the user asked
 * for (isColorFallback: true) instead of failing the whole code.
 */
export async function resolveArticleForGeneration(code: string): Promise<ResolvedArticle> {
  const articleCode = code.trim();

  let withImage: any[];
  try {
    withImage = await findRowsByArticleNumber(articleCode);
  } catch (err: any) {
    return { articleCode, found: false, reason: `lookup failed: ${err?.message || 'db error'}` };
  }

  if (withImage.length > 0) {
    // Prefer APPROVED, else the latest (rows already sorted newest-first).
    const row = withImage.find((r) => r.approvalStatus === 'APPROVED') || withImage[0];
    const colour = String(row.colour || row.variantColor || '').trim();
    const { gender, bodytype, featuredGarment } = await resolveFramingAndGender(row);

    return {
      articleCode,
      found: true,
      imageUrl: String(row.imageUrl).trim(),
      gender,
      bodytype,
      colorName: colour || undefined,
      featuredGarment,
      attributesText: buildAttributesText(row),
    };
  }

  // No exact extraction match — try falling back to a sibling colour variant of the
  // same base article number (split on the first "-").
  const dashIdx = articleCode.indexOf('-');
  const hasDash = dashIdx > 0 && dashIdx < articleCode.length - 1;
  const baseArticleNumber = hasDash ? articleCode.slice(0, dashIdx).trim() : articleCode;
  const requestedColor = hasDash ? articleCode.slice(dashIdx + 1).trim() : undefined;

  if (hasDash) {
    let siblingRows: any[];
    try {
      siblingRows = await withPrismaRetry(() =>
        prisma.extractionResultFlat.findMany({
          where: { articleNumber: { startsWith: baseArticleNumber, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: ARTICLE_SELECT,
        })
      );
    } catch (err: any) {
      return { articleCode, found: false, reason: `lookup failed: ${err?.message || 'db error'}` };
    }
    siblingRows = siblingRows.filter((r) => {
      const url = String(r.imageUrl || '').trim();
      if (!url) return false;
      if (url.includes('supabase.co/storage') && url.includes('srm-uploads')) return false;
      return true;
    });

    if (siblingRows.length > 0) {
      // Prefer APPROVED, else the latest — same rule as the exact-match path.
      const row = siblingRows.find((r) => r.approvalStatus === 'APPROVED') || siblingRows[0];
      const { gender, bodytype, featuredGarment } = await resolveFramingAndGender(row);

      return {
        articleCode,
        found: true,
        imageUrl: String(row.imageUrl).trim(),
        gender,
        bodytype,
        colorName: requestedColor || undefined,
        featuredGarment,
        attributesText: buildAttributesText(row),
        isColorFallback: true,
      };
    }
  }

  // No extraction record at all — fall back to the approved R2 bucket with metadata
  // from the v2srm product_master table.
  return tryApprovedR2Fallback(articleCode, baseArticleNumber, requestedColor);
}
