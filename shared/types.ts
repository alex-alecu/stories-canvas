export type PageStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type StoryStatus = 'generating_scenario' | 'generating_characters' | 'generating_images' | 'generating_audio' | 'completed' | 'failed' | 'cancelled';

export type ArtStyleKey = 'disney-pixar' | 'watercolor' | 'storybook' | 'anime' | 'colored-pencil' | 'paper-cutout';

export type VoiceKey = 'jora' | 'serban' | 'corina';

export type LegacyVoiceKey = 'grandma' | 'grandpa' | 'dad' | 'mom' | 'whisper';

export const DEFAULT_VOICE_KEY: VoiceKey = 'jora';

export const LEGACY_VOICE_KEY_ALIASES: Record<LegacyVoiceKey, VoiceKey> = {
  grandma: 'corina',
  mom: 'corina',
  grandpa: 'jora',
  dad: 'serban',
  whisper: 'jora',
};

export const VOICE_OPTIONS = [
  { key: 'jora', name: 'Grandpa', labelKey: 'voiceJora', descKey: 'voiceJoraDesc' },
  { key: 'serban', name: 'Dad', labelKey: 'voiceSerban', descKey: 'voiceSerbanDesc' },
  { key: 'corina', name: 'Mom', labelKey: 'voiceCorina', descKey: 'voiceCorinaDesc' },
] as const satisfies ReadonlyArray<{ key: VoiceKey; name: string; labelKey: string; descKey: string }>;

const VOICE_OPTION_MAP = new Map<VoiceKey, (typeof VOICE_OPTIONS)[number]>(
  VOICE_OPTIONS.map(option => [option.key, option]),
);

export function isVoiceKey(value: string): value is VoiceKey {
  return VOICE_OPTION_MAP.has(value as VoiceKey);
}

export function normalizeVoiceKey(value: string | null | undefined): VoiceKey | undefined {
  if (!value) return undefined;
  const trimmedValue = value.trim();
  if (!trimmedValue) return undefined;
  if (isVoiceKey(trimmedValue)) {
    return trimmedValue;
  }
  if (trimmedValue in LEGACY_VOICE_KEY_ALIASES) {
    return LEGACY_VOICE_KEY_ALIASES[trimmedValue as LegacyVoiceKey];
  }
  return undefined;
}

export function getVoiceName(voiceKey: VoiceKey): string {
  return VOICE_OPTION_MAP.get(voiceKey)?.name ?? voiceKey;
}

export const ART_STYLES: Record<ArtStyleKey, string> = {
  'disney-pixar': 'Disney/Pixar 3D animation style with warm, vibrant colors, round and friendly character designs',
  'watercolor': 'Soft watercolor illustration style with delicate washes of color, dreamy atmosphere, and gentle brushstrokes',
  'storybook': 'Classic hand-drawn storybook illustration with detailed line work, warm colors, and a nostalgic feel',
  'anime': 'Soft anime style with large expressive eyes, vibrant colors, and gentle cel-shading',
  'colored-pencil': 'Colored pencil illustration style with visible pencil textures, warm shading, and a handcrafted feel',
  'paper-cutout': 'Paper cutout collage style with layered textures, craft paper elements, and a handmade feel',
};

export const DEFAULT_ART_STYLE: ArtStyleKey = 'disney-pixar';
export const DEFAULT_AGE = 3;

export type AgeGroup = 'toddler' | 'young' | 'older' | 'preteen';

export function getAgeGroup(age: number): AgeGroup {
  if (age <= 3) return 'toddler';
  if (age <= 6) return 'young';
  if (age <= 9) return 'older';
  return 'preteen';
}

export const AGE_RANGES = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
  { value: 11, label: '11' },
  { value: 12, label: '12' },
] as const;

export interface Character {
  name: string;
  role: string;
  appearance: string;
  clothing: string;
  personality: string;
  characterSheetPrompt: string;
}

export interface Page {
  pageNumber: number;
  text: string;
  imagePrompt: string;
  characters: string[];
  status: PageStatus;
  imageUrl?: string;
  audioUrl?: string;
}

export interface Scenario {
  title: string;
  targetAge: number;
  characters: Character[];
  pages: Page[];
}

export interface StoryMeta {
  id: string;
  prompt: string;
  status: StoryStatus;
  createdAt: string;
  scenario?: Scenario;
  coverImage?: string;
  userId?: string;
  isPublic?: boolean;
  artStyle?: ArtStyleKey;
  voice?: VoiceKey;
  currentPhase?: string;
  progressMessage?: string;
}

export interface StoryDetail extends StoryMeta {
  scenario: Scenario;
}

export interface GenerationProgress {
  storyId: string;
  status: StoryStatus;
  currentPhase: string;
  completedPages: number;
  totalPages: number;
  failedPages: number[];
  message: string;
  pageNumber?: number;
  pageStatus?: PageStatus;
  audioFailed?: boolean;
  audioError?: string;
}

export interface CreateStoryRequest {
  prompt: string;
  language?: string;
  age?: number;
  style?: ArtStyleKey;
  pro?: boolean;
  voice?: VoiceKey;
}

export interface CreateStoryResponse {
  id: string;
  status: StoryStatus;
}

export interface StoryAssets {
  characterSheets: { name: string; url: string }[];
  pageImages: { pageNumber: number; url: string }[];
}

export interface RetryStoryResponse {
  status: StoryStatus;
  retriedImages: number;
  retriedAudio: number;
}
