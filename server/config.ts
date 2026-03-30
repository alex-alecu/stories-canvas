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

const supabaseUrl = optionalEnv('SUPABASE_URL');
const supabaseServiceKey = optionalEnv('SUPABASE_SERVICE_KEY');

export const config = {
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  scenarioModel: process.env.SCENARIO_MODEL || 'gemini-3.1-pro-preview',
  imageModel: process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
  imageModelPro: process.env.IMAGE_MODEL_PRO || 'gemini-3-pro-image-preview',
  imageConcurrency: parseInt(process.env.IMAGE_CONCURRENCY || '3', 10),
  port: parseInt(process.env.PORT || process.env.SERVER_PORT || '3001', 10),
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data', 'stories'),
  maxPromptLength: 500,
  maxRetries: 3,
  scenarioTemperature: numberEnv('SCENARIO_TEMPERATURE', 0.6, Number.parseFloat),
  scenarioReviewTemperature: numberEnv('SCENARIO_REVIEW_TEMPERATURE', 0.2, Number.parseFloat),
  scenarioThinkingBudget: numberEnv('SCENARIO_THINKING_BUDGET', 1024, raw => Number.parseInt(raw, 10)),
  scenarioReviewThinkingBudget: numberEnv('SCENARIO_REVIEW_THINKING_BUDGET', 1024, raw => Number.parseInt(raw, 10)),

  // Supabase configuration
  supabaseUrl,
  supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY'),
  supabaseServiceKey,
  useSupabase: !!(supabaseUrl && supabaseServiceKey),

  // ElevenLabs configuration
  elevenLabsApiKey: optionalEnv('ELEVENLABS_API_KEY'),
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  voiceIds: {
    jora: optionalEnv('VOICE_JORA_ID') || 'OlBp4oyr3FBAGEAtJOnU', // Jora Slobod
    serban: optionalEnv('VOICE_SERBAN_ID') || '8nBBDfYxYXmDNaqTCxPH', // Serban Popescu
    corina: optionalEnv('VOICE_CORINA_ID') || 'RjgBjNgGkuZd49zyCxIq', // Corina Capuccina
  },
} as const;
