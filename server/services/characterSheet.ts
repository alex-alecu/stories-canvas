import { generateImage, isImagePolicyBlockedError, isImageSafetyBlockedError } from './gemini.js';
import { buildCharacterAliasMap, prepareCharacterSheetImagePrompt } from './imagePromptPreparation.js';
import { saveImage } from '../utils/storage.js';
import { uploadImage } from './supabaseStorage.js';
import { config } from '../config.js';
import type { Character } from '../../shared/types.js';

export function getCharacterSheetFilename(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `character-sheet-${safeName}.png`;
}

interface CharacterSheetDeps {
  aliasMap?: ReadonlyMap<string, string>;
  generateImage?: typeof generateImage;
  saveImage?: typeof saveImage;
  uploadImage?: typeof uploadImage;
}

type CharacterSheetUsageCallback = (usage: {
  model: string;
  status: 'succeeded' | 'failed';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  generatedImages: number;
  usageDetails: Record<string, unknown>;
}) => void | Promise<void>;

export async function generateCharacterSheet(
  storyId: string,
  character: Character,
  userId?: string,
  styleDescription?: string,
  pro?: boolean,
  deps: CharacterSheetDeps = {},
  onUsage?: CharacterSheetUsageCallback,
): Promise<{ name: string; filename: string; base64: string }> {
  const aliasMap = deps.aliasMap ?? buildCharacterAliasMap([character]);
  const prompt = prepareCharacterSheetImagePrompt(character, aliasMap, styleDescription);
  const runGenerateImage = deps.generateImage ?? generateImage;
  const persistLocalImage = deps.saveImage ?? saveImage;
  const persistSupabaseImage = deps.uploadImage ?? uploadImage;

  console.log(`[character-sheet:${storyId}] Generating character sheet for ${character.name}...`);
  const base64 = await runGenerateImage(prompt, [], { pro, onUsage });
  const filename = getCharacterSheetFilename(character.name);

  if (config.useSupabase) {
    await persistSupabaseImage(userId, storyId, filename, base64);
  } else {
    await persistLocalImage(storyId, filename, base64);
  }
  console.log(`[character-sheet:${storyId}] Character sheet saved: ${filename}`);

  return { name: character.name, filename, base64 };
}

export async function generateAllCharacterSheets(
  storyId: string,
  characters: Character[],
  userId?: string,
  signal?: AbortSignal,
  styleDescription?: string,
  pro?: boolean,
  deps: CharacterSheetDeps = {},
  onUsage?: (character: Character, usage: {
    model: string;
    status: 'succeeded' | 'failed';
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    generatedImages: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>,
): Promise<Map<string, string>> {
  const characterSheets = new Map<string, string>();
  const aliasMap = deps.aliasMap ?? buildCharacterAliasMap(characters);

  for (const character of characters) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled');
    }
    try {
      const result = await generateCharacterSheet(storyId, character, userId, styleDescription, pro, {
        ...deps,
        aliasMap,
      }, usage => onUsage?.(character, usage));
      characterSheets.set(result.name, result.base64);
    } catch (error) {
      if (isImageSafetyBlockedError(error) || isImagePolicyBlockedError(error)) {
        console.error(
          `[character-sheet:${storyId}] Failed to generate character sheet for ${character.name}: ${error.message}`,
        );
      } else {
        console.error(`[character-sheet:${storyId}] Failed to generate character sheet for ${character.name}:`, error);
      }
      // Continue with other characters - scenes will work without reference sheets
    }
  }

  return characterSheets;
}
