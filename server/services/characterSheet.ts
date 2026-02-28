import { generateImage } from './gemini.js';
import { saveImage } from '../utils/storage.js';
import { uploadImage } from './supabaseStorage.js';
import { config } from '../config.js';
import type { Character } from '../../shared/types.js';

export function getCharacterSheetFilename(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `character-sheet-${safeName}.png`;
}

export async function generateCharacterSheet(
  storyId: string,
  character: Character,
  userId?: string,
): Promise<{ name: string; filename: string; base64: string }> {
  const prompt = `Professional character reference sheet for "${character.name}".
Layout: Front view (left), 3/4 view (center), Back view (right).
Below: Close-up face showing key facial features and expressions.
Color palette swatches at the bottom showing exact colors used for skin/fur, clothing, eyes, and accessories.

${character.appearance}. ${character.clothing}.

Disney/Pixar 3D animation style with warm, round, and friendly character designs.
Pure white background. Clean, professional character model sheet layout.
CRITICAL: Show the EXACT same character in all views - same colors, same proportions, same clothing.
Label at the bottom: "${character.name.toUpperCase()} CHARACTER SHEET"`;

  console.log(`Generating character sheet for ${character.name}...`);
  const base64 = await generateImage(prompt);
  const filename = getCharacterSheetFilename(character.name);

  if (config.useSupabase) {
    await uploadImage(userId, storyId, filename, base64);
  } else {
    await saveImage(storyId, filename, base64);
  }
  console.log(`Character sheet saved: ${filename}`);

  return { name: character.name, filename, base64 };
}

export async function generateAllCharacterSheets(
  storyId: string,
  characters: Character[],
  userId?: string,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const characterSheets = new Map<string, string>();

  for (const character of characters) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled');
    }
    try {
      const result = await generateCharacterSheet(storyId, character, userId);
      characterSheets.set(result.name, result.base64);
    } catch (error) {
      console.error(`Failed to generate character sheet for ${character.name}:`, error);
      // Continue with other characters - scenes will work without reference sheets
    }
  }

  return characterSheets;
}
