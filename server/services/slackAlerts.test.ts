import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sendPaymentAlert,
  sendStoryBlockAlert,
  slackAlertTestExports,
} from './slackAlerts.js';

process.env.GEMINI_API_KEY ??= 'test-key';

test('sendStoryBlockAlert posts structured Slack payload and redacts secrets', async (t) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('ok', { status: 200 });
  });

  await sendStoryBlockAlert({
    blockType: 'pipeline_failure',
    action: 'story_create',
    message: 'Story generation failed',
    userId: 'user-1',
    userEmail: 'buyer@example.test',
    storyId: 'story-1',
    error: new Error('Provider failed with Bearer secret-token and sk_test_secret'),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, slackAlertTestExports.SLACK_WEBHOOK_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });

  const payload = JSON.parse(String(calls[0].init.body)) as {
    text: string;
    blocks: Array<{ type: string; fields?: Array<{ text: string }> }>;
  };
  assert.match(payload.text, /Pipeline failure/);
  assert.match(JSON.stringify(payload.blocks), /buyer@example\.test/);
  assert.match(JSON.stringify(payload.blocks), /story-1/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /secret-token/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /sk_test_secret/);
});

test('sendPaymentAlert logs non-ok Slack responses without throwing', async (t) => {
  const logs: string[] = [];

  t.mock.method(globalThis, 'fetch', async () => (
    new Response('channel_not_found', { status: 404, statusText: 'Not Found' })
  ));
  t.mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await sendPaymentAlert({
    type: 'checkout_created',
    userId: 'user-2',
    email: 'checkout@example.test',
    offerSlug: 'pack_5',
    amountMinor: 3900,
    currency: 'ron',
    stripeCheckoutSessionId: 'cs_123',
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /Slack alert failed: 404 Not Found channel_not_found/);
});

test('Slack sender logs timed-out requests without throwing', async (t) => {
  const logs: string[] = [];

  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => (
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new Error('already aborted'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(new Error('request aborted'));
      });
    })
  ));
  t.mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await slackAlertTestExports.postSlackPayload({
    text: 'timeout test',
    blocks: [],
  }, 1);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /Slack alert request failed: request aborted/);
});
