import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextGenerationOptions, TextUsageEvent } from './openrouter.js';
import { parseTextModelSettings, TEXT_MODELS, textModelPriceLevel } from '../../shared/textModels.js';

const { generateJSON } = await import('./openrouter.js');
const { withTextModelSettings } = await import('./textGenerationContext.js');
const { recordStoryUsage } = await import('./storyUsage.js');
const { getOpenRouterClient } = await import('./openrouterClient.js');
const { config } = await import('../config.js');
const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] };

test('translated site names produce valid HTTP headers through the real client', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousTitle = config.appSiteName;
  process.env.OPENROUTER_API_KEY = 'local-header-test';
  config.appSiteName = 'Povești Magice 🦊';
  try {
    let sent = false;
    await getOpenRouterClient().withOptions({ fetch: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('X-OpenRouter-Title'), 'Povesti Magice');
      sent = true;
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    } }).get('/key');
    assert.equal(sent, true);
  } finally {
    config.appSiteName = previousTitle;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

function fixture(overrides = {}) {
  const requests: Array<Record<string, any>> = [];
  let lookups = 0;
  return {
    requests, get lookups() { return lookups; },
    client: {
      chat: { completions: { create: async (body: Record<string, unknown>) => {
        requests.push(body);
        return { id: 'gen-paid-1', model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.012345 }, ...overrides };
      } } },
      get: async () => { lookups++; return { data: { total_cost: 0.001234 } }; },
    } as unknown as NonNullable<TextGenerationOptions['client']>,
  };
}

test('model settings stay separate across concurrent stories; cost comes from the provider', async () => {
  const api = fixture();
  const usage: TextUsageEvent[] = [];
  await Promise.all(['openai/gpt-6-astra', 'anthropic/claude-fable-5.1'].map(textModel =>
    withTextModelSettings(parseTextModelSettings(textModel, 'high'), () => generateJSON('Story', 'Write it.', schema,
      { client: api.client, onUsage: event => { usage.push(event); } }))));
  assert.deepEqual(api.requests.map(item => item.model), ['openai/gpt-6-astra', 'anthropic/claude-fable-5.1']);
  assert.deepEqual(api.requests[0].reasoning, { effort: 'high' });
  assert.equal(api.requests[0].response_format.json_schema.schema.type, 'object');
  assert.equal(usage[0].usageDetails.providerCostUsd, 0.012345);
  assert.equal(api.lookups, 0);
  assert.ok(TEXT_MODELS.length <= 10);
  assert.deepEqual(TEXT_MODELS.map(textModelPriceLevel), ['$', '$$$', '$$$', '$$', '$', '$']);
  assert.throws(() => parseTextModelSettings('unknown/model', 'low'));
  assert.throws(() => parseTextModelSettings(TEXT_MODELS[0].id, 'ultra'));
  assert.throws(() => parseTextModelSettings('openai/gpt-5.6-sol', 'medium'));
  assert.equal(parseTextModelSettings('openai/gpt-5.6-sol', 'medium', true).textModel, 'openai/gpt-5.6-sol');
  assert.equal(parseTextModelSettings('anthropic/claude-sonnet-5', 'high', true).thinkingLevel, 'high');
});

test('missing inline cost is recovered by generation ID and malformed paid output is recorded', async () => {
  const api = fixture({ usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'invalid json' } }] });
  let usage: TextUsageEvent | undefined;
  await assert.rejects(generateJSON('Story', 'Write it.', schema, { client: api.client, onUsage: event => { usage = event; } }));
  assert.equal(api.lookups, 1);
  assert.equal(usage?.usageDetails.providerCostUsd, 0.001234);
  assert.equal(usage?.status, 'failed');
  assert.equal(api.requests.length, 1);
});


test('an accounting failure never repeats a paid completion', async () => {
  const api = fixture();
  let writes = 0;
  await assert.rejects(generateJSON('Story', 'Write it.', schema, { client: api.client, onUsage: () => { writes++; throw new Error('Database unavailable'); } }), /Database unavailable/);
  assert.equal(api.requests.length, 1);
  assert.equal(writes, 1);
});


test('request costs use USD micros and a stable event ID, including failed output', async () => {
  const events: any[] = [];
  const storage = { appendStoryUsageEvent: async (_id: string, event: unknown) => { events.push(event); } };
  const input = { provider: 'openrouter' as const, operation: 'scenario_draft' as const, source: 'initial_generation' as const,
    status: 'failed' as const, model: 'openai/gpt-6-astra', inputTokens: 100, outputTokens: 10,
    usageDetails: { responseId: 'gen-paid', providerCostUsd: 0.012345 } };
  await recordStoryUsage(storage, 'story-1', 'user-1', input, async () => { throw new Error('Do not estimate a reported cost'); });
  await recordStoryUsage(storage, 'story-1', 'user-1', input);
  assert.equal(events[0].costUsdMicros, 12345);
  assert.equal(events[0].id, events[1].id);
  assert.equal(events[0].pricingStatus, 'complete');
});
