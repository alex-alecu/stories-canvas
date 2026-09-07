import assert from 'node:assert/strict';
import test from 'node:test';

import type { Character, Page } from '../../shared/types.js';


const character: Character = {
  name: 'Prâslea',
  role: 'hero',
  appearance: 'Warm olive skin, dark-brown eyes, and wavy black hair.',
  clothing: 'Moss-green tunic and ochre cloak.',
  personality: 'Brave and careful.',
  characterSheetPrompt: 'Reference sheet for Prâslea.',
};

const page: Page = {
  pageNumber: 7,
  text: 'Prâslea enters the copper palace.',
  imagePrompt: 'Prâslea in a moss-green tunic enters the copper palace.',
  characters: ['Prâslea'],
  status: 'pending',
};

test('reviewSceneImage sends the generated page before labeled character sheets and fails major identity drift', async () => {
  const { reviewSceneImage } = await import('./sceneImageReview.js');
  let capturedContents: unknown;
  const result = await reviewSceneImage(
    page,
    [character],
    ['Prâslea'],
    'generated-page',
    new Map([['Prâslea', 'reference-sheet']]),
    6,
    {
      generate: (async (contents: unknown) => {
        capturedContents = contents;
        return {
          summary: 'The hero has blond hair and pale skin.',
          retryFeedback: 'Match the olive skin and black hair in the Prâslea reference sheet.',
          issues: [{
            code: 'wrong_character_identity',
            severity: 'minor',
            characterName: 'Prâslea',
            summary: 'The face, skin tone, and hair do not match the reference sheet.',
          }],
        };
      }) as never,
    },
  );

  assert.equal(result.pass, false);
  assert.equal(result.issues[0].severity, 'major');
  assert.match(result.retryFeedback, /olive skin and black hair/i);
  const parts = (capturedContents as Array<{ parts: Array<Record<string, unknown>> }>)[0].parts;
  assert.deepEqual(parts.slice(1), [
    { inlineData: { data: 'generated-page', mimeType: 'image/png', detail: 'high' } },
    { inlineData: { data: 'reference-sheet', mimeType: 'image/png', detail: 'high' } },
  ]);
});
