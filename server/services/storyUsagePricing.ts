import type { ModelPricingSnapshot } from '../../shared/types.js';

export const STORY_USAGE_PRICING_VERSION = 'catalog-v2';
export const OPENAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;

function price(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundMicros(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000));
}

export function computeTextCostUsdMicros(
  pricing: ModelPricingSnapshot,
  inputTokens: number,
  outputTokens: number,
  usage: {
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    webSearchCalls?: number;
  } = {},
): number {
  const totalInputTokens = Math.max(0, inputTokens);
  const cachedInputTokens = Math.min(totalInputTokens, Math.max(0, usage.cachedInputTokens ?? 0));
  const cacheWriteInputTokens = Math.min(
    totalInputTokens - cachedInputTokens,
    Math.max(0, usage.cacheWriteInputTokens ?? 0),
  );
  const standardInputTokens = totalInputTokens - cachedInputTokens - cacheWriteInputTokens;
  const usesOpenAILongContextPricing = pricing.provider === 'openai'
    && pricing.model === 'gpt-5.6-sol'
    && totalInputTokens > OPENAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD;
  const inputPriceMultiplier = usesOpenAILongContextPricing ? 2 : 1;
  const outputPriceMultiplier = usesOpenAILongContextPricing ? 1.5 : 1;
  return roundMicros(
    inputPriceMultiplier * (
      standardInputTokens * price(pricing.inputUsdPerToken)
      + cachedInputTokens * price(pricing.cachedInputUsdPerToken)
      + cacheWriteInputTokens * price(pricing.cacheWriteUsdPerToken)
    )
    + outputPriceMultiplier * Math.max(0, outputTokens) * price(pricing.outputUsdPerToken)
    + Math.max(0, usage.webSearchCalls ?? 0) * price(pricing.webSearchUsdPerCall),
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
