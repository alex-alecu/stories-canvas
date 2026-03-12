import pRetry, { AbortError } from 'p-retry';
import { generateImage } from './gemini.js';
import { saveImage, updatePageStatus as fsUpdatePageStatus } from '../utils/storage.js';
import { uploadImage, updatePageStatus as sbUpdatePageStatus } from './supabaseStorage.js';
import { config } from '../config.js';
import { imageGenerationLimiter } from '../utils/rateLimiter.js';
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

function buildScenePrompt(
  page: Page,
  characters: Character[],
  hasFirstScene: boolean,
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

  // Build image labels matching the new order: character sheets FIRST, then scene references
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

  // Scene reference labels come after character sheets
  if (hasFirstScene && hasPreviousScene) {
    preambleParts.push(
      `Image ${imageIndex}: STYLE REFERENCE — This is the first scene of the story. Match its art style, rendering quality, color saturation, and lighting approach. Do NOT use this image for character appearance — use the character reference sheets above instead.`,
    );
    imageIndex++;
    preambleParts.push(
      `Image ${imageIndex}: ENVIRONMENT CONTINUITY REFERENCE — This is the previous scene. Use it ONLY for environment layout, background details, and camera angle continuity. If the location is the same, keep ALL objects and furniture in the EXACT same positions. Do NOT use this image for character appearance — use the character reference sheets above instead.`,
    );
    imageIndex++;
  } else if (hasPreviousScene) {
    // Only previous scene (page 2, where first === previous)
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

export async function generateSceneImage(
  storyId: string,
  page: Page,
  characters: Character[],
  characterSheets: Map<string, string>,
  styleDescription?: string,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
  previousSceneBase64?: string | null,
  firstSceneBase64?: string | null,
  pro?: boolean,
): Promise<string | null> {
  const pageFilename = `page-${String(page.pageNumber).padStart(2, '0')}.png`;

  await updatePageStatusBoth(storyId, page.pageNumber, 'generating');
    onProgress?.({ message: `Generating image for page ${page.pageNumber}...`, pageNumber: page.pageNumber, pageStatus: 'generating' });

  const referenceImages: Array<{ data: string; mimeType: string }> = [];

  // Determine which scene references we have
  const hasFirstScene = !!firstSceneBase64 && firstSceneBase64 !== previousSceneBase64;
  const hasPreviousScene = !!previousSceneBase64;
  const sceneRefCount = (hasFirstScene ? 1 : 0) + (hasPreviousScene ? 1 : 0);

  // 1. Character reference sheets FIRST (authoritative source for character appearance)
  //    This primes the model on correct character appearance before seeing any drifted scenes
  const maxCharSheets = 5 - sceneRefCount;
  const includedCharNames: string[] = [];
  for (const charName of page.characters) {
    if (includedCharNames.length >= maxCharSheets) break;
    const sheetBase64 = characterSheets.get(charName);
    if (sheetBase64) {
      referenceImages.push({ data: sheetBase64, mimeType: 'image/png' });
      includedCharNames.push(charName);
    }
  }

  // 2. First scene as style reference (only when it differs from previous scene)
  if (hasFirstScene) {
    referenceImages.push({ data: firstSceneBase64!, mimeType: 'image/png' });
  }

  // 3. Previous scene as environment/layout continuity reference
  if (hasPreviousScene) {
    referenceImages.push({ data: previousSceneBase64!, mimeType: 'image/png' });
  }

  const prompt = buildScenePrompt(page, characters, hasFirstScene, hasPreviousScene, includedCharNames, styleDescription);

  try {
    const base64 = await pRetry(
      async (attemptNumber) => {
        try {
          return await generateImage(
            attemptNumber > 1 ? softenPrompt(prompt) : prompt,
            referenceImages,
            pro,
          );
        } catch (error: any) {
          // Check for safety filter
          if (error?.message?.includes('SAFETY') || error?.message?.includes('safety')) {
            console.warn(`Safety filter hit on page ${page.pageNumber}, attempt ${attemptNumber}. Softening prompt...`);
            if (attemptNumber >= 2) {
              throw new AbortError(`Safety filter rejected page ${page.pageNumber} after softening`);
            }
            throw error; // retry with softened prompt
          }
          // Check for rate limit (429)
          if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
            console.warn(`Rate limited on page ${page.pageNumber}, attempt ${attemptNumber}. Retrying...`);
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
          console.warn(`Page ${page.pageNumber} attempt ${error.attemptNumber} failed: ${error.message}`);
        },
      },
    );

    await saveSceneImage(storyId, pageFilename, base64, userId);
    await updatePageStatusBoth(storyId, page.pageNumber, 'completed');

    onProgress?.({ message: `Page ${page.pageNumber} completed`, pageNumber: page.pageNumber, pageStatus: 'completed' });
    return base64;
  } catch (error) {
    console.error(`Failed to generate page ${page.pageNumber}:`, error);
    await updatePageStatusBoth(storyId, page.pageNumber, 'failed');
    onProgress?.({ message: `Page ${page.pageNumber} failed`, pageNumber: page.pageNumber, pageStatus: 'failed' });
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
  let firstSceneBase64: string | null = null;

  // Generate scenes sequentially so each can reference the previous scene
  for (const page of pages) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled');
    }

    const result = await imageGenerationLimiter(() =>
      generateSceneImage(
        storyId, page, characters, characterSheets, styleDescription,
        onProgress, userId, previousSceneBase64, firstSceneBase64, pro,
      ),
    );

    if (result) {
      previousSceneBase64 = result;
      // Store the first successfully generated scene as a style reference
      if (firstSceneBase64 === null) {
        firstSceneBase64 = result;
      }
    }
  }
}
