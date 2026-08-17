import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelPricingSnapshot, StoryUsageEvent, StoryUsageTotals } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

const { recordStoryUsage } = await import('./storyUsage.js');
const { computeTextCostUsdMicros } = await import('./storyUsagePricing.js');

function snapshot(overrides: Partial<ModelPricingSnapshot> = {}): ModelPricingSnapshot {
  return {
    model: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    roles: ['draft'],
    unit: 'input/output tokens',
    inputUsdPerToken: '0.000002',
    cachedInputUsdPerToken: '0',
    cacheWriteUsdPerToken: '0',
    outputUsdPerToken: '0.000012',
    imageOutputUsdPerToken: '0',
    audioUsdPerCharacter: '0',
    webSearchUsdPerCall: '0',
    sourceUrl: 'https://example.test/prices',
    endpointTag: 'google-ai-studio',
    fetchedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

function storage(captured: Array<{ event: StoryUsageEvent; delta: StoryUsageTotals }>) {
  return {
    appendStoryUsageEvent: async (_storyId: string, event: StoryUsageEvent, delta: StoryUsageTotals) => {
      captured.push({ event, delta });
    },
  };
}

test('usage accounting freezes exact text, image-output-token, and audio snapshots', async () => {
  const captured: Array<{ event: StoryUsageEvent; delta: StoryUsageTotals }> = [];
  const textPrice = snapshot();
  const text = await recordStoryUsage(storage(captured), 'story-1', 'user-1', {
    provider: 'gemini', operation: 'scenario_draft', source: 'initial_generation', status: 'succeeded',
    model: textPrice.model, inputTokens: 100, outputTokens: 50,
  }, async () => textPrice);
  assert.equal(text.costUsdMicros, 800);

  const image = await recordStoryUsage(storage(captured), 'story-1', 'user-1', {
    provider: 'gemini', operation: 'page_image', source: 'initial_generation', status: 'succeeded',
    model: 'gemini-3.1-flash-image-preview', inputTokens: 10, outputTokens: 1_000,
    imageOutputTokens: 1_000, generatedImages: 1,
  }, async () => snapshot({
    model: 'gemini-3.1-flash-image-preview', roles: ['fast image'],
    inputUsdPerToken: '0.0000005', outputUsdPerToken: '0.000003', imageOutputUsdPerToken: '0.00006',
  }));
  assert.equal(image.costUsdMicros, 60_005);

  const audio = await recordStoryUsage(storage(captured), 'story-1', 'user-1', {
    provider: 'elevenlabs', operation: 'page_audio', source: 'initial_generation', status: 'succeeded',
    model: 'eleven_multilingual_v2', billedCharacters: 250,
  }, async () => snapshot({
    model: 'eleven_multilingual_v2', provider: 'elevenlabs', roles: ['audio'], unit: 'billed characters',
    inputUsdPerToken: '0', outputUsdPerToken: '0', audioUsdPerCharacter: '0.0001',
  }));
  assert.equal(audio.costUsdMicros, 25_000);

  textPrice.inputUsdPerToken = '99';
  assert.equal(text.pricingSnapshot.inputUsdPerToken, '0.000002');
  assert.ok(captured.every(item => item.event.pricingStatus === 'complete'));
});

test('OpenAI text usage charges standard, cached, cache-write, output, and web search units', async () => {
  const captured: Array<{ event: StoryUsageEvent; delta: StoryUsageTotals }> = [];
  const openaiPrice = snapshot({
    model: 'gpt-5.6-sol',
    provider: 'openai',
    roles: ['draft'],
    inputUsdPerToken: '0.000005',
    cachedInputUsdPerToken: '0.0000005',
    cacheWriteUsdPerToken: '0.00000625',
    outputUsdPerToken: '0.00003',
    webSearchUsdPerCall: '0.01',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    endpointTag: 'openai-standard-tiered-context',
  });

  const event = await recordStoryUsage(storage(captured), 'story-1', 'user-1', {
    provider: 'openai',
    operation: 'scenario_draft',
    source: 'initial_generation',
    status: 'succeeded',
    model: openaiPrice.model,
    inputTokens: 1_000,
    outputTokens: 50,
    usageDetails: {
      input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
      webSearchCalls: 2,
    },
  }, async () => openaiPrice);

  assert.equal(event.costUsdMicros, 25_725);
  assert.equal(event.pricingStatus, 'complete');
  assert.equal(captured[0]?.delta.textCostUsdMicros, 25_725);
  assert.equal(captured[0]?.delta.imageCostUsdMicros, 0);
});

test('OpenAI text usage applies long-context rates only above 272,000 input tokens', () => {
  const openaiPrice = snapshot({
    model: 'gpt-5.6-sol',
    provider: 'openai',
    inputUsdPerToken: '0.000005',
    cachedInputUsdPerToken: '0.0000005',
    cacheWriteUsdPerToken: '0.00000625',
    outputUsdPerToken: '0.00003',
    webSearchUsdPerCall: '0.01',
  });

  assert.equal(computeTextCostUsdMicros(openaiPrice, 272_000, 2), 1_360_060);
  assert.equal(computeTextCostUsdMicros(openaiPrice, 272_001, 2), 2_720_100);
  assert.equal(computeTextCostUsdMicros(openaiPrice, 300_000, 100, {
    cachedInputTokens: 100_000,
    cacheWriteInputTokens: 50_000,
    webSearchCalls: 2,
  }), 2_249_500);
});

test('unavailable usage persists a zero-unit incomplete event', async () => {
  const captured: Array<{ event: StoryUsageEvent; delta: StoryUsageTotals }> = [];
  const event = await recordStoryUsage(storage(captured), 'story-1', undefined, {
    provider: 'openai', operation: 'page_text_review', source: 'regenerate_page_audio', status: 'failed',
    model: 'gpt-5.6-sol', inputTokens: 100, outputTokens: 50, usageAvailable: false,
  }, async () => snapshot({ model: 'gpt-5.6-sol', provider: 'openai', roles: ['page text review'] }));

  assert.equal(event.inputTokens, 0);
  assert.equal(event.outputTokens, 0);
  assert.equal(event.costUsdMicros, 0);
  assert.equal(event.pricingStatus, 'incomplete');
  assert.equal(captured.length, 1);
});
