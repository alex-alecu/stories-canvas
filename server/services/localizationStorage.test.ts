import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';
import type { StoryLocalization } from '../../shared/storyLocalization.js';
import { loadStoryLocalization, saveStoryLocalization } from './localizationStorage.js';

function localization(): StoryLocalization {
  return { language: 'ro', sourceHash: 'a'.repeat(64), title: 'Un prieten',
    pages: [{ pageNumber: 1, text: 'Pip are un prieten.', audioUrl: '/ro-1.mp3', audioRevision: 2 }],
    voice: 'mom', audioModel: 'tts', audioVoice: 'Kore' };
}

test('file storage saves complete language records without changing another language', async t => {
  const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'story-localizations-'));
  Object.assign(config, { dataDir: directory, useSupabase: false });
  t.after(async () => { Object.assign(config, previous); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(await loadStoryLocalization('story-1', 'ro'), null);
  await saveStoryLocalization('story-1', localization());
  await saveStoryLocalization('story-1', { ...localization(), language: 'de', title: 'Ein Freund' });
  await saveStoryLocalization('story-1', { ...localization(), title: 'Un prieten nou' });
  assert.deepEqual(await loadStoryLocalization('story-1', 'ro'), { ...localization(), title: 'Un prieten nou' });
  assert.equal((await loadStoryLocalization('story-1', 'de'))?.title, 'Ein Freund');
  assert.deepEqual((await fs.readdir(path.join(directory, 'story-1'))).sort(), ['localizations-de.json', 'localizations-ro.json']);
});

test('file storage rejects path traversal and corrupt language records', async t => {
  const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'story-localizations-safe-'));
  Object.assign(config, { dataDir: directory, useSupabase: false });
  t.after(async () => { Object.assign(config, previous); await fs.rm(directory, { recursive: true, force: true }); });
  for (const id of ['../outside', '/tmp/outside', '..', '', 'story/1']) {
    await assert.rejects(loadStoryLocalization(id, 'ro'), /story id/i);
    await assert.rejects(saveStoryLocalization(id, localization()), /story id/i);
  }
  for (const language of ['../en', 'en/../../', 'xx', 'RO']) {
    await assert.rejects(loadStoryLocalization('story-1', language), /language/i);
    await assert.rejects(saveStoryLocalization('story-1', { ...localization(), language }), /language/i);
  }
  await fs.mkdir(path.join(directory, 'story-1'));
  await fs.writeFile(path.join(directory, 'story-1', 'localizations-ro.json'), JSON.stringify({ ...localization(), language: 'de' }));
  await assert.rejects(loadStoryLocalization('story-1', 'ro'), /language/i);
  await fs.writeFile(path.join(directory, 'story-1', 'localizations-ro.json'), JSON.stringify({ ...localization(), pages: [{ text: null }] }));
  await assert.rejects(loadStoryLocalization('story-1', 'ro'));
});

test('database storage reads and upserts one complete localization with the composite key', async t => {
  const previous = config.useSupabase; Object.assign(config, { useSupabase: true });
  t.after(() => { Object.assign(config, { useSupabase: previous }); });
  let row: Record<string, unknown> | null = null;
  const client = createClient('https://localizations.example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/rest/v1/story_localizations');
      if (init?.method === 'POST') {
        assert.equal(url.searchParams.get('on_conflict'), 'story_id,language');
        row = JSON.parse(String(init.body));
        assert.deepEqual(row, { story_id: 'story-1', language: 'ro', source_hash: 'a'.repeat(64), title: 'Un prieten',
          pages: [{ pageNumber: 1, text: 'Pip are un prieten.', audioUrl: '/ro-1.mp3', audioRevision: 2 }],
          voice: 'mom', audio_model: 'tts', audio_voice: 'Kore' });
        return new Response(null, { status: 201 });
      }
      assert.equal(url.searchParams.get('story_id'), 'eq.story-1');
      assert.equal(url.searchParams.get('language'), 'eq.ro');
      return new Response(JSON.stringify(row ? [row] : []), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  assert.equal(await loadStoryLocalization('story-1', 'ro', client), null);
  await saveStoryLocalization('story-1', localization(), client);
  assert.deepEqual(await loadStoryLocalization('story-1', 'ro', client), localization());
});

test('database failures propagate without returning a missing translation', async t => {
  const previous = config.useSupabase; Object.assign(config, { useSupabase: true });
  t.after(() => { Object.assign(config, { useSupabase: previous }); });
  const client = createClient('https://localizations.example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => new Response(
      JSON.stringify({ message: 'permission denied', code: '42501' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) },
  });
  await assert.rejects(loadStoryLocalization('story-1', 'ro', client), /permission denied/);
  await assert.rejects(saveStoryLocalization('story-1', localization(), client), /permission denied/);
});

test('localization migration preserves usage operations and restricts table access to the server', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
    CREATE TABLE storage.objects (id UUID, bucket_id TEXT);`);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await fs.readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec((await fs.readFile(new URL(name, migrations), 'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  }
  assert.deepEqual((await db.query(`SELECT has_table_privilege('anon', 'public.story_localizations', 'select') AS anon,
    has_table_privilege('authenticated', 'public.story_localizations', 'select') AS authenticated,
    has_table_privilege('service_role', 'public.story_localizations', 'select,insert,update,delete') AS service`)).rows,
  [{ anon: false, authenticated: false, service: true }]);
  assert.deepEqual((await db.query(`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.story_localizations'::regclass`)).rows, [{ enabled: true }]);
  const id = '20000000-0000-4000-8000-000000000001';
  await db.exec(`INSERT INTO stories (id, prompt) VALUES ('${id}', 'A fox');`);
  await db.query(`INSERT INTO story_localizations (story_id, language, source_hash, title, pages)
    VALUES ($1, 'ro', $2, 'Un prieten', '[{"pageNumber":1,"text":"Pip are un prieten."}]')`, [id, 'a'.repeat(64)]);
  await db.query(`INSERT INTO story_localizations (story_id, language, source_hash, title, pages)
    VALUES ($1, 'ro', $2, 'Titlu nou', '[]') ON CONFLICT (story_id, language) DO UPDATE SET title = EXCLUDED.title`, [id, 'a'.repeat(64)]);
  assert.deepEqual((await db.query(`SELECT title FROM story_localizations`)).rows, [{ title: 'Titlu nou' }]);
  await assert.rejects(db.query(`INSERT INTO story_localizations (story_id, language, source_hash, title, pages)
    VALUES ($1, '../en', $2, 'Bad', '[]')`, [id, 'a'.repeat(64)]), /check constraint/);
  const operations = ['source_analysis', 'scenario_draft', 'scenario_validation_repair', 'scenario_review', 'scenario_review_rewrite', 'page_text_review', 'page_image_review', 'character_sheet', 'page_image', 'page_audio', 'story_translation'];
  for (const operation of operations) {
    await db.query(`INSERT INTO story_usage_events (story_id, provider, operation, source, status, model)
      VALUES ($1, 'openrouter', $2, 'add_audio', 'succeeded', 'test')`, [id, operation]);
  }
  assert.equal((await db.query<{ count: number }>(`SELECT count(*)::integer AS count FROM story_usage_events`)).rows[0].count, 11);
  await db.query(`DELETE FROM stories WHERE id = $1`, [id]);
  assert.deepEqual((await db.query(`SELECT * FROM story_localizations`)).rows, []);
});
