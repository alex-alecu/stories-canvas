import pRetry, { AbortError } from 'p-retry';
import fs from 'fs/promises';
import { generateImage, isImagePolicyBlockedError, isImageSafetyBlockedError } from './gemini.js';
import { buildCharacterAliasMap, prepareSceneImagePrompt } from './imagePromptPreparation.js';
import { saveImage, updatePageStatus as fsUpdatePageStatus, getImagePath } from '../utils/storage.js';
import { uploadImage, updatePageStatus as sbUpdatePageStatus, downloadImage } from './supabaseStorage.js';
import { getCharacterSheetFilename } from './characterSheet.js';
import { config } from '../config.js';
import { imageGenerationLimiter } from '../utils/rateLimiter.js';
import { getPageImageFilename } from '../utils/storyMedia.js';
import type { Page, Character, GenerationProgress } from '../../shared/types.js';

async function saveSceneImage(storyId: string, filename: string, base64: string, userId?: string): Promise<void> {
  if (config.useSupabase) {
    await uploadImage(userId, storyId, filename, base64);
  } else {
    await saveImage(storyId, filename, base64);
  }
}

async function updatePageStatusBoth(storyId: string, pageNumber: number, status: 'pending' | 'generating' | 'completed' | 'failed'): Promise<void> {
  if (config.useSupabase) {
    await sbUpdatePageStatus(storyId, pageNumber, status);
  } else {
    await fsUpdatePageStatus(storyId, pageNumber, status);
  }
}

async function downloadImageForRetry(storyId: string, filename: string, userId?: string): Promise<string> {
  if (config.useSupabase) {
    return downloadImage(storyId, filename, userId);
  }
  const imagePath = await getImagePath(storyId, filename);
  if (!imagePath) throw new Error(`Image not found: ${filename}`);
  const buffer = await fs.readFile(imagePath);
  return buffer.toString('base64');
}

function softenPrompt(prompt: string): string {
  return prompt
    .replace(/angry|furious|rage/gi, 'upset')
    .replace(/scary|terrifying|horror/gi, 'surprising')
    .replace(/fight|battle|attack/gi, 'challenge')
    .replace(/dark|darkness/gi, 'dim')
    .replace(/cry|crying|tears/gi, 'feeling sad')
    + '\n\nNote: This is a wholesome, gentle children\'s story illustration. Keep it bright, cheerful, and child-friendly.';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function promptContainsExactName(prompt: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(prompt);
}

interface SceneGenerationDeps {
  generateImage?: typeof generateImage;
  log?: Pick<Console, 'error' | 'warn'>;
  retryOptions?: Partial<{
    factor: number;
    maxTimeout: number;
    minTimeout: number;
    randomize: boolean;
    retries: number;
  }>;
  saveSceneImage?: typeof saveSceneImage;
  updatePageStatus?: typeof updatePageStatusBoth;
}

function buildProviderFailureMessage(pageNumber: number, error: unknown): string {
  if (isImageSafetyBlockedError(error)) {
    return `Page ${pageNumber} could not be illustrated because the image provider blocked it with safety filters, even after retrying with a softened prompt. You can retry it from Story Tools.`;
  }

  if (isImagePolicyBlockedError(error)) {
    return `Page ${pageNumber} could not be illustrated because the image provider rejected the prompt under its prohibited-content policy. You can edit the story details and retry it from Story Tools.`;
  }

  return `Page ${pageNumber} could not be illustrated because the image provider returned an error. You can retry it from Story Tools.`;
}

function buildProviderPolicyDebugContext(
  page: Page,
  characters: Character[],
  prompt: string,
  styleDescription: string | undefined,
  includedCharacterNames: string[],
  hasPreviousScene: boolean,
  referenceImageCount: number,
): string {
  const aliasMap = buildCharacterAliasMap(characters);
  const missingCharacterSheets = page.characters.filter(name => !includedCharacterNames.includes(name));
  const remainingCharacterNames = [...new Set(
    [...aliasMap.keys()]
      .filter(name => !/^character\s+/iu.test(name))
      .filter(name => promptContainsExactName(prompt, name)),
  )];

  return JSON.stringify({
    pageNumber: page.pageNumber,
    pageText: page.text,
    rawImagePrompt: page.imagePrompt,
    sanitizedPrompt: prompt,
    pageCharacters: page.characters,
    includedCharacterSheets: includedCharacterNames,
    missingCharacterSheets,
    hasPreviousScene,
    referenceImageCount,
    requestedStyleDescription: styleDescription ?? null,
    characterAliases: Object.fromEntries(aliasMap),
    containsBrandedStyleTokens: /\b(?:Disney|Pixar)\b/iu.test(prompt),
    remainingCharacterNames,
  });
}

export async function generateSceneImage(
  storyId: string,
  page: Page,
  characters: Character[],
  characterSheets: Map<string, string>,
  styleDescription?: string,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
  previousSceneBase64?: string | null,
  pro?: boolean,
  deps: SceneGenerationDeps = {},
): Promise<string | null> {
  const pageFilename = getPageImageFilename(page.pageNumber);
  const runGenerateImage = deps.generateImage ?? generateImage;
  const persistSceneImage = deps.saveSceneImage ?? saveSceneImage;
  const setPageStatus = deps.updatePageStatus ?? updatePageStatusBoth;
  const logger = deps.log ?? console;

  await setPageStatus(storyId, page.pageNumber, 'generating');
    onProgress?.({ message: `Generating image for page ${page.pageNumber}...`, pageNumber: page.pageNumber, pageStatus: 'generating' });

  const referenceImages: Array<{ data: string; mimeType: string }> = [];

  // Determine which scene references we have
  const hasPreviousScene = !!previousSceneBase64;

  // 1. Character reference sheets FIRST (authoritative source for character appearance)
  //    This primes the model on correct character appearance before seeing any drifted scenes
  const maxCharSheets = hasPreviousScene ? 4 : 5;
  const includedCharNames: string[] = [];
  for (const charName of page.characters) {
    if (includedCharNames.length >= maxCharSheets) break;
    const sheetBase64 = characterSheets.get(charName);
    if (sheetBase64) {
      referenceImages.push({ data: sheetBase64, mimeType: 'image/png' });
      includedCharNames.push(charName);
    }
  }

  // 2. Previous scene as environment/layout continuity reference
  if (hasPreviousScene) {
    referenceImages.push({ data: previousSceneBase64!, mimeType: 'image/png' });
  }

  const prompt = prepareSceneImagePrompt(page, characters, hasPreviousScene, includedCharNames, styleDescription);

  try {
    const base64 = await pRetry(
      async (attemptNumber) => {
        try {
          return await runGenerateImage(
            attemptNumber > 1 ? softenPrompt(prompt) : prompt,
            referenceImages,
            pro,
          );
        } catch (error: any) {
          // Check for safety filter
          if (isImageSafetyBlockedError(error)) {
            if (attemptNumber === 1) {
              logger.warn(
                `[scene:${storyId}] Safety filter hit on page ${page.pageNumber}, attempt ${attemptNumber}. `
                + `Softening prompt... ${error.message}`,
              );
            }
            if (attemptNumber >= 2) {
              throw new AbortError(error);
            }
            throw error; // retry with softened prompt
          }
          if (isImagePolicyBlockedError(error)) {
            throw new AbortError(error);
          }
          // Check for rate limit (429)
          if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
            logger.warn(`[scene:${storyId}] Rate limited on page ${page.pageNumber}, attempt ${attemptNumber}. Retrying...`);
            throw error; // p-retry handles backoff
          }
          throw error;
        }
      },
      {
        retries: 3,
        minTimeout: 5000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        onFailedAttempt: (error) => {
          if (isImageSafetyBlockedError(error)) {
            return;
          }
          logger.warn(`[scene:${storyId}] Page ${page.pageNumber} attempt ${error.attemptNumber} failed: ${error.message}`);
        },
        ...deps.retryOptions,
      },
    );

    await persistSceneImage(storyId, pageFilename, base64, userId);
    await setPageStatus(storyId, page.pageNumber, 'completed');

    onProgress?.({ message: `Page ${page.pageNumber} completed`, pageNumber: page.pageNumber, pageStatus: 'completed' });
    return base64;
  } catch (error) {
    const failureMessage = buildProviderFailureMessage(page.pageNumber, error);
    if (isImageSafetyBlockedError(error)) {
      logger.warn(
        `[scene:${storyId}] Page ${page.pageNumber} was blocked by image safety filters after prompt softening. `
        + `Marking it failed and leaving it retryable. ${error.message}`,
      );
    } else if (isImagePolicyBlockedError(error)) {
      const debugContext = buildProviderPolicyDebugContext(
        page,
        characters,
        prompt,
        styleDescription,
        includedCharNames,
        hasPreviousScene,
        referenceImages.length,
      );
      logger.warn(
        `[scene:${storyId}] Page ${page.pageNumber} was rejected by provider policy. `
        + `Marking it failed and leaving it retryable. ${error.message} Debug: ${debugContext}`,
      );
    } else {
      logger.error(`[scene:${storyId}] Failed to generate page ${page.pageNumber}:`, error);
    }
    await setPageStatus(storyId, page.pageNumber, 'failed');
    onProgress?.({ message: failureMessage, pageNumber: page.pageNumber, pageStatus: 'failed' });
    return null;
  }
}

export async function generateAllSceneImages(
  storyId: string,
  pages: Page[],
  characters: Character[],
  characterSheets: Map<string, string>,
  styleDescription?: string,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
  signal?: AbortSignal,
  pro?: boolean,
): Promise<void> {
  let previousSceneBase64: string | null = null;

  // Generate scenes sequentially so each can reference the previous scene
  for (const page of pages) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled');
    }

    const result = await imageGenerationLimiter(() =>
      generateSceneImage(
        storyId, page, characters, characterSheets, styleDescription,
        onProgress, userId, previousSceneBase64, pro,
      ),
    );

    if (result) {
      previousSceneBase64 = result;
    }
  }
}

/**
 * Retry generation for failed scene images only.
 * Downloads reference images from storage to reconstruct the reference chain.
 */
export async function retryFailedSceneImages(
  storyId: string,
  pages: Page[],
  characters: Character[],
  failedPageNumbers: number[],
  styleDescription?: string,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
  signal?: AbortSignal,
  pro?: boolean,
): Promise<number> {
  let retriedCount = 0;

  // Reconstruct character sheets from storage
  const characterSheets = new Map<string, string>();
  for (const character of characters) {
    try {
      const filename = getCharacterSheetFilename(character.name);
      const base64 = await downloadImageForRetry(storyId, filename, userId);
      characterSheets.set(character.name, base64);
    } catch {
      // Character sheet may not exist if it failed during initial generation
      console.warn(`[scene:${storyId}] Could not download character sheet for ${character.name}, continuing without it`);
    }
  }

  // Sort failed pages so we process them in order
  const sortedFailed = [...failedPageNumbers].sort((a, b) => a - b);

  for (const failedPageNum of sortedFailed) {
    if (signal?.aborted) throw new Error('Generation cancelled');

    const page = pages.find(p => p.pageNumber === failedPageNum);
    if (!page) continue;

    // Download nearest previous completed page for continuity reference
    let previousSceneBase64: string | null = null;
    for (let i = failedPageNum - 1; i >= 1; i--) {
      const prevPage = pages.find(p => p.pageNumber === i && p.status === 'completed');
      if (prevPage) {
        try {
          const filename = getPageImageFilename(i);
          previousSceneBase64 = await downloadImageForRetry(storyId, filename, userId);
          break;
        } catch {
          continue;
        }
      }
    }

    const result = await imageGenerationLimiter(() =>
      generateSceneImage(
        storyId, page, characters, characterSheets, styleDescription,
        onProgress, userId, previousSceneBase64, pro,
      ),
    );

    if (result) {
      // Update the page status in our local array too for subsequent reference lookups
      page.status = 'completed';
      retriedCount++;
    }
  }

  return retriedCount;
}
