import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../generated/prisma';
import { authenticate } from './auth';

/**
 * Service API-Key Authentication (x-api-key).
 *
 * Lets a trusted internal service — currently craftpack-studio's material
 * colourway recolour — call POST /api/model-generation/generate without holding
 * a user JWT (and therefore without craftpack needing our JWT_SECRET, which
 * would let it mint a token for any user).
 *
 * Set MODELGEN_SERVICE_API_KEY in .env / Azure App Settings. Mirrors the shape
 * of watcherAuth.ts, which does the same job for the file-watcher service.
 */

/** Constant-time compare that does not throw on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Validates x-api-key and stamps a synthetic req.user so requireUser — and
 * anything downstream expecting an authenticated request — keeps working.
 *
 * The role is PD_DESIGNER, not ADMIN: it satisfies requireUser's allow-list and
 * nothing more, so if this key ever reaches a route guarded by requireAdmin it
 * still fails. The id is 0 on purpose — no such row exists in `users`, so any
 * code that tries to use it as a foreign key fails loudly instead of silently
 * attributing work to a real person.
 */
export const authenticateServiceKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const key = req.headers['x-api-key'];
  const expected = process.env.MODELGEN_SERVICE_API_KEY;

  if (!expected) {
    console.error('[ServiceKey] MODELGEN_SERVICE_API_KEY is not set in environment variables');
    res.status(503).json({
      success: false,
      error: 'Service API key not configured on server',
      code: 'SERVICE_KEY_NOT_CONFIGURED',
    });
    return;
  }

  if (typeof key !== 'string' || !safeEqual(key, expected)) {
    res.status(401).json({
      success: false,
      error: 'Invalid or missing x-api-key header',
      code: 'INVALID_SERVICE_KEY',
    });
    return;
  }

  req.user = {
    id: 0,
    email: 'service@craftpack.internal',
    name: 'Craftpack Service',
    role: 'PD_DESIGNER' as UserRole,
    division: null,
    subDivision: null,
  };

  next();
};

/**
 * Accepts either a user JWT (the Article-Creation UI) or a service x-api-key
 * (craftpack), on the same router.
 *
 * The key path is deliberately narrowed to /generate. This router also mounts
 * the bulk pipeline at '/' (routes/modelGeneration.ts), which writes to disk,
 * accepts 1500 files, holds a 20-minute request, and keys job ownership on
 * req.user.id — none of which should be reachable by a synthetic user id of 0.
 */
export const authenticateJwtOrServiceKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.headers['x-api-key']) {
    void authenticate(req, res, next);
    return;
  }

  // Mounted with app.use('/api/model-generation', …), so req.path is '/generate'.
  if (req.path !== '/generate') {
    res.status(403).json({
      success: false,
      error: 'This API key may only call /generate.',
      code: 'SERVICE_KEY_SCOPE',
    });
    return;
  }

  authenticateServiceKey(req, res, next);
};
