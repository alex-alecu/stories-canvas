import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
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

interface CachedAuthResult {
  expiresAt: number;
  authUser?: Express.Request['authUser'];
}

const AUTH_CACHE_MAX_ENTRIES = 1_000;
const authResultCache = new Map<string, CachedAuthResult>();

function getTokenCacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getCachedAuthResult(cacheKey: string): { hit: boolean; authUser?: Express.Request['authUser'] } {
  if (config.authCacheTtlMs <= 0) {
    return { hit: false };
  }

  const cached = authResultCache.get(cacheKey);
  if (!cached) {
    return { hit: false };
  }

  if (cached.expiresAt <= Date.now()) {
    authResultCache.delete(cacheKey);
    return { hit: false };
  }

  return {
    hit: true,
    authUser: cached.authUser ? { ...cached.authUser } : undefined,
  };
}

function setCachedAuthResult(cacheKey: string, authUser?: Express.Request['authUser']): void {
  if (config.authCacheTtlMs <= 0) {
    return;
  }

  authResultCache.set(cacheKey, {
    expiresAt: Date.now() + config.authCacheTtlMs,
    authUser: authUser ? { ...authUser } : undefined,
  });

  while (authResultCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authResultCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    authResultCache.delete(oldestKey);
  }
}

export function clearAuthResultCacheForTests(): void {
  authResultCache.clear();
}

export const authOps = {
  getUserForToken: async (token: string) => {
    const { getSupabase } = await import('../services/supabase.js');
    const supabase = getSupabase();
    return supabase.auth.getUser(token);
  },
  resolveUserAccess: async (userId: string, email: string | undefined) => {
    const { resolveUserAccess } = await import('../services/accessControl.js');
    return resolveUserAccess(userId, email);
  },
};

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

    const cacheKey = getTokenCacheKey(token);
    const cached = getCachedAuthResult(cacheKey);
    if (cached.hit) {
      if (cached.authUser) {
        req.authUser = cached.authUser;
      }
      return next();
    }

    const { data: { user }, error } = await authOps.getUserForToken(token);
    if (error || !user) {
      setCachedAuthResult(cacheKey);
      return next();
    }

    const access = await authOps.resolveUserAccess(user.id, user.email);

    const authUser = {
      id: user.id,
      email: user.email,
      isAdmin: access.isAdmin,
    };
    req.authUser = authUser;
    setCachedAuthResult(cacheKey, authUser);
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
