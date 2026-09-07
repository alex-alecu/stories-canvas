import assert from 'node:assert/strict';
import test from 'node:test';
import { AbortError } from 'p-retry';

import type { Character } from '../../shared/types.js';


function makeCharacters(): Character[] {
  return [
    {
      name: 'Bambi',
      role: 'hero',
      appearance: 'Bambi is a young spotted fawn with bright eyes.',
      clothing: 'Bambi wears a tiny blue scarf.',
      personality: 'gentle',
      characterSheetPrompt: 'Reference sheet for Bambi in Disney/Pixar 3D animation style.',
    },
    {
      name: 'Cenușăreasa',
      role: 'friend',
      appearance: 'Cenușăreasa has kind eyes and chestnut hair in a braid.',
      clothing: 'Cenușăreasa wears a pale blue dress and silver shoes.',
      personality: 'kind',
      characterSheetPrompt: 'Reference sheet for Cenușăreasa in Disney/Pixar 3D animation style.',
    },
  ];
}

test('character requests receive cancellation and stop after a fatal cost error', async () => {
  const { generateAllCharacterSheets } = await import('./characterSheet.js');
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(generateAllCharacterSheets('story-cost-stop', makeCharacters(), undefined, controller.signal, undefined, false, {
    generateImage: async (_prompt, _references, options) => {
      calls++;
      assert.equal(options?.signal, controller.signal);
      throw new AbortError('Image cost unavailable');
    },
  }), /Image cost unavailable/);
  assert.equal(calls, 1);
});

test('generateAllCharacterSheets sanitizes outbound prompts without mutating stored character data', async () => {
  const characterSheet = await import('./characterSheet.js');
  const characters = makeCharacters();
  const originalCharacters = structuredClone(characters);
  const prompts: string[] = [];

  const result = await characterSheet.generateAllCharacterSheets(
    'story-characters',
    characters,
    undefined,
    undefined,
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
    false,
    {
      generateImage: async (prompt) => {
        prompts.push(prompt);
        return 'image-base64';
      },
      saveImage: async () => {},
      uploadImage: async () => '/mock-upload-url',
    },
  );

  assert.equal(result.size, 2);
  assert.deepEqual(characters, originalCharacters);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /character one/);
  assert.match(prompts[1], /character two/);
  assert.doesNotMatch(prompts[0], /Bambi/u);
  assert.doesNotMatch(prompts[1], /Cenușăreasa/u);
  assert.doesNotMatch(prompts[0], /Disney|Pixar/u);
  assert.doesNotMatch(prompts[1], /Disney|Pixar/u);
  assert.match(prompts[0], /Absolutely no readable or pseudo-readable text/);
  assert.match(prompts[1], /Absolutely no readable or pseudo-readable text/);
  assert.match(prompts[0], /typography/);
  assert.match(prompts[1], /typography/);
});
