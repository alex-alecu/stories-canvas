import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

const {
  fetchModelPriceCatalog,
  isModelPriceCatalogStale,
  selectGoogleAiStudioEndpoint,
} = await import('./modelPriceCatalog.js');

function response(pricing: Record<string, string>, tag = 'google-ai-studio'): Response {
  return new Response(JSON.stringify({
    data: {
      endpoints: [
        { provider_name: 'Google AI Studio', tag: `${tag}/flex`, pricing },
        { provider_name: 'Google', tag: 'google-vertex/global', pricing },
        { provider_name: 'Google AI Studio', tag, pricing },
        { provider_name: 'Google AI Studio', tag: `${tag}/priority`, pricing },
      ],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('selectGoogleAiStudioEndpoint chooses only the standard endpoint', () => {
  const endpoint = selectGoogleAiStudioEndpoint({
    data: {
      endpoints: [
        { provider_name: 'Google AI Studio', tag: 'google-ai-studio/flex' },
        { provider_name: 'Google AI Studio', tag: 'google-ai-studio' },
        { provider_name: 'Google AI Studio', tag: 'google-ai-studio/priority' },
      ],
    },
  });
  assert.equal(endpoint.tag, 'google-ai-studio');
});

test('fetchModelPriceCatalog maps text, image-output, and audio rates', async () => {
  const entries = await fetchModelPriceCatalog(
    async url => response({
      prompt: '0.000002',
      completion: '0.000012',
      image_output: String(url).includes('image') ? '0.00006' : '0',
    }),
    new Date('2026-07-24T10:00:00.000Z'),
  );

  assert.equal(entries.length, 6);
  assert.equal(entries.find(entry => entry.model === 'gemini-3.1-pro-preview')?.inputUsdPerToken, '0.000002');
  assert.equal(entries.find(entry => entry.model === 'gemini-3.1-flash-image-preview')?.imageOutputUsdPerToken, '0.00006');
  assert.equal(entries.find(entry => entry.provider === 'elevenlabs')?.audioUsdPerCharacter, '0.0001');

  const openai = entries.find(entry => entry.model === 'gpt-5.6-sol');
  assert.equal(openai?.provider, 'openai');
  assert.equal(openai?.inputUsdPerToken, '0.000005');
  assert.equal(openai?.cachedInputUsdPerToken, '0.0000005');
  assert.equal(openai?.cacheWriteUsdPerToken, '0.00000625');
  assert.equal(openai?.outputUsdPerToken, '0.00003');
  assert.equal(openai?.webSearchUsdPerCall, '0.01');
  assert.equal(openai?.fetchedAt, '2026-08-17T00:00:00.000Z');
  assert.deepEqual(openai?.roles, [
    'source analysis',
    'draft',
    'validation repair',
    'review',
    'review rewrite',
    'page text review',
  ]);
});

test('price catalog becomes stale when a fixed price verification expires', async () => {
  const entries = await fetchModelPriceCatalog(
    async url => response({
      prompt: '0.000002',
      completion: '0.000012',
      image_output: String(url).includes('image') ? '0.00006' : '0',
    }),
    new Date('2026-08-17T10:00:00.000Z'),
  );

  assert.equal(isModelPriceCatalogStale(
    entries,
    '2026-08-17T10:00:00.000Z',
    new Date('2026-08-17T23:59:59.999Z'),
  ), false);
  assert.equal(isModelPriceCatalogStale(
    entries,
    '2026-08-18T00:00:00.000Z',
    new Date('2026-08-18T00:00:00.000Z'),
  ), true);
});

test('price catalog rejects ambiguous and malformed endpoint responses', async () => {
  assert.throws(
    () => selectGoogleAiStudioEndpoint({ data: { endpoints: [] } }),
    /found 0/,
  );
  await assert.rejects(
    () => fetchModelPriceCatalog(async () => response({ prompt: 'bad', completion: '0.1', image_output: '0.1' })),
    /malformed/,
  );
});
