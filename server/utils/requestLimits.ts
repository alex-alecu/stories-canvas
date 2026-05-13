import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

interface FixedWindowEntry {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface SseConnectionClaim {
  allowed: true;
  release: () => void;
}

interface SseConnectionRejection {
  allowed: false;
  retryAfterSeconds: number;
}

class FixedWindowRateLimiter {
  private entries = new Map<string, FixedWindowEntry>();
  private hitsUntilPrune = 0;

  check(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    if (limit <= 0 || windowMs <= 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    this.hitsUntilPrune++;
    if (this.hitsUntilPrune >= 1_000) {
      this.prune(now);
      this.hitsUntilPrune = 0;
    }

    const existing = this.entries.get(key);
    const entry = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

    if (entry.count >= limit) {
      this.entries.set(key, entry);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
      };
    }

    entry.count++;
    this.entries.set(key, entry);
    return {
      allowed: true,
      retryAfterSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  }

  reset(): void {
    this.entries.clear();
    this.hitsUntilPrune = 0;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

const readIpLimiter = new FixedWindowRateLimiter();
const readUserLimiter = new FixedWindowRateLimiter();
const sseConnectionsByIp = new Map<string, number>();
const sseConnectionsByStoryIp = new Map<string, number>();

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function normalizeClientIp(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first ? first.slice(0, 120) : undefined;
}

export function getClientIp(req: Request): string {
  return normalizeClientIp(firstHeaderValue(req.headers['x-real-ip']))
    ?? normalizeClientIp(firstHeaderValue(req.headers['x-forwarded-for']))
    ?? normalizeClientIp(req.ip)
    ?? normalizeClientIp(req.socket.remoteAddress)
    ?? 'unknown';
}

function hasBearerAuth(req: Request): boolean {
  return typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
}

function isMediaRequestPath(path: string): boolean {
  return /^\/[^/]+\/(?:images|audio)\//.test(path);
}

function rejectRateLimited(res: Response, retryAfterSeconds: number): void {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too many requests',
    retryAfterSeconds,
  });
}

function enforceWindowLimit(
  res: Response,
  key: string,
  limit: number,
): boolean {
  const result = readIpLimiter.check(key, limit, config.readRateWindowMs);
  if (result.allowed) {
    return true;
  }

  rejectRateLimited(res, result.retryAfterSeconds);
  return false;
}

export function limitStoryReadByIp(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' || isMediaRequestPath(req.path)) {
    next();
    return;
  }

  const limit = req.path === '/public'
    ? config.anonymousReadIpLimit
    : hasBearerAuth(req)
    ? config.authenticatedReadIpLimit
    : config.anonymousReadIpLimit;
  const key = `story-read:ip:${getClientIp(req)}`;

  if (!enforceWindowLimit(res, key, limit)) {
    return;
  }

  next();
}

export function limitAuthenticatedStoryRead(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' || isMediaRequestPath(req.path) || !req.authUser) {
    next();
    return;
  }

  const userResult = readUserLimiter.check(
    `story-read:user:${req.authUser.id}`,
    config.authenticatedReadUserLimit,
    config.readRateWindowMs,
  );
  if (!userResult.allowed) {
    rejectRateLimited(res, userResult.retryAfterSeconds);
    return;
  }

  const ipResult = readIpLimiter.check(
    `story-read:authenticated-ip:${getClientIp(req)}`,
    config.authenticatedReadIpLimit,
    config.readRateWindowMs,
  );
  if (!ipResult.allowed) {
    rejectRateLimited(res, ipResult.retryAfterSeconds);
    return;
  }

  next();
}

function decrement(map: Map<string, number>, key: string): void {
  const count = map.get(key) ?? 0;
  if (count <= 1) {
    map.delete(key);
  } else {
    map.set(key, count - 1);
  }
}

export function claimSseConnection(req: Request, storyId: string): SseConnectionClaim | SseConnectionRejection {
  const ip = getClientIp(req);
  const ipCount = sseConnectionsByIp.get(ip) ?? 0;
  if (config.sseIpConnectionLimit > 0 && ipCount >= config.sseIpConnectionLimit) {
    return { allowed: false, retryAfterSeconds: 30 };
  }

  const storyIpKey = `${storyId}:${ip}`;
  const storyIpCount = sseConnectionsByStoryIp.get(storyIpKey) ?? 0;
  if (config.sseStoryIpConnectionLimit > 0 && storyIpCount >= config.sseStoryIpConnectionLimit) {
    return { allowed: false, retryAfterSeconds: 30 };
  }

  sseConnectionsByIp.set(ip, ipCount + 1);
  sseConnectionsByStoryIp.set(storyIpKey, storyIpCount + 1);

  let released = false;
  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      decrement(sseConnectionsByIp, ip);
      decrement(sseConnectionsByStoryIp, storyIpKey);
    },
  };
}

export function rejectSseRateLimited(res: Response, retryAfterSeconds: number): void {
  rejectRateLimited(res, retryAfterSeconds);
}

export function resetRequestLimitersForTests(): void {
  readIpLimiter.reset();
  readUserLimiter.reset();
  sseConnectionsByIp.clear();
  sseConnectionsByStoryIp.clear();
}
