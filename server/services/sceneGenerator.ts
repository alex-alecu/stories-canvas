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
): string {
  const charDescriptions = page.characters
    .map(name => {
      const char = characters.find(c => c.name === name);
      if (!char) return '';
      return `- ${char.name}: ${char.appearance}. ${char.clothing}.`;
    })
    .filter(Boolean)
    .join('\n');

  // Build image labels accounting for reference scene images
  let imageIndex = 1;
  const preambleParts: string[] = [];

  if (hasFirstScene && hasPreviousScene) {
    preambleParts.push(
      `Image ${imageIndex}: STYLE REFERENCE — This is the first scene of the story. Match its exact art style, rendering quality, color saturation, and lighting approach.`,
    );
    imageIndex++;
    preambleParts.push(
      `Image ${imageIndex}: CONTINUITY REFERENCE — This is the previous scene. Maintain the exact same character appearances, proportions, and visual style shown here.`,
    );
    imageIndex++;
  } else if (hasPreviousScene) {
    // Only previous scene (page 2, where first === previous)
    preambleParts.push(
      `Image ${imageIndex}: STYLE & CONTINUITY REFERENCE — This is the previous scene. Maintain the exact same visual style, character appearances, proportions, color palette, and lighting quality.`,
    );
    imageIndex++;
  }

  const charImageLabels = page.characters
    .map((name, i) => `Image ${imageIndex + i}: Character reference sheet for ${name}.`)
    .join(' ');

  const preamble = preambleParts.length > 0
    ? preambleParts.join('\n') + '\n\n'
    : '';

  return `${preamble}${charImageLabels}

IMPORTANT: Generate a new illustration that maintains PERFECT visual consistency with all reference images provided.

Scene: ${page.imagePrompt}

Characters in scene:
${charDescriptions}

CONSISTENCY REQUIREMENTS:
- Characters must look IDENTICAL to the reference sheets: same exact fur/skin colors, eye colors, body proportions, clothing details
- Maintain the SAME art style across all scenes: same rendering quality, same color saturation, same lighting approach
- Use the SAME visual language: same line weight, same level of detail, same background style
${hasPreviousScene ? '- The previous scene is shown for visual continuity. Maintain the same character appearance, art style, and color palette.\n' : ''}
Style: Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs.
The characters MUST look EXACTLY like the characters in the reference sheets above.
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
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
  previousSceneBase64?: string | null,
  firstSceneBase64?: string | null,
): Promise<string | null> {
  const pageFilename = `page-${String(page.pageNumber).padStart(2, '0')}.png`;

  await updatePageStatusBoth(storyId, page.pageNumber, 'generating');
  onProgress?.({ message: `Se generează imaginea pentru pagina ${page.pageNumber}...` });

  const referenceImages: Array<{ data: string; mimeType: string }> = [];

  // 1. First scene as style reference (only when it differs from previous scene)
  const hasFirstScene = !!firstSceneBase64 && firstSceneBase64 !== previousSceneBase64;
  if (hasFirstScene) {
    referenceImages.push({ data: firstSceneBase64!, mimeType: 'image/png' });
  }

  // 2. Previous scene as continuity reference
  const hasPreviousScene = !!previousSceneBase64;
  if (hasPreviousScene) {
    referenceImages.push({ data: previousSceneBase64!, mimeType: 'image/png' });
  }

  // 3. Character reference sheets (limit total to 5 images)
  const maxCharSheets = 5 - referenceImages.length;
  let charSheetCount = 0;
  for (const charName of page.characters) {
    if (charSheetCount >= maxCharSheets) break;
    const sheetBase64 = characterSheets.get(charName);
    if (sheetBase64) {
      referenceImages.push({ data: sheetBase64, mimeType: 'image/png' });
      charSheetCount++;
    }
  }

  const prompt = buildScenePrompt(page, characters, hasFirstScene, hasPreviousScene);

  try {
    const base64 = await pRetry(
      async (attemptNumber) => {
        try {
          return await generateImage(
            attemptNumber > 1 ? softenPrompt(prompt) : prompt,
            referenceImages,
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

    onProgress?.({ message: `Pagina ${page.pageNumber} completed` });
    return base64;
  } catch (error) {
    console.error(`Failed to generate page ${page.pageNumber}:`, error);
    await updatePageStatusBoth(storyId, page.pageNumber, 'failed');
    onProgress?.({ message: `Pagina ${page.pageNumber} failed` });
    return null;
  }
}

export async function generateAllSceneImages(
  storyId: string,
  pages: Page[],
  characters: Character[],
  characterSheets: Map<string, string>,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
  userId?: string,
): Promise<void> {
  let previousSceneBase64: string | null = null;
  let firstSceneBase64: string | null = null;

  // Generate scenes sequentially so each can reference the previous scene
  for (const page of pages) {
    const result = await imageGenerationLimiter(() =>
      generateSceneImage(
        storyId, page, characters, characterSheets,
        onProgress, userId, previousSceneBase64, firstSceneBase64,
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
