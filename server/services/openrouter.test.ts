import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextGenerationOptions, TextUsageEvent } from './openrouter.js';
import { parseTextModelSettings, TEXT_MODELS } from '../../shared/textModels.js';

process.env.GEMINI_API_KEY ??= 'test-key';
const { generateJSON, createOpenRouterAgentModel, toChatMessages } = await import('./openrouter.js');
const { withTextModelSettings } = await import('./textGenerationContext.js');
const { recordStoryUsage } = await import('./storyUsage.js');
const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] };

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
  await Promise.all(['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5'].map(textModel =>
    withTextModelSettings(parseTextModelSettings(textModel, 'high'), () => generateJSON('Story', 'Write it.', schema,
      { client: api.client, onUsage: event => { usage.push(event); } }))));
  assert.deepEqual(api.requests.map(item => item.model), ['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5']);
  assert.deepEqual(api.requests[0].reasoning, { effort: 'high' });
  assert.equal(api.requests[0].response_format.json_schema.schema.type, 'object');
  assert.equal(usage[0].usageDetails.providerCostUsd, 0.012345);
  assert.equal(api.lookups, 0);
  assert.ok(TEXT_MODELS.length <= 10);
  assert.throws(() => parseTextModelSettings('unknown/model', 'low'));
  assert.throws(() => parseTextModelSettings(TEXT_MODELS[0].id, 'ultra'));
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

test('tool calls preserve their IDs, image inputs, and reasoning details for the next turn', async () => {
  const message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'save', arguments: '{"ok":true}' } }],
    reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }] };
  const api = fixture({ choices: [{ finish_reason: 'tool_calls', message }] });
  const model = createOpenRouterAgentModel({ client: api.client });
  const output = await model({ systemInstruction: 'Write a story', contents: [{ role: 'user', parts: [{ text: 'Inspect this' }, { inlineData: { data: 'abc', mimeType: 'image/png' } }] }],
    tools: [{ name: 'save', description: 'Save', parameters: schema }], forceToolNames: ['save'] });
  const history = toChatMessages([output.content, { role: 'user', parts: [{ functionResponse: { id: 'call-1', response: { saved: true } } }] }]);
  assert.deepEqual(history[0], message);
  assert.deepEqual(history[1], { role: 'tool', tool_call_id: 'call-1', content: '{"saved":true}' });
  assert.equal(api.requests[0].messages[1].content[1].image_url.url, 'data:image/png;base64,abc');
  assert.equal(output.functionCalls[0].id, 'call-1');
});

test('request costs use USD micros and a stable event ID, including failed output', async () => {
  const events: any[] = [];
  const storage = { appendStoryUsageEvent: async (_id: string, event: unknown) => { events.push(event); } };
  const input = { provider: 'openrouter' as const, operation: 'scenario_draft' as const, source: 'initial_generation' as const,
    status: 'failed' as const, model: 'openai/gpt-5.6-sol', inputTokens: 100, outputTokens: 10,
    usageDetails: { responseId: 'gen-paid', providerCostUsd: 0.012345 } };
  await recordStoryUsage(storage, 'story-1', 'user-1', input, async () => { throw new Error('Do not estimate a reported cost'); });
  await recordStoryUsage(storage, 'story-1', 'user-1', input);
  assert.equal(events[0].costUsdMicros, 12345);
  assert.equal(events[0].id, events[1].id);
  assert.equal(events[0].pricingStatus, 'complete');
});
