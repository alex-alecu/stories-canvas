import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import * as fsStorage from '../utils/storage.js';
import * as sbStorage from '../services/supabaseStorage.js';
import { getCharacterSheetFilename } from '../services/characterSheet.js';
import { generateScenario, generateScenarioWithMetadata, type GeneratedScenarioResult } from '../services/scenario.js';
import { generateAllCharacterSheets } from '../services/characterSheet.js';
import { finishTrackedGeneration, getTrackedGeneration, isGenerationActive, startTrackedGeneration } from '../services/generationRegistry.js';
import { generateAllSceneImages, retryFailedSceneImages } from '../services/sceneGenerator.js';
import { generateAllPageAudio, generatePageAudio, retryMissingAudio, savePageAudio, isElevenLabsConfigured } from '../services/elevenlabs.js';
import { reviewPageText } from '../services/pageTextReview.js';
import {
  consumeCredits,
  getUserCreditBalance,
  grantCredits,
  InsufficientCreditsError,
  refundStoryCredits,
} from '../services/billingStorage.js';
import { getArtStyleDescription, getStoryArtStyleDescription, resolveArtStyle } from '../services/storyStyle.js';
import { optionalAuth } from '../middleware/auth.js';
import type {
  ArtStyleKey,
  CreateStoryRequest,
  GenerateAudioResponse,
  GenerationProgress,
  Page,
  RegeneratePageAudioResponse,
  RegeneratePageImageResponse,
  RegenerateAssetsResponse,
  RetryStoryResponse,
  Scenario,
  StoryGenerationInputs,
  StoryMeta,
  StoryMode,
  StoryReaction,
  StoryReactionResponse,
  StoryStatus,
  StoryUsageSource,
  StoryUsageTotals,
  StoryAssets,
  VoiceKey,
} from '../../shared/types.js';
import {
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  getStoryAudioCreditCost,
  getStoryCreditCost,
  getStoryImageCreditCost,
  getStoryImagePageCreditCost,
  getVoiceName,
  isStoryMode,
  isStoryReaction,
  normalizeVoiceKey,
  roundCreditAmount,
} from '../../shared/types.js';
import { MEDIA_CACHE_CONTROL, getPageAudioFilename, getPageImageFilename, pageHasAudio } from '../utils/storyMedia.js';
import { buildStoryGenerationInputs, recordStoryUsage, type StoryUsageStorage } from '../services/storyUsage.js';
import { getScenarioTextRules, OVERLAY_SAFE_MAX_CHARS } from '../services/scenarioValidation.js';

const router = Router();
const SSE_CLOSE_DELAY_MS = 2_000;

export const scenarioOps = {
  generateScenario,
  generateScenarioWithMetadata,
};

export const illustrationOps = {
  getCharacterSheetFilename,
  generateAllCharacterSheets,
  generateAllSceneImages,
  retryFailedSceneImages,
};

export const audioOps = {
  generateAllPageAudio,
  generatePageAudio,
  retryMissingAudio,
  savePageAudio,
  isElevenLabsConfigured,
};

export const pageTextReviewOps = {
  reviewPageText,
};

export const storyStyleOps = {
  getArtStyleDescription,
  getStoryArtStyleDescription,
  resolveArtStyle,
};

export const storageOps = {
  getActiveGenerations: sbStorage.getActiveGenerations,
  getStory: async (storyId: string) => (
    config.useSupabase ? sbStorage.getStory(storyId) : fsStorage.getStory(storyId)
  ),
  updateStoryStatus: async (storyId: string, status: StoryStatus) => (
    config.useSupabase ? sbStorage.updateStoryStatus(storyId, status) : fsStorage.updateStoryStatus(storyId, status)
  ),
  updateStoryProgress: async (storyId: string, progress: sbStorage.StoryProgressUpdate) => (
    config.useSupabase ? sbStorage.updateStoryProgress(storyId, progress) : undefined
  ),
  updateStoryVoice: async (storyId: string, voice: VoiceKey) => (
    config.useSupabase ? sbStorage.updateStoryVoice(storyId, voice) : fsStorage.updateStoryVoice(storyId, voice)
  ),
  listPublicStories: async (search?: string, limit?: number) => (
    config.useSupabase ? sbStorage.listPublicStories(search, limit) : []
  ),
  listStoriesByUser: async (userId: string, limit?: number) => (
    config.useSupabase ? sbStorage.listStoriesByUser(userId, limit) : []
  ),
  incrementStoryViewCount: async (storyId: string) => (
    config.useSupabase ? sbStorage.incrementStoryViewCount(storyId) : fsStorage.incrementStoryViewCount(storyId)
  ),
  getStoryReaction: async (storyId: string, userId: string) => (
    config.useSupabase ? sbStorage.getStoryReaction(storyId, userId) : null
  ),
  setStoryReaction: async (storyId: string, userId: string, reaction: StoryReaction | null) => (
    config.useSupabase
      ? sbStorage.setStoryReaction(storyId, userId, reaction)
      : {
          id: storyId,
          likeCount: 0,
          dislikeCount: 0,
          myReaction: null,
        } satisfies StoryReactionResponse
  ),
};

export const billingOps = {
  consumeCredits,
  getUserCreditBalance,
  grantCredits,
  refundStoryCredits,
};

// ---------- Storage adapter (delegates to Supabase or filesystem) ----------

async function saveScenario(
  storyId: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
  options: {
    voice?: VoiceKey;
    artStyle?: ArtStyleKey;
    language?: string;
    scenarioRevision?: number;
    renderedScenarioRevision?: number;
    storyMode?: StoryMode;
    creditCost?: number;
    generationInputs?: StoryGenerationInputs;
  } = {},
): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryScenario(storyId, scenario, status, prompt, {
      artStyle: options.artStyle,
      language: options.language,
      scenarioRevision: options.scenarioRevision,
      renderedScenarioRevision: options.renderedScenarioRevision,
      storyMode: options.storyMode,
      creditCost: options.creditCost,
      generationInputs: options.generationInputs,
    });
  } else {
    await fsStorage.saveScenario(storyId, scenario, status, prompt, options);
  }
}

async function createStoryRecord(
  storyId: string,
  prompt: string,
  status: StoryStatus,
  userId: string | undefined,
  language: string | undefined,
  voice: VoiceKey | undefined,
  artStyle: ArtStyleKey | undefined,
  storyMode: StoryMode,
  creditCost: number,
  generationInputs: StoryGenerationInputs,
): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.createStory(
      storyId,
      prompt,
      status,
      userId,
      language,
      voice,
      artStyle,
      storyMode,
      creditCost,
      generationInputs,
    );
  } else {
    await fsStorage.createStory(
      storyId,
      prompt,
      status,
      userId,
      language,
      voice,
      artStyle,
      storyMode,
      creditCost,
      generationInputs,
    );
  }
}

async function updateStoryScenario(
  storyId: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
  options: {
    voice?: VoiceKey;
    artStyle?: ArtStyleKey;
    language?: string;
    scenarioRevision?: number;
    renderedScenarioRevision?: number;
    storyMode?: StoryMode;
    creditCost?: number;
    generationInputs?: StoryGenerationInputs;
  } = {},
): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryScenario(storyId, scenario, status, prompt, {
      artStyle: options.artStyle,
      language: options.language,
      scenarioRevision: options.scenarioRevision,
      renderedScenarioRevision: options.renderedScenarioRevision,
      storyMode: options.storyMode,
      creditCost: options.creditCost,
      generationInputs: options.generationInputs,
    });
  } else {
    await fsStorage.updateStoryScenario(storyId, scenario, status, prompt, options);
  }
}

async function updateRenderedScenarioRevision(storyId: string, renderedScenarioRevision: number): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryRenderedScenarioRevision(storyId, renderedScenarioRevision);
  } else {
    await fsStorage.updateStoryRenderedScenarioRevision(storyId, renderedScenarioRevision);
  }
}

async function updateStoryStatus(storyId: string, status: StoryStatus): Promise<void> {
  await storageOps.updateStoryStatus(storyId, status);
}

async function getStory(storyId: string): Promise<StoryMeta | null> {
  return storageOps.getStory(storyId);
}

const usageStorage: StoryUsageStorage = {
  appendStoryUsageEvent: async (storyId, event, totalsDelta) => {
    if (config.useSupabase) {
      await sbStorage.appendStoryUsageEvent(storyId, event, totalsDelta);
    } else {
      await fsStorage.appendStoryUsageEvent(storyId, event, totalsDelta);
    }
  },
};

async function listAllStories(): Promise<StoryMeta[]> {
  if (config.useSupabase) {
    return sbStorage.listStories();
  }
  return fsStorage.listStories();
}

async function removeStory(storyId: string, userId?: string): Promise<boolean> {
  if (config.useSupabase) {
    return sbStorage.deleteStory(storyId, userId);
  }
  return fsStorage.deleteStory(storyId);
}

// ---------- Image URL helpers ----------

function getStoryImageUrl(storyId: string, filename: string, userId?: string): string {
  return config.useSupabase
    ? sbStorage.getImageUrl(userId, storyId, filename)
    : `/api/stories/${storyId}/images/${filename}`;
}

function getStoryAudioUrl(storyId: string, filename: string, userId?: string): string {
  return config.useSupabase
    ? sbStorage.getAudioUrl(userId, storyId, filename)
    : `/api/stories/${storyId}/audio/${filename}`;
}

function getPageImageUrl(storyId: string, pageNumber: number, userId?: string): string {
  return getStoryImageUrl(storyId, getPageImageFilename(pageNumber), userId);
}

function getPageAudioUrl(storyId: string, pageNumber: number, userId?: string): string {
  return getStoryAudioUrl(storyId, getPageAudioFilename(pageNumber), userId);
}

function getCoverImageUrl(story: StoryMeta): string | undefined {
  if (!story.scenario?.pages?.[0]) return undefined;
  if (story.scenario.pages[0].status !== 'completed') return undefined;
  return getPageImageUrl(story.id, story.scenario.pages[0].pageNumber, story.userId);
}

function storyHasAudio(story: StoryMeta): boolean {
  return story.scenario?.pages?.some(pageHasAudio) ?? false;
}

function getScenarioRevision(story: Pick<StoryMeta, 'scenario' | 'scenarioRevision'>): number {
  if (typeof story.scenarioRevision === 'number' && Number.isInteger(story.scenarioRevision)) {
    return Math.max(0, story.scenarioRevision);
  }

  return story.scenario ? 1 : 0;
}

function getRenderedScenarioRevision(story: Pick<StoryMeta, 'scenario' | 'renderedScenarioRevision' | 'scenarioRevision'>): number {
  if (typeof story.renderedScenarioRevision === 'number' && Number.isInteger(story.renderedScenarioRevision)) {
    return Math.max(0, story.renderedScenarioRevision);
  }

  return getScenarioRevision(story);
}

function storyAssetsAreStale(story: Pick<StoryMeta, 'scenario' | 'scenarioRevision' | 'renderedScenarioRevision'>): boolean {
  return getScenarioRevision(story) > getRenderedScenarioRevision(story);
}

function toStorySummary(story: StoryMeta) {
  const firstPageRevision = story.scenario?.pages?.[0]?.imageRevision;
  const coverImage = story.coverImage ?? getCoverImageUrl(story);
  const coverImageSources = story.coverImageSources
    ? {
        thumb: story.coverImageSources.thumb ? appendMediaRevision(story.coverImageSources.thumb, firstPageRevision) : undefined,
        card: story.coverImageSources.card ? appendMediaRevision(story.coverImageSources.card, firstPageRevision) : undefined,
        full: story.coverImageSources.full ? appendMediaRevision(story.coverImageSources.full, firstPageRevision) : undefined,
      }
    : undefined;
  return {
    id: story.id,
    prompt: story.prompt,
    status: story.status,
    createdAt: story.createdAt,
    title: story.scenario?.title,
    coverImage: coverImage ? appendMediaRevision(coverImage, firstPageRevision) : undefined,
    coverImageSources,
    totalPages: story.scenario?.pages?.length ?? 0,
    completedPages: story.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
    isPublic: story.isPublic,
    hasAudio: storyHasAudio(story),
    assetsStale: storyAssetsAreStale(story),
    viewCount: story.viewCount ?? 0,
    likeCount: story.likeCount ?? 0,
    dislikeCount: story.dislikeCount ?? 0,
  };
}

function canReadStory(story: StoryMeta, viewerUserId?: string): boolean {
  if (config.useSupabase && story.userId && !story.isPublic && viewerUserId !== story.userId) {
    return false;
  }

  return true;
}

function isTerminalStoryStatus(status: StoryStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function getStatusPhase(status: StoryStatus): string {
  switch (status) {
    case 'reviewing_scenario':
      return 'Generating story scenario...';
    case 'completed':
      return 'Done!';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'In progress...';
  }
}

function getStatusMessage(status: StoryStatus): string {
  switch (status) {
    case 'reviewing_scenario':
      return 'Creating your story...';
    case 'completed':
      return 'Story generated successfully!';
    case 'failed':
      return 'Generation failed';
    case 'cancelled':
      return 'Generation cancelled';
    default:
      return 'Reconnected to generation progress...';
  }
}

function getDisplayProgressMessage(story: StoryMeta): string {
  return story.progressMessage || getStatusMessage(story.status);
}

function resolveRequestedStoryMode(input: CreateStoryRequest): StoryMode {
  if (isStoryMode(input.storyMode)) {
    return input.storyMode;
  }

  if (input.voice) {
    return 'pro_audio';
  }

  if (input.pro) {
    return 'pro';
  }

  return 'fast';
}

function storyModeUsesProModel(mode: StoryMode): boolean {
  return mode !== 'fast';
}

function storyHasCompletedIllustrations(story: Pick<StoryMeta, 'scenario'>): boolean {
  return story.scenario?.pages.some(page => page.status === 'completed') ?? false;
}

async function maybeRefundCreditsForStory(
  storyId: string,
  story: StoryMeta | null,
  note: string,
): Promise<void> {
  if (!config.useSupabase || !story || storyHasCompletedIllustrations(story)) {
    return;
  }

  await refundStoryCredits(storyId, note);
}

function summarizeImageProviderFailure(failedPages: number[], lastFailureMessage?: string): string {
  if (failedPages.length === 0) {
    return 'Story generated successfully!';
  }

  if (failedPages.length === 1 && lastFailureMessage) {
    return lastFailureMessage;
  }

  return `${failedPages.length} illustrations could not be generated because the image provider blocked or rejected them. Open Story Tools to retry those pages.`;
}

function cloneScenarioForAssetRefresh(scenario: Scenario): Scenario {
  return {
    ...scenario,
    pages: scenario.pages.map(page => ({
      pageNumber: page.pageNumber,
      text: page.text,
      imagePrompt: page.imagePrompt,
      characters: [...page.characters],
      status: 'pending',
      imageRevision: page.imageRevision,
      audioRevision: page.audioRevision,
    })),
  };
}

function normalizePageRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function incrementPageRevision(value: unknown): number {
  return normalizePageRevision(value) + 1;
}

function appendMediaRevision(url: string, revision: unknown): string {
  const normalizedRevision = normalizePageRevision(revision);
  if (normalizedRevision <= 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${normalizedRevision}`;
}

function findScenarioPage(scenario: Scenario, pageNumber: number): Page | undefined {
  return scenario.pages.find(page => page.pageNumber === pageNumber);
}

function cloneScenarioWithUpdatedPage(
  scenario: Scenario,
  pageNumber: number,
  update: (page: Page) => Page,
): Scenario {
  return {
    ...scenario,
    pages: scenario.pages.map(page => (
      page.pageNumber === pageNumber ? update({ ...page, characters: [...page.characters] }) : page
    )),
  };
}

function getCompletedPageCount(scenario: Scenario): number {
  return scenario.pages.filter(page => page.status === 'completed').length;
}

function getFailedPageNumbers(scenario: Scenario): number[] {
  return scenario.pages.filter(page => page.status === 'failed').map(page => page.pageNumber);
}

async function persistScenarioAfterPageMutation(storyId: string, story: StoryMeta, scenario: Scenario): Promise<void> {
  await updateStoryScenario(storyId, scenario, 'completed', story.prompt, {
    voice: story.voice,
    artStyle: story.artStyle,
    language: story.language,
    scenarioRevision: getScenarioRevision(story),
    renderedScenarioRevision: getRenderedScenarioRevision(story),
    storyMode: story.storyMode,
    creditCost: story.creditCost,
    generationInputs: story.generationInputs,
  });

  if (config.useSupabase) {
    await storageOps.updateStoryProgress(storyId, {
      status: 'completed',
      completed_pages: getCompletedPageCount(scenario),
      failed_pages: getFailedPageNumbers(scenario),
    });
  }
}

async function refundRegenerationCharge(userId: string | undefined, storyId: string, amount: number, note: string): Promise<void> {
  if (!config.useSupabase || !userId || amount <= 0) return;

  try {
    await billingOps.grantCredits(userId, amount, {
      reason: 'story_refund',
      storyId,
      note,
    });
  } catch (error) {
    console.error(`Failed to refund regeneration charge for ${storyId}:`, error);
  }
}

function getSafeStoryMode(story: Pick<StoryMeta, 'storyMode'>): StoryMode {
  return story.storyMode ?? 'fast';
}

function getPageTextValidationError(text: string, targetAge: number): string | null {
  if (!text) return 'Page text cannot be empty';
  const textRules = getScenarioTextRules(targetAge);
  if (text.length > textRules.maxChars) {
    return `Page text must be ${textRules.maxChars} characters or less for this age`;
  }
  if (text.length > OVERLAY_SAFE_MAX_CHARS) {
    return `Page text must be ${OVERLAY_SAFE_MAX_CHARS} characters or less`;
  }
  return null;
}

function buildInitialProgress(storyId: string, story: StoryMeta): GenerationProgress {
  const isHiddenReviewPhase = story.status === 'reviewing_scenario';

  return {
    storyId,
    status: story.status,
    currentPhase: isHiddenReviewPhase
      ? 'Generating story scenario...'
      : (story.currentPhase || getStatusPhase(story.status)),
    completedPages: story.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
    totalPages: story.scenario?.pages?.length ?? 0,
    failedPages: story.scenario?.pages
      ?.filter(p => p.status === 'failed')
      .map(p => p.pageNumber) ?? [],
    message: isHiddenReviewPhase
      ? 'Creating your story...'
      : getDisplayProgressMessage(story),
  };
}

function buildGenerationInputsSnapshot(
  prompt: string,
  language: string,
  age: number,
  artStyle: ArtStyleKey,
  storyMode: StoryMode,
  voice: VoiceKey | undefined,
  proModel: boolean,
): StoryGenerationInputs {
  return buildStoryGenerationInputs({
    prompt,
    language,
    age,
    artStyle,
    storyMode,
    voice,
    proModel,
    scenarioModel: config.scenarioModel,
    imageModel: config.imageModel,
    imageModelPro: config.imageModelPro,
    audioModel: config.elevenLabsModel,
  });
}

function applyScenarioGroundingInputs(
  inputs: StoryGenerationInputs,
  result: GeneratedScenarioResult,
): StoryGenerationInputs {
  if (!result.retellingSource) {
    return {
      ...inputs,
      retellingMode: 'original',
    };
  }

  return {
    ...inputs,
    retellingMode: 'faithful_retelling',
    sourceTitle: result.retellingSource.title,
    sourceProvider: result.retellingSource.provider,
    sourceUrl: result.retellingSource.sourceUrl,
    sourceLicense: result.retellingSource.licenseNote,
    sourceTextHash: result.retellingSource.sourceTextHash,
    sourceCacheHit: result.retellingSource.sourceCacheHit,
  };
}

function createUsageRecorder(storyId: string, userId: string | undefined, source: StoryUsageSource) {
  async function safeRecord(operationLabel: string, record: () => Promise<void>): Promise<void> {
    try {
      await record();
    } catch (error) {
      console.error(`[usage:${storyId}] Failed to persist ${operationLabel} usage event:`, error);
    }
  }

  return {
    recordText: async (operation: 'source_analysis' | 'scenario_draft' | 'scenario_validation_repair' | 'scenario_review' | 'scenario_review_rewrite', usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      usageDetails: Record<string, unknown>;
    }) => {
      await safeRecord(operation, async () => {
        await recordStoryUsage(usageStorage, storyId, userId, {
          provider: 'gemini',
          operation,
          source,
          status: usage.status,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          usageDetails: usage.usageDetails,
        });
      });
    },
    recordCharacterSheet: async (usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      generatedImages: number;
      usageDetails: Record<string, unknown>;
    }) => {
      await safeRecord('character_sheet', async () => {
        await recordStoryUsage(usageStorage, storyId, userId, {
          provider: 'gemini',
          operation: 'character_sheet',
          source,
          status: usage.status,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          generatedImages: usage.generatedImages,
          usageDetails: usage.usageDetails,
        });
      });
    },
    recordPageImage: async (pageNumber: number, usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      generatedImages: number;
      usageDetails: Record<string, unknown>;
    }) => {
      await safeRecord(`page_image:${pageNumber}`, async () => {
        await recordStoryUsage(usageStorage, storyId, userId, {
          provider: 'gemini',
          operation: 'page_image',
          source,
          status: usage.status,
          model: usage.model,
          pageNumber,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          generatedImages: usage.generatedImages,
          usageDetails: usage.usageDetails,
        });
      });
    },
    recordPageAudio: async (pageNumber: number, usage: {
      model: string;
      status: 'succeeded' | 'failed';
      billedCharacters: number;
      usageDetails: Record<string, unknown>;
    }) => {
      await safeRecord(`page_audio:${pageNumber}`, async () => {
        await recordStoryUsage(usageStorage, storyId, userId, {
          provider: 'elevenlabs',
          operation: 'page_audio',
          source,
          status: usage.status,
          model: usage.model,
          pageNumber,
          billedCharacters: usage.billedCharacters,
          usageDetails: usage.usageDetails,
        });
      });
    },
  };
}

// ---------- SSE connections ----------

const sseConnections = new Map<string, Set<Response>>();

function sendSSE(storyId: string, data: Partial<GenerationProgress>): void {
  const connections = sseConnections.get(storyId);
  if (!connections) return;
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of connections) {
    try {
      res.write(message);
    } catch {
      connections.delete(res);
    }
  }

  if (connections.size === 0) {
    sseConnections.delete(storyId);
  }
}

function closeStoryConnections(storyId: string): void {
  const connections = sseConnections.get(storyId);
  if (!connections) return;

  for (const res of connections) {
    try {
      res.end();
    } catch {
      // Ignore already-closed connections.
    }
  }

  sseConnections.delete(storyId);
}

function scheduleStoryConnectionCleanup(storyId: string): void {
  setTimeout(() => {
    closeStoryConnections(storyId);
  }, SSE_CLOSE_DELAY_MS);
}

// ---------- Persist progress to DB alongside SSE ----------

async function sendProgressUpdate(storyId: string, data: Partial<GenerationProgress>): Promise<void> {
  // Always send via SSE for real-time
  sendSSE(storyId, data);

  // Also persist to Supabase so progress survives refresh
  if (config.useSupabase) {
    try {
      await storageOps.updateStoryProgress(storyId, {
        status: data.status,
        completed_pages: data.completedPages,
        failed_pages: data.failedPages,
        current_phase: data.currentPhase,
        progress_message: data.message,
      });
    } catch (error) {
      console.error(`Failed to persist progress for ${storyId}:`, error);
    }
  }
}

// ---------- Routes ----------

// GET /api/stories/public - List public stories (no auth required)
router.get('/public', async (req: Request, res: Response) => {
  try {
    if (!config.useSupabase) {
      res.json([]);
      return;
    }

    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const rawLimit = typeof req.query.limit === 'string'
      ? Number.parseInt(req.query.limit, 10)
      : Number.NaN;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 50)
      : undefined;
    const stories = await storageOps.listPublicStories(search, limit);
    const summaries = stories.map(toStorySummary);
    res.json(summaries);
  } catch (error) {
    console.error('Failed to list public stories:', error);
    res.status(500).json({ error: 'Failed to list public stories' });
  }
});

// GET /api/stories/mine - List stories for authenticated user
router.get('/mine', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (config.useSupabase) {
      const stories = await storageOps.listStoriesByUser(req.authUser.id);
      const summaries = stories.map(toStorySummary);
      res.json(summaries);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Failed to list user stories:', error);
    res.status(500).json({ error: 'Failed to list user stories' });
  }
});

// GET /api/stories - List stories (private by default: only user's own stories when authenticated)
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    let stories: StoryMeta[];

    if (config.useSupabase && req.authUser) {
      // Authenticated with Supabase: only return user's own stories
      stories = await storageOps.listStoriesByUser(req.authUser.id);
    } else if (config.useSupabase && !req.authUser) {
      // Supabase enabled but not authenticated: return empty list (private by default)
      stories = [];
    } else {
      // Filesystem mode (no Supabase): return all stories (backward compatible)
      stories = await listAllStories();
    }

    const summaries = stories.map(toStorySummary);
    res.json(summaries);
  } catch (error) {
    console.error('Failed to list stories:', error);
    res.status(500).json({ error: 'Failed to list stories' });
  }
});

// POST /api/stories - Create a new story (requires auth when Supabase is configured)
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    // Require authentication when Supabase is configured
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const request = req.body as CreateStoryRequest;
    const { prompt, language, age, style, voice } = request;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
      res.status(400).json({ error: 'Prompt cannot be empty' });
      return;
    }

    if (trimmedPrompt.length > config.maxPromptLength) {
      res.status(400).json({ error: `Prompt must be ${config.maxPromptLength} characters or less` });
      return;
    }

    const storyLanguage = typeof language === 'string' ? language : 'ro';
    const storyAge = typeof age === 'number' && age > 0 && age <= 12 ? age : DEFAULT_AGE;
    const storyStyle = storyStyleOps.resolveArtStyle(typeof style === 'string' ? style : undefined);
    const storyMode = resolveRequestedStoryMode(request);
    const creditCost = getStoryCreditCost(storyMode);
    const storyVoice = storyMode === 'pro_audio'
      ? normalizeVoiceKey(typeof voice === 'string' ? voice : undefined)
      : undefined;
    const useProModel = storyModeUsesProModel(storyMode);
    const storyId = crypto.randomUUID();
    const userId = req.authUser?.id;
    const generationInputs = buildGenerationInputsSnapshot(
      trimmedPrompt,
      storyLanguage,
      storyAge,
      storyStyle,
      storyMode,
      storyVoice,
      useProModel,
    );

    if (storyMode === 'pro_audio' && !storyVoice) {
      res.status(400).json({ error: 'A narrator voice is required for Pro + Audio stories' });
      return;
    }

    if (storyMode === 'pro_audio' && !audioOps.isElevenLabsConfigured()) {
      res.status(503).json({ error: 'Audio generation service is not configured' });
      return;
    }

    await createStoryRecord(
      storyId,
      trimmedPrompt,
      'generating_scenario',
      userId,
      storyLanguage,
      storyVoice,
      storyStyle,
      storyMode,
      creditCost,
      generationInputs,
    );

    // Create the story in storage immediately so it's available for SSE and refresh
    if (config.useSupabase) {
      try {
        const charge = await consumeCredits(req.authUser!.id, creditCost, {
          reason: 'story_create',
          storyId,
          note: storyMode,
        });

        try {
          await sbStorage.updateStoryCreditCharge(storyId, charge.ledger_id);
        } catch (creditChargeError) {
          try {
            await grantCredits(req.authUser!.id, creditCost, {
              reason: 'story_refund',
              storyId,
              note: 'Automatic refund after credit charge persistence failed.',
            });
          } catch (refundError) {
            console.error(`Failed to compensate credits after charge persistence error for ${storyId}:`, refundError);
          }

          await removeStory(storyId, userId).catch(() => {});
          throw creditChargeError;
        }
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          const balance = await getUserCreditBalance(req.authUser!.id).catch(() => ({ availableCredits: 0 }));
          await removeStory(storyId, userId).catch(() => {});
          res.status(402).json({
            error: 'Not enough credits to create this story',
            requiredCredits: creditCost,
            availableCredits: balance.availableCredits,
          });
          return;
        }

        await removeStory(storyId, userId).catch(() => {});
        throw error;
      }
    }

    // Return immediately, generation happens in background
    res.status(201).json({ id: storyId, status: 'generating_scenario' as StoryStatus });

    // Background generation pipeline
    runGenerationPipeline(
      storyId,
      trimmedPrompt,
      userId,
      storyLanguage,
      storyAge,
      storyStyle,
      storyMode,
      creditCost,
      storyVoice,
      useProModel,
    ).catch(error => {
      console.error(`Generation pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to create story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

async function runGenerationPipeline(
  storyId: string,
  prompt: string,
  userId?: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
  storyMode: StoryMode = 'fast',
  creditCost = getStoryCreditCost(storyMode),
  voice?: VoiceKey,
  pro = storyModeUsesProModel(storyMode),
): Promise<void> {
  const controller = startTrackedGeneration(storyId);
  const { signal } = controller;
  const initialScenarioRevision = 1;
  const usageRecorder = createUsageRecorder(storyId, userId, 'initial_generation');

  try {
    // Phase 1: Generate scenario
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_scenario',
      currentPhase: 'Generating story scenario...',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Creating your story...',
    });

    if (signal.aborted) throw new Error('Generation cancelled');
    const scenarioResult = await scenarioOps.generateScenarioWithMetadata(
      prompt,
      language,
      age,
      style,
      (progress) => {
        sendProgressUpdate(storyId, {
          storyId,
          status: progress.status,
          currentPhase: progress.currentPhase,
          completedPages: 0,
          totalPages: 0,
          failedPages: [],
          message: progress.message,
        }).catch(() => {});
      },
      {
        onSourceAnalysisUsage: usage => usageRecorder.recordText('source_analysis', usage),
        onDraftUsage: usage => usageRecorder.recordText('scenario_draft', usage),
        onValidationRepairUsage: usage => usageRecorder.recordText('scenario_validation_repair', usage),
        onReviewUsage: usage => usageRecorder.recordText('scenario_review', usage),
        onRewriteUsage: usage => usageRecorder.recordText('scenario_review_rewrite', usage),
      },
    );
    const scenario = scenarioResult.scenario;
    const groundedGenerationInputs = applyScenarioGroundingInputs(
      buildGenerationInputsSnapshot(
        prompt,
        language ?? 'ro',
        age ?? DEFAULT_AGE,
        style ?? DEFAULT_ART_STYLE,
        storyMode,
        voice,
        pro,
      ),
      scenarioResult,
    );
    await saveScenario(storyId, scenario, 'generating_characters', prompt, {
      voice,
      artStyle: style,
      language,
      scenarioRevision: initialScenarioRevision,
      renderedScenarioRevision: 0,
      storyMode,
      creditCost,
      generationInputs: groundedGenerationInputs,
    });

    if (signal.aborted) throw new Error('Generation cancelled');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_characters',
      currentPhase: 'Generating character sheets...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Story "${scenario.title}" created with ${scenario.pages.length} pages. Generating character sheets...`,
    });

    // Phase 2: Generate character sheets (sequential)
    const styleDescription = storyStyleOps.getArtStyleDescription(style);
    const characterSheets = await illustrationOps.generateAllCharacterSheets(
      storyId,
      scenario.characters,
      userId,
      signal,
      styleDescription,
      pro,
      {},
      (_character, usage) => usageRecorder.recordCharacterSheet(usage),
    );

    if (signal.aborted) throw new Error('Generation cancelled');
    await updateStoryStatus(storyId, 'generating_images');

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_images',
      currentPhase: 'Generating page illustrations...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Character sheets ready. Generating ${scenario.pages.length} illustrations...`,
    });

    // Phase 3: Generate scene images (sequential with reference chaining for visual consistency)
    let completedPages = 0;
    const failedPages: number[] = [];
    let lastImageFailureMessage: string | undefined;

    await illustrationOps.generateAllSceneImages(
      storyId,
      scenario.pages,
      scenario.characters,
      characterSheets,
      styleDescription,
      (progress) => {
        // Track completion using structured fields
        if (progress.pageStatus === 'completed') {
          completedPages++;
        } else if (progress.pageStatus === 'failed' && progress.pageNumber !== undefined) {
          failedPages.push(progress.pageNumber);
          if (progress.message) {
            lastImageFailureMessage = progress.message;
          }
        }

        // Fire-and-forget the async persist, but always sync-send SSE
        sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_images',
          currentPhase: 'Generating page illustrations...',
          completedPages,
          totalPages: scenario.pages.length,
          failedPages,
          message: progress.message || '',
          pageNumber: progress.pageNumber,
          pageStatus: progress.pageStatus,
        }).catch(() => {});
      },
      userId,
      signal,
      pro,
      (page, usage) => usageRecorder.recordPageImage(page.pageNumber, usage),
    );

    // Update cover image URL
    if (config.useSupabase) {
      const coverUrl = getPageImageUrl(storyId, 1, userId);
      try {
        await sbStorage.updateStoryProgress(storyId, {
          status: voice && audioOps.isElevenLabsConfigured() ? 'generating_audio' : 'completed',
          completed_pages: completedPages,
          failed_pages: failedPages,
        });
        // Update cover_image_url directly
        const { getSupabase } = await import('../services/supabase.js');
        await getSupabase().from('stories').update({ cover_image_url: coverUrl }).eq('id', storyId);
      } catch (err) {
        console.error(`Failed to update cover image for ${storyId}:`, err);
      }
    }

    // Phase 4: Generate audio narration (only if voice selected and ElevenLabs configured)
    let audioFailed = false;
    let audioError: string | undefined;

    if (voice && audioOps.isElevenLabsConfigured()) {
      if (signal.aborted) throw new Error('Generation cancelled');
      await updateStoryStatus(storyId, 'generating_audio');

      await sendProgressUpdate(storyId, {
        storyId,
        status: 'generating_audio',
        currentPhase: 'Recording narration...',
        completedPages: 0,
        totalPages: scenario.pages.length,
        failedPages: [],
        message: `Illustrations complete. Recording narration with ${getVoiceName(voice)}...`,
      });

      let audioCompletedPages = 0;

      const audioResult = await audioOps.generateAllPageAudio(
        storyId,
        scenario.pages,
        voice,
        userId,
        signal,
        (progress) => {
          if (progress.pageStatus === 'completed') {
            audioCompletedPages++;
          }

          sendProgressUpdate(storyId, {
            storyId,
            status: 'generating_audio',
            currentPhase: 'Recording narration...',
            completedPages: audioCompletedPages,
            totalPages: scenario.pages.length,
            failedPages,
            message: progress.message || '',
            pageNumber: progress.pageNumber,
            pageStatus: progress.pageStatus,
          }).catch(() => {});
        },
        (page, usage) => usageRecorder.recordPageAudio(page.pageNumber, usage),
      );

      // Check if audio generation had failures
      if (audioResult.completedCount < scenario.pages.length) {
        audioFailed = true;
        audioError = audioResult.error || 'Some narration pages could not be generated';
        console.warn(`Audio generation incomplete for ${storyId}: ${audioResult.completedCount}/${scenario.pages.length} succeeded, ${audioResult.failedCount} failed, ${audioResult.skippedCount} skipped`);

        // Notify clients that audio failed before transitioning to completed
        sendSSE(storyId, {
          storyId,
          status: 'generating_audio',
          currentPhase: 'Recording narration...',
          completedPages: audioResult.completedCount,
          totalPages: scenario.pages.length,
          failedPages,
          message: audioError,
          audioFailed: true,
          audioError,
        });
      }
    }

    // Complete - story is viewable even if audio failed
    const imageFailureMessage = summarizeImageProviderFailure(failedPages, lastImageFailureMessage);
    const completionMessage = audioFailed
      ? failedPages.length > 0
        ? `${imageFailureMessage} ${audioError!}`
        : audioError!
      : imageFailureMessage;
    await updateRenderedScenarioRevision(storyId, initialScenarioRevision);
    await updateStoryStatus(storyId, 'completed');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages,
      totalPages: scenario.pages.length,
      failedPages,
      message: completionMessage,
      audioFailed,
      audioError,
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    const status = isCancelled ? 'cancelled' : 'failed';
    console.error(`Pipeline ${status} for ${storyId}:`, isCancelled ? 'cancelled by user' : error);

    if (!isCancelled) {
      const story = await getStory(storyId).catch(() => null);
      await maybeRefundCreditsForStory(
        storyId,
        story,
        'Story failed before the first completed illustration.',
      );
    }

    try {
      await updateStoryStatus(storyId, status);
    } catch {}

    sendSSE(storyId, {
      storyId,
      status,
      currentPhase: isCancelled ? 'Cancelled' : 'Failed',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: isCancelled ? 'Generation cancelled' : (error instanceof Error ? error.message : 'Generation failed'),
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// GET /api/stories/active/generations - Get stories still being generated (for reconnection)
router.get('/active/generations', async (_req: Request, res: Response) => {
  try {
    if (config.useSupabase) {
      const active = await storageOps.getActiveGenerations();
      res.json(active.map(s => s.id));
    } else {
      res.json([]);
    }
  } catch (error) {
    if (sbStorage.isTransientDependencyError(error)) {
      console.warn('Active generation lookup temporarily unavailable:', error.message);
      res.status(503).json({ error: 'Story generation status is temporarily unavailable. Please retry shortly.' });
      return;
    }

    console.error('Failed to get active generations:', error);
    res.status(500).json({ error: 'Failed to get active generations' });
  }
});

// POST /api/stories/:id/regenerate-assets - Regenerate images/audio for the current script revision
router.post('/:id/regenerate-assets', optionalAuth, async (req: Request, res: Response) => {
  try {
    const storyId = req.params.id as string;

    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (config.useSupabase && story.userId && story.userId !== req.authUser?.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Story must be completed to regenerate assets' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    if (!storyAssetsAreStale(story)) {
      res.status(400).json({ error: 'Story assets are already up to date' });
      return;
    }

    if (isGenerationActive(storyId)) {
      res.status(409).json({ error: 'A generation is already in progress' });
      return;
    }

    const pageCount = story.scenario.pages.length;
    const regenerationCost = roundCreditAmount(
      getStoryImageCreditCost(getSafeStoryMode(story), pageCount)
        + (story.voice ? getStoryAudioCreditCost(pageCount) : 0),
    );
    let availableCredits = 0;
    if (config.useSupabase) {
      try {
        const charge = await billingOps.consumeCredits(req.authUser!.id, regenerationCost, {
          reason: 'story_regenerate_assets',
          storyId,
          note: `pages:${pageCount}`,
        });
        availableCredits = charge.available_credits;
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          const balance = await billingOps.getUserCreditBalance(req.authUser!.id).catch(() => ({ availableCredits: 0 }));
          res.status(402).json({
            error: 'Not enough credits to regenerate this story',
            requiredCredits: regenerationCost,
            availableCredits: balance.availableCredits,
          });
          return;
        }
        throw error;
      }
    }

    const refreshedScenario = cloneScenarioForAssetRefresh(story.scenario);
    try {
      await updateStoryScenario(storyId, refreshedScenario, 'generating_characters', story.prompt, {
        voice: story.voice,
        artStyle: story.artStyle,
        language: story.language,
        scenarioRevision: getScenarioRevision(story),
        renderedScenarioRevision: getRenderedScenarioRevision(story),
      });
    } catch (error) {
      await refundRegenerationCharge(
        req.authUser?.id,
        storyId,
        regenerationCost,
        'Automatic refund after asset regeneration setup failed.',
      );
      throw error;
    }

    res.json({
      status: 'generating_characters',
      chargedCredits: regenerationCost,
      availableCredits,
    } as RegenerateAssetsResponse);

    runRegenerateAssetsPipeline(storyId, {
      ...story,
      status: 'generating_characters',
      scenario: refreshedScenario,
    }, regenerationCost, req.authUser?.id).catch(error => {
      console.error(`Asset regeneration pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to regenerate story assets:', error);
    res.status(500).json({ error: 'Failed to regenerate story assets' });
  }
});

async function runRegenerateAssetsPipeline(
  storyId: string,
  story: StoryMeta,
  chargedCredits = 0,
  chargedUserId?: string,
): Promise<void> {
  const controller = startTrackedGeneration(storyId);
  const { signal } = controller;
  const usageRecorder = createUsageRecorder(storyId, story.userId, 'regenerate_assets');

  try {
    if (!story.scenario) {
      throw new Error('Story has no scenario data');
    }

    const scenario = story.scenario;
    const userId = story.userId;
    const styleDescription = storyStyleOps.getStoryArtStyleDescription(story);

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_characters',
      currentPhase: 'Generating character sheets...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Regenerating assets for "${scenario.title}"...`,
    });

    const characterSheets = await illustrationOps.generateAllCharacterSheets(
      storyId,
      scenario.characters,
      userId,
      signal,
      styleDescription,
      undefined,
      {},
      (_character, usage) => usageRecorder.recordCharacterSheet(usage),
    );

    if (signal.aborted) throw new Error('Generation cancelled');
    await updateStoryStatus(storyId, 'generating_images');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_images',
      currentPhase: 'Generating page illustrations...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Character sheets ready. Generating ${scenario.pages.length} illustrations...`,
    });

    let completedPages = 0;
    const failedPages: number[] = [];
    let lastImageFailureMessage: string | undefined;

    await illustrationOps.generateAllSceneImages(
      storyId,
      scenario.pages,
      scenario.characters,
      characterSheets,
      styleDescription,
      (progress) => {
        if (progress.pageStatus === 'completed') {
          completedPages++;
        } else if (progress.pageStatus === 'failed' && progress.pageNumber !== undefined) {
          failedPages.push(progress.pageNumber);
          if (progress.message) {
            lastImageFailureMessage = progress.message;
          }
        }

        sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_images',
          currentPhase: 'Generating page illustrations...',
          completedPages,
          totalPages: scenario.pages.length,
          failedPages,
          message: progress.message || '',
          pageNumber: progress.pageNumber,
          pageStatus: progress.pageStatus,
        }).catch(() => {});
      },
      userId,
      signal,
      undefined,
      (page, usage) => usageRecorder.recordPageImage(page.pageNumber, usage),
    );

    if (config.useSupabase) {
      const coverUrl = getPageImageUrl(storyId, 1, userId);
      try {
        await sbStorage.updateStoryProgress(storyId, {
          status: story.voice && audioOps.isElevenLabsConfigured() ? 'generating_audio' : 'completed',
          completed_pages: completedPages,
          failed_pages: failedPages,
        });
        const { getSupabase } = await import('../services/supabase.js');
        await getSupabase().from('stories').update({ cover_image_url: coverUrl }).eq('id', storyId);
      } catch (err) {
        console.error(`Failed to update cover image for ${storyId}:`, err);
      }
    }

    let audioFailed = false;
    let audioError: string | undefined;

    if (story.voice && audioOps.isElevenLabsConfigured()) {
      if (signal.aborted) throw new Error('Generation cancelled');
      await updateStoryStatus(storyId, 'generating_audio');
      await sendProgressUpdate(storyId, {
        storyId,
        status: 'generating_audio',
        currentPhase: 'Recording narration...',
        completedPages: 0,
        totalPages: scenario.pages.length,
        failedPages: [],
        message: `Illustrations complete. Recording narration with ${getVoiceName(story.voice)}...`,
      });

      let audioCompletedPages = 0;
      const audioResult = await audioOps.generateAllPageAudio(
        storyId,
        scenario.pages,
        story.voice,
        userId,
        signal,
        (progress) => {
          if (progress.pageStatus === 'completed') {
            audioCompletedPages++;
          }

          sendProgressUpdate(storyId, {
            storyId,
            status: 'generating_audio',
            currentPhase: 'Recording narration...',
            completedPages: audioCompletedPages,
            totalPages: scenario.pages.length,
            failedPages,
            message: progress.message || '',
            pageNumber: progress.pageNumber,
            pageStatus: progress.pageStatus,
          }).catch(() => {});
        },
        (page, usage) => usageRecorder.recordPageAudio(page.pageNumber, usage),
      );

      if (audioResult.completedCount < scenario.pages.length) {
        audioFailed = true;
        audioError = audioResult.error || 'Some narration pages could not be generated';
        sendSSE(storyId, {
          storyId,
          status: 'generating_audio',
          currentPhase: 'Recording narration...',
          completedPages: audioResult.completedCount,
          totalPages: scenario.pages.length,
          failedPages,
          message: audioError,
          audioFailed: true,
          audioError,
        });
      }
    }

    const imageFailureMessage = summarizeImageProviderFailure(failedPages, lastImageFailureMessage);
    const completionMessage = audioFailed
      ? failedPages.length > 0
        ? `${imageFailureMessage} ${audioError!}`
        : audioError!
      : imageFailureMessage;

    await updateRenderedScenarioRevision(storyId, getScenarioRevision(story));
    await updateStoryStatus(storyId, 'completed');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages,
      totalPages: scenario.pages.length,
      failedPages,
      message: completionMessage,
      audioFailed,
      audioError,
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    const status = isCancelled ? 'completed' : 'failed';
    console.error(`Asset regeneration pipeline ${isCancelled ? 'cancelled' : 'failed'} for ${storyId}:`, isCancelled ? 'cancelled by user' : error);

    await refundRegenerationCharge(
      chargedUserId,
      storyId,
      chargedCredits,
      `Automatic refund after asset regeneration ${isCancelled ? 'was cancelled' : 'failed'}.`,
    );

    try {
      await updateStoryStatus(storyId, status);
    } catch {}

    sendSSE(storyId, {
      storyId,
      status,
      currentPhase: isCancelled ? 'Cancelled' : 'Failed',
      completedPages: 0,
      totalPages: story.scenario?.pages.length ?? 0,
      failedPages: [],
      message: isCancelled ? 'Asset regeneration cancelled' : (error instanceof Error ? error.message : 'Asset regeneration failed'),
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// POST /api/stories/:id/retry - Retry failed image/audio generation
router.post('/:id/retry', optionalAuth, async (req: Request, res: Response) => {
  try {
    const storyId = req.params.id as string;

    // Require auth when Supabase is configured
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Ownership check
    if (config.useSupabase && story.userId && story.userId !== req.authUser?.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Allow retry on completed, failed, or stuck generating statuses.
    // Stories can get stuck at generating_images/generating_audio if the pipeline
    // crashed or the server restarted. The activeGenerations check below prevents
    // concurrent retries for genuinely in-progress generations.
    const retryableStatuses: StoryStatus[] = ['completed', 'failed', 'generating_images', 'generating_audio'];
    if (!retryableStatuses.includes(story.status)) {
      res.status(400).json({ error: 'Story must be completed or failed to retry' });
      return;
    }

    // Prevent concurrent retries
    if (isGenerationActive(storyId)) {
      res.status(409).json({ error: 'A retry is already in progress' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    if (storyAssetsAreStale(story)) {
      res.status(400).json({ error: 'Story assets are out of date. Regenerate assets instead of retrying.' });
      return;
    }

    const pages = story.scenario.pages;
    const failedImagePages = pages.filter(p => p.status === 'failed').map(p => p.pageNumber);
    const hasAudioPages = pages.some(pageHasAudio);
    const missingAudioPages = pages.filter(p => !pageHasAudio(p));
    // Story should have audio if it has a voice setting OR some pages already have audio
    const shouldHaveAudio = !!story.voice || hasAudioPages;
    const needsAudioRetry = shouldHaveAudio && missingAudioPages.length > 0;

    if (failedImagePages.length === 0 && !needsAudioRetry) {
      // Fix stuck status: if the story appears complete but status is still a
      // generating state (e.g. pipeline crashed), correct it to 'completed'.
      let resolvedStatus = story.status;
      if (story.status !== 'completed' && story.status !== 'failed') {
        await updateStoryStatus(storyId, 'completed');
        resolvedStatus = 'completed';
      }
      res.json({ status: resolvedStatus, retriedImages: 0, retriedAudio: 0 } as RetryStoryResponse);
      return;
    }

    // Return immediately, retry happens in background
    res.json({
      status: (failedImagePages.length > 0 ? 'generating_images' : 'generating_audio') as StoryStatus,
      retriedImages: failedImagePages.length,
      retriedAudio: needsAudioRetry ? missingAudioPages.length : 0,
    } as RetryStoryResponse);

    // Run retry pipeline in background
    runRetryPipeline(storyId, story, failedImagePages, needsAudioRetry).catch(error => {
      console.error(`Retry pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to retry story:', error);
    res.status(500).json({ error: 'Failed to retry story' });
  }
});

async function runRetryPipeline(
  storyId: string,
  story: StoryMeta,
  failedImagePages: number[],
  needsAudioRetry: boolean,
): Promise<void> {
  const controller = startTrackedGeneration(storyId);
  const { signal } = controller;
  const usageRecorder = createUsageRecorder(storyId, story.userId, 'retry');

  const scenario = story.scenario!;
  const userId = story.userId;

  try {
    let completedImages = 0;
    const totalRetries = failedImagePages.length;
    let lastImageFailureMessage: string | undefined;

    // Phase 1: Retry failed images
    if (failedImagePages.length > 0) {
      await updateStoryStatus(storyId, 'generating_images');

      await sendProgressUpdate(storyId, {
        storyId,
        status: 'generating_images',
        currentPhase: 'Retrying failed illustrations...',
        completedPages: 0,
        totalPages: totalRetries,
        failedPages: [],
        message: `Retrying ${failedImagePages.length} failed illustration(s)...`,
      });

      const styleDescription = storyStyleOps.getStoryArtStyleDescription(story);
      const failedPages: number[] = [];

      await illustrationOps.retryFailedSceneImages(
        storyId,
        scenario.pages,
        scenario.characters,
        failedImagePages,
        styleDescription,
        (progress) => {
          if (progress.pageStatus === 'completed') {
            completedImages++;
          } else if (progress.pageStatus === 'failed' && progress.pageNumber !== undefined) {
            failedPages.push(progress.pageNumber);
            if (progress.message) {
              lastImageFailureMessage = progress.message;
            }
          }
          sendProgressUpdate(storyId, {
            storyId,
            status: 'generating_images',
            currentPhase: 'Retrying failed illustrations...',
            completedPages: completedImages,
            totalPages: totalRetries,
            failedPages,
            message: progress.message || '',
            pageNumber: progress.pageNumber,
            pageStatus: progress.pageStatus,
          }).catch(() => {});
        },
        userId,
        signal,
        undefined,
        (page, usage) => usageRecorder.recordPageImage(page.pageNumber, usage),
        (_character, usage) => usageRecorder.recordCharacterSheet(usage),
      );

      // Update cover image if page 1 was retried and succeeded
      if (failedImagePages.includes(1) && !failedPages.includes(1) && config.useSupabase) {
        const coverUrl = getPageImageUrl(storyId, 1, userId);
        try {
          const { getSupabase } = await import('../services/supabase.js');
          await getSupabase().from('stories').update({ cover_image_url: coverUrl }).eq('id', storyId);
        } catch {}
      }
    }

    // Phase 2: Retry missing audio
    if (needsAudioRetry && audioOps.isElevenLabsConfigured()) {
      if (signal.aborted) throw new Error('Generation cancelled');

      // We need to re-fetch the story to get updated page data after image retry
      const updatedStory = await getStory(storyId);
      const updatedPages = updatedStory?.scenario?.pages || scenario.pages;
      const pagesNeedingAudio = updatedPages.filter(p => !pageHasAudio(p));

      // Use voice from freshest DB data, falling back to original story object
      const voiceKey = normalizeVoiceKey(updatedStory?.voice || story.voice);
      if (!voiceKey) {
        console.warn(`[retry] Story ${storyId} needs audio retry but has no voice set — skipping audio`);
      } else {
        await updateStoryStatus(storyId, 'generating_audio');

        await sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_audio',
          currentPhase: 'Retrying narration...',
          completedPages: 0,
          totalPages: pagesNeedingAudio.length,
          failedPages: [],
          message: `Retrying narration for ${pagesNeedingAudio.length} page(s)...`,
        });

        let audioCompletedPages = 0;
        await audioOps.retryMissingAudio(
          storyId,
          updatedPages,
          voiceKey,
          userId,
          signal,
          (progress) => {
            if (progress.pageStatus === 'completed') audioCompletedPages++;
            sendProgressUpdate(storyId, {
              storyId,
              status: 'generating_audio',
              currentPhase: 'Retrying narration...',
              completedPages: audioCompletedPages,
              totalPages: pagesNeedingAudio.length,
              failedPages: [],
              message: progress.message || '',
              pageNumber: progress.pageNumber,
              pageStatus: progress.pageStatus,
            }).catch(() => {});
          },
          (page, usage) => usageRecorder.recordPageAudio(page.pageNumber, usage),
        );
      }
    }

    const remainingFailedPages = scenario.pages
      .filter(page => page.status === 'failed')
      .map(page => page.pageNumber);
    const retryCompletionMessage = summarizeImageProviderFailure(remainingFailedPages, lastImageFailureMessage);

    // Complete
    await updateStoryStatus(storyId, 'completed');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages: 0,
      totalPages: 0,
      failedPages: remainingFailedPages,
      message: retryCompletionMessage === 'Story generated successfully!'
        ? 'Retry completed successfully!'
        : retryCompletionMessage,
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    const status = isCancelled ? 'cancelled' : 'failed';
    console.error(`Retry pipeline ${status} for ${storyId}:`, error);

    try {
      await updateStoryStatus(storyId, status === 'cancelled' ? 'completed' : 'failed');
    } catch {}

    sendSSE(storyId, {
      storyId,
      status: status === 'cancelled' ? 'completed' : 'failed',
      currentPhase: isCancelled ? 'Cancelled' : 'Retry failed',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: isCancelled ? 'Retry cancelled' : (error instanceof Error ? error.message : 'Retry failed'),
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// POST /api/stories/:id/generate-audio - Generate audio for a story that has none
router.post('/:id/generate-audio', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const storyId = req.params.id as string;
    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (config.useSupabase && story.userId !== req.authUser.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Story must be completed to add narration' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    if (isGenerationActive(storyId)) {
      res.status(409).json({ error: 'A generation is already in progress' });
      return;
    }

    const requestedVoice = normalizeVoiceKey(typeof req.body?.voice === 'string' ? req.body.voice : undefined);
    if (!requestedVoice) {
      res.status(400).json({ error: 'A valid narrator voice is required' });
      return;
    }

    if (!audioOps.isElevenLabsConfigured()) {
      res.status(503).json({ error: 'Audio generation service is not configured' });
      return;
    }

    const hasAnyAudio = story.scenario.pages.some(pageHasAudio);
    if (hasAnyAudio) {
      res.status(400).json({ error: 'Story already has narration' });
      return;
    }

    if (story.voice) {
      res.status(400).json({ error: 'Story already has a narrator voice. Use retry to generate missing narration.' });
      return;
    }

    const pagesNeedingAudio = story.scenario.pages.filter(page => !pageHasAudio(page));
    if (pagesNeedingAudio.length === 0) {
      res.status(400).json({ error: 'Story already has narration' });
      return;
    }

    const creditCost = getStoryAudioCreditCost(pagesNeedingAudio.length);
    const controller = startTrackedGeneration(storyId);
    let availableCredits = 0;
    let chargedCredits = 0;

    if (config.useSupabase) {
      try {
        const charge = await billingOps.consumeCredits(req.authUser.id, creditCost, {
          reason: 'story_add_audio',
          storyId,
          note: requestedVoice,
        });
        availableCredits = charge.available_credits;
        chargedCredits = creditCost;
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          const balance = await billingOps.getUserCreditBalance(req.authUser.id).catch(() => ({ availableCredits: 0 }));
          finishTrackedGeneration(storyId);
          res.status(402).json({
            error: 'Not enough credits to add narration',
            requiredCredits: creditCost,
            availableCredits: balance.availableCredits,
          });
          return;
        }

        finishTrackedGeneration(storyId);
        throw error;
      }
    }

    try {
      await storageOps.updateStoryVoice(storyId, requestedVoice);
    } catch (error) {
      if (config.useSupabase && chargedCredits > 0) {
        try {
          await billingOps.grantCredits(req.authUser.id, chargedCredits, {
            reason: 'story_refund',
            storyId,
            note: 'Automatic refund after narration setup failed.',
          });
        } catch (refundError) {
          console.error(`Failed to refund add-audio charge for ${storyId}:`, refundError);
        }
      }

      finishTrackedGeneration(storyId);
      throw error;
    }

    res.json({
      status: 'generating_audio',
      generatedAudio: pagesNeedingAudio.length,
      chargedCredits,
      availableCredits,
    } as GenerateAudioResponse);

    runAudioGenerationPipeline(
      storyId,
      {
        ...story,
        voice: requestedVoice,
      },
      requestedVoice,
      'add_audio',
      controller,
    ).catch(error => {
      console.error(`Audio generation pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to start audio generation:', error);
    res.status(500).json({ error: 'Failed to start audio generation' });
  }
});

async function runAudioGenerationPipeline(
  storyId: string,
  story: StoryMeta,
  voiceKey: VoiceKey,
  usageSource: StoryUsageSource = 'retry',
  controller = startTrackedGeneration(storyId),
): Promise<void> {
  const { signal } = controller;
  const usageRecorder = createUsageRecorder(storyId, story.userId, usageSource);

  const scenario = story.scenario!;
  const userId = story.userId;

  try {
    await updateStoryStatus(storyId, 'generating_audio');

    // Only generate audio for pages that don't already have it (defense in depth)
    const pagesNeedingAudio = scenario.pages.filter(p => !pageHasAudio(p));
    const totalToGenerate = pagesNeedingAudio.length;

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_audio',
      currentPhase: 'Recording narration...',
      completedPages: 0,
      totalPages: totalToGenerate,
      failedPages: [],
      message: `Recording narration with ${getVoiceName(voiceKey)}...`,
    });

    let audioCompletedPages = 0;

    const audioResult = await audioOps.retryMissingAudio(
      storyId,
      scenario.pages,
      voiceKey,
      userId,
      signal,
      (progress) => {
        if (progress.pageStatus === 'completed') {
          audioCompletedPages++;
        }
        sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_audio',
          currentPhase: 'Recording narration...',
          completedPages: audioCompletedPages,
          totalPages: totalToGenerate,
          failedPages: [],
          message: progress.message || '',
          pageNumber: progress.pageNumber,
          pageStatus: progress.pageStatus,
        }).catch(() => {});
      },
      (page, usage) => usageRecorder.recordPageAudio(page.pageNumber, usage),
    );

    // Check if audio generation had failures
    let audioFailed = false;
    let audioError: string | undefined;
    if (audioResult.completedCount < totalToGenerate) {
      audioFailed = true;
      audioError = audioResult.error || 'Some narration pages could not be generated';
      console.warn(`Audio generation incomplete for ${storyId}: ${audioResult.completedCount}/${totalToGenerate} succeeded, ${audioResult.failedCount} failed, ${audioResult.skippedCount} skipped`);
    }

    // Complete — story is viewable even if some audio failed
    await updateStoryStatus(storyId, 'completed');
    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages: audioCompletedPages,
      totalPages: totalToGenerate,
      failedPages: [],
      message: audioFailed ? audioError! : 'Narration generated successfully!',
      audioFailed,
      audioError,
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    const status = isCancelled ? 'completed' : 'failed';
    console.error(`Audio generation pipeline ${isCancelled ? 'cancelled' : 'failed'} for ${storyId}:`, error);

    try {
      await updateStoryStatus(storyId, status);
    } catch {}

    sendSSE(storyId, {
      storyId,
      status,
      currentPhase: isCancelled ? 'Cancelled' : 'Failed',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: isCancelled ? 'Audio generation cancelled' : (error instanceof Error ? error.message : 'Audio generation failed'),
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// POST /api/stories/:id/pages/:pageNumber/regenerate-image - Regenerate one page image from owner feedback
router.post('/:id/pages/:pageNumber/regenerate-image', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const storyId = req.params.id as string;
    const pageNumber = Number.parseInt(req.params.pageNumber as string, 10);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      res.status(400).json({ error: 'A valid page number is required' });
      return;
    }

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (config.useSupabase && story.userId !== req.authUser?.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Story must be completed to regenerate a page image' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    const page = findScenarioPage(story.scenario, pageNumber);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    if (isGenerationActive(storyId)) {
      res.status(409).json({ error: 'A generation is already in progress' });
      return;
    }

    const feedback = typeof req.body?.feedback === 'string'
      ? req.body.feedback.replace(/\s+/g, ' ').trim()
      : '';
    if (!feedback) {
      res.status(400).json({ error: 'Feedback is required' });
      return;
    }
    if (feedback.length > 800) {
      res.status(400).json({ error: 'Feedback must be 800 characters or less' });
      return;
    }

    const review = await pageTextReviewOps.reviewPageText({
      text: feedback,
      targetAge: story.scenario.targetAge,
      language: story.language,
      purpose: 'image_feedback',
    });
    if (!review.allowed) {
      res.status(400).json({
        error: review.explanation || 'Feedback is not appropriate for a children story',
        reasonCode: review.reasonCode,
      });
      return;
    }

    const chargedCredits = roundCreditAmount(getStoryImagePageCreditCost(getSafeStoryMode(story)));
    let availableCredits = 0;
    if (config.useSupabase) {
      try {
        const charge = await billingOps.consumeCredits(req.authUser!.id, chargedCredits, {
          reason: 'story_regenerate_image',
          storyId,
          note: `page:${pageNumber}`,
        });
        availableCredits = charge.available_credits;
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          const balance = await billingOps.getUserCreditBalance(req.authUser!.id).catch(() => ({ availableCredits: 0 }));
          res.status(402).json({
            error: 'Not enough credits to regenerate this image',
            requiredCredits: chargedCredits,
            availableCredits: balance.availableCredits,
          });
          return;
        }
        throw error;
      }
    }

    const controller = startTrackedGeneration(storyId);
    res.json({
      status: 'generating_images',
      pageNumber,
      chargedCredits,
      availableCredits,
    } as RegeneratePageImageResponse);

    runRegeneratePageImagePipeline(storyId, story, pageNumber, feedback, chargedCredits, req.authUser?.id, controller)
      .catch(error => {
        console.error(`Page image regeneration pipeline failed for ${storyId} page ${pageNumber}:`, error);
      });
  } catch (error) {
    console.error('Failed to start page image regeneration:', error);
    res.status(500).json({ error: 'Failed to start page image regeneration' });
  }
});

async function runRegeneratePageImagePipeline(
  storyId: string,
  story: StoryMeta,
  pageNumber: number,
  feedback: string,
  chargedCredits: number,
  chargedUserId: string | undefined,
  controller = startTrackedGeneration(storyId),
): Promise<void> {
  const { signal } = controller;
  const usageRecorder = createUsageRecorder(storyId, story.userId, 'regenerate_page_image');

  try {
    if (!story.scenario) throw new Error('Story has no scenario data');

    const styleDescription = storyStyleOps.getStoryArtStyleDescription(story);
    const pro = getSafeStoryMode(story) !== 'fast';
    const scenarioForGeneration = cloneScenarioWithUpdatedPage(story.scenario, pageNumber, page => ({
      ...page,
      imagePrompt: `${page.imagePrompt}\n\nUser feedback for this regeneration: ${feedback}`,
    }));

    await updateStoryStatus(storyId, 'generating_images');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_images',
      currentPhase: 'Regenerating page image...',
      completedPages: 0,
      totalPages: 1,
      failedPages: [],
      message: `Regenerating image for page ${pageNumber}...`,
      pageNumber,
      pageStatus: 'generating',
    });

    let completedPages = 0;
    const failedPages: number[] = [];
    let lastImageFailureMessage: string | undefined;

    const regeneratedCount = await illustrationOps.retryFailedSceneImages(
      storyId,
      scenarioForGeneration.pages,
      scenarioForGeneration.characters,
      [pageNumber],
      styleDescription,
      (progress) => {
        if (progress.pageStatus === 'completed') {
          completedPages++;
        } else if (progress.pageStatus === 'failed' && progress.pageNumber !== undefined) {
          failedPages.push(progress.pageNumber);
          if (progress.message) lastImageFailureMessage = progress.message;
        }

        sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_images',
          currentPhase: 'Regenerating page image...',
          completedPages,
          totalPages: 1,
          failedPages,
          message: progress.message || '',
          pageNumber: progress.pageNumber,
          pageStatus: progress.pageStatus,
        }).catch(() => {});
      },
      story.userId,
      signal,
      pro,
      (page, usage) => usageRecorder.recordPageImage(page.pageNumber, usage),
      (_character, usage) => usageRecorder.recordCharacterSheet(usage),
    );

    if (signal.aborted) throw new Error('Generation cancelled');
    if (regeneratedCount < 1) {
      throw new Error(lastImageFailureMessage || 'Page image could not be regenerated');
    }

    const updatedScenario = cloneScenarioWithUpdatedPage(story.scenario, pageNumber, page => ({
      ...page,
      status: 'completed',
      imageRevision: incrementPageRevision(page.imageRevision),
    }));

    await persistScenarioAfterPageMutation(storyId, story, updatedScenario);
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages: 1,
      totalPages: 1,
      failedPages: [],
      message: `Page ${pageNumber} image regenerated successfully.`,
      pageNumber,
      pageStatus: 'completed',
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    await refundRegenerationCharge(
      chargedUserId,
      storyId,
      chargedCredits,
      `Automatic refund after page ${pageNumber} image regeneration ${isCancelled ? 'was cancelled' : 'failed'}.`,
    );

    try {
      if (story.scenario) {
        await persistScenarioAfterPageMutation(storyId, story, story.scenario);
      } else {
        await updateStoryStatus(storyId, 'completed');
      }
    } catch {}

    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: isCancelled ? 'Cancelled' : 'Failed',
      completedPages: 0,
      totalPages: 1,
      failedPages: [],
      message: isCancelled ? 'Page image regeneration cancelled' : (error instanceof Error ? error.message : 'Page image regeneration failed'),
      pageNumber,
      pageStatus: 'failed',
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// PATCH /api/stories/:id/pages/:pageNumber/script-audio - Edit one page script and regenerate same-voice audio
router.patch('/:id/pages/:pageNumber/script-audio', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const storyId = req.params.id as string;
    const pageNumber = Number.parseInt(req.params.pageNumber as string, 10);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      res.status(400).json({ error: 'A valid page number is required' });
      return;
    }

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (config.useSupabase && story.userId !== req.authUser?.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Story must be completed to edit page audio' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    const page = findScenarioPage(story.scenario, pageNumber);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const voiceKey = normalizeVoiceKey(story.voice);
    if (!voiceKey) {
      res.status(400).json({ error: 'Story has no narrator voice. Add narration first.' });
      return;
    }

    if (!audioOps.isElevenLabsConfigured()) {
      res.status(503).json({ error: 'Audio generation service is not configured' });
      return;
    }

    if (isGenerationActive(storyId)) {
      res.status(409).json({ error: 'A generation is already in progress' });
      return;
    }

    const text = typeof req.body?.text === 'string'
      ? req.body.text.replace(/\s+/g, ' ').trim()
      : '';
    const validationError = getPageTextValidationError(text, story.scenario.targetAge);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const review = await pageTextReviewOps.reviewPageText({
      text,
      targetAge: story.scenario.targetAge,
      language: story.language,
      purpose: 'page_text',
    });
    if (!review.allowed) {
      res.status(400).json({
        error: review.explanation || 'Page text is not appropriate for a children story',
        reasonCode: review.reasonCode,
      });
      return;
    }

    const chargedCredits = getStoryAudioCreditCost(1);
    let availableCredits = 0;
    if (config.useSupabase) {
      try {
        const charge = await billingOps.consumeCredits(req.authUser!.id, chargedCredits, {
          reason: 'story_regenerate_audio',
          storyId,
          note: `page:${pageNumber}`,
        });
        availableCredits = charge.available_credits;
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          const balance = await billingOps.getUserCreditBalance(req.authUser!.id).catch(() => ({ availableCredits: 0 }));
          res.status(402).json({
            error: 'Not enough credits to regenerate this page audio',
            requiredCredits: chargedCredits,
            availableCredits: balance.availableCredits,
          });
          return;
        }
        throw error;
      }
    }

    const controller = startTrackedGeneration(storyId);
    res.json({
      status: 'generating_audio',
      pageNumber,
      chargedCredits,
      availableCredits,
    } as RegeneratePageAudioResponse);

    runRegeneratePageAudioPipeline(storyId, story, pageNumber, text, voiceKey, chargedCredits, req.authUser?.id, controller)
      .catch(error => {
        console.error(`Page audio regeneration pipeline failed for ${storyId} page ${pageNumber}:`, error);
      });
  } catch (error) {
    console.error('Failed to start page audio regeneration:', error);
    res.status(500).json({ error: 'Failed to start page audio regeneration' });
  }
});

async function runRegeneratePageAudioPipeline(
  storyId: string,
  story: StoryMeta,
  pageNumber: number,
  text: string,
  voiceKey: VoiceKey,
  chargedCredits: number,
  chargedUserId: string | undefined,
  controller = startTrackedGeneration(storyId),
): Promise<void> {
  const { signal } = controller;
  const usageRecorder = createUsageRecorder(storyId, story.userId, 'regenerate_page_audio');

  try {
    if (!story.scenario) throw new Error('Story has no scenario data');

    await updateStoryStatus(storyId, 'generating_audio');
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_audio',
      currentPhase: 'Regenerating page narration...',
      completedPages: 0,
      totalPages: 1,
      failedPages: [],
      message: `Recording narration for page ${pageNumber} with ${getVoiceName(voiceKey)}...`,
      pageNumber,
      pageStatus: 'generating',
    });

    if (signal.aborted) throw new Error('Generation cancelled');
    const audioBuffer = await audioOps.generatePageAudio(text, voiceKey, usage => usageRecorder.recordPageAudio(pageNumber, usage));
    if (signal.aborted) throw new Error('Generation cancelled');
    const audioUrl = await audioOps.savePageAudio(storyId, getPageAudioFilename(pageNumber), audioBuffer, story.userId);

    const updatedScenario = cloneScenarioWithUpdatedPage(story.scenario, pageNumber, page => ({
      ...page,
      text,
      audioUrl,
      audioRevision: incrementPageRevision(page.audioRevision),
    }));

    await persistScenarioAfterPageMutation(storyId, story, updatedScenario);
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages: 1,
      totalPages: 1,
      failedPages: [],
      message: `Page ${pageNumber} script and narration updated successfully.`,
      pageNumber,
      pageStatus: 'completed',
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    await refundRegenerationCharge(
      chargedUserId,
      storyId,
      chargedCredits,
      `Automatic refund after page ${pageNumber} audio regeneration ${isCancelled ? 'was cancelled' : 'failed'}.`,
    );

    try {
      if (story.scenario) {
        await persistScenarioAfterPageMutation(storyId, story, story.scenario);
      } else {
        await updateStoryStatus(storyId, 'completed');
      }
    } catch {}

    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: isCancelled ? 'Cancelled' : 'Failed',
      completedPages: 0,
      totalPages: 1,
      failedPages: [],
      message: isCancelled ? 'Page audio regeneration cancelled' : (error instanceof Error ? error.message : 'Page audio regeneration failed'),
      pageNumber,
      pageStatus: 'failed',
    });
  } finally {
    finishTrackedGeneration(storyId);
    scheduleStoryConnectionCleanup(storyId);
  }
}

// GET /api/stories/:id/assets - List all stored assets (character sheets, images)
router.get('/:id/assets', optionalAuth, async (req: Request, res: Response) => {
  try {
    const storyId = req.params.id as string;

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Access check: owner or public story
    if (config.useSupabase && story.userId) {
      if (!story.isPublic && (!req.authUser || req.authUser.id !== story.userId)) {
        res.status(404).json({ error: 'Story not found' });
        return;
      }
    }

    if (!config.useSupabase) {
      // Filesystem mode: construct asset list from scenario data
      const assets: StoryAssets = { characterSheets: [], pageImages: [] };
      if (story.scenario) {
        for (const char of story.scenario.characters) {
          const filename = illustrationOps.getCharacterSheetFilename(char.name);
          assets.characterSheets.push({
            name: char.name,
            url: getStoryImageUrl(storyId, filename, story.userId),
          });
        }
        for (const page of story.scenario.pages) {
          assets.pageImages.push({
            pageNumber: page.pageNumber,
            url: appendMediaRevision(getPageImageUrl(storyId, page.pageNumber, story.userId), page.imageRevision),
          });
        }
      }
      res.json(assets);
      return;
    }

    // Supabase mode: list actual files in storage
    const files = await sbStorage.listStoryFiles(storyId, story.userId);
    const assets: StoryAssets = { characterSheets: [], pageImages: [] };

    for (const filename of files) {
      if (filename.startsWith('character-sheet-') && filename.endsWith('.png')) {
        // Extract character name from filename: character-sheet-{name}.png
        const rawName = filename.replace('character-sheet-', '').replace('.png', '');
        // Try to find a matching character from the scenario for the display name
        const matchedChar = story.scenario?.characters.find(c =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, '-') === rawName
        );
        assets.characterSheets.push({
          name: matchedChar?.name || rawName,
          url: getStoryImageUrl(storyId, filename, story.userId),
        });
      } else if (filename.startsWith('page-') && filename.endsWith('.png')) {
        const numStr = filename.replace('page-', '').replace('.png', '');
        const pageNumber = parseInt(numStr, 10);
        if (!isNaN(pageNumber)) {
          const page = story.scenario?.pages.find(item => item.pageNumber === pageNumber);
          assets.pageImages.push({
            pageNumber,
            url: appendMediaRevision(getPageImageUrl(storyId, pageNumber, story.userId), page?.imageRevision),
          });
        }
      }
    }

    // Sort by page number
    assets.pageImages.sort((a, b) => a.pageNumber - b.pageNumber);

    res.json(assets);
  } catch (error) {
    console.error('Failed to get story assets:', error);
    res.status(500).json({ error: 'Failed to get story assets' });
  }
});

// POST /api/stories/:id/view - Count one successful story open
router.post('/:id/view', optionalAuth, async (req: Request, res: Response) => {
  try {
    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (!canReadStory(story, req.authUser?.id)) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    const viewCount = await storageOps.incrementStoryViewCount(story.id);
    res.json({ id: story.id, viewCount });
  } catch (error) {
    console.error('Failed to record story view:', error);
    res.status(500).json({ error: 'Failed to record story view' });
  }
});

// PATCH /api/stories/:id/reaction - Set, switch, or clear the signed-in user's reaction
router.patch('/:id/reaction', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (!canReadStory(story, req.authUser.id)) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Only completed stories can be liked or disliked' });
      return;
    }

    const rawReaction = req.body && typeof req.body === 'object'
      ? (req.body as { reaction?: unknown }).reaction
      : undefined;
    if (rawReaction !== null && !isStoryReaction(rawReaction)) {
      res.status(400).json({ error: 'reaction must be "like", "dislike", or null' });
      return;
    }

    const reaction = rawReaction ?? null;
    const result = await storageOps.setStoryReaction(story.id, req.authUser.id, reaction);
    res.json(result);
  } catch (error) {
    console.error('Failed to update story reaction:', error);
    res.status(500).json({ error: 'Failed to update story reaction' });
  }
});

// GET /api/stories/:id - Get story details (ownership check for private stories)
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    if (!canReadStory(story, req.authUser?.id)) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    story.myReaction = req.authUser
      ? await storageOps.getStoryReaction(story.id, req.authUser.id)
      : null;

    // Enrich pages with image URLs
    if (story.scenario?.pages) {
      for (const page of story.scenario.pages) {
        if (page.status === 'completed') {
          page.imageUrl = appendMediaRevision(
            getPageImageUrl(story.id, page.pageNumber, story.userId),
            page.imageRevision,
          );
        }
        if (pageHasAudio(page)) {
          page.audioUrl = appendMediaRevision(
            getPageAudioUrl(story.id, page.pageNumber, story.userId),
            page.audioRevision,
          );
        }
      }
    }

    res.json(story);
  } catch (error) {
    console.error('Failed to get story:', error);
    res.status(500).json({ error: 'Failed to get story' });
  }
});

// GET /api/stories/:id/status - SSE stream for generation progress
router.get('/:id/status', async (req: Request, res: Response) => {
  const storyId = req.params.id as string;

  try {
    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const initialProgress = buildInitialProgress(storyId, story);
    res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);

    // If already completed, failed, or cancelled, close after sending status
    if (story && isTerminalStoryStatus(story.status)) {
      res.end();
      return;
    }

    // Register SSE connection
    if (!sseConnections.has(storyId)) {
      sseConnections.set(storyId, new Set());
    }
    sseConnections.get(storyId)!.add(res);

    // Keep-alive ping
    const pingInterval = setInterval(() => {
      try {
        res.write(':ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);

    // Cleanup on close
    req.on('close', () => {
      clearInterval(pingInterval);
      const connections = sseConnections.get(storyId);
      if (connections) {
        connections.delete(res);
        if (connections.size === 0) {
          sseConnections.delete(storyId);
        }
      }
    });
  } catch (error) {
    console.error(`Failed to stream story status for ${storyId}:`, error);

    try {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream story status' });
        return;
      }

      res.write(`data: ${JSON.stringify({
        storyId,
        status: 'failed',
        currentPhase: 'Failed',
        completedPages: 0,
        totalPages: 0,
        failedPages: [],
        message: 'Failed to stream story status',
      } satisfies GenerationProgress)}\n\n`);
    } catch {
      // Ignore write failures on broken SSE connections.
    }

    res.end();
  }
});

// PATCH /api/stories/:id/visibility - Toggle story visibility (requires auth + ownership)
router.patch('/:id/visibility', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Ownership check
    if (config.useSupabase && story.userId && story.userId !== req.authUser?.id) {
      res.status(403).json({ error: 'Forbidden: you can only modify your own stories' });
      return;
    }

    const { isPublic } = req.body as { isPublic: boolean };
    if (typeof isPublic !== 'boolean') {
      res.status(400).json({ error: 'isPublic must be a boolean' });
      return;
    }

    if (config.useSupabase) {
      await sbStorage.updateStoryVisibility(req.params.id as string, isPublic);
    }

    res.json({ id: story.id, isPublic });
  } catch (error) {
    console.error('Failed to update story visibility:', error);
    res.status(500).json({ error: 'Failed to update story visibility' });
  }
});

// DELETE /api/stories/:id - Delete a story (requires auth when Supabase is configured)
router.delete('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    // Require authentication when Supabase is configured
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify ownership if authenticated
    if (config.useSupabase && req.authUser) {
      const story = await getStory(req.params.id as string);
      if (story && story.userId && story.userId !== req.authUser.id) {
        res.status(403).json({ error: 'Forbidden: you can only delete your own stories' });
        return;
      }
    }

    const deleted = await removeStory(req.params.id as string, req.authUser?.id);
    if (!deleted) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete story:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// POST /api/stories/:id/cancel - Cancel story generation and delete the story
router.post('/:id/cancel', optionalAuth, async (req: Request, res: Response) => {
  try {
    const storyId = req.params.id as string;

    // Require authentication when Supabase is configured
    if (config.useSupabase && !req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const story = await getStory(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Verify ownership if authenticated
    if (config.useSupabase && req.authUser) {
      if (story.userId && story.userId !== req.authUser.id) {
        res.status(403).json({ error: 'Forbidden: you can only cancel your own stories' });
        return;
      }
    }

    // Abort the active generation pipeline if still running
    const controller = getTrackedGeneration(storyId);
    if (controller) {
      controller.abort();
    }

    if (config.useSupabase && !storyHasCompletedIllustrations(story)) {
      await refundStoryCredits(storyId, 'Story cancelled before the first completed illustration.');
    }

    // Delete the story from the database
    await removeStory(storyId, req.authUser?.id);

    // Send cancelled SSE event so connected clients update immediately
    sendSSE(storyId, {
      storyId,
      status: 'cancelled',
      currentPhase: 'Cancelled',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Generation cancelled',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to cancel story:', error);
    res.status(500).json({ error: 'Failed to cancel story' });
  }
});

// GET /api/stories/:id/images/:filename - Serve story images (filesystem fallback)
router.get('/:id/images/:filename', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const filename = req.params.filename as string;

    // Basic security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    // If Supabase is configured, redirect to Supabase Storage URL
    if (config.useSupabase) {
      // Look up story to get userId for the correct storage path
      const story = await getStory(id);
      const url = sbStorage.getImageUrl(story?.userId, id, filename);
      res.redirect(url);
      return;
    }

    const imagePath = await fsStorage.getImagePath(id, filename);
    if (!imagePath) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL);
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Failed to serve image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// GET /api/stories/:id/audio/:filename - Serve story audio (filesystem fallback)
router.get('/:id/audio/:filename', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const filename = req.params.filename as string;

    // Basic security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    // If Supabase is configured, redirect to Supabase Storage URL
    if (config.useSupabase) {
      const story = await getStory(id);
      const url = sbStorage.getAudioUrl(story?.userId, id, filename);
      res.redirect(url);
      return;
    }

    const audioPath = await fsStorage.getAudioPath(id, filename);
    if (!audioPath) {
      res.status(404).json({ error: 'Audio not found' });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL);
    res.sendFile(audioPath);
  } catch (error) {
    console.error('Failed to serve audio:', error);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

export default router;
