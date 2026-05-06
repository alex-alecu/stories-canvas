export type PageStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type StoryStatus = 'generating_scenario' | 'reviewing_scenario' | 'generating_characters' | 'generating_images' | 'generating_audio' | 'completed' | 'failed' | 'cancelled';

export type ArtStyleKey = 'disney-pixar' | 'watercolor' | 'storybook' | 'anime' | 'colored-pencil' | 'paper-cutout';

export type VoiceKey = 'bunica' | 'jora' | 'serban' | 'corina';
export type StoryMode = 'fast' | 'pro' | 'pro_audio';
export type StoryUsageProvider = 'gemini' | 'elevenlabs';
export type StoryUsageSource = 'initial_generation' | 'retry' | 'regenerate_assets' | 'add_audio';
export type StoryUsageStatus = 'succeeded' | 'failed';
export type StoryUsageOperation =
  | 'scenario_draft'
  | 'scenario_validation_repair'
  | 'scenario_review'
  | 'scenario_review_rewrite'
  | 'character_sheet'
  | 'page_image'
  | 'page_audio';

export const STORY_MODE_CREDITS: Record<StoryMode, number> = {
  fast: 1,
  pro: 2,
  pro_audio: 3,
};

export function isStoryMode(value: string | null | undefined): value is StoryMode {
  return value === 'fast' || value === 'pro' || value === 'pro_audio';
}

export function getStoryModeCredits(mode: StoryMode): number {
  return STORY_MODE_CREDITS[mode];
}

export type LegacyVoiceKey = 'grandma' | 'grandpa' | 'dad' | 'mom' | 'whisper';

export const DEFAULT_VOICE_KEY: VoiceKey = 'jora';

export const LEGACY_VOICE_KEY_ALIASES: Record<LegacyVoiceKey, VoiceKey> = {
  grandma: 'bunica',
  mom: 'corina',
  grandpa: 'jora',
  dad: 'serban',
  whisper: 'jora',
};

export const VOICE_OPTIONS = [
  { key: 'jora', name: 'Grandpa', labelKey: 'voiceJora', descKey: 'voiceJoraDesc' },
  { key: 'bunica', name: 'Grandma', labelKey: 'voiceBunica', descKey: 'voiceBunicaDesc' },
  { key: 'corina', name: 'Mom', labelKey: 'voiceCorina', descKey: 'voiceCorinaDesc' },
  { key: 'serban', name: 'Dad', labelKey: 'voiceSerban', descKey: 'voiceSerbanDesc' },
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
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7+' },
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

export interface StoryGenerationInputs {
  prompt: string;
  language: string;
  age: number;
  artStyle: ArtStyleKey;
  storyMode: StoryMode;
  voice?: VoiceKey;
  audioEnabled: boolean;
  proModel: boolean;
  scenarioModel: string;
  imageModel: string;
  imageModelPro: string;
  audioModel?: string;
  pricingVersion: string;
}

export interface StoryUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsdMicros: number;
  textCostUsdMicros: number;
  imageCostUsdMicros: number;
  audioCostUsdMicros: number;
}

export interface StoryUsageEvent {
  id: string;
  storyId: string;
  userId?: string;
  provider: StoryUsageProvider;
  operation: StoryUsageOperation;
  source: StoryUsageSource;
  status: StoryUsageStatus;
  model: string;
  pageNumber?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsdMicros: number;
  usageDetails: Record<string, unknown>;
  createdAt: string;
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
  language?: string;
  artStyle?: ArtStyleKey;
  voice?: VoiceKey;
  currentPhase?: string;
  progressMessage?: string;
  scenarioRevision?: number;
  renderedScenarioRevision?: number;
  assetsStale?: boolean;
  storyMode?: StoryMode;
  creditCost?: number;
  creditRefundedAt?: string;
  generationInputs?: StoryGenerationInputs;
  usageTotals?: StoryUsageTotals;
  viewCount?: number;
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
  storyMode?: StoryMode;
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

export interface ReviewStoryResponse {
  status: StoryStatus;
  rewritten: boolean;
  assetsStale: boolean;
}

export interface RegenerateAssetsResponse {
  status: StoryStatus;
}

export interface GenerateAudioResponse {
  status: StoryStatus;
  generatedAudio: number;
  chargedCredits: number;
  availableCredits: number;
}

export interface StoryViewResponse {
  id: string;
  viewCount: number;
}

export interface StoryPackOffer {
  slug: 'pack_5' | 'pack_12' | 'pack_20';
  name: string;
  description: string;
  credits: number;
  priceMinor: number;
  currency: 'ron';
  isActive: boolean;
}

export interface CreditBalance {
  availableCredits: number;
}

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note?: string;
  storyId?: string;
  purchaseId?: string;
  adminUserId?: string;
  createdAt: string;
}

export interface BillingPurchase {
  id: string;
  offerSlug: StoryPackOffer['slug'];
  amountMinor: number;
  currency: 'ron';
  creditsGranted: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  fulfilledAt?: string;
}

export interface BillingOverview {
  balance: CreditBalance;
  offers: StoryPackOffer[];
  isAdmin: boolean;
}

export interface BillingHistoryResponse {
  purchases: BillingPurchase[];
  ledger: CreditLedgerEntry[];
}

export interface BillingCheckoutResponse {
  checkoutUrl: string;
  checkoutSessionId: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  displayName?: string;
  availableCredits: number;
  isAdmin: boolean;
  createdAt?: string;
}

export interface AdminUserStoryCostSummary {
  id: string;
  createdAt: string;
  title?: string;
  status: StoryStatus;
  creditCost?: number;
  generationInputs?: StoryGenerationInputs;
  usageTotals: StoryUsageTotals;
}

export interface AdminUserCostMetrics {
  revenueMinor: number;
  revenueCurrency: 'ron';
  costUsdMicros: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AdminUserDetail extends AdminUserSummary {
  purchases: BillingPurchase[];
  ledger: CreditLedgerEntry[];
  stories: AdminUserStoryCostSummary[];
  metrics: AdminUserCostMetrics;
}

export interface AdminWebhookEvent {
  stripeEventId: string;
  eventType: string;
  status: 'processing' | 'processed' | 'failed';
  errorMessage?: string;
  createdAt: string;
  processedAt?: string;
}

export interface AdminOverview {
  offers: StoryPackOffer[];
  webhookEvents: AdminWebhookEvent[];
}
