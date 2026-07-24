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
  return rows.filter((r) => String(r.imageUrl || '').trim());
}

/**
 * Look up one article number. Prefers an APPROVED row, else the most recent row;
 * in all cases requires a usable imageUrl. Returns { found: false, reason } when
 * the article isn't in extraction_results_flat or has no image.
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

    return {
      articleCode,
      found: true,
      imageUrl: String(row.imageUrl).trim(),
      gender: deriveGender(row.division, row.subDivision),
      bodytype: deriveBodyFraming(row.majorCategory, row.articleType),
      colorName: colour || undefined,
      featuredGarment: deriveFeaturedGarment(row.majorCategory, row.articleType),
      attributesText: buildAttributesText(row),
    };
  }

  // No exact match — try falling back to a sibling colour variant of the same
  // base article number (split on the first "-").
  const dashIdx = articleCode.indexOf('-');
  if (dashIdx <= 0 || dashIdx === articleCode.length - 1) {
    return { articleCode, found: false, reason: 'not found in extraction data (no image)' };
  }
  const baseArticleNumber = articleCode.slice(0, dashIdx).trim();
  const requestedColor = articleCode.slice(dashIdx + 1).trim();

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
  siblingRows = siblingRows.filter((r) => String(r.imageUrl || '').trim());

  if (siblingRows.length === 0) {
    return { articleCode, found: false, reason: 'not found in extraction data (no image)' };
  }

  // Prefer APPROVED, else the latest — same rule as the exact-match path.
  const row = siblingRows.find((r) => r.approvalStatus === 'APPROVED') || siblingRows[0];

  return {
    articleCode,
    found: true,
    imageUrl: String(row.imageUrl).trim(),
    gender: deriveGender(row.division, row.subDivision),
    bodytype: deriveBodyFraming(row.majorCategory, row.articleType),
    colorName: requestedColor || undefined,
    featuredGarment: deriveFeaturedGarment(row.majorCategory, row.articleType),
    attributesText: buildAttributesText(row),
    isColorFallback: true,
  };
}
