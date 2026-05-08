import assert from 'node:assert/strict';
import test from 'node:test';

import type { JSONGenerationOptions } from './gemini.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeSearchBeatSheet() {
  return {
    isPublicDomain: true,
    confidence: 0.91,
    title: 'The Lost Crown',
    author: 'Anonymous',
    provider: 'Wikisource',
    sourceUrl: 'https://en.wikisource.org/wiki/The_Lost_Crown',
    licenseNote: 'Public-domain source hosted on Wikisource.',
    requiredCharacters: ['The youngest prince', 'the queen'],
    requiredLocations: ['the old forest'],
    magicalObjects: ['the lost crown'],
    eventOrder: ['The crown is stolen.', 'The prince follows the trail.', 'The crown is restored.'],
    forbiddenSubstitutions: ['Do not replace the crown with a new trinket.'],
    softenableBeats: ['Danger can be non-graphic.'],
    fidelityWarnings: ['Keep the recovery of the crown as the ending.'],
  };
}

test('retelling classifier distinguishes faithful classics from original prompts', async () => {
  const storySources = await import('./storySources.js');

  const greuceanu = storySources.classifyRetellingRequest(
    'Creaza povestea lui Greuceanu cat mai aproape de original',
    'ro',
  );
  const typoGreuceanu = storySources.classifyRetellingRequest(
    'Creaza povestea lui grauceanu cat mai aproape de original',
    'ro',
  );
  const original = storySources.classifyRetellingRequest(
    'un iepuras intr-o gradina magica',
    'ro',
  );

  assert.equal(greuceanu.shouldResolve, true);
  assert.equal(greuceanu.manifestSource?.id, 'ro-greuceanu');
  assert.equal(typoGreuceanu.shouldResolve, true);
  assert.equal(typoGreuceanu.manifestSource?.id, 'ro-greuceanu');
  assert.equal(original.shouldResolve, false);
  assert.equal(original.manifestSource, undefined);
});

test('Greuceanu resolves from the committed manifest without live fetch or model analysis', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, { useSupabase: false });

  let generateCalls = 0;
  let fetchCalls = 0;
  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Creaza povestea lui Greuceanu cat mai aproape de original',
      language: 'ro',
    },
    {
      generateJSON: async () => {
        generateCalls += 1;
        throw new Error('Unexpected source analysis');
      },
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error('Unexpected source fetch');
      },
    },
  );

  assert.equal(source?.title, 'Greuceanu');
  assert.equal(source?.provider, 'wikisource');
  assert.equal(source?.sourceCacheHit, true);
  assert.ok(source?.canonicalBeatSheet.requiredCharacters.includes('Faurul Pământului'));
  assert.equal(generateCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('unknown public-domain requests try trusted providers before Gemini Search fallback', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gemini-3.1-flash-lite',
  });

  const requestedUrls: string[] = [];
  const calls: Array<{ prompt: string; options?: { model?: string; tools?: unknown[] } }> = [];
  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Retell The Lost Crown faithfully',
      language: 'en',
    },
    {
      generateJSON: async <T>(
        prompt: string,
        _systemInstruction: string,
        _schema: Record<string, unknown>,
        options?: JSONGenerationOptions,
      ) => {
        calls.push({ prompt, options });
        return makeSearchBeatSheet() as T;
      },
      fetchFn: async (url) => {
        requestedUrls.push(String(url));
        return {
          ok: false,
          text: async () => '',
          json: async () => ({}),
        } as Response;
      },
    },
  );

  assert.equal(source?.title, 'The Lost Crown');
  assert.ok(requestedUrls.some(url => url.includes('en.wikisource.org/w/api.php')));
  assert.ok(requestedUrls.some(url => url.includes('gutenberg.org/ebooks/search')));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options?.tools, [{ googleSearch: {} }]);
});

test('unknown public-domain requests can fall back to Gemini Google Search', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gemini-3.1-flash-lite',
  });

  const calls: Array<{ prompt: string; options?: { model?: string; tools?: unknown[] } }> = [];
  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Retell The Lost Crown faithfully',
      language: 'en',
    },
    {
      generateJSON: async <T>(
        prompt: string,
        _systemInstruction: string,
        _schema: Record<string, unknown>,
        options?: JSONGenerationOptions,
      ) => {
        calls.push({ prompt, options });
        return makeSearchBeatSheet() as T;
      },
      fetchFn: async () => ({
        ok: false,
        text: async () => '',
        json: async () => ({}),
      } as Response),
    },
  );

  assert.equal(source?.title, 'The Lost Crown');
  assert.equal(source?.provider, 'wikisource');
  assert.equal(source?.sourceCacheHit, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options?.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls[0].options?.tools, [{ googleSearch: {} }]);
  assert.match(calls[0].prompt, /Find a trusted public-domain source/);
});
