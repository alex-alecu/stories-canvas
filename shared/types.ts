import type { ThinkingLevel } from './textModels.js';
export type PageStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type StoryStatus = 'generating_scenario' | 'reviewing_scenario' | 'generating_characters' | 'generating_images' | 'generating_audio' | 'completed' | 'failed' | 'cancelled';

export type ArtStyleKey = 'disney-pixar' | 'watercolor' | 'storybook' | 'anime' | 'colored-pencil' | 'paper-cutout';

export type VoiceKey = 'bunica' | 'jora' | 'serban' | 'corina';
export type StoryMode = 'fast' | 'pro' | 'pro_audio';
export type StoryReaction = 'like' | 'dislike';
export const STORY_REACTION_FEEDBACK_MAX_CHARS = 500;
export type StoryUsageProvider = 'openrouter' | 'openai' | 'gemini' | 'elevenlabs';
export type StoryUsageSource = 'initial_generation' | 'retry' | 'regenerate_assets' | 'add_audio' | 'regenerate_page_image' | 'regenerate_page_audio';
export type StoryUsageStatus = 'succeeded' | 'failed';
export type StoryUsageOperation =
  | 'source_analysis'
  | 'scenario_draft'
  | 'scenario_validation_repair'
  | 'scenario_review'
  | 'scenario_review_rewrite'
  | 'page_text_review'
  | 'page_image_review'
  | 'character_sheet'
  | 'page_image'
  | 'page_audio';

export const STORY_PAGE_DEFAULT_MAX_COUNT = 10;
export const STORY_PAGE_MAX_COUNT = 20;
export const STORY_PAGE_TARGET_COUNT = STORY_PAGE_DEFAULT_MAX_COUNT;

export function isStoryMode(value: string | null | undefined): value is StoryMode {
  return value === 'fast' || value === 'pro' || value === 'pro_audio';
}

function normalizePromptForPageEstimate(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['"„”’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptLooksLikeFaithfulRetelling(normalizedPrompt: string): boolean {
  return [
    'aproape de original',
    'cat mai aproape de original',
    'povestea originala',
    'basmul original',
    'retell',
    'faithful retelling',
    'original version',
    'versiunea originala',
    'adaptare fidela',
    'adapteaza fidel',
    'urmeaza originalul',
  ].some(cue => normalizedPrompt.includes(cue))
    || /\b(?:povestea|basmul)\s+(?:lui\s+)?[a-z0-9]/.test(normalizedPrompt);
}

function promptLooksComplexStory(normalizedPrompt: string): boolean {
  return /\b(?:adventure|journey|quest|kingdom|mystery|epic|chapter|long|multi part|complex|aventura|calatorie|misiune|taram|regat|lung|complex)\b/.test(normalizedPrompt);
}

export function estimateOriginalStoryPageCount(_prompt?: string): number {
  return STORY_PAGE_DEFAULT_MAX_COUNT;
}

export function estimateStoryPageLimit(prompt?: string): number {
  const normalizedPrompt = normalizePromptForPageEstimate(prompt);
  if (!normalizedPrompt) return STORY_PAGE_DEFAULT_MAX_COUNT;
  return promptLooksLikeFaithfulRetelling(normalizedPrompt) || promptLooksComplexStory(normalizedPrompt)
    ? STORY_PAGE_MAX_COUNT
    : STORY_PAGE_DEFAULT_MAX_COUNT;
}

export function estimateInitialStoryPageCount(prompt?: string): number {
  return estimateStoryPageLimit(prompt);
}

export function isStoryReaction(value: unknown): value is StoryReaction {
  return value === 'like' || value === 'dislike';
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
  'disney-pixar': 'Warm family-friendly stylized 3D animation with rounded character shapes, expressive faces, cinematic lighting, richly detailed environments, and gentle vibrant colors',
  'watercolor': 'Soft watercolor illustration style with delicate washes of color, dreamy atmosphere, and gentle brushstrokes',
  'storybook': 'Classic hand-drawn storybook illustration with detailed line work, warm colors, and a nostalgic feel',
  'anime': 'Soft anime style with large expressive eyes, vibrant colors, and gentle cel-shading',
  'colored-pencil': 'Colored pencil illustration style with visible pencil textures, warm shading, and a handcrafted feel',
  'paper-cutout': 'Paper cutout collage style with layered textures, craft paper elements, and a handmade feel',
};

export const DEFAULT_ART_STYLE: ArtStyleKey = 'storybook';
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
  imageRevision?: number;
  audioRevision?: number;
}

export interface Scenario {
  title: string;
  targetAge: number;
  characters: Character[];
  pages: Page[];
}

export interface PublicStoryPreviewGate {
  pageLimit: number;
  totalPages: number;
}

export interface StoryGenerationInputs {
  textModel?: string;
  thinkingLevel?: ThinkingLevel;
  billingCurrency?: 'USD';
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
  pageCount?: number;
  retellingMode?: 'original' | 'faithful_retelling';
  sourceTitle?: string;
  sourceProvider?: string;
  sourceUrl?: string;
  sourceLicense?: string;
  sourceTextHash?: string;
  sourceCacheHit?: boolean;
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

export interface StoryOpenRouterCosts {
  textCostUsdMicros: number;
  imageCostUsdMicros: number;
  unpricedRequests: number;
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
  generatedImages: number;
  billedCharacters: number;
  imageOutputTokens: number;
  costUsdMicros: number;
  usageDetails: Record<string, unknown>;
  pricingSnapshot: ModelPricingSnapshot | Record<string, never>;
  pricingStatus: 'complete' | 'incomplete' | 'estimated';
  calculatedAt: string;
  createdAt: string;
}

export interface ModelPriceCatalogEntry {
  model: string;
  provider: StoryUsageProvider;
  roles: string[];
  unit: string;
  inputUsdPerToken: string;
  cachedInputUsdPerToken: string;
  cacheWriteUsdPerToken: string;
  outputUsdPerToken: string;
  imageOutputUsdPerToken: string;
  audioUsdPerCharacter: string;
  webSearchUsdPerCall: string;
  sourceUrl: string;
  endpointTag: string;
  fetchedAt: string;
}

export type ModelPricingSnapshot = ModelPriceCatalogEntry;

export interface PriceCatalogStatus {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  stale: boolean;
}

export interface StoryImageSources {
  thumb?: string;
  card?: string;
  full?: string;
}

export interface StoryMeta {
  id: string;
  prompt: string;
  status: StoryStatus;
  createdAt: string;
  scenario?: Scenario;
  coverImage?: string;
  coverImageSources?: StoryImageSources;
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
  openRouterCosts?: StoryOpenRouterCosts | null;
  viewCount?: number;
  likeCount?: number;
  dislikeCount?: number;
  myReaction?: StoryReaction | null;
  publicPreviewGate?: PublicStoryPreviewGate;
}

export interface StoryDetail extends StoryMeta {
  scenario: Scenario;
}

export type GenerationActivityKind =
  | 'main_agent'
  | 'subagent'
  | 'script'
  | 'characters'
  | 'page_image'
  | 'page_audio';

export type GenerationActivityStatus = 'working' | 'completed' | 'failed';

export interface GenerationActivity {
  id: string;
  kind: GenerationActivityKind;
  status: GenerationActivityStatus;
  label: string;
  detail?: string;
  turn?: number;
  maxTurns?: number;
  turnsRemaining?: number;
  reviewCycle?: number;
  pageNumber?: number;
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
  activity?: GenerationActivity;
  activityLog?: GenerationActivity[];
}

export interface CreateStoryRequest {
  textModel?: string;
  thinkingLevel?: ThinkingLevel;
  audioEnabled?: boolean;
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
  chargedCredits?: number;
  availableCredits?: number;
}

export interface GenerateAudioResponse {
  status: StoryStatus;
  generatedAudio: number;
  chargedCredits: number;
  availableCredits: number;
}

export interface RegeneratePageImageResponse {
  status: StoryStatus;
  pageNumber: number;
  chargedCredits: number;
  availableCredits: number;
}

export interface RegeneratePageAudioResponse {
  status: StoryStatus;
  pageNumber: number;
  chargedCredits: number;
  availableCredits: number;
}

export interface StoryViewResponse {
  id: string;
  viewCount: number;
}

export interface StoryReactionResponse {
  id: string;
  likeCount: number;
  dislikeCount: number;
  myReaction: StoryReaction | null;
  feedback?: string | null;
}

export interface StoryPackOffer {
  slug: 'pack_5' | 'pack_12' | 'pack_20';
  name: string;
  description: string;
  credits: number;
  priceMinor: number;
  currency: string;
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
  stripeCheckoutSessionId: string;
  amountMinor: number;
  currency: string;
  creditsGranted: number;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;
}

export interface MarketingAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  ttclid?: string;
  landingPage?: string;
  referrer?: string;
}

export interface MarketingConsentState {
  marketing: boolean;
  decidedAt?: string;
}

export interface BillingCheckoutMarketingPayload {
  attribution?: MarketingAttribution;
  consent?: MarketingConsentState;
  eventId?: string;
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
  averageCreditValueMinor: number | null;
  revenueCurrency: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface AdminStorySummary {
  id: string;
  userId?: string;
  email: string;
  title: string;
  createdAt: string;
  pages: number;
  storyMode: StoryMode;
  textCostUsdMicros: number;
  imageCostUsdMicros: number;
  audioCostUsdMicros: number;
  totalCostUsdMicros: number;
  creditsConsumed: number;
  profitUsdMicros: number | null;
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
  revenueCurrency: string;
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
  modelPrices: ModelPriceCatalogEntry[];
  priceCatalogStatus: PriceCatalogStatus;
}
