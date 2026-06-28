import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

test('GET /api/user/preferences falls back to configured default language without Supabase', async (t) => {
  const { config } = await import('../config.js');
  const userRouter = (await import('./user.js')).default;
  const originalConfig = { ...config };

  Object.assign(config, {
    useSupabase: false,
    defaultLanguage: 'en',
  });
  t.after(() => Object.assign(config, originalConfig));

  const app = express();
  app.use((_req, _res, next) => {
    _req.authUser = { id: 'user-one', email: 'test@example.com' };
    next();
  });
  app.use('/api/user', userRouter);

  const server = app.listen(0);
  t.after(() => {
    server.close();
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/user/preferences`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { language: 'en' });
});
