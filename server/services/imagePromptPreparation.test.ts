import assert from 'node:assert/strict';
import test from 'node:test';

import type { Character, Page } from '../../shared/types.js';
import {
  buildCharacterAliasMap,
  prepareCharacterSheetImagePrompt,
  prepareSceneImagePrompt,
  sanitizeImagePromptText,
} from './imagePromptPreparation.js';

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
      appearance: 'Cinderella has kind eyes and chestnut hair in a braid.',
      clothing: 'Cinderella wears a pale blue dress and silver shoes.',
      personality: 'kind',
      characterSheetPrompt: 'Reference sheet for Cinderella in Disney/Pixar 3D animation style.',
    },
    {
      name: 'Zâna Bună',
      role: 'helper',
      appearance: 'The Fairy Godmother is a plump older lady with white hair and a kind smile.',
      clothing: 'The Fairy Godmother wears a sparkling light blue hooded cape over a soft pink dress.',
      personality: 'wise',
      characterSheetPrompt: 'Reference sheet for The Fairy Godmother in Disney/Pixar 3D animation style.',
    },
  ];
}

function makePage(): Page {
  return {
    pageNumber: 4,
    text: 'Bambi and Cenușăreasa walk through the garden.',
    imagePrompt: 'Bambi and Cenușăreasa walk together in Disney/Pixar 3D animation style with warm, round, and friendly character designs.',
    characters: ['Bambi', 'Cenușăreasa'],
    status: 'pending',
  };
}

test('buildCharacterAliasMap assigns stable aliases from scenario order', () => {
  const aliasMap = buildCharacterAliasMap(makeCharacters());

  assert.equal(aliasMap.get('Bambi'), 'character one');
  assert.equal(aliasMap.get('Cenușăreasa'), 'character two');
});

test('sanitizeImagePromptText removes Disney/Pixar wording and aliases exact names', () => {
  const aliasMap = buildCharacterAliasMap(makeCharacters());
  const sanitized = sanitizeImagePromptText(
    'Bambi greets Cenușăreasa in Disney/Pixar style while Pixar lighting glows nearby.',
    aliasMap,
  );

  assert.match(sanitized, /character one/);
  assert.match(sanitized, /character two/);
  assert.doesNotMatch(sanitized, /Bambi/u);
  assert.doesNotMatch(sanitized, /Cenușăreasa/u);
  assert.doesNotMatch(sanitized, /Disney|Pixar/u);
});

test('sanitizeImagePromptText aliases translated canonical names discovered in character metadata', () => {
  const aliasMap = buildCharacterAliasMap(makeCharacters());
  const sanitized = sanitizeImagePromptText(
    'Cinderella twirls while The Fairy Godmother smiles nearby in Disney/Pixar style.',
    aliasMap,
  );

  assert.match(sanitized, /character two/);
  assert.match(sanitized, /character three/);
  assert.doesNotMatch(sanitized, /Cinderella/u);
  assert.doesNotMatch(sanitized, /Fairy Godmother/u);
  assert.doesNotMatch(sanitized, /Disney|Pixar/u);
});

test('prepareCharacterSheetImagePrompt removes text labels and protected names', () => {
  const [character] = makeCharacters();
  const aliasMap = buildCharacterAliasMap(makeCharacters());
  const prompt = prepareCharacterSheetImagePrompt(
    character,
    aliasMap,
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /character one/);
  assert.match(prompt, /No text or labels in the image\./);
  assert.doesNotMatch(prompt, /Bambi/u);
  assert.doesNotMatch(prompt, /Disney|Pixar/u);
  assert.doesNotMatch(prompt, /Label at the bottom/u);
});

test('prepareSceneImagePrompt sanitizes raw imagePrompt and reference labels', () => {
  const page = makePage();
  page.imagePrompt = 'Cinderella and The Fairy Godmother walk together in Disney/Pixar 3D animation style with warm, round, and friendly character designs.';
  page.characters = ['Cenușăreasa', 'Zâna Bună'];
  const prompt = prepareSceneImagePrompt(
    page,
    makeCharacters(),
    true,
    ['Cenușăreasa', 'Zâna Bună'],
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /reference sheet for character two/);
  assert.match(prompt, /reference sheet for character three/);
  assert.match(prompt, /character two and character three walk together/u);
  assert.doesNotMatch(prompt, /Cinderella/u);
  assert.doesNotMatch(prompt, /Fairy Godmother/u);
  assert.doesNotMatch(prompt, /Cenușăreasa/u);
  assert.doesNotMatch(prompt, /Zâna Bună/u);
  assert.doesNotMatch(prompt, /Disney|Pixar/u);
});
