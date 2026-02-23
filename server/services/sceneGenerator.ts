import pRetry, { AbortError } from 'p-retry';
import { generateImage } from './gemini.js';
import { saveImage, updatePageStatus } from '../utils/storage.js';
import { imageGenerationLimiter } from '../utils/rateLimiter.js';
import type { Page, Character, GenerationProgress } from '../../shared/types.js';

function buildScenePrompt(
  page: Page,
  characters: Character[],
): string {
  const charDescriptions = page.characters
    .map(name => {
      const char = characters.find(c => c.name === name);
      if (!char) return '';
      return `${char.name}: ${char.appearance}. ${char.clothing}.`;
    })
    .filter(Boolean)
    .join('\n');

  const imageLabels = page.characters
    .map((name, i) => `Image ${i + 1}: Character reference sheet for ${name}.`)
    .join(' ');

  return `${imageLabels}

Generate a NEW illustration based on the reference sheets above.

Scene: ${page.imagePrompt}

Characters in scene:
${charDescriptions}

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
): Promise<void> {
  const pageFilename = `page-${String(page.pageNumber).padStart(2, '0')}.png`;

  await updatePageStatus(storyId, page.pageNumber, 'generating');
  onProgress?.({ message: `Se generează imaginea pentru pagina ${page.pageNumber}...` });

  const referenceImages: Array<{ data: string; mimeType: string }> = [];
  for (const charName of page.characters) {
    const sheetBase64 = characterSheets.get(charName);
    if (sheetBase64) {
      referenceImages.push({ data: sheetBase64, mimeType: 'image/png' });
    }
    // Max 3 inline images
    if (referenceImages.length >= 3) break;
  }

  const prompt = buildScenePrompt(page, characters);

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

    await saveImage(storyId, pageFilename, base64);
    await updatePageStatus(storyId, page.pageNumber, 'completed');
    onProgress?.({ message: `Pagina ${page.pageNumber} completed` });
  } catch (error) {
    console.error(`Failed to generate page ${page.pageNumber}:`, error);
    await updatePageStatus(storyId, page.pageNumber, 'failed');
    onProgress?.({ message: `Pagina ${page.pageNumber} failed` });
  }
}

export async function generateAllSceneImages(
  storyId: string,
  pages: Page[],
  characters: Character[],
  characterSheets: Map<string, string>,
  onProgress?: (progress: Partial<GenerationProgress>) => void,
): Promise<void> {
  const promises = pages.map(page =>
    imageGenerationLimiter(() =>
      generateSceneImage(storyId, page, characters, characterSheets, onProgress),
    ),
  );

  await Promise.all(promises);
}
