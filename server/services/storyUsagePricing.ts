import type { ModelPricingSnapshot } from '../../shared/types.js';

export const STORY_USAGE_PRICING_VERSION = 'catalog-v1';

function price(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundMicros(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000));
}

export function computeGeminiTextCostUsdMicros(
  pricing: ModelPricingSnapshot,
  inputTokens: number,
  outputTokens: number,
): number {
  return roundMicros(
    Math.max(0, inputTokens) * price(pricing.inputUsdPerToken)
    + Math.max(0, outputTokens) * price(pricing.outputUsdPerToken),
  );
}

export function computeGeminiImageCostUsdMicros(
  pricing: ModelPricingSnapshot,
  inputTokens: number,
  imageOutputTokens: number,
): number {
  return roundMicros(
    Math.max(0, inputTokens) * price(pricing.inputUsdPerToken)
    + Math.max(0, imageOutputTokens) * price(pricing.imageOutputUsdPerToken),
  );
}

export function computeElevenLabsCostUsdMicros(
  pricing: ModelPricingSnapshot,
  billedCharacters: number,
): number {
  return roundMicros(
    Math.max(0, billedCharacters) * price(pricing.audioUsdPerCharacter),
  );
}
