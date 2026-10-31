import type { Language } from '../i18n/types';
import type { StoryMeta } from '../types';

export function resolveStoryLanguage(preferredLanguage: Language, siteLanguage: Language): Language {
  return siteLanguage === 'ro' ? 'ro' : preferredLanguage;
}

export function getStoryLanguageKey(storyId: string, language: string): string {
  return `${storyId}:${language}`;
}

export function matchesStoryLanguage(
  story: { language?: string; requestedLanguage?: string; generationInputs?: { language?: string } },
  language: string,
): boolean {
  const storedLanguage = story.requestedLanguage ?? story.language ?? story.generationInputs?.language ?? 'ro';
  return storedLanguage === language;
}

export function getMissingAudioCount(pages: readonly { audioUrl?: string }[]): number {
  return pages.filter(page => !page.audioUrl).length;
}

export function getStoryLanguagePlaceholder(
  previousStory: StoryMeta | undefined,
  storyId: string | undefined,
  requestedLanguage: string,
): StoryMeta | undefined {
  if (!previousStory || previousStory.id !== storyId) return undefined;
  return {
    ...previousStory,
    requestedLanguage,
    localizationMissing: false,
    scenario: previousStory.scenario && {
      ...previousStory.scenario,
      pages: previousStory.scenario.pages.map(page => ({ ...page, audioUrl: undefined })),
    },
  };
}

export function getStoryPageTextMaxChars(targetAge: number, requestedLanguage: string, sourceLanguage: string): number {
  if (requestedLanguage !== sourceLanguage) return 640;
  if (targetAge <= 3) return 160;
  if (targetAge <= 6) return 200;
  if (targetAge <= 9) return 280;
  return 320;
}
