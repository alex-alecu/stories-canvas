import pRetry, { AbortError } from 'p-retry';
import fs from 'fs/promises';
import { generateImage, isImagePolicyBlockedError, isImageSafetyBlockedError } from './gemini.js';
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

function buildScenePrompt(
  page: Page,
  characters: Character[],
  hasPreviousScene: boolean,
  includedCharNames: string[],
  styleDescription?: string,
): string {
  const charDescriptions = page.characters
    .map(name => {
      const char = characters.find(c => c.name === name);
      if (!char) return '';
      return `- ${char.name}: ${char.appearance}. ${char.clothing}.`;
    })
    .filter(Boolean)
    .join('\n');

  // Build image labels: character sheets FIRST, then scene references
  let imageIndex = 1;
  const preambleParts: string[] = [];

  // Character sheet labels come first (they are first in the referenceImages array)
  const charImageLabels = includedCharNames
    .map((name, i) => {
      const label = `Image ${imageIndex + i}: ⭐ AUTHORITATIVE CHARACTER REFERENCE for ${name} — This reference sheet is the DEFINITIVE source for this character's appearance. Every detail (skin/fur color, eye color, body proportions, clothing, accessories) MUST match this sheet EXACTLY in the generated scene.`;
      return label;
    })
    .join('\n');
  imageIndex += includedCharNames.length;

  // Scene reference label comes after character sheets
  if (hasPreviousScene) {
    preambleParts.push(
      `Image ${imageIndex}: STYLE & ENVIRONMENT CONTINUITY REFERENCE — This is the previous scene. Match its art style, color palette, and lighting quality. If the location is the same, keep ALL objects and furniture in the EXACT same positions. For character appearance, ALWAYS defer to the character reference sheets above.`,
    );
    imageIndex++;
  }

  const sceneRefLabels = preambleParts.length > 0
    ? '\n' + preambleParts.join('\n')
    : '';

  return `${charImageLabels}${sceneRefLabels}

IMPORTANT: Generate a new illustration. The character reference sheets are the SINGLE SOURCE OF TRUTH for how each character looks. Scene references are provided only for art style and environment continuity.

Scene: ${page.imagePrompt}

Characters in scene:
${charDescriptions}

ENVIRONMENT: This must be a COMPLETE, richly detailed scene — like a frame from a Pixar/Disney animated movie. Render a FULL environment with depth, atmospheric lighting, and environmental storytelling details (weather, time of day, objects that tell a story). Do NOT render characters on a plain or overly simple background. The setting should feel alive and immersive.

BACKGROUND LIFE: Include secondary characters and living details in the background to make the world feel alive — other animals, people, creatures, or environmental activity appropriate to the setting. These background elements should add depth and atmosphere without distracting from the main characters.

COMPOSITION: Position the main characters in the UPPER TWO-THIRDS of the frame. The lower portion of the image will have a text overlay, so keep character faces and critical visual elements out of the bottom third. Place supporting environment details (ground, path, floor, grass) in the lower area instead.

CHARACTER APPEARANCE (HIGHEST PRIORITY):
- The character reference sheets are the ABSOLUTE AUTHORITY for character appearance. ALWAYS match them exactly.
- Same exact skin/fur colors, eye colors, hair style and color, body proportions, clothing details, and accessories as shown in the character sheets.
- If a scene reference shows a character looking even SLIGHTLY different from the character sheet (due to accumulated generation drift), IGNORE the scene reference and follow the character sheet.

STYLE & ENVIRONMENT CONSISTENCY:
- Maintain the SAME art style across all scenes: same rendering quality, same color saturation, same lighting approach
- Use the SAME visual language: same line weight, same level of detail, same background style
${hasPreviousScene ? `- ENVIRONMENT SPATIAL CONTINUITY: If this scene takes place in the same location as the previous scene, ALL furniture, objects, and architectural elements MUST remain in the EXACT same positions. Beds, shelves, windows, doors, trees, rocks — everything must stay where it was. Only the characters' poses and actions should change. Match the camera angle and perspective of the previous scene.
` : ''}
Style: ${styleDescription || 'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs'}.
4:3 aspect ratio composition. No text or words in the image.`;
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

  const prompt = buildScenePrompt(page, characters, hasPreviousScene, includedCharNames, styleDescription);

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
      logger.warn(
        `[scene:${storyId}] Page ${page.pageNumber} was rejected by provider policy. `
        + `Marking it failed and leaving it retryable. ${error.message}`,
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
