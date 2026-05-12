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
      appearance: 'Fair skin, rosy cheeks, big expressive blue eyes, blonde hair tied back with a simple ribbon.',
      clothing: 'Starts in a patched brown dress and white apron. Later wears a sparkling, voluminous light blue ballgown with elegant glass slippers.',
      personality: 'kind',
      characterSheetPrompt: 'Reference sheet for Cinderella in Disney/Pixar 3D animation style.',
    },
    {
      name: 'Zâna Bună',
      role: 'helper',
      appearance: 'Plump, sweet older lady with white hair, a kind smile, and rosy cheeks.',
      clothing: 'A sparkling light blue hooded cape over a soft pink dress, holding a glowing star-tipped magic wand.',
      personality: 'wise',
      characterSheetPrompt: 'Reference sheet for The Fairy Godmother in Disney/Pixar 3D animation style.',
    },
    {
      name: 'Prințul',
      role: 'friend',
      appearance: 'Handsome young man, kind brown eyes, neat brown hair, warm and gentle smile.',
      clothing: 'Royal white jacket with gold epaulets, a red sash, and dark blue pants.',
      personality: 'gentle',
      characterSheetPrompt: 'Reference sheet for The Prince in Disney/Pixar 3D animation style.',
    },
  ];
}

function makeCinderellaCharacters(): Character[] {
  return makeCharacters().slice(1);
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
  assert.equal(aliasMap.has('Later'), false);
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

test('prepareCharacterSheetImagePrompt removes text labels and protected names', () => {
  const [, character] = makeCharacters();
  const aliasMap = buildCharacterAliasMap(makeCharacters());
  const prompt = prepareCharacterSheetImagePrompt(
    character,
    aliasMap,
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /character two/);
  assert.match(prompt, /Absolutely no readable or pseudo-readable text/);
  assert.match(prompt, /typography/);
  assert.doesNotMatch(prompt, /Cinderella/u);
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

test('prepareSceneImagePrompt removes text overlay trigger wording', () => {
  const page = makePage();
  page.imagePrompt = 'Bambi walks across a wooden bridge. Lower-frame-safe composition for text overlay with a blank caption area at the bottom.';

  const prompt = prepareSceneImagePrompt(
    page,
    makeCharacters(),
    false,
    ['Bambi'],
    'Classic hand-drawn storybook illustration',
  );

  assert.match(prompt, /bottom third must still be a complete, fully illustrated continuation of the scene/);
  assert.match(prompt, /Never leave the bottom third blank, empty, flat, plain, clean, unused, or simplified/);
  assert.match(prompt, /noncritical illustrated environment in the bottom third/);
  assert.match(prompt, /Never write text in images/);
  assert.match(prompt, /Never, never add readable or pseudo-readable text of any kind/);
  assert.match(prompt, /no marks that resemble writing/);
  assert.doesNotMatch(prompt, /text overlay/iu);
  assert.doesNotMatch(prompt, /caption area/iu);
  assert.doesNotMatch(prompt, /reserved for app layout/iu);
  assert.doesNotMatch(prompt, /blank caption/iu);
  assert.doesNotMatch(prompt, /blank fully illustrated/iu);
});

test('prepareSceneImagePrompt infers repeated legacy names against page character order', () => {
  const page = makePage();
  page.pageNumber = 11;
  page.imagePrompt = 'The Prince is kneeling on the wooden floor of a rustic house, gently sliding the glass slipper onto Cinderella\'s foot. It fits perfectly. Cinderella is smiling brightly.';
  page.characters = ['Cenușăreasa', 'Prințul'];

  const prompt = prepareSceneImagePrompt(
    page,
    makeCharacters(),
    true,
    ['Prințul'],
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /character four is kneeling on the wooden floor/iu);
  assert.match(prompt, /helping character two try on an elegant shoe/iu);
  assert.match(prompt, /character two is smiling brightly/iu);
  assert.doesNotMatch(prompt, /Cinderella/u);
  assert.doesNotMatch(prompt, /The Prince/u);
});

test('sanitizeImagePromptText originalizes iconic fairytale motifs in legacy prompts', () => {
  const sanitized = sanitizeImagePromptText(
    'A large clock tower in the background shows midnight while Cinderella wears a sparkling, voluminous light blue ballgown with elegant glass slippers.',
    buildCharacterAliasMap(makeCinderellaCharacters()),
  );

  assert.doesNotMatch(sanitized, /midnight/u);
  assert.doesNotMatch(sanitized, /ballgown/u);
  assert.doesNotMatch(sanitized, /glass slipper/u);
  assert.match(sanitized, /late hour/u);
  assert.match(sanitized, /formal gown/u);
  assert.match(sanitized, /dress shoes/u);
});

test('prepareSceneImagePrompt originalizes iconic transformation motifs from blocked live prompts', () => {
  const characters = makeCinderellaCharacters();
  const page: Page = {
    pageNumber: 6,
    text: 'Apoi, Zâna a atins hainele rupte ale fetei.',
    imagePrompt: 'Cinderella is spinning around joyfully in the garden, now wearing a sparkling light blue ballgown and glass slippers. The Fairy Godmother is smiling nearby on the right. Magical sparkles fill the air.',
    characters: ['Cenușăreasa', 'Zâna Bună'],
    status: 'pending',
  };

  const prompt = prepareSceneImagePrompt(
    page,
    characters,
    true,
    ['Cenușăreasa', 'Zâna Bună'],
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /character one is spinning around joyfully/iu);
  assert.match(prompt, /character two is smiling nearby/iu);
  assert.doesNotMatch(prompt, /Cinderella/u);
  assert.doesNotMatch(prompt, /Fairy Godmother/u);
  assert.doesNotMatch(prompt, /ballgown/u);
  assert.doesNotMatch(prompt, /glass slipper/u);
  assert.match(prompt, /sparkling formal gown/u);
  assert.match(prompt, /dress shoes/u);
});

test('prepareSceneImagePrompt originalizes iconic shoe-fitting motifs from blocked live prompts', () => {
  const characters = makeCinderellaCharacters();
  const page: Page = {
    pageNumber: 11,
    text: 'A doua zi, Prințul a ajuns la casa Cenușăresei.',
    imagePrompt: 'The Prince is kneeling on the wooden floor of a rustic house, gently sliding the glass slipper onto Cinderella\'s foot. It fits perfectly. Cinderella is smiling brightly.',
    characters: ['Cenușăreasa', 'Prințul'],
    status: 'pending',
  };

  const prompt = prepareSceneImagePrompt(
    page,
    characters,
    true,
    ['Cenușăreasa', 'Prințul'],
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  );

  assert.match(prompt, /character three is kneeling on the wooden floor/iu);
  assert.match(prompt, /helping character one try on an elegant shoe/iu);
  assert.doesNotMatch(prompt, /glass slipper/u);
  assert.doesNotMatch(prompt, /Cinderella/u);
  assert.doesNotMatch(prompt, /The Prince/u);
});
