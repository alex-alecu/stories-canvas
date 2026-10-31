import { config } from '../config.js';
import { SUPPORTED_STORY_LANGUAGES } from './storyPrompt.js';

export function resolveReaderLanguage(requested: unknown, fallback: string, siteDefault = config.defaultLanguage): string {
  if (siteDefault === 'ro') return 'ro';
  const language = requested === undefined ? fallback : requested;
  if (typeof language !== 'string' || !(SUPPORTED_STORY_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error('Select a supported story language.');
  }
  return language;
}
