import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

process.env.GEMINI_API_KEY ??= 'test-key';

function runOptionalAuth(
  optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  token: string,
): Promise<Request> {
  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  } as unknown as Request;

  return new Promise((resolve, reject) => {
    optionalAuth(req, {} as Response, ((error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(req);
    }) as NextFunction).catch(reject);
  });
}

test('optionalAuth caches token lookups for the configured TTL', async (t) => {
  const { config } = await import('../config.js');
  const authMiddleware = await import('./auth.js');

  const previousUseSupabase = config.useSupabase;
  const previousAuthCacheTtlMs = config.authCacheTtlMs;
  Object.assign(config, {
    useSupabase: true,
    authCacheTtlMs: 60_000,
  });
  authMiddleware.clearAuthResultCacheForTests();

  t.after(() => {
    Object.assign(config, {
      useSupabase: previousUseSupabase,
      authCacheTtlMs: previousAuthCacheTtlMs,
    });
    authMiddleware.clearAuthResultCacheForTests();
  });

  let getUserCalls = 0;
  t.mock.method(authMiddleware.authOps, 'getUserForToken', async () => {
    getUserCalls += 1;
    return {
      data: {
        user: {
          id: 'cached-user',
          email: 'cached@example.test',
        },
      },
      error: null,
    };
  });
  t.mock.method(authMiddleware.authOps, 'resolveUserAccess', async () => ({ isAdmin: false }));

  const first = await runOptionalAuth(authMiddleware.optionalAuth, 'cached-token');
  const second = await runOptionalAuth(authMiddleware.optionalAuth, 'cached-token');

  assert.equal(getUserCalls, 1);
  assert.equal(first.authUser?.id, 'cached-user');
  assert.equal(second.authUser?.id, 'cached-user');
});

test('requireAdmin denies non-admin users and accepts admins', async () => {
  const { requireAdmin } = await import('./auth.js');
  const makeResponse = () => {
    const result = { statusCode: 200, body: undefined as unknown };
    return {
      result,
      response: {
        status(code: number) {
          result.statusCode = code;
          return this;
        },
        json(body: unknown) {
          result.body = body;
          return this;
        },
      } as unknown as Response,
    };
  };

  const denied = makeResponse();
  let deniedNext = false;
  await requireAdmin(
    { headers: {}, authUser: { id: 'user-1', isAdmin: false } } as Request,
    denied.response,
    (() => { deniedNext = true; }) as NextFunction,
  );
  assert.equal(denied.result.statusCode, 403);
  assert.equal(deniedNext, false);

  const allowed = makeResponse();
  let allowedNext = false;
  await requireAdmin(
    { headers: {}, authUser: { id: 'admin-1', isAdmin: true } } as Request,
    allowed.response,
    (() => { allowedNext = true; }) as NextFunction,
  );
  assert.equal(allowed.result.statusCode, 200);
  assert.equal(allowedNext, true);
});
