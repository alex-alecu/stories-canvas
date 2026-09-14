import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import type { Character, Page } from '../../shared/types.js';

test('restoreSavedSceneImages restores valid saved pages and leaves missing pages incomplete', async t => {
  const { config } = await import('../config.js');
  const { restoreSavedSceneImages } = await import('./sceneGenerator.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saved-scenes-'));
  const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
  Object.assign(config, { dataDir: directory, useSupabase: false });
  t.after(async () => { Object.assign(config, previous); await fs.rm(directory, { recursive: true, force: true }); });
  const storyId = 'saved-story';
  const pages = [
    makePage({ pageNumber: 1, status: 'generating' }),
    makePage({ pageNumber: 2, status: 'pending' }),
    makePage({ pageNumber: 3, status: 'completed' }),
    makePage({ pageNumber: 4, status: 'completed' }),
  ];
  const storyDirectory = path.join(directory, storyId);
  await fs.mkdir(storyDirectory, { recursive: true });
  await fs.writeFile(path.join(storyDirectory, 'scenario.json'), JSON.stringify({
    id: storyId, prompt: 'Story', status: 'failed', createdAt: new Date().toISOString(),
    scenario: { title: 'Story', targetAge: 3, characters: [], pages },
  }));
  await fs.writeFile(path.join(storyDirectory, 'page-01.png'), await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  }).png().toBuffer());
  await fs.writeFile(path.join(storyDirectory, 'page-04.png'), 'corrupt image');

  await restoreSavedSceneImages(storyId, pages);

  assert.deepEqual(pages.map(page => page.status), ['completed', 'pending', 'pending', 'pending']);
  const saved = JSON.parse(await fs.readFile(path.join(storyDirectory, 'scenario.json'), 'utf8'));
  assert.deepEqual(saved.scenario.pages.map((page: Page) => page.status), ['completed', 'pending', 'pending', 'pending']);
});


function makePage(overrides: Partial<Page> = {}): Page {
  return {
    pageNumber: 2,
    text: 'A gentle rabbit waves from the hill.',
    imagePrompt: 'Gentle rabbit on a hill at sunrise',
    characters: [],
    status: 'pending',
    ...overrides,
  };
}

test('scene cancellation reaches the image request and stops retries', async () => {
  const { generateSceneImage } = await import('./sceneGenerator.js');
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(generateSceneImage('story-cancel', makePage(), [], new Map(), undefined, undefined, undefined, null, false, {
    signal: controller.signal,
    updatePageStatus: async () => {},
    generateImage: async (_prompt, _references, options) => {
      attempts++;
      assert.equal(options?.signal, controller.signal);
      controller.abort(new Error('Generation cancelled'));
      throw new Error('Generation cancelled');
    },
    retryOptions: { minTimeout: 0, maxTimeout: 0 },
  }), /Generation cancelled/);
  assert.equal(attempts, 1);
});

function createLogger() {
  const entries = {
    error: [] as string[],
    warn: [] as string[],
  };

  return {
    entries,
    logger: {
      error: (...args: unknown[]) => {
        entries.error.push(args.map(String).join(' '));
      },
      warn: (...args: unknown[]) => {
        entries.warn.push(args.map(String).join(' '));
      },
    },
  };
}

test('generateSceneImage marks safety-blocked pages as failed without logging an error stack', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const imageProvider = await import('./openrouterImages.js');
  const { entries, logger } = createLogger();
  const progressMessages: string[] = [];
  const statuses: string[] = [];
  let attempts = 0;
  let savedImage = false;

  const result = await sceneGenerator.generateSceneImage(
    'story-safety',
    makePage(),
    [] as Character[],
    new Map(),
    'Storybook illustration style',
    progress => {
      if (progress.message) {
        progressMessages.push(progress.message);
      }
    },
    undefined,
    undefined,
    false,
    {
      generateImage: async () => {
        attempts++;
        throw new imageProvider.ImageSafetyBlockedError(
          'gemini-3.1-flash-image-preview',
          'Image generation blocked by safety filters on model gemini-3.1-flash-image-preview',
        );
      },
      log: logger,
      retryOptions: {
        retries: 1,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {
        savedImage = true;
      },
      updatePageStatus: async (_storyId, _pageNumber, status) => {
        statuses.push(status);
      },
    },
  );

  assert.equal(result, null);
  assert.equal(attempts, 2);
  assert.equal(savedImage, false);
  assert.deepEqual(statuses, ['generating', 'failed']);
  assert.equal(entries.error.length, 0);
  assert.equal(entries.warn.length, 2);
  assert.match(entries.warn[0], /Safety filter hit on page 2, attempt 1/);
  assert.match(entries.warn[0], /Image generation blocked by safety filters on model gemini-3.1-flash-image-preview/);
  assert.match(entries.warn[1], /blocked by image safety filters after prompt softening/);
  assert.match(entries.warn[1], /Image generation blocked by safety filters on model gemini-3.1-flash-image-preview/);
  assert.match(progressMessages.at(-1) ?? '', /image provider blocked it with safety filters/i);
});

test('generateSceneImage keeps non-safety generation failures on the error path', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const { entries, logger } = createLogger();
  const progressMessages: string[] = [];
  const statuses: string[] = [];

  const result = await sceneGenerator.generateSceneImage(
    'story-error',
    makePage({ pageNumber: 4 }),
    [] as Character[],
    new Map(),
    'Storybook illustration style',
    progress => {
      if (progress.message) {
        progressMessages.push(progress.message);
      }
    },
    undefined,
    undefined,
    false,
    {
      generateImage: async () => {
        throw new Error('upstream connection reset');
      },
      log: logger,
      retryOptions: {
        retries: 0,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {
        throw new Error('should not save image');
      },
      updatePageStatus: async (_storyId, _pageNumber, status) => {
        statuses.push(status);
      },
    },
  );

  assert.equal(result, null);
  assert.deepEqual(statuses, ['generating', 'failed']);
  assert.equal(entries.warn.length, 1);
  assert.match(entries.warn[0], /Page 4 attempt 1 failed: upstream connection reset/);
  assert.equal(entries.error.length, 1);
  assert.match(entries.error[0], /Failed to generate page 4:/);
  assert.match(progressMessages.at(-1) ?? '', /image provider returned an error/i);
});

test('generateSceneImage does not soften-and-retry provider policy blocks', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const imageProvider = await import('./openrouterImages.js');
  const { entries, logger } = createLogger();
  const progressMessages: string[] = [];
  const statuses: string[] = [];
  let attempts = 0;

  const result = await sceneGenerator.generateSceneImage(
    'story-policy',
    makePage({ pageNumber: 6 }),
    [] as Character[],
    new Map(),
    'Storybook illustration style',
    progress => {
      if (progress.message) {
        progressMessages.push(progress.message);
      }
    },
    undefined,
    undefined,
    false,
    {
      generateImage: async () => {
        attempts++;
        throw new imageProvider.ImagePolicyBlockedError(
          'gemini-3.1-flash-image-preview',
          'Image generation blocked by provider policy on model gemini-3.1-flash-image-preview: candidate 1, finishReason=PROHIBITED_CONTENT, parts=missing',
        );
      },
      log: logger,
      retryOptions: {
        retries: 1,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {
        throw new Error('should not save image');
      },
      updatePageStatus: async (_storyId, _pageNumber, status) => {
        statuses.push(status);
      },
    },
  );

  assert.equal(result, null);
  assert.equal(attempts, 1);
  assert.deepEqual(statuses, ['generating', 'failed']);
  assert.equal(entries.error.length, 0);
  assert.equal(entries.warn.length, 1);
  assert.match(entries.warn[0], /Page 6 was rejected by provider policy/);
  assert.match(progressMessages.at(-1) ?? '', /prohibited-content policy/i);
});

test('generateSceneImage includes current page image as regeneration context', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  let capturedPrompt = '';
  let capturedReferenceImages: Array<{ data: string; mimeType: string }> = [];

  const result = await sceneGenerator.generateSceneImage(
    'story-current-reference',
    makePage({ pageNumber: 1 }),
    [] as Character[],
    new Map(),
    'Storybook illustration style',
    undefined,
    undefined,
    undefined,
    false,
    {
      generateImage: async (prompt, referenceImages) => {
        capturedPrompt = prompt;
        capturedReferenceImages = referenceImages ?? [];
        return 'scene-image-base64';
      },
      retryOptions: {
        retries: 0,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {},
      updatePageStatus: async () => {},
    },
    undefined,
    'current-page-image-base64',
  );

  assert.equal(result, 'scene-image-base64');
  assert.deepEqual(capturedReferenceImages, [
    { data: 'current-page-image-base64', mimeType: 'image/png' },
  ]);
  assert.match(capturedPrompt, /current page image to preserve/);
});

test('generateSceneImage keeps four character sheets with scene continuity references', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const characters: Character[] = Array.from({ length: 4 }, (_, index) => ({
    name: `Hero ${index + 1}`,
    role: 'hero',
    appearance: `Distinct appearance ${index + 1}.`,
    clothing: `Distinct clothing ${index + 1}.`,
    personality: 'Brave.',
    characterSheetPrompt: `Reference sheet ${index + 1}.`,
  }));
  let references: string[] = [];

  const result = await sceneGenerator.generateSceneImage(
    'story-four-character-references',
    makePage({
      pageNumber: 8,
      text: 'The four heroes meet in the garden.',
      imagePrompt: 'The four heroes meet in the garden.',
      characters: characters.map(character => character.name),
    }),
    characters,
    new Map(characters.map((character, index) => [character.name, `sheet-${index + 1}`])),
    'Storybook illustration style',
    undefined,
    undefined,
    'previous-scene',
    false,
    {
      generateImage: async (_prompt, referenceImages) => {
        references = (referenceImages ?? []).map(image => image.data);
        return 'scene-image';
      },
      retryOptions: { retries: 0, minTimeout: 0, maxTimeout: 0, randomize: false },
      saveSceneImage: async () => {},
      updatePageStatus: async () => {},
    },
    undefined,
    'current-scene',
  );

  assert.equal(result, 'scene-image');
  assert.deepEqual(references, [
    'sheet-1',
    'sheet-2',
    'sheet-3',
    'sheet-4',
    'current-scene',
    'previous-scene',
  ]);
});

test('FLUX Klein keeps four character sheets and omits optional scene references above its limit', async () => {
  const { withImageModel } = await import('./imageGenerationContext.js');
  const { parseImageModel } = await import('../../shared/imageModels.js');
  const sceneGenerator = await import('./sceneGenerator.js');
  const characters: Character[] = Array.from({ length: 4 }, (_, index) => ({
    name: `Hero ${index + 1}`,
    role: 'hero',
    appearance: `Distinct appearance ${index + 1}.`,
    clothing: `Distinct clothing ${index + 1}.`,
    personality: 'Brave.',
    characterSheetPrompt: `Reference sheet ${index + 1}.`,
  }));
  let references: string[] = [];
  let prompt = '';

  const result = await withImageModel(parseImageModel('black-forest-labs/flux.2-klein-4b'), () => sceneGenerator.generateSceneImage(
    'story-qwen-reference-limit',
    makePage({
      pageNumber: 9,
      text: 'The four heroes meet in the garden.',
      imagePrompt: 'The four heroes meet in the garden.',
      characters: characters.map(character => character.name),
    }),
    characters,
    new Map(characters.map((character, index) => [character.name, `sheet-${index + 1}`])),
    'Storybook illustration style',
    undefined,
    undefined,
    'previous-scene',
    false,
    {
      generateImage: async (value, referenceImages) => {
        prompt = value;
        references = (referenceImages ?? []).map(image => image.data);
        return 'scene-image';
      },
      retryOptions: { retries: 0, minTimeout: 0, maxTimeout: 0, randomize: false },
      saveSceneImage: async () => {},
      updatePageStatus: async () => {},
    },
    undefined,
    'current-scene',
  ));

  assert.equal(result, 'scene-image');
  assert.deepEqual(references, ['sheet-1', 'sheet-2', 'sheet-3', 'sheet-4']);
  assert.doesNotMatch(prompt, /current page image to preserve/);
  assert.doesNotMatch(prompt, /previous scene image as a continuity reference/);
});

test('generateSceneImage logs the exact prohibited prompt and provider-policy debug context', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const imageProvider = await import('./openrouterImages.js');
  const { entries, logger } = createLogger();
  const statuses: string[] = [];
  const page = makePage({
    pageNumber: 9,
    text: 'Bambi and Cenușăreasa walk through the moonlit garden.',
    imagePrompt: 'Bambi and Cenușăreasa walk together in Disney/Pixar 3D animation style with warm, round, and friendly character designs.',
    characters: ['Bambi', 'Cenușăreasa'],
  });
  const characters: Character[] = [
    {
      name: 'Bambi',
      role: 'hero',
      appearance: 'Bambi is a young spotted fawn with bright eyes.',
      clothing: 'Bambi wears a tiny blue scarf.',
      personality: 'gentle',
      characterSheetPrompt: 'Reference sheet for Bambi.',
    },
    {
      name: 'Cenușăreasa',
      role: 'friend',
      appearance: 'Cenușăreasa has kind eyes and chestnut hair in a braid.',
      clothing: 'Cenușăreasa wears a pale blue dress and silver shoes.',
      personality: 'kind',
      characterSheetPrompt: 'Reference sheet for Cenușăreasa.',
    },
  ];

  const result = await sceneGenerator.generateSceneImage(
    'story-policy-debug',
    page,
    characters,
    new Map([['Bambi', 'sheet-one']]),
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
    undefined,
    undefined,
    'previous-scene-base64',
    false,
    {
      generateImage: async () => {
        throw new imageProvider.ImagePolicyBlockedError(
          'gemini-3.1-flash-image-preview',
          'Image generation blocked by provider policy on model gemini-3.1-flash-image-preview: candidate 1, finishReason=PROHIBITED_CONTENT, parts=missing',
        );
      },
      log: logger,
      retryOptions: {
        retries: 0,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {
        throw new Error('should not save image');
      },
      updatePageStatus: async (_storyId, _pageNumber, status) => {
        statuses.push(status);
      },
    },
  );

  assert.equal(result, null);
  assert.deepEqual(statuses, ['generating', 'failed']);
  assert.equal(entries.warn.length, 1);
  assert.match(entries.warn[0], /"sanitizedPrompt":"/);
  assert.match(entries.warn[0], /reference sheet for character one/);
  assert.match(entries.warn[0], /"rawImagePrompt":"Bambi and Cenușăreasa walk together in Disney\/Pixar/);
  assert.match(entries.warn[0], /"pageCharacters":\["Bambi","Cenușăreasa"\]/);
  assert.match(entries.warn[0], /"includedCharacterSheets":\["Bambi"\]/);
  assert.match(entries.warn[0], /"missingCharacterSheets":\["Cenușăreasa"\]/);
  assert.match(entries.warn[0], /"hasPreviousScene":true/);
  assert.match(entries.warn[0], /"containsBrandedStyleTokens":false/);
  assert.match(entries.warn[0], /"remainingCharacterNames":\[\]/);
});

test('generateSceneImage sanitizes outbound prompts without mutating visible story data', async () => {
  const sceneGenerator = await import('./sceneGenerator.js');
  const statuses: string[] = [];
  const capturedPrompts: string[] = [];
  const page = makePage({
    pageNumber: 8,
    imagePrompt: 'Bambi and Cenușăreasa walk together in Disney/Pixar 3D animation style with warm, round, and friendly character designs.',
    characters: ['Bambi', 'Cenușăreasa'],
  });
  const originalPage = structuredClone(page);
  const characters: Character[] = [
    {
      name: 'Bambi',
      role: 'hero',
      appearance: 'Bambi is a young spotted fawn with bright eyes.',
      clothing: 'Bambi wears a tiny blue scarf.',
      personality: 'gentle',
      characterSheetPrompt: 'Reference sheet for Bambi.',
    },
    {
      name: 'Cenușăreasa',
      role: 'friend',
      appearance: 'Cenușăreasa has kind eyes and chestnut hair in a braid.',
      clothing: 'Cenușăreasa wears a pale blue dress and silver shoes.',
      personality: 'kind',
      characterSheetPrompt: 'Reference sheet for Cenușăreasa.',
    },
  ];
  const originalCharacters = structuredClone(characters);

  const result = await sceneGenerator.generateSceneImage(
    'story-sanitized',
    page,
    characters,
    new Map([
      ['Bambi', 'sheet-one'],
      ['Cenușăreasa', 'sheet-two'],
    ]),
    'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
    undefined,
    undefined,
    undefined,
    false,
    {
      generateImage: async (prompt) => {
        capturedPrompts.push(prompt);
        return 'scene-image-base64';
      },
      retryOptions: {
        retries: 0,
        minTimeout: 0,
        maxTimeout: 0,
        randomize: false,
      },
      saveSceneImage: async () => {},
      updatePageStatus: async (_storyId, _pageNumber, status) => {
        statuses.push(status);
      },
    },
  );

  assert.equal(result, 'scene-image-base64');
  assert.deepEqual(statuses, ['generating', 'completed']);
  assert.deepEqual(page, originalPage);
  assert.deepEqual(characters, originalCharacters);
  assert.equal(capturedPrompts.length, 1);
  assert.match(capturedPrompts[0], /reference sheet for character one/);
  assert.match(capturedPrompts[0], /reference sheet for character two/);
  assert.doesNotMatch(capturedPrompts[0], /Bambi/u);
  assert.doesNotMatch(capturedPrompts[0], /Cenușăreasa/u);
  assert.doesNotMatch(capturedPrompts[0], /Disney|Pixar/u);
});
