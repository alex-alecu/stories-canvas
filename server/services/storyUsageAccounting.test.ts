import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelPricingSnapshot, StoryUsageEvent, StoryUsageTotals } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

const { recordStoryUsage } = await import('./storyUsage.js');

function snapshot(overrides: Partial<ModelPricingSnapshot> = {}): ModelPricingSnapshot {
  return {
    model: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    roles: ['draft'],
    unit: 'input/output tokens',
    inputUsdPerToken: '0.000002',
    outputUsdPerToken: '0.000012',
    imageOutputUsdPerToken: '0',
    audioUsdPerCharacter: '0',
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

test('unavailable usage persists a zero-unit incomplete event', async () => {
  const captured: Array<{ event: StoryUsageEvent; delta: StoryUsageTotals }> = [];
  const event = await recordStoryUsage(storage(captured), 'story-1', undefined, {
    provider: 'gemini', operation: 'page_text_review', source: 'regenerate_page_audio', status: 'failed',
    model: 'gemini-3.1-flash-lite', inputTokens: 100, outputTokens: 50, usageAvailable: false,
  }, async () => snapshot({ model: 'gemini-3.1-flash-lite', roles: ['page text review'] }));

  assert.equal(event.inputTokens, 0);
  assert.equal(event.outputTokens, 0);
  assert.equal(event.costUsdMicros, 0);
  assert.equal(event.pricingStatus, 'incomplete');
  assert.equal(captured.length, 1);
});
