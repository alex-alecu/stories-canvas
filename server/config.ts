function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  scenarioModel: process.env.SCENARIO_MODEL || 'gemini-2.5-flash',
  imageModel: process.env.IMAGE_MODEL || 'gemini-2.5-flash-preview-image-generation',
  imageConcurrency: parseInt(process.env.IMAGE_CONCURRENCY || '3', 10),
  port: parseInt(process.env.SERVER_PORT || '3001', 10),
  dataDir: new URL('../data/stories', import.meta.url).pathname,
  maxPromptLength: 500,
  maxRetries: 3,
} as const;
