import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { config } from '../config.js';
import type { StoryLocalization } from '../../shared/storyLocalization.js';
import { getSupabase } from './supabase.js';
import { SUPPORTED_STORY_LANGUAGES } from './storyPrompt.js';

const localizationSchema = z.object({
  language: z.enum(SUPPORTED_STORY_LANGUAGES),
  sourceHash: z.string().min(1), title: z.string().trim().min(1),
  pages: z.array(z.object({ pageNumber: z.number().int().positive(), text: z.string().trim().min(1),
    audioUrl: z.string().min(1).optional(), audioRevision: z.number().int().nonnegative().optional(),
  })).min(1).refine(pages => new Set(pages.map(page => page.pageNumber)).size === pages.length, 'Duplicate page number'),
  voice: z.enum(['grandma', 'grandpa', 'dad', 'mom']).optional(),
  audioModel: z.string().min(1).optional(), audioVoice: z.string().min(1).optional(),
});

function validateKey(storyId: string, language: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storyId)) throw new Error('Invalid story id.');
  if (!(SUPPORTED_STORY_LANGUAGES as readonly string[]).includes(language)) throw new Error('Unsupported story language.');
}

function parseLocalization(value: unknown, language: string): StoryLocalization {
  const parsed = localizationSchema.parse(value);
  if (parsed.language !== language) throw new Error('The localization language does not match the requested language.');
  return parsed;
}

export async function loadStoryLocalization(
  storyId: string, language: string, client?: SupabaseClient,
): Promise<StoryLocalization | null> {
  validateKey(storyId, language);
  if (config.useSupabase) {
    const { data, error } = await (client ?? getSupabase()).from('story_localizations').select('*')
      .eq('story_id', storyId).eq('language', language).maybeSingle();
    if (error) throw new Error(`Failed to load story localization: ${error.message}`);
    if (!data) return null;
    return parseLocalization({ language: data.language, sourceHash: data.source_hash, title: data.title, pages: data.pages,
      ...(data.voice ? { voice: data.voice } : {}), ...(data.audio_model ? { audioModel: data.audio_model } : {}),
      ...(data.audio_voice ? { audioVoice: data.audio_voice } : {}),
    }, language);
  }
  try {
    const value = JSON.parse(await fs.readFile(path.join(config.dataDir, storyId, `localizations-${language}.json`), 'utf8'));
    return parseLocalization(value, language);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveStoryLocalization(
  storyId: string, localization: StoryLocalization, client?: SupabaseClient,
): Promise<void> {
  validateKey(storyId, localization.language);
  const value = parseLocalization(localization, localization.language);
  if (config.useSupabase) {
    const { error } = await (client ?? getSupabase()).from('story_localizations').upsert({
      story_id: storyId, language: value.language, source_hash: value.sourceHash, title: value.title, pages: value.pages,
      voice: value.voice ?? null, audio_model: value.audioModel ?? null, audio_voice: value.audioVoice ?? null,
    }, { onConflict: 'story_id,language' });
    if (error) throw new Error(`Failed to save story localization: ${error.message}`);
    return;
  }
  const directory = path.join(config.dataDir, storyId);
  const filePath = path.join(directory, `localizations-${value.language}.json`);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
