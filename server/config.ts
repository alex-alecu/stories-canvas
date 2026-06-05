import path from 'path';

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
  pageTextReviewModel: process.env.PAGE_TEXT_REVIEW_MODEL || 'gemini-3.1-flash-lite',

  // Supabase configuration
  supabaseUrl,
  supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY'),
  supabaseServiceKey,
  useSupabase: !!(supabaseUrl && supabaseServiceKey),
  adminBootstrapEmails: listEnv('ADMIN_BOOTSTRAP_EMAILS'),

  // ElevenLabs configuration
  elevenLabsApiKey: optionalEnv('ELEVENLABS_API_KEY'),
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  voiceIds: {
    jora: optionalEnv('VOICE_JORA_ID') || 'OlBp4oyr3FBAGEAtJOnU', // Jora Slobod
    serban: optionalEnv('VOICE_SERBAN_ID') || '8nBBDfYxYXmDNaqTCxPH', // Serban Popescu
    corina: optionalEnv('VOICE_CORINA_ID') || 'RjgBjNgGkuZd49zyCxIq', // Corina Capuccina
  },

  // Stripe configuration
  stripeSecretKey: optionalEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: optionalEnv('STRIPE_WEBHOOK_SECRET'),
  appBaseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || `http://localhost:${parseInt(process.env.PORT || process.env.SERVER_PORT || '3001', 10)}`,

  // SEO configuration
  seoSiteName: process.env.SEO_SITE_NAME || 'Povești Magice',
  seoDefaultLang: process.env.SEO_DEFAULT_LANG || 'ro',
  seoDefaultLocale: process.env.SEO_DEFAULT_LOCALE || 'ro_RO',
  seoDefaultTitle: process.env.SEO_DEFAULT_TITLE || 'Povești Magice | Povești ilustrate pentru copii',
  seoDefaultDescription: process.env.SEO_DEFAULT_DESCRIPTION || 'Creează povești ilustrate personalizate pentru copii, cu imagini, narațiune și povești publice de explorat.',
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
