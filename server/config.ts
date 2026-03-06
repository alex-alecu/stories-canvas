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

  // Supabase configuration
  supabaseUrl,
  supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY'),
  supabaseServiceKey,
  useSupabase: !!(supabaseUrl && supabaseServiceKey),

  // ElevenLabs configuration
  elevenLabsApiKey: optionalEnv('ELEVENLABS_API_KEY'),
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  voiceIds: {
    grandma: optionalEnv('VOICE_GRANDMA_ID') || 'XB0fDUnXU5powFXDhCwa', // Charlotte
    grandpa: optionalEnv('VOICE_GRANDPA_ID') || 'JBFqnCBsd6RMkjVDRZzb', // George
    dad: optionalEnv('VOICE_DAD_ID') || 'TX3LPaxmHKxFdv7VOQHJ', // Liam
    mom: optionalEnv('VOICE_MOM_ID') || 'EXAVITQu4vr4xnSDxMaL', // Sarah
    whisper: optionalEnv('VOICE_WHISPER_ID') || 'JBFqnCBsd6RMkjVDRZzb', // George (with whisper settings)
  },
} as const;
