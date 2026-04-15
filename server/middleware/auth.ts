import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email?: string;
        isAdmin?: boolean;
      };
    }
  }
}

/**
 * Optional auth middleware: extracts and verifies the JWT from the Authorization header.
 * Does NOT block unauthenticated requests - it just attaches user info if available.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    if (!token || !config.useSupabase) {
      return next();
    }

    // Dynamic import to avoid loading supabase when not configured
    const { getSupabase } = await import('../services/supabase.js');
    const supabase = getSupabase();

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return next();
    }

    const { resolveUserAccess } = await import('../services/accessControl.js');
    const access = await resolveUserAccess(user.id, user.email);

    req.authUser = {
      id: user.id,
      email: user.email,
      isAdmin: access.isAdmin,
    };
  } catch {
    // Silently continue without auth
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await optionalAuth(req, res, () => undefined);

  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => undefined);

  if (!req.authUser) {
    return;
  }

  if (!req.authUser.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
