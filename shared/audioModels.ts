export const DEFAULT_AUDIO_MODEL = 'elevenlabs';

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
  { id: DEFAULT_AUDIO_MODEL, name: 'ElevenLabs', provider: 'elevenlabs' },
  { id: 'google/gemini-3.1-flash-tts-preview', name: 'Gemini 3.1 Flash TTS Preview', provider: 'openrouter' },
  { id: 'microsoft/mai-voice-2', name: 'MAI Voice 2', provider: 'openrouter' },
  { id: 'minimax/speech-2.8-hd', name: 'MiniMax Speech 2.8 HD', provider: 'openrouter' },
  { id: 'hexgrad/kokoro-82m', name: 'Kokoro 82M', provider: 'openrouter' },
] as const satisfies readonly AudioModelOption[];

const GOOGLE_VOICES = ['Rasalgethi', 'Gacrux', 'Sulafat', 'Algenib']
  .map(id => ({ id, name: id }));
const MULTILINGUAL_MINIMAX_VOICES = [
  { id: 'English_CaptivatingStoryteller', name: 'Captivating Storyteller' },
  { id: 'English_Wiselady', name: 'Wise Lady' },
  { id: 'English_CalmWoman', name: 'Calm Woman' },
  { id: 'English_Trustworth_Man', name: 'Trustworthy Man' },
] as const;
const ROMANIAN_MINIMAX_VOICES = [
  { id: 'Romanian_male_1_sample2', name: 'Male 1' },
  { id: 'Romanian_female_2_sample1', name: 'Female 2' },
  { id: 'Romanian_female_1_sample4', name: 'Female 1' },
  { id: 'Romanian_male_2_sample1', name: 'Male 2' },
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

const MODEL_IDS = new Set<string>(AUDIO_MODELS.map(model => model.id));

export function getAudioVoices(model: string, language: string): readonly AudioVoiceOption[] {
  switch (model) {
    case DEFAULT_AUDIO_MODEL: return [];
    case 'google/gemini-3.1-flash-tts-preview': return GOOGLE_VOICES;
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
  if (!MODEL_IDS.has(audioModel)) throw new Error('Select an audio model from the model list.');
  if (!isAudioModelAvailable(audioModel, language)) throw new Error('The selected audio model does not support this language.');
  if (audioModel === DEFAULT_AUDIO_MODEL) return { audioModel };
  const voices = getAudioVoices(audioModel, language);
  const requestedVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : voices[0]?.id;
  if (!requestedVoice || !voices.some(option => option.id === requestedVoice)) {
    throw new Error('Select a voice from the voice list for this audio model.');
  }
  return { audioModel, audioVoice: requestedVoice };
}

// Catalog checked 2026-09-11: https://openrouter.ai/api/v1/models?output_modalities=speech
