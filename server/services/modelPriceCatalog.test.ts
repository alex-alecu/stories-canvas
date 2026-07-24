import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

const { fetchModelPriceCatalog, selectGoogleAiStudioEndpoint } = await import('./modelPriceCatalog.js');

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

  assert.equal(entries.length, 5);
  assert.equal(entries.find(entry => entry.model === 'gemini-3.1-pro-preview')?.inputUsdPerToken, '0.000002');
  assert.equal(entries.find(entry => entry.model === 'gemini-3.1-flash-image-preview')?.imageOutputUsdPerToken, '0.00006');
  assert.equal(entries.find(entry => entry.provider === 'elevenlabs')?.audioUsdPerCharacter, '0.0001');
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
