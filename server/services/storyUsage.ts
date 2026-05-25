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
} from '../../shared/types.js';
import {
  STORY_USAGE_PRICING_VERSION,
  computeElevenLabsCostUsdMicros,
  computeGeminiImageCostUsdMicros,
  computeGeminiTextCostUsdMicros,
} from './storyUsagePricing.js';

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
  billedCharacters?: number;
  usageDetails?: Record<string, unknown>;
}

export interface StoryUsageStorage {
  appendStoryUsageEvent(storyId: string, event: StoryUsageEvent, totalsDelta: StoryUsageTotals): Promise<void>;
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

function resolveCostMicros(input: StoryUsageRecordInput, inputTokens: number, outputTokens: number): number {
  if (input.provider === 'elevenlabs') {
    return computeElevenLabsCostUsdMicros(input.model, input.billedCharacters ?? 0);
  }

  if (input.operation === 'character_sheet' || input.operation === 'page_image') {
    return computeGeminiImageCostUsdMicros(input.model, inputTokens, input.generatedImages ?? 0);
  }

  return computeGeminiTextCostUsdMicros(input.model, inputTokens, outputTokens);
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
): Promise<StoryUsageEvent> {
  const inputTokens = Math.max(0, input.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.outputTokens ?? 0);
  const totalTokens = inputTokens + outputTokens;
  const costUsdMicros = resolveCostMicros(input, inputTokens, outputTokens);
  const event: StoryUsageEvent = {
    id: crypto.randomUUID(),
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
    costUsdMicros,
    usageDetails: {
      ...(input.usageDetails ?? {}),
      ...(input.generatedImages !== undefined ? { generatedImages: input.generatedImages } : {}),
      ...(input.billedCharacters !== undefined ? { billedCharacters: input.billedCharacters } : {}),
    },
    createdAt: new Date().toISOString(),
  };

  await storage.appendStoryUsageEvent(
    storyId,
    event,
    buildTotalsDelta(input, inputTokens, outputTokens, totalTokens, costUsdMicros),
  );
  return event;
}

export function applyStoryUsageTotals(story: StoryMeta | null): StoryMeta | null {
  if (!story) return story;
  return {
    ...story,
    usageTotals: normalizeStoryUsageTotals(story.usageTotals),
  };
}
