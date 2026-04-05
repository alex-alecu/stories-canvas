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
