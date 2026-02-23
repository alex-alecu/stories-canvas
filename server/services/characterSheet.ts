import { generateImage } from './gemini.js';
import { saveImage } from '../utils/storage.js';
import type { Character } from '../../shared/types.js';

export function getCharacterSheetFilename(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `character-sheet-${safeName}.png`;
}

export async function generateCharacterSheet(
  storyId: string,
  character: Character,
): Promise<{ name: string; filename: string; base64: string }> {
  const prompt = `Character reference sheet for "${character.name}". 
Left side: front view. Right side: back view. 
${character.appearance}. ${character.clothing}. 
Disney/Pixar 3D animation style with warm, round, and friendly character designs. 
Pure white background. Clean, professional character sheet layout.
Label at the bottom: "${character.name.toUpperCase()} CHARACTER SHEET"`;

  console.log(`Generating character sheet for ${character.name}...`);
  const base64 = await generateImage(prompt);
  const filename = getCharacterSheetFilename(character.name);
  await saveImage(storyId, filename, base64);
  console.log(`Character sheet saved: ${filename}`);

  return { name: character.name, filename, base64 };
}

export async function generateAllCharacterSheets(
  storyId: string,
  characters: Character[],
): Promise<Map<string, string>> {
  const characterSheets = new Map<string, string>();

  for (const character of characters) {
    try {
      const result = await generateCharacterSheet(storyId, character);
      characterSheets.set(result.name, result.base64);
    } catch (error) {
      console.error(`Failed to generate character sheet for ${character.name}:`, error);
      // Continue with other characters - scenes will work without reference sheets
    }
  }

  return characterSheets;
}
