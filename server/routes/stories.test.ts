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
  const generationRegistry = await import('../services/generationRegistry.js');
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
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      generationRegistry.abortAllTrackedGenerations();
      await waitFor(
        async () => generationRegistry.listTrackedGenerationIds(),
        activeGenerationIds => activeGenerationIds.length === 0,
      ).catch(() => {});
    },
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

async function writeStoryMeta(dataDir: string, story: Omit<StoryMeta, 'voice'> & { voice?: string }) {
  const storyDir = path.join(dataDir, story.id);
  await fs.mkdir(storyDir, { recursive: true });
  await fs.writeFile(path.join(storyDir, 'scenario.json'), JSON.stringify(story, null, 2));
}

async function readStoryMeta(dataDir: string, storyId: string): Promise<Omit<StoryMeta, 'voice'> & { voice?: string }> {
  const raw = await fs.readFile(path.join(dataDir, storyId, 'scenario.json'), 'utf-8');
  return JSON.parse(raw) as StoryMeta & { voice?: string };
}

async function readUsageEvents(dataDir: string, storyId: string) {
  const raw = await fs.readFile(path.join(dataDir, storyId, 'usage-events.json'), 'utf-8');
  return JSON.parse(raw) as Array<{ operation: string; source: string; status: string; costUsdMicros: number }>;
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
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generateAllPageAudio', async () => ({
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }));

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tell a moonlit story about a dragon.',
      storyMode: 'pro_audio',
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
  assert.equal(savedStory.storyMode, 'pro_audio');
  assert.equal(savedStory.creditCost, 3);
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
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generateAllPageAudio', async () => ({
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }));

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tell a gentle bedtime story.',
      storyMode: 'pro_audio',
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
  assert.equal(savedStory.storyMode, 'pro_audio');
  assert.equal(savedStory.creditCost, 3);
});

test('POST /api/stories stores fixed story mode credit costs', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-mode-costs-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenario', async () => makeScenario());
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async () => []);
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async () => {});
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generateAllPageAudio', async () => ({
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }));

  const cases = [
    { storyMode: 'fast', creditCost: 1, voice: undefined },
    { storyMode: 'pro', creditCost: 2, voice: undefined },
    { storyMode: 'pro_audio', creditCost: 3, voice: 'bunica' },
  ] as const;

  for (const scenarioCase of cases) {
    const response = await fetch(`${harness.baseUrl}/api/stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `Create a ${scenarioCase.storyMode} bedtime story.`,
        storyMode: scenarioCase.storyMode,
        voice: scenarioCase.voice,
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json() as { id: string };
    const savedStory = await waitFor(
      () => readStoryMeta(dataDir, body.id),
      story => story.storyMode === scenarioCase.storyMode,
    );

    assert.equal(savedStory.storyMode, scenarioCase.storyMode);
    assert.equal(savedStory.creditCost, scenarioCase.creditCost);
    assert.equal(savedStory.voice, scenarioCase.voice);
  }
});

test('POST /api/stories persists generation inputs and usage totals for filesystem stories', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-usage-tracking-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const scenario = makeScenario([
    makePage({
      status: 'pending',
      text: 'A dragon falls asleep under the moon.',
    }),
  ]);

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenario', async (
    _prompt: string,
    _language: string | undefined,
    _age: number | undefined,
    _style: string | undefined,
    _onProgress?: unknown,
    usageCallbacks?: {
      onDraftUsage?: (usage: {
        model: string;
        status: 'succeeded' | 'failed';
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        usageDetails: Record<string, unknown>;
      }) => void | Promise<void>;
    },
  ) => {
    await usageCallbacks?.onDraftUsage?.({
      model: 'gemini-3.1-pro-preview',
      status: 'succeeded',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      usageDetails: { promptTokenCount: 120, candidatesTokenCount: 80, totalTokenCount: 200 },
    });
    return scenario;
  });

  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async (
    _storyId: string,
    _characters: unknown,
    _userId: unknown,
    _signal: AbortSignal | undefined,
    _styleDescription: string | undefined,
    _pro: boolean | undefined,
    _deps: unknown,
    onUsage?: (_character: unknown, usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      generatedImages: number;
      usageDetails: Record<string, unknown>;
    }) => void | Promise<void>,
  ) => {
    await onUsage?.({}, {
      model: 'gemini-3.1-flash-image-preview',
      status: 'succeeded',
      inputTokens: 10,
      outputTokens: 0,
      totalTokens: 10,
      generatedImages: 1,
      usageDetails: { promptTokenCount: 10, totalTokenCount: 10 },
    });
    return new Map();
  });

  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async (
    _storyId: string,
    pages: Page[],
    _characters: unknown,
    _sheets: unknown,
    _styleDescription: string | undefined,
    onProgress?: (progress: { pageNumber?: number; pageStatus?: 'completed' | 'failed'; message?: string }) => void,
    _userId?: string,
    _signal?: AbortSignal,
    _pro?: boolean,
    onUsage?: (page: Page, usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      generatedImages: number;
      usageDetails: Record<string, unknown>;
    }) => void | Promise<void>,
  ) => {
    const [page] = pages;
    await onUsage?.(page, {
      model: 'gemini-3.1-flash-image-preview',
      status: 'succeeded',
      inputTokens: 12,
      outputTokens: 0,
      totalTokens: 12,
      generatedImages: 1,
      usageDetails: { promptTokenCount: 12, totalTokenCount: 12 },
    });
    page.status = 'completed';
    onProgress?.({ pageNumber: page.pageNumber, pageStatus: 'completed', message: 'Page complete' });
  });

  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generateAllPageAudio', async (
    _storyId: string,
    pages: Page[],
    _voice: string,
    _userId: string | undefined,
    _signal: AbortSignal,
    _onProgress?: unknown,
    onUsage?: (page: Page, usage: {
      model: string;
      status: 'succeeded' | 'failed';
      billedCharacters: number;
      usageDetails: Record<string, unknown>;
    }) => void | Promise<void>,
  ) => {
    const [page] = pages;
    await onUsage?.(page, {
      model: 'eleven_multilingual_v2',
      status: 'succeeded',
      billedCharacters: page.text.length,
      usageDetails: { voiceId: 'voice-123' },
    });
    return {
      completedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    };
  });

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '  Tell a gentle bedtime story about a dragon.  ',
      storyMode: 'pro_audio',
      voice: 'corina',
      age: 5,
      style: 'watercolor',
      language: 'en',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { id: string };
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, body.id),
    story => story.status === 'completed' && (story.usageTotals?.costUsdMicros ?? 0) > 0,
  );

  assert.equal(savedStory.generationInputs?.prompt, 'Tell a gentle bedtime story about a dragon.');
  assert.equal(savedStory.generationInputs?.language, 'en');
  assert.equal(savedStory.generationInputs?.age, 5);
  assert.equal(savedStory.generationInputs?.artStyle, 'watercolor');
  assert.equal(savedStory.generationInputs?.storyMode, 'pro_audio');
  assert.equal(savedStory.generationInputs?.voice, 'corina');
  assert.equal(savedStory.generationInputs?.audioEnabled, true);
  assert.equal(savedStory.generationInputs?.proModel, true);
  assert.equal(savedStory.usageTotals?.inputTokens, 142);
  assert.equal(savedStory.usageTotals?.outputTokens, 80);
  assert.equal(savedStory.usageTotals?.totalTokens, 222);
  assert.ok((savedStory.usageTotals?.textCostUsdMicros ?? 0) > 0);
  assert.ok((savedStory.usageTotals?.imageCostUsdMicros ?? 0) > 0);
  assert.ok((savedStory.usageTotals?.audioCostUsdMicros ?? 0) > 0);

  const usageEvents = await readUsageEvents(dataDir, body.id);
  assert.equal(usageEvents.length, 4);
  assert.deepEqual(usageEvents.map(event => event.operation), [
    'scenario_draft',
    'character_sheet',
    'page_image',
    'page_audio',
  ]);
  assert.ok(usageEvents.every(event => event.source === 'initial_generation'));
  assert.ok(usageEvents.every(event => event.status === 'succeeded'));
});

test('POST /api/stories rejects Pro + Audio when narration is unavailable', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-pro-audio-disabled-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => false);

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Create a narrated bedtime story.',
      storyMode: 'pro_audio',
      voice: 'corina',
    }),
  });

  assert.equal(response.status, 503);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Audio generation service is not configured');
});

test('POST /api/stories/:id/generate-audio charges one credit and starts narration', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-enabled-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-audio', email: 'audio@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let chargedReason: string | undefined;
  let storedVoice: string | undefined;
  let generatedVoice: string | undefined;

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-enabled',
    prompt: 'A story ready for narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    userId: 'user-audio',
    scenario: makeScenario([makePage()]),
  }));
  t.mock.method(harness.storiesModule.storageOps, 'updateStoryVoice', async (_storyId: string, voice: string) => {
    storedVoice = voice;
  });
  t.mock.method(harness.storiesModule.storageOps, 'updateStoryStatus', async () => {});
  t.mock.method(harness.storiesModule.storageOps, 'updateStoryProgress', async () => {});
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async (_userId: string, amount: number, params: { reason: string }) => {
    assert.equal(amount, 1);
    chargedReason = params.reason;
    return { ledger_id: 'ledger-add-audio', available_credits: 4 };
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'retryMissingAudio', async (_storyId: string, _pages: Page[], voiceKey: string) => {
    generatedVoice = voiceKey;
    return {
      completedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    };
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-enabled/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'serban' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; generatedAudio: number; chargedCredits: number; availableCredits: number };
  assert.deepEqual(body, {
    status: 'generating_audio',
    generatedAudio: 1,
    chargedCredits: 1,
    availableCredits: 4,
  });

  await waitFor(async () => generatedVoice, value => value === 'serban');
  assert.equal(chargedReason, 'story_add_audio');
  assert.equal(storedVoice, 'serban');
  assert.equal(generatedVoice, 'serban');
});

test('POST /api/stories/:id/generate-audio returns 402 when credits are insufficient', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-insufficient-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-no-credits', email: 'no-credits@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const { InsufficientCreditsError } = await import('../services/billingStorage.js');
  let storedVoice = false;

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-insufficient',
    prompt: 'A story ready for narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    userId: 'user-no-credits',
    scenario: makeScenario([makePage()]),
  }));
  t.mock.method(harness.storiesModule.storageOps, 'updateStoryVoice', async () => {
    storedVoice = true;
  });
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    throw new InsufficientCreditsError();
  });
  t.mock.method(harness.storiesModule.billingOps, 'getUserCreditBalance', async () => ({ availableCredits: 0 }));
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-insufficient/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'corina' }),
  });

  assert.equal(response.status, 402);
  const body = await response.json() as { error: string; requiredCredits: number; availableCredits: number };
  assert.equal(body.error, 'Not enough credits to add narration');
  assert.equal(body.requiredCredits, 1);
  assert.equal(body.availableCredits, 0);
  assert.equal(storedVoice, false);
});

test('POST /api/stories/:id/generate-audio rejects invalid voices before charging', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-invalid-voice-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-invalid-voice', email: 'invalid-voice@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let charged = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-invalid-voice',
    status: 'completed',
    userId: 'user-invalid-voice',
    scenario: makeScenario([makePage()]),
  }));
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    charged = true;
    return { ledger_id: 'unexpected', available_credits: 0 };
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-invalid-voice/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'unknown' }),
  });

  assert.equal(response.status, 400);
  assert.equal(charged, false);
});

test('POST /api/stories/:id/generate-audio rejects non-owners', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-non-owner-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'viewer-user', email: 'viewer@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-non-owner',
    status: 'completed',
    userId: 'owner-user',
    scenario: makeScenario([makePage()]),
  }));

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-non-owner/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'bunica' }),
  });

  assert.equal(response.status, 403);
});

test('POST /api/stories/:id/generate-audio rejects stories that already have narration', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-already-narrated-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-narrated', email: 'narrated@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let charged = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-already-narrated',
    status: 'completed',
    userId: 'user-narrated',
    scenario: makeScenario([makePage({ audioUrl: '/audio/page-01.mp3' })]),
  }));
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    charged = true;
    return { ledger_id: 'unexpected', available_credits: 0 };
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-already-narrated/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'bunica' }),
  });

  assert.equal(response.status, 400);
  assert.equal(charged, false);
});

test('POST /api/stories/:id/generate-audio rejects active generations before charging', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-active-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-active', email: 'active@example.test' },
  });
  const generationRegistry = await import('../services/generationRegistry.js');
  generationRegistry.startTrackedGeneration('story-audio-active');
  t.after(async () => {
    generationRegistry.finishTrackedGeneration('story-audio-active');
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let charged = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-active',
    status: 'completed',
    userId: 'user-active',
    scenario: makeScenario([makePage()]),
  }));
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    charged = true;
    return { ledger_id: 'unexpected', available_credits: 0 };
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-active/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'bunica' }),
  });

  assert.equal(response.status, 409);
  assert.equal(charged, false);
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
  t.mock.method(harness.storiesModule.audioOps, 'retryMissingAudio', async (_storyId: string, _pages: Page[], voiceKey: string) => {
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

test('POST /api/stories/:id/view increments filesystem view counts', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-view-count-'));
  const harness = await createStoriesHarness(dataDir);

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await writeStoryMeta(dataDir, {
    id: 'story-view-count',
    prompt: 'A story with view tracking.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    scenario: makeScenario([makePage()]),
    viewCount: 2,
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-view-count/view`, {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 'story-view-count',
    viewCount: 3,
  });

  const savedStory = await readStoryMeta(dataDir, 'story-view-count');
  assert.equal(savedStory.viewCount, 3);

  const summariesResponse = await fetch(`${harness.baseUrl}/api/stories`);
  assert.equal(summariesResponse.status, 200);
  const summaries = await summariesResponse.json() as Array<{ id: string; viewCount: number }>;
  assert.equal(summaries.find(story => story.id === 'story-view-count')?.viewCount, 3);
});

test('POST /api/stories/:id/view rejects private non-owner stories without incrementing', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-view-private-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'viewer-user', email: 'viewer@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let incremented = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-private-view',
    status: 'completed',
    userId: 'owner-user',
    isPublic: false,
    viewCount: 7,
  }));
  t.mock.method(harness.storiesModule.storageOps, 'incrementStoryViewCount', async () => {
    incremented = true;
    return 8;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-private-view/view`, {
    method: 'POST',
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Story not found' });
  assert.equal(incremented, false);
});

test('GET /api/stories/mine includes view counts in summaries', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-mine-view-count-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'story-owner', email: 'owner@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'listStoriesByUser', async (userId: string) => {
    assert.equal(userId, 'story-owner');
    return [
      makeStoryMeta({
        id: 'owned-story',
        status: 'completed',
        userId,
        viewCount: 11,
      }),
    ];
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/mine`);

  assert.equal(response.status, 200);
  const stories = await response.json() as Array<{ id: string; viewCount: number }>;
  assert.deepEqual(stories.map(story => ({ id: story.id, viewCount: story.viewCount })), [
    { id: 'owned-story', viewCount: 11 },
  ]);
});

test('GET /api/stories/public forwards the requested limit and returns that many summaries', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-limit-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'listPublicStories', async (_search?: string, limit = 50) => (
    Array.from({ length: limit }, (_, index) => makeStoryMeta({
      id: `public-story-${index + 1}`,
      status: 'completed',
      isPublic: true,
      createdAt: `2026-03-${String(29 - index).padStart(2, '0')}T00:00:00.000Z`,
      scenario: makeScenario([makePage({ pageNumber: 1 })]),
      viewCount: index + 5,
    }))
  ));

  const response = await fetch(`${harness.baseUrl}/api/stories/public?limit=4`);

  assert.equal(response.status, 200);
  const stories = await response.json() as Array<{ id: string; viewCount: number }>;
  assert.equal(stories.length, 4);
  assert.deepEqual(stories.map(story => story.id), [
    'public-story-1',
    'public-story-2',
    'public-story-3',
    'public-story-4',
  ]);
  assert.deepEqual(stories.map(story => story.viewCount), [5, 6, 7, 8]);
});

test('GET /api/stories/public keeps search and limit working together', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-search-limit-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'listPublicStories', async (search?: string, limit = 50) => {
    assert.equal(search, 'moon');
    assert.equal(limit, 3);

    return Array.from({ length: limit }, (_, index) => makeStoryMeta({
      id: `moon-story-${index + 1}`,
      status: 'completed',
      isPublic: true,
      createdAt: `2026-03-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`,
    }));
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/public?search=moon&limit=3`);

  assert.equal(response.status, 200);
  const stories = await response.json() as Array<{ id: string }>;
  assert.equal(stories.length, 3);
  assert.deepEqual(stories.map(story => story.id), [
    'moon-story-1',
    'moon-story-2',
    'moon-story-3',
  ]);
});

test('POST /api/stories/:id/review-script is no longer publicly exposed', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-review-removed-'));
  const harness = await createStoriesHarness(dataDir);

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-review-removed/review-script`, {
    method: 'POST',
  });

  assert.equal(response.status, 404);
});

test('POST /api/stories/:id/regenerate-assets syncs renderedScenarioRevision to the latest scenario revision', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-regenerate-assets-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllCharacterSheets', async () => new Map());
  t.mock.method(harness.storiesModule.illustrationOps, 'generateAllSceneImages', async (_storyId: string, pages: Page[], _characters: unknown, _sheets: unknown, _style: unknown, onProgress?: (progress: { pageNumber?: number; pageStatus?: string; message?: string }) => void) => {
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
