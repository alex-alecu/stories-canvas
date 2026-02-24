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
  scenarioModel: process.env.SCENARIO_MODEL || 'gemini-2.5-flash',
  imageModel: process.env.IMAGE_MODEL || 'gemini-2.5-flash-preview-image-generation',
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
} as const;
