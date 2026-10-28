export const DEFAULT_AUDIO_MODEL = 'elevenlabs';
export const ELEVENLABS_ESTIMATE_USD_PER_1K_CHARACTERS = 0.08;

export interface AudioModelSettings {
  audioModel: string;
  audioVoice?: string;
}

export interface AudioVoiceOption {
  id: string;
  name: string;
}

export interface AudioModelOption {
  id: string;
  name: string;
  provider: 'elevenlabs' | 'openrouter';
  description?: string;
}

export const AUDIO_MODELS = [
  { id: DEFAULT_AUDIO_MODEL, name: 'Eleven v4', provider: 'elevenlabs' },
  { id: 'google/gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS', provider: 'openrouter' },
  { id: 'microsoft/mai-voice-2.1', name: 'MAI Voice 2.1', provider: 'openrouter' },
  { id: 'minimax/speech-2.8-hd', name: 'MiniMax Speech 2.8 HD', provider: 'openrouter' },
  { id: 'fish-audio/s2.1-pro', name: 'Fish Audio S2.1 Pro', provider: 'openrouter' },
  { id: 'mistralai/voxtral-mini-tts-3-0', name: 'Voxtral TTS 3', provider: 'openrouter' },
] as const satisfies readonly AudioModelOption[];

const GOOGLE_VOICES = [
  { id: 'Rasalgethi', name: 'Grandpa' }, { id: 'Gacrux', name: 'Grandma' },
  { id: 'Sulafat', name: 'Mom' }, { id: 'Algenib', name: 'Dad' },
];
const MULTILINGUAL_MINIMAX_VOICES = [
  { id: 'English_CaptivatingStoryteller', name: 'Grandpa' },
  { id: 'English_Wiselady', name: 'Grandma' },
  { id: 'English_CalmWoman', name: 'Mom' },
  { id: 'English_Trustworth_Man', name: 'Dad' },
] as const;
const ROMANIAN_MINIMAX_VOICES = [
  { id: 'Romanian_male_1_sample2', name: 'Grandpa' },
  { id: 'Romanian_female_2_sample1', name: 'Grandma' },
  { id: 'Romanian_female_1_sample4', name: 'Mom' },
  { id: 'Romanian_male_2_sample1', name: 'Dad' },
] as const;
const MICROSOFT_VOICES: Readonly<Record<string, readonly AudioVoiceOption[]>> = {
  en: [{ id: 'en-US-Harper:MAI-Voice-2', name: 'Harper' }],
  es: [{ id: 'es-MX-Valeria:MAI-Voice-2', name: 'Valeria' }],
  fr: [{ id: 'fr-FR-Soleil:MAI-Voice-2', name: 'Soleil' }],
  de: [{ id: 'de-DE-Klaus:MAI-Voice-2', name: 'Klaus' }],
};
const KOKORO_VOICES: Readonly<Record<string, readonly AudioVoiceOption[]>> = {
  en: [
    { id: 'bm_george', name: 'George' }, { id: 'bf_emma', name: 'Emma' },
    { id: 'af_sarah', name: 'Sarah' }, { id: 'am_michael', name: 'Michael' },
  ],
  es: [{ id: 'ef_dora', name: 'Dora' }, { id: 'em_alex', name: 'Alex' }, { id: 'em_santa', name: 'Santa' }],
  fr: [{ id: 'ff_siwis', name: 'Siwis' }],
  hi: [
    { id: 'hf_alpha', name: 'Alpha' }, { id: 'hf_beta', name: 'Beta' },
    { id: 'hm_omega', name: 'Omega' }, { id: 'hm_psi', name: 'Psi' },
  ],
  it: [{ id: 'if_sara', name: 'Sara' }, { id: 'im_nicola', name: 'Nicola' }],
  ja: [
    { id: 'jf_alpha', name: 'Alpha' }, { id: 'jf_gongitsune', name: 'Gongitsune' },
    { id: 'jf_nezumi', name: 'Nezumi' }, { id: 'jf_tebukuro', name: 'Tebukuro' },
    { id: 'jm_kumo', name: 'Kumo' },
  ],
  pt: [{ id: 'pf_dora', name: 'Dora' }, { id: 'pm_alex', name: 'Alex' }, { id: 'pm_santa', name: 'Santa' }],
  zh: [
    { id: 'zf_xiaobei', name: 'Xiaobei' }, { id: 'zf_xiaoni', name: 'Xiaoni' },
    { id: 'zf_xiaoxiao', name: 'Xiaoxiao' }, { id: 'zf_xiaoyi', name: 'Xiaoyi' },
    { id: 'zm_yunjian', name: 'Yunjian' }, { id: 'zm_yunxi', name: 'Yunxi' },
    { id: 'zm_yunxia', name: 'Yunxia' }, { id: 'zm_yunyang', name: 'Yunyang' },
  ],
};

const MICROSOFT_21_VOICES: Readonly<Record<string, readonly AudioVoiceOption[]>> = {
  pl: [{ id: 'pl-PL-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'pl-PL-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  en: [{ id: 'en-US-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'en-US-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  ro: [{ id: 'ro-RO-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'ro-RO-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  es: [{ id: 'es-MX-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'es-MX-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  fr: [{ id: 'fr-FR-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'fr-FR-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  de: [{ id: 'de-DE-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'de-DE-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  it: [{ id: 'it-IT-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'it-IT-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  hu: [{ id: 'hu-HU-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'hu-HU-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  cs: [{ id: 'cs-CZ-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'cs-CZ-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  da: [{ id: 'da-DK-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'da-DK-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  fi: [{ id: 'fi-FI-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'fi-FI-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  pt: [{ id: 'pt-BR-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'pt-BR-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  hi: [{ id: 'hi-IN-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'hi-IN-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  ko: [{ id: 'ko-KR-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'ko-KR-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  nl: [{ id: 'nl-NL-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'nl-NL-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  no: [{ id: 'nb-NO-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'nb-NO-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  zh: [{ id: 'zh-CN-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'zh-CN-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  sv: [{ id: 'sv-SE-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'sv-SE-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  ru: [{ id: 'ru-RU-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'ru-RU-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  tr: [{ id: 'tr-TR-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'tr-TR-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  id: [{ id: 'id-ID-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'id-ID-Harper:MAI-Voice-2.1', name: 'Grandma' }],
  vi: [{ id: 'vi-VN-Grant:MAI-Voice-2.1', name: 'Grandpa' }, { id: 'vi-VN-Harper:MAI-Voice-2.1', name: 'Grandma' }],
};
const VOXTRAL_VOICES: Readonly<Record<string, readonly AudioVoiceOption[]>> = {
  en: [{ id: 'voice_3150', name: 'Dad' }, { id: 'voice_478', name: 'Mom' }],
  ro: [{ id: 'voice_3155', name: 'Mom' }],
  fr: [{ id: 'voice_592', name: 'Mom' }], de: [{ id: 'voice_481', name: 'Mom' }],
  es: [{ id: 'voice_483', name: 'Mom' }], it: [{ id: 'voice_482', name: 'Dad' }],
  pt: [{ id: 'voice_480', name: 'Mom' }], hu: [{ id: 'voice_3146', name: 'Mom' }],
  nl: [{ id: 'voice_3145', name: 'Mom' }], no: [{ id: 'voice_3134', name: 'Dad' }],
  pl: [{ id: 'voice_3154', name: 'Dad' }], ja: [{ id: 'voice_3133', name: 'Dad' }],
  ko: [{ id: 'voice_3136', name: 'Dad' }], ru: [{ id: 'voice_3132', name: 'Mom' }],
  tr: [{ id: 'voice_3138', name: 'Dad' }], uk: [{ id: 'voice_3140', name: 'Dad' }],
  vi: [{ id: 'voice_3144', name: 'Mom' }], zh: [{ id: 'voice_3142', name: 'Mom' }],
};
const STORED_MODEL_IDS = new Set(['google/gemini-3.1-flash-tts-preview', 'microsoft/mai-voice-2', 'hexgrad/kokoro-82m']);

const MODEL_IDS = new Set<string>(AUDIO_MODELS.map(model => model.id));

export function getAudioVoices(model: string, language: string): readonly AudioVoiceOption[] {
  switch (model) {
    case DEFAULT_AUDIO_MODEL: return [];
    case 'google/gemini-3.8-flash-tts':
    case 'google/gemini-3.1-flash-tts-preview': return GOOGLE_VOICES;
    case 'microsoft/mai-voice-2.1': return MICROSOFT_21_VOICES[language] ?? [];
    case 'fish-audio/s2.1-pro': return [{ id: 'f3a2b90078d54a65af4b95f63bc7798e', name: 'Mom' }];
    case 'mistralai/voxtral-mini-tts-3-0': return VOXTRAL_VOICES[language] ?? [];
    case 'microsoft/mai-voice-2': return MICROSOFT_VOICES[language] ?? [];
    case 'minimax/speech-2.8-hd': return language === 'ro' ? ROMANIAN_MINIMAX_VOICES : MULTILINGUAL_MINIMAX_VOICES;
    case 'hexgrad/kokoro-82m': return KOKORO_VOICES[language] ?? [];
    default: return [];
  }
}

export function isAudioModelAvailable(model: string, language: string): boolean {
  return model === DEFAULT_AUDIO_MODEL || (MODEL_IDS.has(model) && getAudioVoices(model, language).length > 0);
}

export function parseAudioModelSettings(
  model: unknown,
  voice: unknown,
  language: string,
  allowStoredModel = false,
): AudioModelSettings {
  if (model !== undefined && typeof model !== 'string') throw new Error('Select an audio model from the model list.');
  if (voice !== undefined && typeof voice !== 'string') throw new Error('Select a voice from the voice list for this audio model.');
  let audioModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_AUDIO_MODEL;
  if (allowStoredModel && audioModel.startsWith('eleven_')) audioModel = DEFAULT_AUDIO_MODEL;
  if (!MODEL_IDS.has(audioModel) && !(allowStoredModel && STORED_MODEL_IDS.has(audioModel))) throw new Error('Select an audio model from the model list.');
  if (audioModel !== DEFAULT_AUDIO_MODEL && getAudioVoices(audioModel, language).length === 0) throw new Error('The selected audio model does not support this language.');
  if (audioModel === DEFAULT_AUDIO_MODEL) return { audioModel };
  const voices = getAudioVoices(audioModel, language);
  const requestedVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : voices[0]?.id;
  if (!requestedVoice || !voices.some(option => option.id === requestedVoice)) {
    throw new Error('Select a voice from the voice list for this audio model.');
  }
  return { audioModel, audioVoice: requestedVoice };
}

// Catalog checked 2026-10-28: https://openrouter.ai/api/v1/models?output_modalities=speech

export function getAudioResponseFormat(model: string): 'mp3' | 'pcm' {
  return model.startsWith('google/gemini-') ? 'pcm' : 'mp3';
}

export function getSelectableAudioModel(model: string | undefined): string {
  return model && MODEL_IDS.has(model) ? model : DEFAULT_AUDIO_MODEL;
}
