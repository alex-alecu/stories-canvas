import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { config } from '../config.js';
import * as storage from '../utils/storage.js';
import type { Scenario, StoryMeta, StoryUsageEvent, StoryUsageTotals } from '../../shared/types.js';

const scenario: Scenario = {
  title: 'The garden',
  targetAge: 4,
  characters: [],
  pages: [{ pageNumber: 1, text: 'A rabbit enters the garden.', imagePrompt: 'A rabbit in a garden.', characters: [], status: 'pending' }],
};
const totals: StoryUsageTotals = {
  inputTokens: 2, outputTokens: 3, totalTokens: 5,
  costUsdMicros: 7, textCostUsdMicros: 7, imageCostUsdMicros: 0, audioCostUsdMicros: 0,
};
const event: StoryUsageEvent = {
  id: 'request-1', storyId: 'story-1', provider: 'openrouter', operation: 'scenario_draft',
  source: 'initial_generation', status: 'succeeded', model: 'test-model',
  inputTokens: 2, outputTokens: 3, totalTokens: 5, generatedImages: 0,
  billedCharacters: 0, imageOutputTokens: 0, costUsdMicros: 7,
  usageDetails: {}, pricingSnapshot: {}, pricingStatus: 'complete',
  calculatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
};

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-atomic-'));
  const previousDataDir = config.dataDir;
  Object.assign(config, { dataDir: directory });
  t.after(async () => {
    Object.assign(config, { dataDir: previousDataDir });
    await fs.rm(directory, { recursive: true, force: true });
  });
  const storyId = path.basename(directory);
  await storage.createStory(storyId, 'The garden', 'generating_scenario');
  await storage.saveScenario(storyId, scenario, 'generating_images', 'The garden');
  const storyDirectory = path.join(directory, storyId);
  return { storyId, storyDirectory, metadataPath: path.join(storyDirectory, 'scenario.json') };
}

function pauseWrite(t: TestContext, filename: string) {
  const originalWriteFile = fs.writeFile;
  let signalStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let paused = false;
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    if (!paused && typeof args[0] === 'string' && path.basename(args[0]).startsWith(filename)) {
      paused = true;
      // Keep a real write incomplete. The public file must remain readable until publication.
      const options = args[2];
      const flags = typeof options === 'object' && options !== null ? options.flag ?? 'w' : 'w';
      const file = await fs.open(args[0], flags);
      try {
        const contents = String(args[1]);
        await file.writeFile(contents.slice(0, 10));
        signalStarted();
        await released;
        await file.writeFile(contents.slice(10));
      } finally {
        await file.close();
      }
      return;
    }
    return originalWriteFile(...args);
  });
  return { started, release };
}

const mutations = [
  { name: 'createStory', run: (storyId: string) => storage.createStory(storyId, 'A new story', 'generating_scenario'),
    check: (story: StoryMeta) => assert.equal(story.prompt, 'A new story') },
  { name: 'saveScenario', run: (storyId: string) => storage.saveScenario(storyId, { ...scenario, title: 'A new title' }, 'completed', 'The garden'),
    check: (story: StoryMeta) => assert.equal(story.scenario?.title, 'A new title') },
  { name: 'updateStoryStatus', run: (storyId: string) => storage.updateStoryStatus(storyId, 'completed'),
    check: (story: StoryMeta) => assert.equal(story.status, 'completed') },
  { name: 'updatePageStatus', run: (storyId: string) => storage.updatePageStatus(storyId, 1, 'completed'),
    check: (story: StoryMeta) => assert.equal(story.scenario?.pages[0].status, 'completed') },
  { name: 'updatePageAudioUrl', run: (storyId: string) => storage.updatePageAudioUrl(storyId, 1, '/page-1.mp3'),
    check: (story: StoryMeta) => assert.equal(story.scenario?.pages[0].audioUrl, '/page-1.mp3') },
  { name: 'updateStoryVoice', run: (storyId: string) => storage.updateStoryVoice(storyId, 'mom'),
    check: (story: StoryMeta) => assert.equal(story.voice, 'mom') },
  { name: 'updateStoryRenderedScenarioRevision', run: (storyId: string) => storage.updateStoryRenderedScenarioRevision(storyId, 2),
    check: (story: StoryMeta) => assert.equal(story.renderedScenarioRevision, 2) },
  { name: 'appendStoryUsageEvent', run: (storyId: string) => storage.appendStoryUsageEvent(storyId, { ...event, storyId }, totals),
    check: (story: StoryMeta) => assert.equal(story.usageTotals?.totalTokens, 5) },
  { name: 'incrementStoryViewCount', run: (storyId: string) => storage.incrementStoryViewCount(storyId),
    check: (story: StoryMeta) => assert.equal(story.viewCount, 1) },
];

for (const mutation of mutations) {
  test(`${mutation.name} keeps the previous story readable during a write`, async t => {
    const { storyId, metadataPath } = await fixture(t);
    const previous = await fs.readFile(metadataPath, 'utf8');
    const paused = pauseWrite(t, 'scenario.json');
    const updating = mutation.run(storyId);
    try {
      await Promise.race([paused.started, updating.then(() => assert.fail('The write was not paused'))]);
      assert.equal((await storage.getStory(storyId))?.status, 'generating_images');
      assert.equal(await fs.readFile(metadataPath, 'utf8'), previous);
    } finally {
      paused.release();
      await updating;
    }
    const saved = await storage.getStory(storyId);
    assert.ok(saved);
    mutation.check(saved);
  });
}

test('usage costs stay readable during a usage event write', async t => {
  const { storyId } = await fixture(t);
  const paused = pauseWrite(t, 'usage-events.json');
  const updating = storage.appendStoryUsageEvent(storyId, { ...event, storyId }, totals);
  try {
    await Promise.race([paused.started, updating.then(() => assert.fail('The write was not paused'))]);
    assert.deepEqual(await storage.getStoryOpenRouterCosts(storyId), {
      textCostUsdMicros: 0, imageCostUsdMicros: 0, audioCostUsdMicros: 0, unpricedRequests: 0,
    });
  } finally {
    paused.release();
    await updating;
  }
  assert.deepEqual(await storage.getStoryOpenRouterCosts(storyId), {
    textCostUsdMicros: 7, imageCostUsdMicros: 0, audioCostUsdMicros: 0, unpricedRequests: 0,
  });
});

for (const failurePoint of ['writeFile', 'rename'] as const) {
  test(`a failed ${failurePoint} keeps the previous story and removes temporary files`, async t => {
    const { storyId, storyDirectory, metadataPath } = await fixture(t);
    const previous = await fs.readFile(metadataPath, 'utf8');
    const failure = new Error(`${failurePoint} failed`);
    const originalWriteFile = fs.writeFile;
    const fault = failurePoint === 'writeFile'
      ? t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
        await originalWriteFile(args[0], '{"id":', args[2]);
        throw failure;
      })
      : t.mock.method(fs, 'rename', async () => { throw failure; });

    await assert.rejects(storage.updateStoryStatus(storyId, 'completed'), error => error === failure);
    assert.equal(await fs.readFile(metadataPath, 'utf8'), previous);
    assert.deepEqual((await fs.readdir(storyDirectory)).sort(), ['scenario.json', 'usage-events.json']);
    fault.mock.restore();

    await storage.updateStoryStatus(storyId, 'completed');
    assert.equal((await storage.getStory(storyId))?.status, 'completed');
  });
}
