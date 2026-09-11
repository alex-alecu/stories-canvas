import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import OpenAI from 'openai';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { authOps, clearAuthResultCacheForTests } from '../middleware/auth.js';
import marketingRouter from '../routes/marketing.js';
import { marketingOps, runInstagramMarketing } from './marketing.js';
import { instagramOps, INSTAGRAM_SCOPES } from './instagram.js';
import { marketingLogOps } from './marketingDiagnostics.js';
import type { MarketingOverview } from '../../shared/marketing.js';

const adminId = '10000000-0000-4000-8000-000000000001';
const storyId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const body = <T = MarketingOverview>(response: Response) => response.json() as Promise<T>;

test('Marketing integration: admin connection, daily selection, image publication, results, and safe retries', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
    CREATE TABLE storage.objects (id UUID, bucket_id TEXT);`);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await fs.readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec((await fs.readFile(new URL(name, migrations), 'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  }
  await db.query('INSERT INTO auth.users VALUES ($1)', [adminId]);
  for (let n = 1; n <= 45; n++) {
    await db.query(`INSERT INTO stories (id, prompt, title, status, is_public, cover_image_url, created_at,
      like_count, view_count, scenario, target_age, art_style)
      VALUES ($1, 'PRIVATE PROMPT DO NOT SEND', $2, $3, $4, $5, now() - $6 * interval '1 day', $6, $6 * 10, $7, 5, 'storybook')`,
    [storyId(n), n === 44 ? 'Private story' : `The rabbit ${n} & the forest`, n === 43 ? 'failed' : 'completed', n !== 44,
      n === 45 ? null : `https://marketing.test/storage/v1/object/public/story-images/${storyId(n)}/page-01.png`,
      n, JSON.stringify({ pages: [{ text: 'A public story in the forest. '.repeat(30) }] })]);
  }

  // A small HTTP adapter connects the real Supabase query builder to real local SQL.
  // Only the provider transport is replaced. Queries and migration functions execute in PGlite.
  const cover = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#8caf65' } }).png().toBuffer();
  let uploaded: Buffer | undefined;
  const imagePaths: string[] = [];
  const identifier = (name: string) => {
    assert.match(name, /^[a-z_]+$/);
    return `"${name}"`;
  };
  const supabase = createClient('https://marketing.test', 'local-service-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || 'GET';
      if (url.pathname.startsWith('/storage/')) {
        if (method === 'GET') return new Response(cover, { headers: { 'Content-Type': 'image/png' } });
        imagePaths.push(url.pathname);
        assert.notEqual(new Headers(init?.headers).get('x-upsert'), 'true');
        uploaded = Buffer.from(await new Response(init?.body).arrayBuffer());
        return json({ Key: 'marketing/image.jpg' });
      }
      try {
        const values: unknown[] = [];
        const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
        if (url.pathname.includes('/rpc/')) {
          const name = url.pathname.split('/').at(-1)!;
          const args = Object.entries(JSON.parse(String(init?.body || '{}'))).map(([key, value]) => `${identifier(key)} => ${param(value)}`);
          return json((await db.query(`SELECT * FROM ${identifier(name)}(${args.join(',')})`, values)).rows);
        }
        const table = identifier(url.pathname.split('/').at(-1)!);
        let query = '';
        if (method === 'PATCH') {
          const updates = Object.entries(JSON.parse(String(init?.body))).map(([key, value]) => `${identifier(key)} = ${param(value)}`);
          query = `UPDATE ${table} SET ${updates.join(',')}`;
        } else if (method === 'POST') {
          const entry = Object.entries(JSON.parse(String(init?.body)));
          query = `INSERT INTO ${table} (${entry.map(([key]) => identifier(key)).join(',')}) VALUES (${entry.map(([, value]) => param(value)).join(',')})`;
        } else query = `SELECT ${url.searchParams.get('select') === '*' ? '*' : (url.searchParams.get('select') || '*').split(',').map(identifier).join(',')} FROM ${table}`;
        const filters: string[] = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'limit'].includes(key)) continue;
          const separator = value.indexOf('.');
          const op = value.slice(0, separator);
          const operator = ({ eq: '=', gt: '>', lt: '<', gte: '>=', lte: '<=' } as Record<string, string>)[op];
          assert.ok(operator, `Unsupported filter ${op}`);
          filters.push(`${identifier(key)} ${operator} ${param(value.slice(separator + 1))}`);
        }
        if (filters.length) query += ` WHERE ${filters.join(' AND ')}`;
        if (method === 'PATCH' || method === 'POST') query += ' RETURNING *';
        else {
          if (url.searchParams.has('order')) query += ' ORDER BY ' + url.searchParams.get('order')!.split(',').map(part => {
            const [column, direction] = part.split('.');
            return `${identifier(column)} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
          }).join(',');
          if (url.searchParams.has('limit')) query += ` LIMIT ${param(Number(url.searchParams.get('limit')))}`;
        }
        const { rows } = await db.query(query, values);
        const headers = new Headers(init?.headers);
        if (headers.get('Accept')?.includes('vnd.pgrst.object')) {
          return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', details: `${rows.length} rows` }, 406);
        }
        return json(rows);
      } catch (error) {
        return json({ message: String(error) }, 400);
      }
    },
  } });
  t.mock.method(marketingOps, 'db', () => supabase);
  t.mock.method(marketingLogOps, 'db', () => supabase);
  const serverLogs: string[] = [];
  t.mock.method(console, 'info', (...values: unknown[]) => { serverLogs.push(values.join(' ')); });
  t.mock.method(console, 'error', (...values: unknown[]) => { serverLogs.push(values.join(' ')); });
  t.mock.method(marketingOps, 'wait', async () => {});
  const originalConfig = { ...config };
  Object.assign(config, { useSupabase: true, supabaseUrl: 'https://marketing.test', supabaseServiceKey: 'test-server-key',
    appBaseUrl: 'https://unused-address.test', authCacheTtlMs: 0 });
  t.after(() => { Object.assign(config, originalConfig); clearAuthResultCacheForTests(); });
  t.mock.method(authOps, 'getUserForToken', async (token: string) => ({ data: { user: { id: adminId, email: token } }, error: null }));
  t.mock.method(authOps, 'resolveUserAccess', async (_id: string, email: string | undefined) => ({ isAdmin: email === 'admin' }));
  const app = express();
  app.use(express.json());
  app.use('/api/admin/marketing', marketingRouter);
  const server = app.listen(0);
  t.after(() => { server.close(); server.closeAllConnections(); });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/api/admin/marketing`;
  const api = (path = '', method = 'GET', body?: unknown, role = 'admin') => fetch(`${endpoint}${path}`, {
    method, headers: { ...(role ? { Authorization: `Bearer ${role}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const calls: string[] = [];
  let losePublishResponse = false;
  let invalidAiId = false;
  let makeStoryPrivate = false;
  let metricsMissing = false;
  let codeShape: 'current' | 'legacy' = 'current';
  let aiCalls = 0;
  let aiPrompt = '';
  let selectedId = '';
  let insightsGate: Promise<void> | undefined;
  let insightStarted: (() => void) | undefined;
  let exchangeGate: Promise<void> | undefined;
  let exchangeStarted: (() => void) | undefined;
  let failExchange = false;
  t.mock.method(instagramOps, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/oauth/access_token') {
      exchangeStarted?.();
      await exchangeGate;
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get('client_id'), '123');
      assert.equal(params.get('client_secret'), 'test-app-secret');
      assert.equal(params.get('redirect_uri'), 'https://stories.test/admin/marketing');
      if (failExchange) return json({ error: { code: 100, error_subcode: 36008, fbtrace_id: 'meta-trace-123',
        message: 'Invalid client_secret test-app-secret access_token=long-secret code=private-code https://example.test/?secret=test-server-key' } }, 400);
      const token = { access_token: 'short-secret', permissions: INSTAGRAM_SCOPES.join(',') };
      return json(codeShape === 'current' ? { data: [token] } : token);
    }
    if (url.pathname === '/access_token' || url.pathname === '/refresh_access_token') return json({ access_token: 'long-secret', expires_in: 60 * 86400 });
    if (url.pathname.endsWith('/me')) return json({ user_id: '1001', username: 'story_account', account_type: 'BUSINESS' });
    if (url.pathname.endsWith('/media')) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('media_type'), 'STORIES');
      assert.match(body.get('image_url')!, /\/marketing\/.+\.jpg$/);
      return json({ id: '5001' });
    }
    if (url.pathname.endsWith('/5001')) {
      if (makeStoryPrivate) await db.query('UPDATE stories SET is_public = false WHERE id = $1', [selectedId]);
      return json({ status_code: 'FINISHED' });
    }
    if (url.pathname.endsWith('/media_publish')) {
      const state = (await db.query<{ status: string; container_id: string }>('SELECT status, container_id FROM instagram_marketing_posts WHERE post_date = (now() AT TIME ZONE \'UTC\')::date')).rows[0];
      assert.equal(state.status, 'publishing');
      assert.equal(state.container_id, '5001');
      if (losePublishResponse) throw new Error('Network lost with secret long-secret');
      return json({ id: '6001' });
    }
    if (url.pathname.endsWith('/insights')) {
      insightStarted?.();
      await insightsGate;
      return json({ data: metricsMissing ? [] : [
        { name: 'reach', values: [{ value: 120 }] }, { name: 'views', values: [{ value: 180 }] },
      ] });
    }
    throw new Error(`Unexpected Instagram endpoint ${url.pathname}`);
  });
  t.mock.method(marketingOps, 'ai', () => new OpenAI({ apiKey: 'local', baseURL: 'https://ai.test', fetch: async (_input, init) => {
    aiCalls++;
    const body = JSON.parse(String(init?.body));
    aiPrompt = body.messages[1].content;
    const prompt = JSON.parse(aiPrompt);
    assert.ok(prompt.candidates.length <= 20);
    assert.ok(prompt.recentPosts.length <= 14);
    assert.ok(prompt.candidates.every((s: { title: string; excerpt: string }) => s.title.length <= 160 && s.excerpt.length <= 300));
    assert.ok(aiPrompt.length < 20_000);
    assert.ok(!aiPrompt.includes('PRIVATE PROMPT'));
    assert.ok(!aiPrompt.includes('Private story'));
    selectedId = prompt.candidates[0].id;
    return json({ id: 'completion-1', choices: [{ message: { role: 'assistant', content: JSON.stringify({
      storyId: invalidAiId ? storyId(99) : selectedId, reason: 'The forest theme had more views. Try a new story with this theme.',
    }) }, finish_reason: 'stop' }] });
  } }));
  const resetToday = () => db.query('DELETE FROM instagram_marketing_posts WHERE post_date = (now() AT TIME ZONE \'UTC\')::date');

  await t.test('admin routes and one-time OAuth state protect the connection and token', async () => {
    for (const [path, method] of [['', 'GET'], ['', 'PATCH'], ['/setup', 'PUT'], ['/connect', 'POST'], ['/callback', 'POST'], ['/disconnect', 'POST'], ['/run', 'POST']]) {
      assert.equal((await api(path, method, undefined, '')).status, 401);
      assert.equal((await api(path, method, undefined, 'member')).status, 403);
    }
    assert.equal((await api('', 'PATCH', { enabled: true, hourUtc: 24 })).status, 400);
    assert.equal((await body(await api())).configured, false);
    assert.equal((await api('/setup', 'PUT', { appId: '123', appSecret: 'test-app-secret', websiteUrl: 'http://private.test' })).status, 400);
    const setup = await api('/setup', 'PUT', { appId: '123', appSecret: 'test-app-secret', websiteUrl: 'https://stories.test' });
    assert.equal(setup.status, 200);
    const setupBody = await body(setup);
    assert.equal(setupBody.configured, true);
    assert.deepEqual(setupBody.setup, { appId: '123', hasAppSecret: true, websiteUrl: 'https://stories.test', redirectUri: 'https://stories.test/admin/marketing' });
    assert.ok(!JSON.stringify(setupBody).includes('test-app-secret'));
    assert.notEqual((await db.query<{ app_secret: string }>('SELECT app_secret FROM instagram_marketing')).rows[0].app_secret, 'test-app-secret');
    const connect = await body<{ url: string }>(await api('/connect', 'POST'));
    const state = new URL(connect.url).searchParams.get('state');
    assert.ok(state);
    const stored = (await db.query<{ oauth_state: string }>('SELECT oauth_state FROM instagram_marketing')).rows[0];
    assert.notEqual(stored.oauth_state, state);
    assert.equal((await api('/callback', 'POST', { state: 'a'.repeat(64), code: 'code' })).status, 400);
    assert.equal(calls.length, 0);
    const response = await api('/callback', 'POST', { state, code: 'code' });
    assert.equal(response.status, 200);
    const overview = await body(response);
    assert.equal(overview.connected, true);
    assert.equal(overview.enabled, false);
    assert.ok(!JSON.stringify(overview).includes('long-secret'));
    assert.notEqual((await db.query<{ access_token: string }>('SELECT access_token FROM instagram_marketing')).rows[0].access_token, 'long-secret');
    const callCount = calls.length;
    assert.equal((await api('/callback', 'POST', { state, code: 'code' })).status, 400);
    assert.equal(calls.length, callCount);
    const expired = new URL((await body<{ url: string }>(await api('/connect', 'POST'))).url).searchParams.get('state');
    await db.exec("UPDATE instagram_marketing SET oauth_expires_at = now() - interval '1 second'");
    assert.equal((await api('/callback', 'POST', { state: expired, code: 'code' })).status, 400);
    assert.equal(calls.length, callCount);
  });

  await t.test('SQL denies browser access and allows one claim per day with bounded public candidates', async () => {
    for (const table of ['instagram_marketing', 'instagram_marketing_posts', 'instagram_marketing_logs']) {
      const result = await db.query(`SELECT has_table_privilege('anon', '${table}', 'SELECT') AS anon,
        has_table_privilege('authenticated', '${table}', 'UPDATE') AS member,
        has_table_privilege('service_role', '${table}', 'SELECT') AS service`);
      assert.deepEqual(result.rows, [{ anon: false, member: false, service: true }]);
      assert.equal((await db.query<{ relrowsecurity: boolean }>('SELECT relrowsecurity FROM pg_class WHERE relname = $1', [table])).rows[0].relrowsecurity, true);
    }
    for (const signature of ['claim_instagram_post(boolean)', 'instagram_story_candidates(text)']) {
      assert.equal((await db.query<{ allowed: boolean }>('SELECT has_function_privilege(\'authenticated\', $1, \'execute\') AS allowed', [signature])).rows[0].allowed, false);
    }
    const candidates = (await db.query<{ id: string; excerpt: string }>("SELECT * FROM instagram_story_candidates('1001')")).rows;
    assert.equal(candidates.length, 20);
    assert.ok(candidates.every(s => ![43, 44, 45].map(storyId).includes(s.id) && s.excerpt.length <= 300));
    assert.ok(candidates.some(s => s.id === storyId(1)) && candidates.some(s => s.id === storyId(42)));
    assert.equal((await db.query('SELECT * FROM claim_instagram_post(false)')).rows.length, 0);
    const [first, second] = await Promise.all([db.query('SELECT * FROM claim_instagram_post(true)'), db.query('SELECT * FROM claim_instagram_post(true)')]);
    assert.equal(first.rows.length + second.rows.length, 1);
    await db.exec("UPDATE instagram_marketing_posts SET status = 'failed', updated_at = now() - interval '16 minutes'");
    assert.equal((await db.query('SELECT * FROM claim_instagram_post(true)')).rows.length, 1);
    await db.exec("UPDATE instagram_marketing_posts SET status = 'uncertain', updated_at = now() - interval '16 minutes'");
    assert.equal((await db.query('SELECT * FROM claim_instagram_post(true)')).rows.length, 0);
    await resetToday();
  });

  await t.test('real recommendation and JPEG publish once; results feed the next choice', async () => {
    await runInstagramMarketing();
    assert.equal(aiCalls, 0, 'disabled automation cannot post');
    await db.query(`INSERT INTO instagram_marketing_posts (account_id, post_date, status, story_id, story, media_id, published_at)
      VALUES ('1001', (now() AT TIME ZONE 'UTC')::date - 1, 'published', $1, $2, '5999', now() - interval '20 hours')`,
    [storyId(1), JSON.stringify({ id: storyId(1), title: 'Previous forest story', excerpt: 'A forest story', language: 'en', target_age: 5, art_style: 'storybook' })]);
    assert.equal((await api('/run', 'POST')).status, 200);
    assert.ok(aiPrompt.includes('"reach":120') && aiPrompt.includes('"views":180'));
    assert.ok(!JSON.parse(aiPrompt).candidates.some((s: { id: string }) => s.id === storyId(1)));
    assert.ok(uploaded);
    const image = await sharp(uploaded).metadata();
    assert.deepEqual([image.format, image.width, image.height, image.space], ['jpeg', 1080, 1920, 'srgb']);
    assert.ok(uploaded.length < 8_000_000);
    const result = await body(await api());
    assert.equal(result.posts[0].status, 'published');
    assert.equal(result.posts[0].media_id, '6001');
    assert.equal(result.posts[0].story_id, selectedId);
    await runInstagramMarketing(true);
    assert.equal(aiCalls, 1);
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, 1);
    assert.deepEqual((await body(await api())).posts[0].insights, { reach: 120, views: 180 });
    metricsMissing = true;
    await db.exec("UPDATE instagram_marketing_posts SET insights_at = now() - interval '2 hours'");
    await runInstagramMarketing();
    const missing = (await body(await api())).posts[0];
    assert.deepEqual(missing.insights, { reach: 120, views: 180 });
    assert.ok(missing.insights_error);
    metricsMissing = false;
  });

  await t.test('AI cannot choose an unknown story; a story made private is not published', async () => {
    await resetToday();
    invalidAiId = true;
    const publishes = calls.filter(path => path.endsWith('/media_publish')).length;
    assert.equal((await api('/run', 'POST')).status, 502);
    assert.equal((await body(await api())).posts[0].status, 'failed');
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, publishes);
    invalidAiId = false;
    await resetToday();
    makeStoryPrivate = true;
    assert.equal((await api('/run', 'POST')).status, 502);
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, publishes);
    assert.match((await body(await api())).posts[0].error!, /no longer public/);
    await db.query('UPDATE stories SET is_public = true WHERE id = $1', [selectedId]);
    makeStoryPrivate = false;
    const oldImage = imagePaths.at(-1);
    await db.exec("UPDATE instagram_marketing_posts SET updated_at = now() - interval '16 minutes' WHERE post_date = (now() AT TIME ZONE 'UTC')::date");
    assert.equal((await api('/run', 'POST')).status, 200);
    assert.notEqual(imagePaths.at(-1), oldImage, 'retry image paths must bypass old CDN entries');
    assert.ok(imagePaths.at(-1)?.endsWith('-2.jpg'));
  });

  await t.test('a manual run reports a conflict while an automatic run is active', async () => {
    await db.exec("UPDATE instagram_marketing_posts SET insights_at = now() - interval '2 hours'");
    let release!: () => void;
    insightsGate = new Promise(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { insightStarted = resolve; });
    const background = runInstagramMarketing();
    await started;
    try {
      const response = await api('/run', 'POST');
      assert.equal(response.status, 409);
      assert.match((await body<{ error: string }>(response)).error, /in progress/);
    } finally {
      release();
      await background;
      insightsGate = undefined;
      insightStarted = undefined;
    }
  });

  await t.test('a lost publish response preserves the container and cannot publish twice', async () => {
    await resetToday();
    losePublishResponse = true;
    assert.equal((await api('/run', 'POST')).status, 502);
    const result = await body(await api());
    assert.equal(result.posts[0].status, 'uncertain');
    assert.equal(result.posts[0].container_id, '5001');
    assert.ok(!JSON.stringify(result).includes('long-secret'));
    const count = calls.filter(path => path.endsWith('/media_publish')).length;
    await runInstagramMarketing(true);
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, count);
    losePublishResponse = false;
    await db.exec("UPDATE instagram_marketing_posts SET status = 'publishing', updated_at = now() - interval '16 minutes' WHERE post_date = (now() AT TIME ZONE 'UTC')::date");
    await runInstagramMarketing();
    assert.equal((await body(await api())).posts[0].status, 'uncertain');
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, count);
  });

  await t.test('refresh, disconnect, legacy OAuth response, and expired access', async () => {
    await db.exec("UPDATE instagram_marketing SET token_expires_at = now() + interval '2 days'");
    await runInstagramMarketing();
    assert.ok(calls.includes('/refresh_access_token'));
    assert.equal((await api('/disconnect', 'POST')).status, 200);
    assert.equal((await body(await api())).connected, false);
    assert.equal((await api('', 'PATCH', { enabled: true, hourUtc: 9 })).status, 400);
    assert.equal((await api('/run', 'POST')).status, 502);
    codeShape = 'legacy';
    const state = new URL((await body<{ url: string }>(await api('/connect', 'POST'))).url).searchParams.get('state');
    assert.equal((await api('/callback', 'POST', { state, code: 'legacy-code' })).status, 200);
    assert.equal((await api('', 'PATCH', { enabled: true, hourUtc: 0 })).status, 200);
    await resetToday();
    const publishedBefore = calls.filter(path => path.endsWith('/media_publish')).length;
    await runInstagramMarketing();
    assert.equal(calls.filter(path => path.endsWith('/media_publish')).length, publishedBefore + 1);
    assert.equal((await body(await api())).posts[0].status, 'published');
    await db.exec("UPDATE instagram_marketing SET token_expires_at = now() - interval '1 second'");
    assert.equal((await api('/run', 'POST')).status, 502);
    assert.equal((await db.query('SELECT * FROM claim_instagram_post(true)')).rows.length, 0);
  });

  await t.test('disconnect cancels a callback that is still waiting for Instagram', async () => {
    const state = new URL((await body<{ url: string }>(await api('/connect', 'POST'))).url).searchParams.get('state');
    let release!: () => void;
    exchangeGate = new Promise(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { exchangeStarted = resolve; });
    const callback = api('/callback', 'POST', { state, code: 'slow-code' });
    await started;
    assert.equal((await api('/disconnect', 'POST')).status, 200);
    release();
    assert.equal((await callback).status, 400);
    assert.equal((await body(await api())).connected, false);
    assert.equal((await db.query<{ access_token: string | null }>('SELECT access_token FROM instagram_marketing')).rows[0].access_token, null);
    exchangeGate = undefined;
    exchangeStarted = undefined;
  });

  await t.test('setup failures and provider codes remain visible after reload without credentials', async () => {
    failExchange = true;
    const state = new URL((await body<{ url: string }>(await api('/connect', 'POST'))).url).searchParams.get('state');
    const response = await api('/callback', 'POST', { state, code: 'private-code' });
    assert.equal(response.status, 502);
    const failure = await body<{ error: string; diagnostic: { stage: string; providerCode: string; providerTraceId: string; runId: string; logId: string } }>(response);
    assert.equal(failure.diagnostic.stage, 'Exchange authorization code');
    assert.equal(failure.diagnostic.providerCode, '100/36008');
    assert.equal(failure.diagnostic.providerTraceId, 'meta-trace-123');
    assert.match(failure.error, /Save the correct secret/);
    const reloaded = await body(await api());
    const saved = reloaded.logs.find(log => log.id === failure.diagnostic.logId);
    assert.ok(saved);
    assert.equal(saved.stage, 'Exchange authorization code');
    assert.equal(saved.status, 'failed');
    assert.ok(serverLogs.some(log => log.includes(failure.diagnostic.logId)));
    for (const secret of ['test-app-secret', 'long-secret', 'short-secret', 'private-code', 'test-server-key']) {
      assert.ok(!JSON.stringify(reloaded).includes(secret));
      assert.ok(!serverLogs.join('\n').includes(secret));
      assert.ok(!JSON.stringify(failure).includes(secret));
    }
    assert.ok(!serverLogs.some(log => log.includes('Cannot save the activity log')));
    failExchange = false;
    assert.equal((await api('/setup', 'PUT', { appId: '123', websiteUrl: 'https://stories.test' })).status, 200, 'saved secret can be retained');
    assert.equal((await api('/setup', 'PUT', { appId: '456', websiteUrl: 'https://stories.test' })).status, 400, 'new app ID requires its own secret');
  });

  await t.test('admin setup and OAuth callbacks cannot send credentials to marketing pixels or attribution storage', async () => {
    const runtime = globalThis as typeof globalThis & { window?: unknown; document?: unknown };
    const originalWindow = runtime.window;
    const originalDocument = runtime.document;
    const events: unknown[] = [];
    runtime.window = { location: { pathname: '/admin/marketing', search: '?code=private-code&state=private-state', href: 'https://stories.test/admin/marketing?code=private-code' },
      localStorage: { getItem: () => JSON.stringify({ marketing: true }), setItem: (...values: unknown[]) => events.push(values) },
      dataLayer: events, gtag: (...values: unknown[]) => events.push(values), fbq: (...values: unknown[]) => events.push(values), ttq: { page: () => events.push('tiktok') } };
    runtime.document = { title: 'Marketing', getElementById: () => null, createElement: () => { events.push('script'); return {}; }, head: { appendChild: () => events.push('load') } };
    try {
      const tracking = await import(new URL('../../src/lib/marketing.ts', import.meta.url).href);
      tracking.captureMarketingAttribution();
      tracking.loadMarketingPixels();
      tracking.trackPageView();
      assert.deepEqual(events, []);
      const location = (runtime.window as { location: Record<string, string> }).location;
      location.pathname = '/login';
      location.search = '?returnTo=' + encodeURIComponent('/admin/marketing?code=private-code&state=private-state');
      location.href = 'https://stories.test/login' + location.search;
      tracking.captureMarketingAttribution();
      tracking.loadMarketingPixels();
      tracking.trackPageView();
      assert.deepEqual(events, [], 'an expired admin session must not expose the callback through the login URL');
    } finally {
      if (originalWindow === undefined) delete runtime.window; else runtime.window = originalWindow;
      if (originalDocument === undefined) delete runtime.document; else runtime.document = originalDocument;
    }
  });
});
