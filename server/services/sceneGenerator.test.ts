import assert from 'node:assert/strict';
import test from 'node:test';

import type { Character, Page } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

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
  const gemini = await import('./gemini.js');
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
        throw new gemini.ImageSafetyBlockedError(
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
  const gemini = await import('./gemini.js');
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
        throw new gemini.ImagePolicyBlockedError(
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
