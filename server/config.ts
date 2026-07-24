import path from 'path';
import { createHash } from 'node:crypto';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

function listEnv(key: string): string[] {
  const value = process.env[key];
  if (!value) return [];

  return value
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function numberEnv(
  key: string,
  fallback: number,
  parser: (raw: string) => number,
): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = parser(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerEnv(key: string, fallback: number): number {
  return numberEnv(key, fallback, raw => Number.parseInt(raw, 10));
}

export interface StoryPackPricingConfig {
  currency: string;
  pricesMinor: {
    pack_5: number;
    pack_12: number;
    pack_20: number;
  };
  fingerprint: string;
}

export function resolveStoryPackPricingConfig(
  env: NodeJS.ProcessEnv = process.env,
): StoryPackPricingConfig | undefined {
  const keys = [
    'STORY_PACK_CURRENCY',
    'STORY_PACK_5_PRICE_MINOR',
    'STORY_PACK_12_PRICE_MINOR',
    'STORY_PACK_20_PRICE_MINOR',
  ] as const;
  const configured = keys.filter(key => !!env[key]?.trim());
  if (configured.length === 0) return undefined;
  if (configured.length !== keys.length) {
    throw new Error(`Story pack pricing requires all of: ${keys.join(', ')}`);
  }

  const currency = env.STORY_PACK_CURRENCY!.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error('STORY_PACK_CURRENCY must be a three-letter currency code');
  }

  const readPrice = (key: typeof keys[number]): number => {
    const raw = env[key]!.trim();
    if (!/^\d+$/.test(raw)) {
      throw new Error(`${key} must be a non-negative integer in minor currency units`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${key} must be a safe integer`);
    }
    return value;
  };

  const pricesMinor = {
    pack_5: readPrice('STORY_PACK_5_PRICE_MINOR'),
    pack_12: readPrice('STORY_PACK_12_PRICE_MINOR'),
    pack_20: readPrice('STORY_PACK_20_PRICE_MINOR'),
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ currency, pricesMinor }))
    .digest('hex');

  return { currency, pricesMinor, fingerprint };
}

type SiteLanguage = 'ro' | 'en';

const VALID_APP_LANGUAGES = new Set<SiteLanguage>(['ro', 'en']);

export function resolveDefaultAppLanguage(language?: string): SiteLanguage {
  const normalizedLanguage = language?.trim().toLowerCase();
  return VALID_APP_LANGUAGES.has(normalizedLanguage as SiteLanguage)
    ? normalizedLanguage as SiteLanguage
    : 'ro';
}

function appLanguageEnv(): SiteLanguage {
  return resolveDefaultAppLanguage(
    process.env.APP_DEFAULT_LANGUAGE || process.env.SEO_DEFAULT_LANG || process.env.VITE_DEFAULT_LANGUAGE,
  );
}

const DEFAULT_SITE_COPY = {
  ro: {
    siteName: 'Povești Magice',
    shortName: 'Povești Magice',
    title: 'Povești Magice | Povești ilustrate pentru copii',
    description: 'Creează povești ilustrate personalizate pentru copii, cu imagini, narațiune și povești publice de explorat.',
    locale: 'ro_RO',
  },
  en: {
    siteName: 'Magic Stories',
    shortName: 'Magic Stories',
    title: 'Magic Stories | Illustrated stories for children',
    description: 'Create personalized illustrated stories for children with images, narration, and public stories to explore.',
    locale: 'en_US',
  },
} as const;

const defaultLanguage = appLanguageEnv();
const defaultSiteCopy = defaultLanguage === 'ro' ? DEFAULT_SITE_COPY.ro : DEFAULT_SITE_COPY.en;
const supabaseUrl = optionalEnv('SUPABASE_URL');
const supabaseServiceKey = optionalEnv('SUPABASE_SERVICE_KEY');

export const config = {
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  scenarioModel: process.env.SCENARIO_MODEL || 'gemini-3.1-pro-preview',
  imageModel: process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
  imageModelPro: process.env.IMAGE_MODEL_PRO || 'gemini-3-pro-image-preview',
  imageConcurrency: integerEnv('IMAGE_CONCURRENCY', 3),
  port: parseInt(process.env.PORT || process.env.SERVER_PORT || '3001', 10),
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data', 'stories'),
  maxPromptLength: 500,
  maxRetries: 3,
  maxActiveGenerationsPerUser: integerEnv('MAX_ACTIVE_GENERATIONS_PER_USER', 2),
  readRateWindowMs: integerEnv('READ_RATE_WINDOW_MS', 60_000),
  anonymousReadIpLimit: integerEnv('ANONYMOUS_READ_IP_LIMIT', 300),
  authenticatedReadUserLimit: integerEnv('AUTHENTICATED_READ_USER_LIMIT', 300),
  authenticatedReadIpLimit: integerEnv('AUTHENTICATED_READ_IP_LIMIT', 600),
  sseIpConnectionLimit: integerEnv('SSE_IP_CONNECTION_LIMIT', 10),
  sseStoryIpConnectionLimit: integerEnv('SSE_STORY_IP_CONNECTION_LIMIT', 3),
  authCacheTtlMs: integerEnv('AUTH_CACHE_TTL_MS', 60_000),
  scenarioTemperature: numberEnv('SCENARIO_TEMPERATURE', 0.6, Number.parseFloat),
  scenarioReviewTemperature: numberEnv('SCENARIO_REVIEW_TEMPERATURE', 0.2, Number.parseFloat),
  sourceAnalysisModel: process.env.SOURCE_ANALYSIS_MODEL || 'gemini-3.1-flash-lite',
  reviewModel: process.env.REVIEW_MODEL || 'gemini-3.1-flash-lite',
  pageTextReviewModel: process.env.REVIEW_MODEL || process.env.PAGE_TEXT_REVIEW_MODEL || 'gemini-3.1-flash-lite',
  storyPackPricing: resolveStoryPackPricingConfig(),

  // Supabase configuration
  supabaseUrl,
  supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY'),
  supabaseServiceKey,
  useSupabase: !!(supabaseUrl && supabaseServiceKey),
  adminBootstrapEmails: listEnv('ADMIN_BOOTSTRAP_EMAILS'),

  // ElevenLabs configuration
  elevenLabsApiKey: optionalEnv('ELEVENLABS_API_KEY'),
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  elevenLabsPriceUsdPer1kCharacters: numberEnv('ELEVENLABS_PRICE_USD_PER_1K_CHARACTERS', 0.10, Number.parseFloat),
  voiceIds: {
    jora: optionalEnv('VOICE_JORA_ID') || 'OlBp4oyr3FBAGEAtJOnU', // Jora Slobod
    serban: optionalEnv('VOICE_SERBAN_ID') || '8nBBDfYxYXmDNaqTCxPH', // Serban Popescu
    corina: optionalEnv('VOICE_CORINA_ID') || 'RjgBjNgGkuZd49zyCxIq', // Corina Capuccina
  },

  // Stripe configuration
  stripeSecretKey: optionalEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: optionalEnv('STRIPE_WEBHOOK_SECRET'),
  appBaseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || `http://localhost:${parseInt(process.env.PORT || process.env.SERVER_PORT || '3001', 10)}`,
  defaultLanguage,
  appSiteName: process.env.APP_SITE_NAME || defaultSiteCopy.siteName,
  appSiteShortName: process.env.APP_SITE_SHORT_NAME || process.env.APP_SITE_NAME || defaultSiteCopy.shortName,
  appSiteDescription: process.env.APP_SITE_DESCRIPTION || defaultSiteCopy.description,

  // SEO configuration
  seoSiteName: process.env.SEO_SITE_NAME || process.env.APP_SITE_NAME || defaultSiteCopy.siteName,
  seoDefaultLang: process.env.SEO_DEFAULT_LANG || defaultLanguage,
  seoDefaultLocale: process.env.SEO_DEFAULT_LOCALE || defaultSiteCopy.locale,
  seoDefaultTitle: process.env.SEO_DEFAULT_TITLE || defaultSiteCopy.title,
  seoDefaultDescription: process.env.SEO_DEFAULT_DESCRIPTION || process.env.APP_SITE_DESCRIPTION || defaultSiteCopy.description,
  seoFallbackImage: process.env.SEO_FALLBACK_IMAGE || '/logo-big-512.png',

  // Marketing conversion configuration
  ga4MeasurementId: optionalEnv('GA4_MEASUREMENT_ID') || optionalEnv('VITE_GA4_MEASUREMENT_ID'),
  ga4ApiSecret: optionalEnv('GA4_API_SECRET'),
  metaPixelId: optionalEnv('META_PIXEL_ID') || optionalEnv('VITE_META_PIXEL_ID'),
  metaCapiAccessToken: optionalEnv('META_CAPI_ACCESS_TOKEN'),
  metaTestEventCode: optionalEnv('META_TEST_EVENT_CODE'),
  tikTokPixelId: optionalEnv('TIKTOK_PIXEL_ID') || optionalEnv('VITE_TIKTOK_PIXEL_ID'),
  tikTokEventsAccessToken: optionalEnv('TIKTOK_EVENTS_ACCESS_TOKEN'),
  tikTokAdvertiserId: optionalEnv('TIKTOK_ADVERTISER_ID'),
  tikTokTestEventCode: optionalEnv('TIKTOK_TEST_EVENT_CODE'),
  googleAdsDeveloperToken: optionalEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
  googleAdsClientId: optionalEnv('GOOGLE_ADS_CLIENT_ID'),
  googleAdsClientSecret: optionalEnv('GOOGLE_ADS_CLIENT_SECRET'),
  googleAdsRefreshToken: optionalEnv('GOOGLE_ADS_REFRESH_TOKEN'),
  googleAdsCustomerId: optionalEnv('GOOGLE_ADS_CUSTOMER_ID'),
  googleAdsLoginCustomerId: optionalEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
  googleAdsPurchaseConversionActionId: optionalEnv('GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID'),
  googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v22',
} as const;
