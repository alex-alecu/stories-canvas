import type { StoryMeta, VoiceKey } from './types.js';

export interface StoryLocalization {
  language: string;
  sourceHash: string;
  title: string;
  pages: Array<{ pageNumber: number; text: string; audioUrl?: string; audioRevision?: number }>;
  voice?: VoiceKey;
  audioModel?: string;
  audioVoice?: string;
}

export function getSourceLanguage(story: StoryMeta): string {
  return story.generationInputs?.sourceLanguage ?? story.language ?? 'en';
}

// The server must check sourceHash before it passes a stored translation here.
export function applyStoryLocalization(
  story: StoryMeta,
  localization: StoryLocalization | null,
  requestedLanguage: string,
): StoryMeta {
  const sourceLanguage = getSourceLanguage(story);
  const sourceRequested = requestedLanguage === sourceLanguage;
  const valid = localization?.language === requestedLanguage && !!story.scenario
    && localization.pages.length === story.scenario.pages.length
    && localization.pages.every((page, index) => page.pageNumber === story.scenario!.pages[index].pageNumber
      && typeof page.text === 'string' && page.text.trim().length > 0)
    && typeof localization.title === 'string' && localization.title.trim().length > 0;
  const selected = valid ? localization : null;
  const availableLanguages = [...new Set([sourceLanguage, ...(story.availableLanguages ?? []), ...(selected ? [selected.language] : [])])];
  return {
    ...story,
    sourceLanguage,
    requestedLanguage,
    language: selected?.language ?? sourceLanguage,
    localizationMissing: !sourceRequested && !selected,
    availableLanguages,
    voice: selected?.voice ?? story.voice,
    generationInputs: story.generationInputs ? {
      ...story.generationInputs,
      ...(selected ? {
        voice: selected.voice ?? story.voice,
        audioModel: selected.audioModel, audioVoice: selected.audioVoice,
        audioEnabled: !!selected.voice || selected.pages.some(page => !!page.audioUrl),
      } : !sourceRequested ? { audioEnabled: false } : {}),
    } : undefined,
    scenario: story.scenario ? {
      ...story.scenario,
      title: selected?.title ?? story.scenario.title,
      pages: story.scenario.pages.map((page, index) => {
        if (sourceRequested && !selected) return { ...page };
        const { audioUrl: _audioUrl, audioRevision: _audioRevision, ...withoutAudio } = page;
        const translated = selected?.pages[index];
        return {
          ...withoutAudio,
          ...(translated ? { text: translated.text,
            ...(translated.audioUrl ? { audioUrl: translated.audioUrl } : {}),
            ...(translated.audioRevision !== undefined ? { audioRevision: translated.audioRevision } : {}),
          } : {}),
        };
      }),
    } : undefined,
  };
}
