import { Router, Request, Response } from 'express';
import { getThumbnail, ThumbnailError, THUMB_WIDTHS, DEFAULT_THUMB_WIDTH } from '../services/thumbnailService';

const router = Router();

// GET /api/images/thumb?url=<image url>&w=320
// Public on purpose: <img> tags can't send the Bearer token. The source images
// are already public, and parseSourceUrl only allows our image hosts.
router.get('/thumb', async (req: Request, res: Response) => {
    const url = String(req.query.url || '');
    const requested = Number(req.query.w) || DEFAULT_THUMB_WIDTH;
    const width = (THUMB_WIDTHS as readonly number[]).includes(requested) ? requested : DEFAULT_THUMB_WIDTH;
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
        const thumb = await getThumbnail(url, width);
        res.setHeader('Content-Type', 'image/webp');
        // The cache key includes the image URL (and its ?v= stamp), so a thumb never changes.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(thumb);
    } catch (err: any) {
        const status = err instanceof ThumbnailError ? err.status : 502;
        if (status >= 500) console.warn(`[thumb] ${url}:`, err?.message);
        return res.status(status).json({ error: err?.message || 'Failed to make thumbnail' });
    }
});

export default router;
