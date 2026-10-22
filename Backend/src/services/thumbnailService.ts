/**
 * Card thumbnails.
 *
 * Article images are 12 MP phone photos (~4 MB, 4096×3072). A page of 50 cards
 * showing those originals makes the browser download ~190 MB and decode ~2 GB of
 * bitmaps, which hangs scrolling. Cards instead load a small WebP made here on
 * first request and cached in R2 under `thumbs/w<width>/<hash>.webp`; the zoom
 * view still opens the original.
 */
import { createHash } from 'crypto';
import sharp from 'sharp';
import { storageService } from './storageService';

export const THUMB_WIDTHS = [160, 320, 480] as const;
export const DEFAULT_THUMB_WIDTH = 320;

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_RENDERS = 4;

// Hosts article images are served from. Anything else is refused so this
// public endpoint can't be used to make the server fetch arbitrary URLs.
const ALLOWED_HOST_SUFFIXES = ['.r2.dev', '.v2retail.com', '.v2retail.net', '.supabase.co'];

export class ThumbnailError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

export function parseSourceUrl(raw: string): URL {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        throw new ThumbnailError('Invalid image URL', 400);
    }
    if (u.protocol !== 'https:') throw new ThumbnailError('Only https image URLs are allowed', 400);
    const host = u.hostname.toLowerCase();
    if (!ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
        throw new ThumbnailError('Image host not allowed', 400);
    }
    return u;
}

// Signed URLs carry a fresh signature/expiry each time they are minted; leave
// those params out of the cache key so the same object maps to one thumbnail.
// `?v=` (used when an image is replaced) is kept, so a new file gets a new thumb.
function cacheKey(u: URL, width: number): string {
    const clean = new URL(u.toString());
    for (const k of Array.from(clean.searchParams.keys())) {
        if (/^x-amz-/i.test(k) || /^(token|expires|signature)$/i.test(k)) clean.searchParams.delete(k);
    }
    const hash = createHash('sha1').update(clean.toString()).digest('hex');
    return `thumbs/w${width}/${hash}.webp`;
}

let activeRenders = 0;
const renderQueue: Array<() => void> = [];
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (activeRenders >= MAX_CONCURRENT_RENDERS) {
        await new Promise<void>((resolve) => renderQueue.push(resolve));
    }
    activeRenders++;
    try {
        return await fn();
    } finally {
        activeRenders--;
        renderQueue.shift()?.();
    }
}

async function fetchSource(u: URL): Promise<Buffer> {
    const res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new ThumbnailError(`Source image returned ${res.status}`, res.status === 404 ? 404 : 502);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_SOURCE_BYTES) throw new ThumbnailError('Source image too large', 413);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw new ThumbnailError('Source image too large', 413);
    return buf;
}

async function render(u: URL, width: number, key: string): Promise<Buffer> {
    return withRenderSlot(async () => {
        const source = await fetchSource(u);
        const thumb = await sharp(source, { failOn: 'none' })
            .rotate() // honour EXIF orientation from phone photos
            // Cards crop to 3:4 (object-cover), so cover a width × 4/3·width box —
            // a landscape photo sized by width alone would be too short and blur.
            .resize({ width, height: Math.round((width * 4) / 3), fit: 'outside', withoutEnlargement: true })
            .webp({ quality: 72 })
            .toBuffer();
        storageService.putThumbnail(key, thumb, 'image/webp').catch((err) => {
            console.warn(`[thumb] cache write failed for ${key}:`, err?.message);
        });
        return thumb;
    });
}

// Many cards can ask for the same image at once (e.g. a page refresh); share one render.
const inFlight = new Map<string, Promise<Buffer>>();

export async function getThumbnail(rawUrl: string, width: number): Promise<Buffer> {
    const u = parseSourceUrl(rawUrl);
    const key = cacheKey(u, width);

    const cached = await storageService.getThumbnail(key).catch(() => null);
    if (cached) return cached;

    let p = inFlight.get(key);
    if (!p) {
        p = render(u, width, key).finally(() => inFlight.delete(key));
        inFlight.set(key, p);
    }
    return p;
}
