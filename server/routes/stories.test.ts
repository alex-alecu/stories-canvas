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

async function createStoriesHarness(dataDir: string) {
  const express = (await import('express')).default;
  const { config } = await import('../config.js');
  const storiesModule = await import('./stories.js');

  Object.assign(config, {
    dataDir,
    useSupabase: false,
    elevenLabsApiKey: undefined,
  });

  const app = express();
  app.use(express.json());
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
