import { Request, Response, NextFunction } from 'express';
import { authenticate, requireUser } from './auth';

/**
 * Auth for /api/model-generation: the in-house frontend calls it with a user
 * JWT like any other route, but craftpack-studio also calls /generate directly
 * as a service (no logged-in Article-Creation user) — same x-api-key pattern as
 * authenticateWatcher/authenticateSrmHook, just layered in front of the normal
 * JWT check instead of replacing it, since this route family still serves
 * real users too.
 */
export const authenticateModelGeneration = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const key = req.headers['x-api-key'];
  const expected = process.env.ARTICLE_CREATION_API_KEY;

  if (expected && key === expected) {
    next();
    return;
  }

  authenticate(req, res, () => requireUser(req, res, next));
};
