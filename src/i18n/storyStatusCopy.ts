import type { Translations } from './types';

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

export function formatStoryStatusMessage(message: string | null | undefined, t: Pick<Translations, 'retryingFailedIllustrations' | 'generatingImageForPage' | 'blockedIllustrationsDescription'>): string | undefined {
  if (!message) return message ?? undefined;

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
