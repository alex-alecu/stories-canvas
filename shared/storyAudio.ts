import { normalizeVoiceKey, type Scenario, type StoryGenerationInputs, type StoryMode } from './types.js';

interface StoryAudioSettings {
  voice?: string | null;
  storyMode?: StoryMode;
  generationInputs?: Pick<StoryGenerationInputs, 'audioEnabled' | 'storyMode' | 'voice'>;
  scenario?: Pick<Scenario, 'pages'>;
}

export function storyRequiresAudio(story: StoryAudioSettings): boolean {
  // The saved choice has priority over an old voice or story mode.
  if (typeof story.generationInputs?.audioEnabled === 'boolean') {
    return story.generationInputs.audioEnabled;
  }

  // Older stories do not have the saved audio choice.
  return story.generationInputs?.storyMode === 'pro_audio'
    || story.storyMode === 'pro_audio'
    || !!normalizeVoiceKey(story.voice ?? story.generationInputs?.voice)
    || !!story.scenario?.pages.some(page => !!page.audioUrl);
}

export function withoutDisabledAudioFailure(message: string | undefined, requiresAudio: boolean): string | undefined {
  if (!message || requiresAudio) return message;
  // Keep other failures when an older completion message includes this false warning.
  return message.replace(/(?:^| )Some narration pages could not be generated\.?$/, '').trim() || undefined;
}
