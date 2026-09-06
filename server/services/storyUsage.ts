import { config } from '../config.js';
import { requestUsageId } from './openrouter.js';
import crypto from 'crypto';
import type {
  ArtStyleKey,
  StoryGenerationInputs,
  StoryMeta,
  StoryMode,
  StoryUsageEvent,
  StoryUsageOperation,
  StoryUsageProvider,
  StoryUsageSource,
  StoryUsageStatus,
  StoryUsageTotals,
  VoiceKey,
  ModelPricingSnapshot,
} from '../../shared/types.js';
import {
  STORY_USAGE_PRICING_VERSION,
  computeElevenLabsCostUsdMicros,
  computeGeminiImageCostUsdMicros,
  computeTextCostUsdMicros,
} from './storyUsagePricing.js';
import { resolveModelPricingSnapshot } from './modelPriceCatalog.js';

export const EMPTY_STORY_USAGE_TOTALS: StoryUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsdMicros: 0,
  textCostUsdMicros: 0,
  imageCostUsdMicros: 0,
  audioCostUsdMicros: 0,
};

export interface StoryUsageRecordInput {
  provider: StoryUsageProvider;
  operation: StoryUsageOperation;
  source: StoryUsageSource;
  status: StoryUsageStatus;
  model: string;
  pageNumber?: number;
  inputTokens?: number;
  outputTokens?: number;
  generatedImages?: number;
  imageOutputTokens?: number;
  billedCharacters?: number;
  usageAvailable?: boolean;
  usageDetails?: Record<string, unknown>;
}

export interface StoryUsageStorage {
  appendStoryUsageEvent(storyId: string, event: StoryUsageEvent, totalsDelta: StoryUsageTotals): Promise<void>;
}

interface TextUsageBillingUnits {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  webSearchCalls: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

function resolveTextUsageBillingUnits(usageDetails: Record<string, unknown> | undefined): TextUsageBillingUnits {
  const details = usageDetails ?? {};
  const responseUsage = record(details.responseUsage) ?? record(details.usage) ?? details;
  const inputDetails = record(responseUsage.input_tokens_details)
    ?? record(responseUsage.inputTokensDetails)
    ?? record(details.input_tokens_details)
    ?? record(details.inputTokensDetails)
    ?? {};

  return {
    cachedInputTokens: nonNegativeNumber(
      inputDetails.cached_tokens,
      inputDetails.cachedTokens,
      responseUsage.cached_input_tokens,
      responseUsage.cachedInputTokens,
      details.cached_input_tokens,
      details.cachedInputTokens,
    ),
    cacheWriteInputTokens: nonNegativeNumber(
      inputDetails.cache_write_tokens,
      inputDetails.cacheWriteTokens,
      responseUsage.cache_write_input_tokens,
      responseUsage.cacheWriteInputTokens,
      details.cache_write_input_tokens,
      details.cacheWriteInputTokens,
    ),
    webSearchCalls: nonNegativeNumber(
      responseUsage.web_search_calls,
      responseUsage.webSearchCalls,
      details.web_search_calls,
      details.webSearchCalls,
    ),
  };
}

export function normalizeStoryUsageTotals(usageTotals?: Partial<StoryUsageTotals> | null): StoryUsageTotals {
  return {
    inputTokens: usageTotals?.inputTokens ?? 0,
    outputTokens: usageTotals?.outputTokens ?? 0,
    totalTokens: usageTotals?.totalTokens ?? 0,
    costUsdMicros: usageTotals?.costUsdMicros ?? 0,
    textCostUsdMicros: usageTotals?.textCostUsdMicros ?? 0,
    imageCostUsdMicros: usageTotals?.imageCostUsdMicros ?? 0,
    audioCostUsdMicros: usageTotals?.audioCostUsdMicros ?? 0,
  };
}

export function buildStoryGenerationInputs(params: {
  prompt: string;
  language: string;
  age: number;
  artStyle: ArtStyleKey;
  storyMode: StoryMode;
  voice?: VoiceKey;
  proModel: boolean;
  scenarioModel: string;
  imageModel: string;
  imageModelPro: string;
  audioModel?: string;
  pageCount?: number;
}): StoryGenerationInputs {
  return {
    prompt: params.prompt,
    language: params.language,
    age: params.age,
    artStyle: params.artStyle,
    storyMode: params.storyMode,
    voice: params.voice,
    audioEnabled: params.storyMode === 'pro_audio',
    proModel: params.proModel,
    scenarioModel: params.scenarioModel,
    imageModel: params.imageModel,
    imageModelPro: params.imageModelPro,
    audioModel: params.audioModel,
    pricingVersion: STORY_USAGE_PRICING_VERSION,
    pageCount: params.pageCount,
  };
}

function resolveCostMicros(
  input: StoryUsageRecordInput,
  pricing: ModelPricingSnapshot,
  inputTokens: number,
  outputTokens: number,
  imageOutputTokens: number,
  billedCharacters: number,
  textUsageBillingUnits: TextUsageBillingUnits,
): number {
  if (input.provider === 'elevenlabs') {
    return computeElevenLabsCostUsdMicros(pricing, billedCharacters);
  }

  if (input.operation === 'character_sheet' || input.operation === 'page_image') {
    return computeGeminiImageCostUsdMicros(pricing, inputTokens, imageOutputTokens);
  }

  return computeTextCostUsdMicros(pricing, inputTokens, outputTokens, textUsageBillingUnits);
}

function buildTotalsDelta(input: StoryUsageRecordInput, inputTokens: number, outputTokens: number, totalTokens: number, costUsdMicros: number): StoryUsageTotals {
  const totals = {
    ...EMPTY_STORY_USAGE_TOTALS,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsdMicros,
  };

  if (input.provider === 'elevenlabs') {
    totals.audioCostUsdMicros = costUsdMicros;
    return totals;
  }

  if (input.operation === 'character_sheet' || input.operation === 'page_image') {
    totals.imageCostUsdMicros = costUsdMicros;
    return totals;
  }

  totals.textCostUsdMicros = costUsdMicros;
  return totals;
}

export async function recordStoryUsage(
  storage: StoryUsageStorage,
  storyId: string,
  userId: string | undefined,
  input: StoryUsageRecordInput,
  pricingResolver: (model: string) => Promise<ModelPricingSnapshot | undefined> = resolveModelPricingSnapshot,
): Promise<StoryUsageEvent> {
  const usageAvailable = input.usageAvailable !== false;
  const inputTokens = usageAvailable ? Math.max(0, input.inputTokens ?? 0) : 0;
  const outputTokens = usageAvailable ? Math.max(0, input.outputTokens ?? 0) : 0;
  const imageOutputTokens = usageAvailable ? Math.max(0, input.imageOutputTokens ?? 0) : 0;
  const billedCharacters = usageAvailable ? Math.max(0, input.billedCharacters ?? 0) : 0;
  const totalTokens = inputTokens + outputTokens;
  const textUsageBillingUnits = usageAvailable
    ? resolveTextUsageBillingUnits(input.usageDetails)
    : { cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchCalls: 0 };
  const reportedCost = input.provider === 'openrouter' ? input.usageDetails?.providerCostUsd : undefined;
  const hasReportedCost = typeof reportedCost === 'number' && Number.isFinite(reportedCost) && reportedCost >= 0;
  const pricingSnapshot = input.provider === 'openrouter' ? undefined : await pricingResolver(input.model);
  const calculatedAt = new Date().toISOString();
  const costUsdMicros = hasReportedCost ? Math.round(reportedCost * 1_000_000) : pricingSnapshot
    ? resolveCostMicros(
      input,
      pricingSnapshot,
      inputTokens,
      outputTokens,
      imageOutputTokens,
      billedCharacters,
      textUsageBillingUnits,
    )
    : 0;
  const event: StoryUsageEvent = {
    id: input.provider === 'openrouter' && typeof input.usageDetails?.responseId === 'string'
      ? requestUsageId(storyId, input.usageDetails.responseId) : crypto.randomUUID(),
    storyId,
    userId,
    provider: input.provider,
    operation: input.operation,
    source: input.source,
    status: input.status,
    model: input.model,
    pageNumber: input.pageNumber,
    inputTokens,
    outputTokens,
    totalTokens,
    generatedImages: Math.max(0, input.generatedImages ?? 0),
    billedCharacters,
    imageOutputTokens,
    costUsdMicros,
    usageDetails: {
      ...(input.usageDetails ?? {}),
      ...(input.generatedImages !== undefined ? { generatedImages: input.generatedImages } : {}),
      ...(input.billedCharacters !== undefined ? { billedCharacters: input.billedCharacters } : {}),
    },
    pricingSnapshot: pricingSnapshot
      ? { ...pricingSnapshot, roles: [...pricingSnapshot.roles] }
      : {},
    pricingStatus: hasReportedCost || (usageAvailable && pricingSnapshot) ? 'complete' : 'incomplete',
    calculatedAt,
    createdAt: new Date().toISOString(),
  };

  await storage.appendStoryUsageEvent(
    storyId,
    event,
    buildTotalsDelta(input, inputTokens, outputTokens, totalTokens, costUsdMicros),
  );
  if (config.useSupabase && input.status === 'succeeded' && event.pricingStatus === 'incomplete') {
    throw new Error('The request cost is unavailable. Generation stopped.');
  }
  return event;
}

export function applyStoryUsageTotals(story: StoryMeta | null): StoryMeta | null {
  if (!story) return story;
  return {
    ...story,
    usageTotals: normalizeStoryUsageTotals(story.usageTotals),
  };
}
