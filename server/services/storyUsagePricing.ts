const USD_MICROS_PER_USD = 1_000_000;

export const STORY_USAGE_PRICING_VERSION = '2026-04-15';

interface GeminiTextPrice {
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
}

interface GeminiImagePrice {
  inputMicrosPerMillion: number;
  imageOutputMicros: number;
}

interface ElevenLabsPrice {
  microsPerCharacter: number;
}

const GEMINI_TEXT_PRICING: Record<string, GeminiTextPrice> = {
  'gemini-3-pro-preview': { inputMicrosPerMillion: 2 * USD_MICROS_PER_USD, outputMicrosPerMillion: 12 * USD_MICROS_PER_USD },
  'gemini-3.1-pro-preview': { inputMicrosPerMillion: 2 * USD_MICROS_PER_USD, outputMicrosPerMillion: 12 * USD_MICROS_PER_USD },
  'gemini-3.1-flash-lite': { inputMicrosPerMillion: 250_000, outputMicrosPerMillion: 1.5 * USD_MICROS_PER_USD },
  'gemini-2.5-pro': { inputMicrosPerMillion: 2 * USD_MICROS_PER_USD, outputMicrosPerMillion: 12 * USD_MICROS_PER_USD },
  'gemini-2.5-flash-lite': { inputMicrosPerMillion: 100_000, outputMicrosPerMillion: 400_000 },
};

const GEMINI_IMAGE_PRICING: Record<string, GeminiImagePrice> = {
  'gemini-3-pro-image-preview': { inputMicrosPerMillion: 2 * USD_MICROS_PER_USD, imageOutputMicros: 134_000 },
  'gemini-3.1-flash-image-preview': { inputMicrosPerMillion: 100_000, imageOutputMicros: 39_000 },
  'gemini-2.0-flash-preview-image-generation': { inputMicrosPerMillion: 100_000, imageOutputMicros: 39_000 },
};

const ELEVENLABS_PRICING: Record<string, ElevenLabsPrice> = {
  eleven_multilingual_v2: { microsPerCharacter: 100 },
  eleven_turbo_v2_5: { microsPerCharacter: 50 },
  eleven_turbo_v2: { microsPerCharacter: 50 },
};

function roundMicros(value: number): number {
  return Math.round(value);
}

export function computeGeminiTextCostUsdMicros(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = GEMINI_TEXT_PRICING[model];
  if (!pricing) return 0;

  return roundMicros(
    (Math.max(0, inputTokens) * pricing.inputMicrosPerMillion) / 1_000_000
    + (Math.max(0, outputTokens) * pricing.outputMicrosPerMillion) / 1_000_000,
  );
}

export function computeGeminiImageCostUsdMicros(model: string, inputTokens: number, generatedImages = 1): number {
  const pricing = GEMINI_IMAGE_PRICING[model];
  if (!pricing) return 0;

  return roundMicros(
    (Math.max(0, inputTokens) * pricing.inputMicrosPerMillion) / 1_000_000
    + Math.max(0, generatedImages) * pricing.imageOutputMicros,
  );
}

export function computeElevenLabsCostUsdMicros(model: string, billedCharacters: number): number {
  const pricing = ELEVENLABS_PRICING[model];
  if (!pricing) return 0;
  return roundMicros(Math.max(0, billedCharacters) * pricing.microsPerCharacter);
}
