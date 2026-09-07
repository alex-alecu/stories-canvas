import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import pRetry from 'p-retry';
import sharp from 'sharp';
import { generateImage, ImagePolicyBlockedError, type ImageUsageEvent } from './openrouterImages.js';
import { recordStoryUsage } from './storyUsage.js';

const png = (await sharp({ create: { width: 4, height: 3, channels: 3, background: '#9333ea' } }).png().toBuffer()).toString('base64');
const paidResponse = { data: [{ b64_json: png, media_type: 'image/png' }], usage: { prompt_tokens: 10, completion_tokens: 1000, total_tokens: 1010, cost: 0.061235 } };

function fixture(payload: unknown = paidResponse, status = 200, lookupCost: number | null = 0.025) {
  const requests: Array<{ path: string; body: any }> = [];
  const client = new OpenAI({ apiKey: 'test', baseURL: 'https://openrouter.test/api/v1', maxRetries: 0,
    fetch: async (url, init) => {
      const path = String(url);
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const lookup = path.includes('/generation?');
      return new Response(JSON.stringify(lookup ? { data: { total_cost: lookupCost } } : payload), {
        status: lookup ? 200 : status, headers: { 'content-type': 'application/json', 'x-generation-id': 'gen-image-1' },
      });
    } });
  return { client, requests };
}

test('image requests preserve references and dimensions; actual cost is an image debit', async () => {
  const api = fixture();
  let usage: ImageUsageEvent | undefined;
  const result = await generateImage('A fox in a forest', [{ data: png, mimeType: 'image/png' }], {
    client: api.client, onUsage: event => { usage = event; },
  });
  assert.equal((await sharp(Buffer.from(result, 'base64')).metadata()).format, 'png');
  assert.equal(api.requests[0].path, 'https://openrouter.test/api/v1/images');
  assert.deepEqual(api.requests[0].body, {
    model: 'google/gemini-3.1-flash-image-preview', prompt: 'A fox in a forest', n: 1, aspect_ratio: '4:3', resolution: '1K', output_format: 'png',
    input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }], provider: { sort: 'price' },
  });
  assert.equal(usage?.usageDetails.responseId, 'gen-image-1');
  const events: any[] = [];
  const totals: any[] = [];
  const storage = { appendStoryUsageEvent: async (_id: string, event: unknown, delta: unknown) => { events.push(event); totals.push(delta); } };
  const record = { ...usage!, provider: 'openrouter' as const, operation: 'page_image' as const, source: 'initial_generation' as const };
  await recordStoryUsage(storage, 'story-1', 'user-1', record, async () => { throw new Error('Do not estimate image costs'); });
  await recordStoryUsage(storage, 'story-1', 'user-1', record);
  assert.equal(events[0].costUsdMicros, 61235);
  assert.equal(events[0].id, events[1].id);
  assert.equal(totals[0].imageCostUsdMicros, 61235);
  assert.equal(totals[0].textCostUsdMicros, 0);
});

test('Pro uses its OpenRouter model; a missing inline cost uses the generation ID', async () => {
  const api = fixture({ data: paidResponse.data });
  let cost: unknown;
  await generateImage('A castle', [], { pro: true, client: api.client, onUsage: event => { cost = event.usageDetails.providerCostUsd; } });
  assert.equal(api.requests[0].body.model, 'google/gemini-3-pro-image-preview');
  assert.match(api.requests[1].path, /generation\?id=gen-image-1/);
  assert.equal(cost, 0.025);
});

test('missing costs and accounting failures stop without repeating a paid request', async () => {
  for (const missingCost of [true, false]) {
    const api = fixture(missingCost ? { data: paidResponse.data } : paidResponse, 200, null);
    const events: ImageUsageEvent[] = [];
    await assert.rejects(pRetry(() => generateImage('A castle', [], {
      client: api.client, onUsage: event => { events.push(event); if (!missingCost) throw new Error('Database unavailable'); },
    }), { retries: 2, minTimeout: 0 }), missingCost ? /cost is unavailable/ : /Database unavailable/);
    assert.equal(api.requests.filter(request => request.body).length, 1);
    assert.equal(events.length, 1);
    if (missingCost) assert.equal(events[0].usageDetails.providerCostUsd, null);
  }
});

test('invalid paid image data is recorded and is not retried with another model', async () => {
  const api = fixture({ ...paidResponse, data: [{ b64_json: 'invalid' }] });
  const events: ImageUsageEvent[] = [];
  await assert.rejects(pRetry(() => generateImage('A castle', [], { client: api.client, onUsage: event => { events.push(event); } }), { retries: 2, minTimeout: 0 }));
  assert.equal(api.requests.length, 1);
  assert.equal(events[0].status, 'failed');
  assert.equal(events[0].usageDetails.providerCostUsd, 0.061235);
});

test('provider policy failures retain the policy error and an unbilled event', async () => {
  const api = fixture({ error: { code: 'content_policy_violation', message: 'PROHIBITED_CONTENT' } }, 400);
  let usage: ImageUsageEvent | undefined;
  await assert.rejects(generateImage('A castle', [], { client: api.client, onUsage: event => { usage = event; } }), ImagePolicyBlockedError);
  assert.equal(api.requests.length, 1);
  assert.equal(usage?.usageDetails.providerCostUsd, 0);
  assert.equal(usage?.generatedImages, 0);
});

test('cancellation reaches an active image request', async () => {
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let calls = 0;
  const client = new OpenAI({ apiKey: 'test', baseURL: 'https://openrouter.test/api/v1', maxRetries: 0,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      markStarted();
    }) });
  const pending = generateImage('A castle', [], { client, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
  assert.equal(calls, 1);
});

test('a lost connection records an unknown cost and does not buy another image', async () => {
  let calls = 0;
  let usage: ImageUsageEvent | undefined;
  const client = new OpenAI({ apiKey: 'test', baseURL: 'https://openrouter.test/api/v1', maxRetries: 0,
    fetch: async () => { calls++; throw new Error('Connection lost'); } });
  await assert.rejects(pRetry(() => generateImage('A castle', [], {
    client, onUsage: event => { usage = event; },
  }), { retries: 2, minTimeout: 0 }), /Connection error/);
  assert.equal(calls, 1);
  assert.equal(usage?.usageDetails.providerCostUsd, null);
});
