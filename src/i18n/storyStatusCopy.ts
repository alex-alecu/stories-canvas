import type { Language, Translations } from './types';
import type { StoryMeta } from '../../shared/types';

type StatusTranslations = Pick<Translations, 'retryingFailedIllustrations' | 'generatingImageForPage' | 'blockedIllustrationsDescription'>
  & Partial<Pick<Translations, 'generationFailed'>>;

const storyWorkflowRo = new Map([
  ['Checking the story before illustration...', 'Verificarea poveștii înainte de ilustrare...'],
  ['Correcting the story after review...', 'Corectarea poveștii după verificare...'],
  ['Correcting the story format...', 'Corectarea formatului poveștii...'],
  ['The story script is ready for illustration.', 'Textul poveștii este pregătit pentru ilustrare.'],
]);

function interpolate(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

type VoiceOption = (typeof import('../../shared/types').VOICE_OPTIONS)[number];

export function getVoiceOptionText(option: VoiceOption, t: Translations): { label: string; description: string } {
  switch (option.key) {
    case 'bunica':
      return { label: t.voiceBunica, description: t.voiceBunicaDesc };
    case 'jora':
      return { label: t.voiceJora, description: t.voiceJoraDesc };
    case 'serban':
      return { label: t.voiceSerban, description: t.voiceSerbanDesc };
    case 'corina':
      return { label: t.voiceCorina, description: t.voiceCorinaDesc };
  }
}

export function formatStoryFailureMessage(
  story: Pick<StoryMeta, 'status' | 'currentPhase' | 'progressMessage' | 'userId'>,
  viewerUserId: string | undefined,
  t: StatusTranslations,
  language: Language,
): string | undefined {
  if (story.status !== 'failed' || story.currentPhase !== 'Failed' || !viewerUserId || story.userId !== viewerUserId) return undefined;
  return formatStoryStatusMessage(story.progressMessage, t, language);
}

export function formatStoryStatusMessage(message: string | null | undefined, t: StatusTranslations, language?: Language): string | undefined {
  if (!message) return message ?? undefined;

  if (language === 'ro') {
    const workflowMessage = storyWorkflowRo.get(message);
    if (workflowMessage) return workflowMessage;
  }

  if (message === 'The selected model blocked this story under its content rules. Please revise the request.') {
    return language === 'ro'
      ? 'Modelul selectat a blocat această poveste conform regulilor sale de conținut. Te rugăm să modifici cererea.'
      : message;
  }

  if (message === 'The model reached its response length limit. Please try a shorter story.') {
    return language === 'ro'
      ? 'Modelul a atins limita de lungime a răspunsului. Te rugăm să încerci o poveste mai scurtă.'
      : message;
  }

  if (message === 'Generation failed') {
    return language === 'ro'
      ? 'Povestea nu a putut fi finalizată. Eroarea salvată nu include cauza. Încearcă din nou.'
      : 'The story could not be completed. The saved error does not include the cause. Try again.';
  }

  const retryingFailedIllustrationsMatch = message.match(/^Retrying (\d+) failed illustration\(s\)\.\.\.$/);
  if (retryingFailedIllustrationsMatch) {
    return interpolate(t.retryingFailedIllustrations, { count: retryingFailedIllustrationsMatch[1] });
  }

  const generatingImageForPageMatch = message.match(/^Generating image for page (\d+)\.\.\.$/);
  if (generatingImageForPageMatch) {
    return interpolate(t.generatingImageForPage, { pageNumber: generatingImageForPageMatch[1] });
  }

  const blockedIllustrationsMatch = message.match(/^(\d+) illustrations could not be generated because the image provider blocked or rejected them\. Open Story Tools to retry those pages\.$/);
  if (blockedIllustrationsMatch) {
    return interpolate(t.blockedIllustrationsDescription, { count: blockedIllustrationsMatch[1] });
  }

  return message;
}
