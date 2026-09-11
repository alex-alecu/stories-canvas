import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import pRetry from 'p-retry';
import { generateOpenRouterPageAudio, type AudioUsageEvent } from './openrouterAudio.js';

const settings = { audioModel: 'google/gemini-3.1-flash-tts-preview', audioVoice: 'Rasalgethi' };

function fixture(audio: ConstructorParameters<typeof Response>[0] = Buffer.from('ID3audio'), contentType = 'audio/mpeg', cost: number | null = 0.0123, status = 200) {
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const client = new OpenAI({
    apiKey: 'test', baseURL: 'https://openrouter.test/api/v1', maxRetries: 0,
    fetch: async (url, init) => {
      const path = String(url);
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path.includes('/generation?')) {
        return new Response(JSON.stringify({ data: { total_cost: cost } }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(audio, { status, headers: { 'content-type': contentType, 'x-generation-id': 'gen-audio-1' } });
    },
  });
  return { client, requests };
}

test('OpenRouter audio uses the speech endpoint and records the resolved response cost', async () => {
  const api = fixture();
  let usage: AudioUsageEvent | undefined;
  const audio = await generateOpenRouterPageAudio('Hello', settings, {
    client: api.client,
    onUsage: event => { usage = event; },
  });
  assert.equal(audio.toString(), 'ID3audio');
  assert.deepEqual(api.requests[0].body, {
    model: settings.audioModel, input: 'Hello', voice: settings.audioVoice, response_format: 'mp3',
  });
  assert.match(api.requests[1].path, /generation\?id=gen-audio-1/);
  assert.equal(usage?.provider, 'openrouter');
  assert.equal(usage?.usageDetails.providerCostUsd, 0.0123);
});

test('invalid paid audio and missing cost stop without a second speech request', async () => {
  for (const [body, contentType, cost] of [
    [JSON.stringify({ error: 'bad output' }), 'application/json', 0.01],
    [Buffer.from('ID3audio'), 'audio/mpeg', null],
  ] as const) {
    const api = fixture(body, contentType, cost);
    const events: AudioUsageEvent[] = [];
    await assert.rejects(pRetry(() => generateOpenRouterPageAudio('Hello', settings, {
      client: api.client, onUsage: event => { events.push(event); },
    }), { retries: 2, minTimeout: 0 }));
    assert.equal(api.requests.filter(request => request.body).length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, contentType === 'application/json' ? 'failed' : 'succeeded');
  }
});

test('accounting failure aborts after one paid speech request', async () => {
  const api = fixture();
  await assert.rejects(pRetry(() => generateOpenRouterPageAudio('Hello', settings, {
    client: api.client,
    onUsage: () => { throw new Error('Database unavailable'); },
  }), { retries: 2, minTimeout: 0 }), /Database unavailable/);
  assert.equal(api.requests.filter(request => request.body).length, 1);
});

test('an authentication failure is fatal and is not retried', async () => {
  const api = fixture(JSON.stringify({ error: { message: 'Unauthorized' } }), 'application/json', null, 401);
  let caught: unknown;
  try {
    await generateOpenRouterPageAudio('Hello', settings, { client: api.client });
  } catch (error) { caught = error; }
  assert.equal(caught instanceof Error ? caught.name : '', 'AbortError');
  assert.equal(api.requests.filter(request => request.body).length, 1);
});
