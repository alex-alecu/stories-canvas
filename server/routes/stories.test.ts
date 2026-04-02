import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Page, Scenario, StoryMeta } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeScenario(pages: Page[] = []): Scenario {
  return {
    title: 'Test Story',
    targetAge: 3,
    characters: [],
    pages,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    pageNumber: 1,
    text: 'A calm dragon watches the moon.',
    imagePrompt: 'Moonlit dragon scene',
    characters: [],
    status: 'completed',
    ...overrides,
  };
}

function makeStoryMeta(overrides: Partial<StoryMeta> = {}): StoryMeta {
  return {
    id: 'story-test',
    prompt: 'A calm bedtime story.',
    status: 'generating_images',
    createdAt: '2026-03-29T00:00:00.000Z',
    scenario: makeScenario([makePage()]),
    ...overrides,
  };
}

async function createStoriesHarness(dataDir: string, configOverrides: Record<string, unknown> = {}) {
  const express = (await import('express')).default;
  const { config } = await import('../config.js');
  const storiesModule = await import('./stories.js');
  const authUser = configOverrides.__testAuthUser as { id: string; email?: string } | undefined;

  if ('__testAuthUser' in configOverrides) {
    delete configOverrides.__testAuthUser;
  }

  Object.assign(config, {
    dataDir,
    useSupabase: false,
    elevenLabsApiKey: undefined,
    ...configOverrides,
  });

  const app = express();
  app.use(express.json());
  if (authUser) {
    app.use((req, _res, next) => {
      req.authUser = authUser;
      next();
    });
  }
  app.use('/api/stories', storiesModule.default);

  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  return {
    storiesModule,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (predicate(value)) return value;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return fn();
}

async function writeStoryMeta(dataDir: string, story: StoryMeta & { voice?: string }) {
  const storyDir = path.join(dataDir, story.id);
  await fs.mkdir(storyDir, { recursive: true });
  await fs.writeFile(path.join(storyDir, 'scenario.json'), JSON.stringify(story, null, 2));
}

async function readStoryMeta(dataDir: string, storyId: string): Promise<StoryMeta & { voice?: string }> {
  const raw = await fs.readFile(path.join(dataDir, storyId, 'scenario.json'), 'utf-8');
  return JSON.parse(raw) as StoryMeta & { voice?: string };
}

test('POST /api/stories stores canonical narrator keys unchanged', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-create-canonical-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenario', async () => makeScenario());
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async () => []);
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async () => {});
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => false);

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tell a moonlit story about a dragon.',
      voice: 'corina',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { id: string };
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, body.id),
    story => story.voice === 'corina',
  );

  assert.equal(savedStory.voice, 'corina');
});

test('POST /api/stories normalizes legacy narrator keys before persistence', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-create-legacy-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenario', async () => makeScenario());
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async () => []);
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async () => {});
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => false);

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tell a gentle bedtime story.',
      voice: 'whisper',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { id: string };
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, body.id),
    story => story.voice === 'jora',
  );

  assert.equal(savedStory.voice, 'jora');
});

test('POST /api/stories/:id/generate-audio accepts canonical narrator keys', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-canonical-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'retryMissingAudio', async () => ({
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }));

  await writeStoryMeta(dataDir, {
    id: 'story-audio-canonical',
    prompt: 'A story ready for narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    scenario: makeScenario(),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-canonical/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'serban' }),
  });

  assert.equal(response.status, 200);
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-audio-canonical'),
    story => story.voice === 'serban',
  );

  assert.equal(savedStory.voice, 'serban');
});

test('POST /api/stories/:id/generate-audio normalizes legacy narrator keys', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-legacy-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'retryMissingAudio', async () => ({
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }));

  await writeStoryMeta(dataDir, {
    id: 'story-audio-legacy',
    prompt: 'A story ready for narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    scenario: makeScenario(),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-legacy/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'dad' }),
  });

  assert.equal(response.status, 200);
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-audio-legacy'),
    story => story.voice === 'serban',
  );

  assert.equal(savedStory.voice, 'serban');
});

test('POST /api/stories/:id/retry resolves stored legacy voice keys for missing audio', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-retry-legacy-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let resolvedVoice: string | undefined;
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'retryMissingAudio', async (_storyId, _pages, voiceKey) => {
    resolvedVoice = voiceKey;
    return {
      completedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    };
  });

  await writeStoryMeta(dataDir, {
    id: 'story-retry-legacy',
    prompt: 'A story with missing narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    voice: 'whisper',
    scenario: makeScenario([makePage()]),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-retry-legacy/retry`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  await waitFor(
    async () => resolvedVoice,
    value => value === 'jora',
  );

  assert.equal(resolvedVoice, 'jora');
});

test('POST /api/stories/:id/review-script keeps revisions unchanged when no rewrite is needed', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-noop-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'reviewScenario', async (_prompt, _language, _age, _style, scenario) => ({
    scenario,
    rewritten: false,
    review: {
      needsRewrite: false,
      summary: 'No changes needed.',
      changedPageNumbers: [],
      issues: [],
    },
  }));

  await writeStoryMeta(dataDir, {
    id: 'story-review-noop',
    prompt: 'A story ready for review.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    language: 'en',
    artStyle: 'storybook',
    scenarioRevision: 1,
    renderedScenarioRevision: 1,
    scenario: makeScenario([makePage()]),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-noop/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'reviewing_scenario',
    rewritten: false,
    assetsStale: false,
  });

  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-review-noop'),
    story => story.status === 'completed',
  );

  assert.equal(savedStory.scenarioRevision, 1);
  assert.equal(savedStory.renderedScenarioRevision, 1);
});

test('POST /api/stories/:id/review-script increments the scenario revision when the script is rewritten', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-rewrite-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'reviewScenario', async () => ({
    scenario: makeScenario([{ ...makePage(), status: 'pending', text: 'A brighter revised opening.' }]),
    rewritten: true,
    review: {
      needsRewrite: true,
      summary: 'The opening page needs a stronger setup.',
      changedPageNumbers: [1],
      issues: [{ code: 'story_arc', summary: 'The opening page needs a stronger setup.', pageNumbers: [1] }],
    },
  }));

  await writeStoryMeta(dataDir, {
    id: 'story-review-rewrite',
    prompt: 'A story ready for review.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    language: 'en',
    artStyle: 'storybook',
    scenarioRevision: 1,
    renderedScenarioRevision: 1,
    scenario: makeScenario([makePage()]),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-rewrite/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);

  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-review-rewrite'),
    story => story.scenarioRevision === 2,
  );

  assert.equal(savedStory.status, 'completed');
  assert.equal(savedStory.scenarioRevision, 2);
  assert.equal(savedStory.renderedScenarioRevision, 1);
  assert.equal(savedStory.scenario?.pages[0]?.status, 'completed');
});

test('POST /api/stories/:id/review-script persists reviewing_scenario before the background review finishes', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-progress-'));
  const harness = await createStoriesHarness(dataDir);
  let releaseReview: (() => void) | null = null;
  const reviewFinished = new Promise<void>(resolve => {
    releaseReview = resolve;
  });

  t.after(async () => {
    releaseReview?.();
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'reviewScenario', async (_prompt, _language, _age, _style, scenario) => {
    await reviewFinished;
    return {
      scenario,
      rewritten: false,
      review: {
        needsRewrite: false,
        summary: 'No changes needed.',
        changedPageNumbers: [],
        issues: [],
      },
    };
  });

  await writeStoryMeta(dataDir, {
    id: 'story-review-progress',
    prompt: 'A story ready for review.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    language: 'en',
    artStyle: 'storybook',
    scenarioRevision: 1,
    renderedScenarioRevision: 1,
    scenario: makeScenario([makePage()]),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-progress/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);

  const inProgressStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-review-progress'),
    story => story.status === 'reviewing_scenario',
  );

  assert.equal(inProgressStory.status, 'reviewing_scenario');

  releaseReview?.();

  const completedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-review-progress'),
    story => story.status === 'completed',
  );

  assert.equal(completedStory.status, 'completed');
});

test('POST /api/stories/:id/review-script requires auth when Supabase is enabled', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-auth-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-auth/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
});

test('POST /api/stories/:id/review-script rejects non-owners when Supabase is enabled', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-owner-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'someone-else', email: 'user@example.com' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-review-owner',
    status: 'completed',
    userId: 'story-owner',
    isPublic: false,
  }));

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-owner/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Forbidden' });
});

test('POST /api/stories/:id/regenerate-assets syncs renderedScenarioRevision to the latest scenario revision', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-regenerate-assets-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async () => new Map());
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async (_storyId, pages, _characters, _sheets, _style, onProgress) => {
    for (const page of pages) {
      page.status = 'completed';
      onProgress?.({ pageNumber: page.pageNumber, pageStatus: 'completed', message: `Page ${page.pageNumber} complete` });
    }
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => false);

  await writeStoryMeta(dataDir, {
    id: 'story-regenerate-assets',
    prompt: 'A story ready for regeneration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    language: 'en',
    artStyle: 'storybook',
    scenarioRevision: 2,
    renderedScenarioRevision: 1,
    scenario: makeScenario([makePage()]),
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-regenerate-assets/regenerate-assets`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'generating_characters' });

  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, 'story-regenerate-assets'),
    story => story.renderedScenarioRevision === 2,
  );

  assert.equal(savedStory.status, 'completed');
  assert.equal(savedStory.scenarioRevision, 2);
  assert.equal(savedStory.renderedScenarioRevision, 2);
});

test('POST /api/stories/:id/regenerate-assets requires auth when Supabase is enabled', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-regenerate-auth-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-regenerate-auth/regenerate-assets`, {
    method: 'POST',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
});

test('GET /api/stories/:id/status returns 404 when the story does not exist', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-status-missing-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/missing-story/status`, {
    headers: {
      Accept: 'text/event-stream',
    },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Story not found' });
});

test('GET /api/stories/active/generations returns Supabase story ids', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-active-generations-ok-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getActiveGenerations', async () => [
    makeStoryMeta({ id: 'story-1' }),
    makeStoryMeta({ id: 'story-2', status: 'generating_audio' }),
  ]);

  const response = await fetch(`${harness.baseUrl}/api/stories/active/generations`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ['story-1', 'story-2']);
});

test('GET /api/stories/active/generations returns 503 for transient Supabase outages', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-active-generations-transient-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });
  const supabaseStorage = await import('../services/supabaseStorage.js');

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getActiveGenerations', async () => {
    throw new supabaseStorage.TransientDependencyError(
      'Supabase',
      'active generation lookup',
      'upstream returned an HTML bad gateway response',
      { status: 502 },
    );
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/active/generations`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Story generation status is temporarily unavailable. Please retry shortly.',
  });
});

test('GET /api/stories/active/generations returns 500 for non-transient errors', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-active-generations-error-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getActiveGenerations', async () => {
    throw new Error('database permissions misconfigured');
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/active/generations`);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to get active generations' });
});
