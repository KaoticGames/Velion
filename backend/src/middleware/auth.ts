import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';

// Extend Express Request with user payload
declare global {
  namespace Express {
    interface Request {
      user?: {
        user_id:           string;
        email:             string;
        subscription_tier: string;
      };
    }
  }
}

/** Verify Bearer token and attach user to request */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided.', status: 401 } });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Token is invalid or expired.', status: 401 } });
  }
};

/** Require DM subscription tier */
export const requireDM = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.', status: 401 } });
    return;
  }
  if (req.user.subscription_tier !== 'dm') {
    res.status(403).json({ error: { code: 'FORBIDDEN_DM_REQUIRED', message: 'This action requires a DM subscription.', status: 403 } });
    return;
  }
  next();
};

/** Require at minimum a paid subscription (player or dm) */
export const requirePaid = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.', status: 401 } });
    return;
  }
  if (req.user.subscription_tier === 'free') {
    res.status(403).json({ error: { code: 'UPGRADE_REQUIRED', message: 'This feature requires a paid subscription.', status: 403 } });
    return;
  }
  next();
};
