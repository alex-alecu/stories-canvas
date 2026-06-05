import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  STORY_REACTION_FEEDBACK_MAX_CHARS,
  type Page,
  type Scenario,
  type StoryMeta,
  type StoryReaction,
} from '../../shared/types.js';

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

function makeGeneratedScenarioResult(scenario = makeScenario()) {
  return {
    scenario,
    retellingMode: 'original' as const,
  };
}

async function createStoriesHarness(dataDir: string, configOverrides: Record<string, unknown> = {}) {
  const express = (await import('express')).default;
  const { config } = await import('../config.js');
  const generationRegistry = await import('../services/generationRegistry.js');
  const authMiddleware = await import('../middleware/auth.js');
  const requestLimits = await import('../utils/requestLimits.js');
  const storiesModule = await import('./stories.js');
  const authUser = configOverrides.__testAuthUser as { id: string; email?: string } | undefined;

  if ('__testAuthUser' in configOverrides) {
    delete configOverrides.__testAuthUser;
  }

  Object.assign(config, {
    dataDir,
    useSupabase: false,
    elevenLabsApiKey: undefined,
    maxActiveGenerationsPerUser: 2,
    readRateWindowMs: 60_000,
    anonymousReadIpLimit: 300,
    authenticatedReadUserLimit: 300,
    authenticatedReadIpLimit: 600,
    sseIpConnectionLimit: 10,
    sseStoryIpConnectionLimit: 3,
    authCacheTtlMs: 60_000,
    ...configOverrides,
  });
  authMiddleware.clearAuthResultCacheForTests();
  requestLimits.resetRequestLimitersForTests();
  Object.assign(storiesModule.generationSlotOps, {
    claimGenerationSlot: async () => ({ activeCount: 1, limit: 2 }),
    releaseGenerationSlot: async () => 0,
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

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenarioWithMetadata', async () => makeGeneratedScenarioResult());
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

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenarioWithMetadata', async () => makeGeneratedScenarioResult());
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

test('POST /api/stories stores fixed mode credit costs', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-mode-costs-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenarioWithMetadata', async () => makeGeneratedScenarioResult());
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
        prompt: `Create a complex ${scenarioCase.storyMode} bedtime story with a difficult quest.`,
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

  t.mock.method(harness.storiesModule.scenarioOps, 'generateScenarioWithMetadata', async (
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
      onSourceAnalysisUsage?: (usage: {
        model: string;
        status: 'succeeded' | 'failed';
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        usageDetails: Record<string, unknown>;
      }) => void | Promise<void>;
    },
  ) => {
    await usageCallbacks?.onSourceAnalysisUsage?.({
      model: 'gemini-3.1-flash-lite',
      status: 'succeeded',
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      usageDetails: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
    });
    await usageCallbacks?.onDraftUsage?.({
      model: 'gemini-3.1-pro-preview',
      status: 'succeeded',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      usageDetails: { promptTokenCount: 120, candidatesTokenCount: 80, totalTokenCount: 200 },
    });
    return {
      scenario,
      retellingMode: 'faithful_retelling' as const,
      retellingSource: {
        title: 'Greuceanu',
        author: 'Petre Ispirescu',
        provider: 'wikisource',
        sourceUrl: 'https://ro.wikisource.org/wiki/Greuceanu',
        licenseNote: 'Public-domain Romanian folklore text hosted on Wikisource.',
        sourceTextHash: 'sha256-test-source',
        sourceCacheHit: true,
        canonicalBeatSheet: {
          requiredCharacters: ['Greuceanu', 'Imparatul Rosu', 'Faurul Pamantului'],
          requiredLocations: ['curtea imparatului'],
          magicalObjects: ['soarele si luna furate'],
          eventOrder: ['zmeii fura lumina', 'Greuceanu infrange zmeii', 'lumina revine'],
          forbiddenSubstitutions: ['Nu inlocui zmeii cu un singur zmeu prietenos.'],
          softenableBeats: ['Luptele pot fi non-grafice.'],
          fidelityWarnings: ['Pastreaza recuperarea soarelui si lunii.'],
        },
      },
    };
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
      prompt: '  Creeaza povestea lui Greuceanu cat mai aproape de original.  ',
      storyMode: 'pro_audio',
      voice: 'corina',
      age: 5,
      style: 'watercolor',
      language: 'ro',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { id: string };
  const savedStory = await waitFor(
    () => readStoryMeta(dataDir, body.id),
    story => story.status === 'completed' && (story.usageTotals?.costUsdMicros ?? 0) > 0,
  );

  assert.equal(savedStory.generationInputs?.prompt, 'Creeaza povestea lui Greuceanu cat mai aproape de original.');
  assert.equal(savedStory.generationInputs?.language, 'ro');
  assert.equal(savedStory.generationInputs?.age, 5);
  assert.equal(savedStory.generationInputs?.artStyle, 'watercolor');
  assert.equal(savedStory.generationInputs?.storyMode, 'pro_audio');
  assert.equal(savedStory.generationInputs?.voice, 'corina');
  assert.equal(savedStory.generationInputs?.audioEnabled, true);
  assert.equal(savedStory.generationInputs?.proModel, true);
  assert.equal(savedStory.generationInputs?.retellingMode, 'faithful_retelling');
  assert.equal(savedStory.generationInputs?.sourceTitle, 'Greuceanu');
  assert.equal(savedStory.generationInputs?.sourceProvider, 'wikisource');
  assert.equal(savedStory.generationInputs?.sourceUrl, 'https://ro.wikisource.org/wiki/Greuceanu');
  assert.equal(savedStory.generationInputs?.sourceLicense, 'Public-domain Romanian folklore text hosted on Wikisource.');
  assert.equal(savedStory.generationInputs?.sourceTextHash, 'sha256-test-source');
  assert.equal(savedStory.generationInputs?.sourceCacheHit, true);
  assert.equal(savedStory.usageTotals?.inputTokens, 192);
  assert.equal(savedStory.usageTotals?.outputTokens, 100);
  assert.equal(savedStory.usageTotals?.totalTokens, 292);
  assert.ok((savedStory.usageTotals?.textCostUsdMicros ?? 0) > 0);
  assert.ok((savedStory.usageTotals?.imageCostUsdMicros ?? 0) > 0);
  assert.ok((savedStory.usageTotals?.audioCostUsdMicros ?? 0) > 0);

  const usageEvents = await readUsageEvents(dataDir, body.id);
  assert.equal(usageEvents.length, 5);
  assert.deepEqual(usageEvents.map(event => event.operation), [
    'source_analysis',
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
  let slackAlert: Record<string, unknown> | null = null;
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

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
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'service_unavailable');
  assert.equal(slackAlert?.action, 'story_create');
});

test('POST /api/stories sends Slack alert when credits are insufficient', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-create-insufficient-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-create-no-credits', email: 'create-no-credits@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const { InsufficientCreditsError } = await import('../services/billingStorage.js');
  let slackAlert: Record<string, unknown> | null = null;
  let deletedStoryId: string | undefined;

  t.mock.method(harness.storiesModule.storageOps, 'createStory', async () => {});
  t.mock.method(harness.storiesModule.storageOps, 'deleteStory', async (storyId: string) => {
    deletedStoryId = storyId;
    return true;
  });
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    throw new InsufficientCreditsError();
  });
  t.mock.method(harness.storiesModule.billingOps, 'getUserCreditBalance', async () => ({ availableCredits: 0 }));
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tell a short story about a brave star.',
      storyMode: 'pro',
    }),
  });

  assert.equal(response.status, 402);
  const body = await response.json() as { error: string; requiredCredits: number; availableCredits: number };
  assert.equal(body.error, 'Not enough credits to create this story');
  assert.equal(body.requiredCredits, 2);
  assert.equal(body.availableCredits, 0);
  assert.equal(typeof deletedStoryId, 'string');
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'insufficient_credits');
  assert.equal(slackAlert?.action, 'story_create');
  assert.equal(slackAlert?.userEmail, 'create-no-credits@example.test');
  assert.equal(slackAlert?.requiredCredits, 2);
  assert.equal(slackAlert?.availableCredits, 0);
});

test('POST /api/stories/:id/generate-audio charges prorated page credits and starts narration', async (t) => {
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
    assert.equal(amount, 0.1);
    chargedReason = params.reason;
    return { ledger_id: 'ledger-add-audio', available_credits: 4.9 };
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
    chargedCredits: 0.1,
    availableCredits: 4.9,
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
  let releasedSlot = false;
  let slackAlert: Record<string, unknown> | null = null;

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
  t.mock.method(harness.storiesModule.generationSlotOps, 'releaseGenerationSlot', async (storyId: string) => {
    assert.equal(storyId, 'story-audio-insufficient');
    releasedSlot = true;
    return 1;
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-insufficient/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'corina' }),
  });

  assert.equal(response.status, 402);
  const body = await response.json() as { error: string; requiredCredits: number; availableCredits: number };
  assert.equal(body.error, 'Not enough credits to add narration');
  assert.equal(body.requiredCredits, 0.1);
  assert.equal(body.availableCredits, 0);
  assert.equal(storedVoice, false);
  assert.equal(releasedSlot, true);
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'insufficient_credits');
  assert.equal(slackAlert?.action, 'story_add_audio');
  assert.equal(slackAlert?.userEmail, 'no-credits@example.test');
  assert.equal(slackAlert?.storyId, 'story-audio-insufficient');
  assert.equal(slackAlert?.requiredCredits, 0.1);
  assert.equal(slackAlert?.availableCredits, 0);
});

test('POST /api/stories/:id/generate-audio returns 429 before charging when generation slots are full', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-audio-slot-limit-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'user-slot-limit', email: 'slot-limit@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const supabaseStorage = await import('../services/supabaseStorage.js');
  let charged = false;
  let slackAlert: Record<string, unknown> | null = null;

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-audio-slot-limit',
    prompt: 'A story ready for narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    userId: 'user-slot-limit',
    scenario: makeScenario([makePage()]),
  }));
  t.mock.method(harness.storiesModule.generationSlotOps, 'claimGenerationSlot', async () => {
    throw new supabaseStorage.GenerationSlotLimitError(2, 2, 60);
  });
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    charged = true;
    return { ledger_id: 'unexpected', available_credits: 0 };
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-audio-slot-limit/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: 'corina' }),
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(await response.json(), {
    error: 'Too many active story generations',
    activeGenerations: 2,
    maxActiveGenerations: 2,
    retryAfterSeconds: 60,
  });
  assert.equal(charged, false);
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'generation_slot_limit');
  assert.equal(slackAlert?.action, 'story_add_audio');
  assert.equal(slackAlert?.userEmail, 'slot-limit@example.test');
  assert.equal(slackAlert?.activeGenerations, 2);
  assert.equal(slackAlert?.maxActiveGenerations, 2);
  assert.equal(slackAlert?.retryAfterSeconds, 60);
});

test('POST /api/stories/:id/pages/:pageNumber/regenerate-image reviews feedback and increments image revision', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-page-image-regenerate-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await writeStoryMeta(dataDir, {
    id: 'story-page-image',
    prompt: 'A story with one page.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    storyMode: 'fast',
    scenario: makeScenario([makePage({ imageRevision: 0 })]),
  });

  let reviewedText = '';
  let generatedPrompt = '';
  t.mock.method(harness.storiesModule.pageTextReviewOps, 'reviewPageText', async (input: { text: string }) => {
    reviewedText = input.text;
    return { allowed: true };
  });
  t.mock.method(harness.storiesModule.illustrationOps, 'retryFailedSceneImages', async (
    _storyId: string,
    pages: Page[],
    _characters: unknown,
    pageNumbers: number[],
    _style: unknown,
    onProgress?: (progress: { pageNumber?: number; pageStatus?: string; message?: string }) => void,
    _userId?: string,
    _signal?: AbortSignal,
    pro?: boolean,
    _onUsage?: unknown,
    _onCharacterSheetUsage?: unknown,
    options?: { includeCurrentSceneReference?: boolean },
  ) => {
    generatedPrompt = pages[0].imagePrompt;
    assert.deepEqual(pageNumbers, [1]);
    assert.equal(pro, true);
    assert.equal(options?.includeCurrentSceneReference, true);
    onProgress?.({ pageNumber: 1, pageStatus: 'completed', message: 'done' });
    return 1;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-page-image/pages/1/regenerate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: 'Make the moon brighter.', mode: 'pro' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; pageNumber: number; chargedCredits: number };
  assert.equal(body.status, 'generating_images');
  assert.equal(body.pageNumber, 1);
  assert.equal(body.chargedCredits, 0.2);

  const updated = await waitFor(
    () => readStoryMeta(dataDir, 'story-page-image'),
    story => story.scenario?.pages[0]?.imageRevision === 1,
  );
  assert.equal(reviewedText, 'Make the moon brighter.');
  assert.match(generatedPrompt, /User feedback for this regeneration: Make the moon brighter\./);
  assert.equal(updated.scenario?.pages[0].status, 'completed');
});

test('PATCH /api/stories/:id/pages/:pageNumber/script-audio reviews text and updates the same-voice narration', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-page-audio-regenerate-'));
  const harness = await createStoriesHarness(dataDir, { elevenLabsApiKey: 'eleven-test-key' });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await writeStoryMeta(dataDir, {
    id: 'story-page-audio',
    prompt: 'A story with narration.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    voice: 'jora',
    storyMode: 'pro_audio',
    scenario: makeScenario([makePage({ audioUrl: '/old-audio.mp3', audioRevision: 0 })]),
  });

  let reviewedText = '';
  let generatedText = '';
  let generatedVoice = '';
  t.mock.method(harness.storiesModule.pageTextReviewOps, 'reviewPageText', async (input: { text: string }) => {
    reviewedText = input.text;
    return { allowed: true };
  });
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generatePageAudio', async (text: string, voiceKey: string) => {
    generatedText = text;
    generatedVoice = voiceKey;
    return Buffer.from('audio');
  });
  t.mock.method(harness.storiesModule.audioOps, 'savePageAudio', async () => '/new-audio.mp3');

  const response = await fetch(`${harness.baseUrl}/api/stories/story-page-audio/pages/1/script-audio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'The dragon waves softly at the stars.' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; pageNumber: number; chargedCredits: number };
  assert.equal(body.status, 'generating_audio');
  assert.equal(body.pageNumber, 1);
  assert.equal(body.chargedCredits, 0.1);

  const updated = await waitFor(
    () => readStoryMeta(dataDir, 'story-page-audio'),
    story => story.scenario?.pages[0]?.audioRevision === 1,
  );
  assert.equal(reviewedText, 'The dragon waves softly at the stars.');
  assert.equal(generatedText, 'The dragon waves softly at the stars.');
  assert.equal(generatedVoice, 'jora');
  assert.equal(updated.scenario?.pages[0].text, 'The dragon waves softly at the stars.');
  assert.equal(updated.scenario?.pages[0].audioUrl, '/new-audio.mp3');
});

test('POST /api/stories/:id/pages/:pageNumber/regenerate-image blocks unsafe feedback before generation', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-page-image-safety-'));
  const harness = await createStoriesHarness(dataDir);
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await writeStoryMeta(dataDir, {
    id: 'story-page-image-safety',
    prompt: 'A story with one page.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    scenario: makeScenario([makePage()]),
  });

  let generated = false;
  let slackAlert: Record<string, unknown> | null = null;
  t.mock.method(harness.storiesModule.pageTextReviewOps, 'reviewPageText', async () => ({
    allowed: false,
    reasonCode: 'profanity',
    explanation: 'Please keep feedback child-friendly.',
  }));
  t.mock.method(harness.storiesModule.illustrationOps, 'retryFailedSceneImages', async () => {
    generated = true;
    return 1;
  });
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-page-image-safety/pages/1/regenerate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: 'unsafe feedback' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string; reasonCode: string };
  assert.equal(body.reasonCode, 'profanity');
  assert.equal(body.error, 'Please keep feedback child-friendly.');
  assert.equal(generated, false);
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'safety_block');
  assert.equal(slackAlert?.action, 'story_regenerate_image');
  assert.equal(slackAlert?.reasonCode, 'profanity');
  assert.equal(slackAlert?.storyId, 'story-page-image-safety');
  assert.equal(slackAlert?.pageNumber, 1);
});

test('PATCH /api/stories/:id/pages/:pageNumber/script-audio returns 402 before audio when credits are insufficient', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-page-audio-insufficient-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    elevenLabsApiKey: 'eleven-test-key',
    __testAuthUser: { id: 'user-page-audio', email: 'page-audio@example.test' },
  });
  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const { InsufficientCreditsError } = await import('../services/billingStorage.js');
  let generated = false;
  let slackAlert: Record<string, unknown> | null = null;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-page-audio-insufficient',
    prompt: 'A story with narration.',
    status: 'completed',
    userId: 'user-page-audio',
    voice: 'jora',
    storyMode: 'pro_audio',
    scenario: makeScenario([makePage({ audioUrl: '/old-audio.mp3' })]),
  }));
  t.mock.method(harness.storiesModule.pageTextReviewOps, 'reviewPageText', async () => ({ allowed: true }));
  t.mock.method(harness.storiesModule.billingOps, 'consumeCredits', async () => {
    throw new InsufficientCreditsError();
  });
  t.mock.method(harness.storiesModule.billingOps, 'getUserCreditBalance', async () => ({ availableCredits: 0 }));
  t.mock.method(harness.storiesModule.audioOps, 'isElevenLabsConfigured', () => true);
  t.mock.method(harness.storiesModule.audioOps, 'generatePageAudio', async () => {
    generated = true;
    return Buffer.from('audio');
  });
  t.mock.method(harness.storiesModule.storySlackOps, 'sendStoryBlockAlert', async (params) => {
    slackAlert = params as Record<string, unknown>;
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-page-audio-insufficient/pages/1/script-audio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'A safe replacement page text.' }),
  });

  assert.equal(response.status, 402);
  const body = await response.json() as { requiredCredits: number; availableCredits: number };
  assert.equal(body.requiredCredits, 0.1);
  assert.equal(body.availableCredits, 0);
  assert.equal(generated, false);
  await waitFor(async () => slackAlert, value => value !== null);
  assert.equal(slackAlert?.blockType, 'insufficient_credits');
  assert.equal(slackAlert?.action, 'story_regenerate_audio');
  assert.equal(slackAlert?.userEmail, 'page-audio@example.test');
  assert.equal(slackAlert?.storyId, 'story-page-audio-insufficient');
  assert.equal(slackAlert?.pageNumber, 1);
  assert.equal(slackAlert?.requiredCredits, 0.1);
  assert.equal(slackAlert?.availableCredits, 0);
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

test('PATCH /api/stories/:id/reaction requires authentication', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-reaction-auth-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-reaction-auth/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reaction: 'like' }),
  });

  assert.equal(response.status, 401);
});

test('PATCH /api/stories/:id/reaction rejects private non-owner stories', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-reaction-private-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'viewer-user', email: 'viewer@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let updated = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-reaction-private',
    status: 'completed',
    userId: 'owner-user',
    isPublic: false,
  }));
  t.mock.method(harness.storiesModule.storageOps, 'setStoryReaction', async () => {
    updated = true;
    return {
      id: 'story-reaction-private',
      likeCount: 1,
      dislikeCount: 0,
      myReaction: 'like' as StoryReaction,
    };
  });

  const response = await fetch(`${harness.baseUrl}/api/stories/story-reaction-private/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reaction: 'like' }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Story not found' });
  assert.equal(updated, false);
});

test('PATCH /api/stories/:id/reaction sets, switches, and clears one user reaction', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-reaction-update-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'reacting-user', email: 'reacting@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const reactions = new Map<string, StoryReaction>();
  let latestFeedback: string | null = null;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-reaction-update',
    status: 'completed',
    isPublic: true,
  }));
  t.mock.method(harness.storiesModule.storageOps, 'setStoryReaction', async (
    storyId: string,
    userId: string,
    reaction: StoryReaction | null,
    feedback?: string | null,
  ) => {
    if (reaction) {
      reactions.set(`${storyId}:${userId}`, reaction);
    } else {
      reactions.delete(`${storyId}:${userId}`);
    }
    if (reaction === 'dislike' && feedback) {
      latestFeedback = feedback;
    }

    const values = [...reactions.values()];
    const response: {
      id: string;
      likeCount: number;
      dislikeCount: number;
      myReaction: StoryReaction | null;
      feedback?: string | null;
    } = {
      id: storyId,
      likeCount: values.filter(value => value === 'like').length,
      dislikeCount: values.filter(value => value === 'dislike').length,
      myReaction: reaction,
    };
    if (reaction === 'dislike') response.feedback = latestFeedback;
    return response;
  });

  async function patchReaction(reaction: StoryReaction | null, feedback?: unknown) {
    const body = feedback === undefined ? { reaction } : { reaction, feedback };
    const response = await fetch(`${harness.baseUrl}/api/stories/story-reaction-update/reaction`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      likeCount: number;
      dislikeCount: number;
      myReaction: StoryReaction | null;
      feedback?: string | null;
    }>;
  }

  assert.deepEqual(await patchReaction('like'), {
    id: 'story-reaction-update',
    likeCount: 1,
    dislikeCount: 0,
    myReaction: 'like',
  });
  assert.deepEqual(await patchReaction('dislike', '  The ending felt too abrupt.  '), {
    id: 'story-reaction-update',
    likeCount: 0,
    dislikeCount: 1,
    myReaction: 'dislike',
    feedback: 'The ending felt too abrupt.',
  });
  assert.deepEqual(await patchReaction(null), {
    id: 'story-reaction-update',
    likeCount: 0,
    dislikeCount: 0,
    myReaction: null,
  });
});

test('PATCH /api/stories/:id/reaction validates dislike feedback', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-reaction-feedback-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'feedback-user', email: 'feedback@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let updated = false;
  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-reaction-feedback',
    status: 'completed',
    isPublic: true,
  }));
  t.mock.method(harness.storiesModule.storageOps, 'setStoryReaction', async () => {
    updated = true;
    return {
      id: 'story-reaction-feedback',
      likeCount: 0,
      dislikeCount: 0,
      myReaction: null,
    };
  });

  const nonStringResponse = await fetch(`${harness.baseUrl}/api/stories/story-reaction-feedback/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reaction: 'dislike', feedback: 123 }),
  });
  assert.equal(nonStringResponse.status, 400);
  assert.deepEqual(await nonStringResponse.json(), { error: 'feedback must be a string' });

  const longResponse = await fetch(`${harness.baseUrl}/api/stories/story-reaction-feedback/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reaction: 'dislike', feedback: 'x'.repeat(STORY_REACTION_FEEDBACK_MAX_CHARS + 1) }),
  });
  assert.equal(longResponse.status, 400);
  assert.deepEqual(await longResponse.json(), {
    error: `feedback must be ${STORY_REACTION_FEEDBACK_MAX_CHARS} characters or fewer`,
  });
  assert.equal(updated, false);
});

test('GET /api/stories/:id includes reaction counts and signed-in viewer reaction', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-reaction-detail-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'reaction-viewer', email: 'viewer@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-reaction-detail',
    status: 'completed',
    isPublic: true,
    likeCount: 4,
    dislikeCount: 2,
  }));
  t.mock.method(harness.storiesModule.storageOps, 'getStoryReaction', async () => 'like' as StoryReaction);

  const response = await fetch(`${harness.baseUrl}/api/stories/story-reaction-detail`);

  assert.equal(response.status, 200);
  const story = await response.json() as StoryMeta;
  assert.equal(story.likeCount, 4);
  assert.equal(story.dislikeCount, 2);
  assert.equal(story.myReaction, 'like');
});

test('GET /api/stories/:id returns only a three-page public preview for anonymous readers', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-preview-anon-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-public-preview',
    status: 'completed',
    userId: 'story-owner',
    isPublic: true,
    scenario: makeScenario(Array.from({ length: 6 }, (_, index) => makePage({
      pageNumber: index + 1,
      text: `Page ${index + 1}`,
    }))),
  }));

  const response = await fetch(`${harness.baseUrl}/api/stories/story-public-preview`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=120');
  const story = await response.json() as StoryMeta;
  assert.deepEqual(story.scenario?.pages.map(page => page.pageNumber), [1, 2, 3]);
  assert.deepEqual(story.publicPreviewGate, {
    pageLimit: 3,
    totalPages: 6,
  });
});

test('GET /api/stories/:id returns the full public story for signed-in readers', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-preview-auth-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'signed-in-reader', email: 'reader@example.test' },
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'getStory', async () => makeStoryMeta({
    id: 'story-public-full',
    status: 'completed',
    userId: 'story-owner',
    isPublic: true,
    scenario: makeScenario(Array.from({ length: 6 }, (_, index) => makePage({
      pageNumber: index + 1,
      text: `Page ${index + 1}`,
    }))),
  }));
  t.mock.method(harness.storiesModule.storageOps, 'getStoryReaction', async () => null);

  const response = await fetch(`${harness.baseUrl}/api/stories/story-public-full`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control')?.includes('public') ?? false, false);
  const story = await response.json() as StoryMeta;
  assert.deepEqual(story.scenario?.pages.map(page => page.pageNumber), [1, 2, 3, 4, 5, 6]);
  assert.equal(story.publicPreviewGate, undefined);
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
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=30, stale-while-revalidate=120');
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

test('GET /api/stories/public rate limits anonymous reads before storage lookup', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-rate-limit-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    anonymousReadIpLimit: 1,
    readRateWindowMs: 60_000,
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let listCalls = 0;
  t.mock.method(harness.storiesModule.storageOps, 'listPublicStories', async () => {
    listCalls += 1;
    return [];
  });

  const first = await fetch(`${harness.baseUrl}/api/stories/public`);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), []);

  const second = await fetch(`${harness.baseUrl}/api/stories/public`);
  assert.equal(second.status, 429);
  assert.deepEqual(await second.json(), {
    error: 'Too many requests',
    retryAfterSeconds: 60,
  });
  assert.equal(listCalls, 1);
});

test('GET /api/stories/mine rate limits authenticated reads by user', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-mine-rate-limit-'));
  const harness = await createStoriesHarness(dataDir, {
    useSupabase: true,
    __testAuthUser: { id: 'rate-limited-user', email: 'limited@example.test' },
    anonymousReadIpLimit: 100,
    authenticatedReadIpLimit: 100,
    authenticatedReadUserLimit: 1,
    readRateWindowMs: 60_000,
  });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let listCalls = 0;
  t.mock.method(harness.storiesModule.storageOps, 'listStoriesByUser', async () => {
    listCalls += 1;
    return [];
  });

  const first = await fetch(`${harness.baseUrl}/api/stories/mine`);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), []);

  const second = await fetch(`${harness.baseUrl}/api/stories/mine`);
  assert.equal(second.status, 429);
  assert.deepEqual(await second.json(), {
    error: 'Too many requests',
    retryAfterSeconds: 60,
  });
  assert.equal(listCalls, 1);
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

test('GET /api/stories/public preserves cover image sources in summaries', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'stories-public-cover-sources-'));
  const harness = await createStoriesHarness(dataDir, { useSupabase: true });

  t.after(async () => {
    await harness.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  t.mock.method(harness.storiesModule.storageOps, 'listPublicStories', async () => [
    makeStoryMeta({
      id: 'story-with-sources',
      status: 'completed',
      isPublic: true,
      coverImage: 'https://cdn.example/story/page-01.png',
      coverImageSources: {
        full: 'https://cdn.example/story/page-01.png',
        thumb: 'https://cdn.example/story/cover-thumb.webp',
        card: 'https://cdn.example/story/cover-card.webp',
      },
    }),
  ]);

  const response = await fetch(`${harness.baseUrl}/api/stories/public?limit=4`);

  assert.equal(response.status, 200);
  const stories = await response.json() as Array<{ id: string; coverImageSources?: Record<string, string> }>;
  assert.deepEqual(stories, [{
    id: 'story-with-sources',
    prompt: 'A calm bedtime story.',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    title: 'Test Story',
    coverImage: 'https://cdn.example/story/page-01.png',
    coverImageSources: {
      full: 'https://cdn.example/story/page-01.png',
      thumb: 'https://cdn.example/story/cover-thumb.webp',
      card: 'https://cdn.example/story/cover-card.webp',
    },
    totalPages: 1,
    completedPages: 1,
    isPublic: true,
    hasAudio: false,
    assetsStale: false,
    viewCount: 0,
    likeCount: 0,
    dislikeCount: 0,
  }]);
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
  const responseBody = await response.json() as { status: string; chargedCredits: number; availableCredits: number };
  assert.equal(responseBody.status, 'generating_characters');
  assert.equal(responseBody.chargedCredits, 0.1);
  assert.equal(responseBody.availableCredits, 0);

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
