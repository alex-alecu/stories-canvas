import assert from 'node:assert/strict';
import test from 'node:test';

import type { TextGenerationOptions } from './openrouter.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeSearchBeatSheet() {
  return {
    isPublicDomain: true,
    confidence: 0.91,
    title: 'The Lost Crown',
    author: 'Anonymous',
    provider: 'OpenAI Search',
    sourceUrl: 'https://en.wikisource.org/wiki/The_Lost_Crown',
    licenseNote: 'Public-domain source hosted on Wikisource.',
    sourceAnalysisVersion: 2,
    requiredCharacters: ['The youngest prince', 'the queen'],
    requiredLocations: ['the old forest'],
    magicalObjects: ['the lost crown'],
    identityConstraints: ['The youngest prince remains a young royal, not a small child.'],
    eventOrder: ['The crown is stolen.', 'The prince follows the trail.', 'The crown is restored.'],
    canonicalEnding: ['The crown is restored to the queen.'],
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

test('Harap-Alb resolves from the complete committed manifest beat sheet', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, { useSupabase: false });

  let generateCalls = 0;
  let fetchCalls = 0;
  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Adapteaza fidel Povestea lui Harap-Alb cat mai aproape de original',
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

  assert.equal(source?.title, 'Povestea lui Harap-Alb');
  assert.equal(source?.sourceCacheHit, true);
  assert.equal(source?.canonicalBeatSheet.sourceAnalysisVersion, storySources.SOURCE_ANALYSIS_VERSION);
  assert.ok(source?.canonicalBeatSheet.identityConstraints?.some(beat => /tanar fecior de crai|print/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.eventOrder.some(beat => /Gerilă|Flămânzilă|Setilă|Ochila/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.canonicalEnding?.some(beat => /invi|readuce la viata|nunta/i.test(beat)));
  assert.equal(generateCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('Povestea porcului resolves from a complete committed beat sheet', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, { useSupabase: false });

  let generateCalls = 0;
  let fetchCalls = 0;
  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Creează povestea Povestea porcului, urmează originalul exact.',
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

  assert.equal(source?.title, 'Povestea porcului');
  assert.equal(source?.provider, 'wikisource');
  assert.equal(source?.sourceCacheHit, true);
  assert.ok(source?.canonicalBeatSheet.eventOrder.some(beat => /Sfanta Miercuri|Sfânta Miercuri/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.eventOrder.some(beat => /ciocarlan/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.eventOrder.some(beat => /lapte/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.canonicalEnding?.some(beat => /trei nopti|a treia noapte/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.forbiddenSubstitutions.some(beat => /doar sa ajunga|fara incercari/i.test(beat)));
  assert.equal(generateCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('stale cached beat sheets without versioned endings are rejected', async () => {
  const storySources = await import('./storySources.js');

  assert.equal(storySources.isUsableCanonicalBeatSheet({
    requiredCharacters: ['Harap-Alb'],
    requiredLocations: ['curtea lui Verde-imparat'],
    magicalObjects: ['calul nazdravan'],
    eventOrder: ['bridge test', 'well oath', 'stag quest'],
    forbiddenSubstitutions: [],
    softenableBeats: [],
    fidelityWarnings: [],
  }), false);

  assert.equal(storySources.isUsableCanonicalBeatSheet({
    sourceAnalysisVersion: storySources.SOURCE_ANALYSIS_VERSION,
    requiredCharacters: ['Harap-Alb'],
    requiredLocations: ['curtea lui Verde-imparat'],
    magicalObjects: ['calul nazdravan'],
    identityConstraints: ['Harap-Alb remains a young prince.'],
    eventOrder: ['bridge test', 'well oath', 'true ending'],
    canonicalEnding: ['Harap-Alb is revived and Spânul is defeated.'],
    forbiddenSubstitutions: [],
    softenableBeats: [],
    fidelityWarnings: [],
  }), true);
});

test('collapsed quest beat sheets are rejected before they reach generation', async () => {
  const storySources = await import('./storySources.js');

  assert.equal(storySources.isUsableCanonicalBeatSheet({
    sourceAnalysisVersion: storySources.SOURCE_ANALYSIS_VERSION,
    requiredCharacters: ['Fata imparatului', 'Fat-Frumos'],
    requiredLocations: ['Manastirea-de-Tamaie'],
    magicalObjects: ['pielea fermecata'],
    identityConstraints: ['Fata imparatului ramane sotia lui Fat-Frumos.'],
    eventOrder: [
      'Fata arde pielea fermecata.',
      'Fat-Frumos pleaca departe.',
      'Fata porneste in cautarea sotului pierdut.',
      'Fata ajunge la Manastirea-de-Tamaie si se reuneste cu Fat-Frumos.',
    ],
    canonicalEnding: ['Fata il gaseste pe Fat-Frumos la Manastirea-de-Tamaie.'],
    forbiddenSubstitutions: ['Nu schimba personajele.'],
    softenableBeats: ['Drumul poate fi non-grafic.'],
    fidelityWarnings: ['Pastreaza finalul.'],
  }), false);
});

test('source analysis reads later chunks so long sources keep their canonical ending', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gpt-5.6-sol',
  });

  const longSourceText = `${'Opening bridge test. '.repeat(2200)}\n\n${'Middle impossible quests. '.repeat(2200)}\n\nENDING_MARKER The hero is revived with living water and the false servant is defeated.`;
  const calls: Array<{ prompt: string; options?: TextGenerationOptions }> = [];

  const source = await storySources.resolveRetellingSource(
    {
      userPrompt: 'Retell The Long Tale faithfully',
      language: 'en',
    },
    {
      generateJSON: async <T>(
        prompt: string,
        _systemInstruction: string,
        _schema: Record<string, unknown>,
        options?: TextGenerationOptions,
      ) => {
        calls.push({ prompt, options });
        const hasEnding = prompt.includes('ENDING_MARKER');
        return {
          title: 'The Long Tale',
          author: 'Anonymous',
          sourceAnalysisVersion: storySources.SOURCE_ANALYSIS_VERSION,
          requiredCharacters: ['The young prince', 'the false servant'],
          requiredLocations: ['the royal road'],
          magicalObjects: ['living water'],
          identityConstraints: ['The young prince remains a young royal, not a small child.'],
          eventOrder: hasEnding
            ? ['The hero is revived with living water.', 'The false servant is defeated.']
            : ['The bridge test begins.', 'The false servant traps the hero.', 'The impossible quests begin.'],
          canonicalEnding: hasEnding
            ? ['The hero is revived with living water and the false servant is defeated.']
            : [],
          forbiddenSubstitutions: ['Do not skip the revival.'],
          softenableBeats: ['The defeat can be non-graphic.'],
          fidelityWarnings: ['Keep the ending.'],
        } as T;
      },
      fetchFn: async (url) => {
        const href = String(url);
        if (href.includes('opensearch')) {
          return {
            ok: true,
            json: async () => ['The Long Tale', ['The Long Tale'], [''], ['https://en.wikisource.org/wiki/The_Long_Tale']],
            text: async () => '',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ query: { pages: [{ extract: longSourceText }] } }),
          text: async () => longSourceText,
        } as Response;
      },
    },
  );

  assert.equal(source?.title, 'The Long Tale');
  assert.ok(calls.length > 1);
  assert.ok(calls.every(call => call.options?.tools === undefined));
  assert.ok(source?.canonicalBeatSheet.eventOrder.some(beat => /revived/i.test(beat)));
  assert.ok(source?.canonicalBeatSheet.canonicalEnding?.some(beat => /living water/i.test(beat)));
});

test('source analysis stops before the next chunk after cancellation', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gpt-5.6-sol',
  });

  const controller = new AbortController();
  const longSourceText = `${'Opening bridge test. '.repeat(2200)}\n\n${'Middle impossible quests. '.repeat(2200)}`;
  let generateCalls = 0;

  await assert.rejects(
    () => storySources.resolveRetellingSource(
      {
        userPrompt: 'Retell The Cancelled Tale faithfully',
        language: 'en',
      },
      {
        signal: controller.signal,
        generateJSON: async <T>(
          _prompt: string,
          _systemInstruction: string,
          _schema: Record<string, unknown>,
          options?: TextGenerationOptions,
        ) => {
          generateCalls += 1;
          assert.equal(options?.signal, controller.signal);
          controller.abort();
          return makeSearchBeatSheet() as T;
        },
        fetchFn: async (url, init) => {
          assert.equal(init?.signal, controller.signal);
          if (String(url).includes('opensearch')) {
            return {
              ok: true,
              json: async () => ['The Cancelled Tale', ['The Cancelled Tale'], [''], ['https://en.wikisource.org/wiki/The_Cancelled_Tale']],
              text: async () => '',
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ query: { pages: [{ extract: longSourceText }] } }),
            text: async () => longSourceText,
          } as Response;
        },
      },
    ),
    error => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.equal(generateCalls, 1);
});

test('unknown public-domain requests try trusted providers before OpenAI Search fallback', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gpt-5.6-sol',
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
        options?: TextGenerationOptions,
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
  assert.deepEqual(calls[0].options?.tools, [{ type: 'web_search', search_context_size: 'high' }]);
});

test('unknown public-domain requests can fall back to OpenAI web search', async () => {
  const { config } = await import('../config.js');
  const storySources = await import('./storySources.js');
  Object.assign(config, {
    useSupabase: false,
    sourceAnalysisModel: 'gpt-5.6-sol',
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
        options?: TextGenerationOptions,
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
  assert.equal(source?.provider, 'openai_search');
  assert.equal(source?.sourceCacheHit, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options?.model, 'gpt-5.6-sol');
  assert.deepEqual(calls[0].options?.tools, [{ type: 'web_search', search_context_size: 'high' }]);
  assert.match(calls[0].prompt, /Find a trusted public-domain source/);
});
