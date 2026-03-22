import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import * as fsStorage from '../utils/storage.js';
import * as sbStorage from '../services/supabaseStorage.js';
import { getCharacterSheetFilename } from '../services/characterSheet.js';
import { generateScenario } from '../services/scenario.js';
import { generateAllCharacterSheets } from '../services/characterSheet.js';
import { generateAllSceneImages, retryFailedSceneImages } from '../services/sceneGenerator.js';
import { generateAllPageAudio, retryMissingAudio, isElevenLabsConfigured } from '../services/elevenlabs.js';
import { optionalAuth } from '../middleware/auth.js';
import type { GenerationProgress, CreateStoryRequest, StoryStatus, StoryMeta, Scenario, ArtStyleKey, VoiceKey, StoryAssets, RetryStoryResponse } from '../../shared/types.js';
import { ART_STYLES, DEFAULT_AGE, DEFAULT_ART_STYLE } from '../../shared/types.js';

const router = Router();

// ---------- Storage adapter (delegates to Supabase or filesystem) ----------

async function saveScenario(storyId: string, scenario: Scenario, status: StoryStatus, prompt: string, voice?: VoiceKey): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryScenario(storyId, scenario, status, prompt);
  } else {
    await fsStorage.saveScenario(storyId, scenario, status, prompt, voice);
  }
}

async function updateStoryStatus(storyId: string, status: StoryStatus): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryStatus(storyId, status);
  } else {
    await fsStorage.updateStoryStatus(storyId, status);
  }
}

async function getStory(storyId: string): Promise<StoryMeta | null> {
  if (config.useSupabase) {
    return sbStorage.getStory(storyId);
  }
  return fsStorage.getStory(storyId);
}

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

function getPageImageUrl(storyId: string, pageNumber: number, userId?: string): string {
  const filename = `page-${String(pageNumber).padStart(2, '0')}.png`;
  if (config.useSupabase) {
    return sbStorage.getImageUrl(userId, storyId, filename);
  }
  return `/api/stories/${storyId}/images/${filename}`;
}

function getCoverImageUrl(story: StoryMeta): string | undefined {
  if (!story.scenario?.pages?.[0]) return undefined;
  if (story.scenario.pages[0].status !== 'completed') return undefined;
  return getPageImageUrl(story.id, story.scenario.pages[0].pageNumber, story.userId);
}

// ---------- Active generation abort controllers ----------

const activeGenerations = new Map<string, AbortController>();

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
}

// ---------- Persist progress to DB alongside SSE ----------

async function sendProgressUpdate(storyId: string, data: Partial<GenerationProgress>): Promise<void> {
  // Always send via SSE for real-time
  sendSSE(storyId, data);

  // Also persist to Supabase so progress survives refresh
  if (config.useSupabase) {
    try {
      await sbStorage.updateStoryProgress(storyId, {
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
    const stories = await sbStorage.listPublicStories(search);
    const summaries = stories.map(s => ({
      id: s.id,
      prompt: s.prompt,
      status: s.status,
      createdAt: s.createdAt,
      title: s.scenario?.title,
      coverImage: getCoverImageUrl(s),
      totalPages: s.scenario?.pages?.length ?? 0,
      completedPages: s.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
      isPublic: s.isPublic,
      hasAudio: s.scenario?.pages?.some(p => !!p.audioUrl) ?? false,
    }));
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
      const stories = await sbStorage.listStoriesByUser(req.authUser.id);
      const summaries = stories.map(s => ({
        id: s.id,
        prompt: s.prompt,
        status: s.status,
        createdAt: s.createdAt,
        title: s.scenario?.title,
        coverImage: getCoverImageUrl(s),
        totalPages: s.scenario?.pages?.length ?? 0,
        completedPages: s.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
        isPublic: s.isPublic,
        hasAudio: s.scenario?.pages?.some(p => !!p.audioUrl) ?? false,
      }));
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
      stories = await sbStorage.listStoriesByUser(req.authUser.id);
    } else if (config.useSupabase && !req.authUser) {
      // Supabase enabled but not authenticated: return empty list (private by default)
      stories = [];
    } else {
      // Filesystem mode (no Supabase): return all stories (backward compatible)
      stories = await listAllStories();
    }

    const summaries = stories.map(s => ({
      id: s.id,
      prompt: s.prompt,
      status: s.status,
      createdAt: s.createdAt,
      title: s.scenario?.title,
      coverImage: getCoverImageUrl(s),
      totalPages: s.scenario?.pages?.length ?? 0,
      completedPages: s.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
      isPublic: s.isPublic,
      hasAudio: s.scenario?.pages?.some(p => !!p.audioUrl) ?? false,
    }));
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

    const { prompt, language, age, style, pro, voice } = req.body as CreateStoryRequest;

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
    const storyStyle: ArtStyleKey = (typeof style === 'string' && style in ART_STYLES) ? style as ArtStyleKey : DEFAULT_ART_STYLE;
    const validVoices: VoiceKey[] = ['grandma', 'grandpa', 'dad', 'mom', 'whisper'];
    const storyVoice: VoiceKey | undefined = (typeof voice === 'string' && validVoices.includes(voice as VoiceKey)) ? voice as VoiceKey : undefined;
    const storyId = crypto.randomUUID();
    const userId = req.authUser?.id;

    // Create the story in DB IMMEDIATELY so it's available for SSE and refresh
    if (config.useSupabase) {
      await sbStorage.createStory(storyId, trimmedPrompt, 'generating_scenario', userId, storyLanguage, storyVoice);
    }

    // Return immediately, generation happens in background
    res.status(201).json({ id: storyId, status: 'generating_scenario' as StoryStatus });

    // Background generation pipeline
    runGenerationPipeline(storyId, trimmedPrompt, userId, storyLanguage, storyAge, storyStyle, !!pro, storyVoice).catch(error => {
      console.error(`Generation pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to create story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

async function runGenerationPipeline(storyId: string, prompt: string, userId?: string, language?: string, age?: number, style?: ArtStyleKey, pro?: boolean, voice?: VoiceKey): Promise<void> {
  const controller = new AbortController();
  activeGenerations.set(storyId, controller);
  const { signal } = controller;

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
    const scenario = await generateScenario(prompt, language, age, style);
    await saveScenario(storyId, scenario, 'generating_characters', prompt, voice);

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
    const styleDescription = style ? ART_STYLES[style] : ART_STYLES[DEFAULT_ART_STYLE];
    const characterSheets = await generateAllCharacterSheets(storyId, scenario.characters, userId, signal, styleDescription, pro);

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

    await generateAllSceneImages(
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
    );

    // Update cover image URL
    if (config.useSupabase) {
      const coverUrl = getPageImageUrl(storyId, 1, userId);
      try {
        await sbStorage.updateStoryProgress(storyId, {
          status: voice && isElevenLabsConfigured() ? 'generating_audio' : 'completed',
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

    if (voice && isElevenLabsConfigured()) {
      if (signal.aborted) throw new Error('Generation cancelled');
      await updateStoryStatus(storyId, 'generating_audio');

      await sendProgressUpdate(storyId, {
        storyId,
        status: 'generating_audio',
        currentPhase: 'Recording narration...',
        completedPages: 0,
        totalPages: scenario.pages.length,
        failedPages: [],
        message: `Illustrations complete. Recording narration with ${voice} voice...`,
      });

      let audioCompletedPages = 0;

      const audioResult = await generateAllPageAudio(
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

    // Complete â story is viewable even if audio failed
    await updateStoryStatus(storyId, 'completed');
    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages,
      totalPages: scenario.pages.length,
      failedPages,
      message: audioFailed ? audioError! : 'Story generated successfully!',
      audioFailed,
      audioError,
    });
  } catch (error) {
    const isCancelled = signal.aborted;
    const status = isCancelled ? 'cancelled' : 'failed';
    console.error(`Pipeline ${status} for ${storyId}:`, isCancelled ? 'cancelled by user' : error);

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
    activeGenerations.delete(storyId);
    // Close SSE connections after a short delay
    setTimeout(() => {
      const connections = sseConnections.get(storyId);
      if (connections) {
        for (const res of connections) {
          try { res.end(); } catch {}
        }
        sseConnections.delete(storyId);
      }
    }, 2000);
  }
}

// GET /api/stories/active/generations - Get stories still being generated (for reconnection)
router.get('/active/generations', async (_req: Request, res: Response) => {
  try {
    if (config.useSupabase) {
      const active = await sbStorage.getActiveGenerations();
      res.json(active.map(s => s.id));
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Failed to get active generations:', error);
    res.status(500).json({ error: 'Failed to get active generations' });
  }
});

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
    if (activeGenerations.has(storyId)) {
      res.status(409).json({ error: 'A retry is already in progress' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    const pages = story.scenario.pages;
    const failedImagePages = pages.filter(p => p.status === 'failed').map(p => p.pageNumber);
    const hasAudioPages = pages.some(p => !!p.audioUrl);
    const missingAudioPages = pages.filter(p => !p.audioUrl);
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
  const controller = new AbortController();
  activeGenerations.set(storyId, controller);
  const { signal } = controller;

  const scenario = story.scenario!;
  const userId = story.userId;

  try {
    let completedImages = 0;
    const totalRetries = failedImagePages.length;

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

      // TODO: Art style is not stored on StoryMeta — retried images use the default
      // style, which may mismatch the original. Thread `artStyle` similarly to `voice` to fix.
      const styleDescription = ART_STYLES[DEFAULT_ART_STYLE];
      const failedPages: number[] = [];

      await retryFailedSceneImages(
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
    if (needsAudioRetry && isElevenLabsConfigured()) {
      if (signal.aborted) throw new Error('Generation cancelled');

      // We need to re-fetch the story to get updated page data after image retry
      const updatedStory = await getStory(storyId);
      const updatedPages = updatedStory?.scenario?.pages || scenario.pages;
      const pagesNeedingAudio = updatedPages.filter(p => !p.audioUrl);

      // Use voice from freshest DB data, falling back to original story object
      const voiceKey: VoiceKey | undefined = updatedStory?.voice || story.voice;
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
        await retryMissingAudio(
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
        );
      }
    }

    // Complete
    await updateStoryStatus(storyId, 'completed');
    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Done!',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Retry completed successfully!',
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
    activeGenerations.delete(storyId);
    setTimeout(() => {
      const connections = sseConnections.get(storyId);
      if (connections) {
        for (const res of connections) {
          try { res.end(); } catch {}
        }
        sseConnections.delete(storyId);
      }
    }, 2000);
  }
}

// POST /api/stories/:id/generate-audio - Generate audio for a story that has none
router.post('/:id/generate-audio', optionalAuth, async (req: Request, res: Response) => {
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

    // Must be a completed story
    if (story.status !== 'completed') {
      res.status(400).json({ error: 'Story must be completed to generate audio' });
      return;
    }

    if (!story.scenario) {
      res.status(400).json({ error: 'Story has no scenario data' });
      return;
    }

    // Reject if story already has narration (voice set or any page has audio)
    const alreadyHasAudio = story.scenario.pages.some(p => !!p.audioUrl);
    if (story.voice || alreadyHasAudio) {
      res.status(400).json({ error: 'Story already has narration. Use retry to fix missing pages.' });
      return;
    }

    // Check ElevenLabs is configured
    if (!isElevenLabsConfigured()) {
      res.status(503).json({ error: 'Audio generation service is not configured' });
      return;
    }

    // Prevent concurrent generations
    if (activeGenerations.has(storyId)) {
      res.status(409).json({ error: 'A generation is already in progress' });
      return;
    }

    // Validate voice
    const { voice } = req.body as { voice?: string };
    const validVoices: VoiceKey[] = ['grandma', 'grandpa', 'dad', 'mom', 'whisper'];
    if (!voice || !validVoices.includes(voice as VoiceKey)) {
      res.status(400).json({ error: 'Invalid voice selection' });
      return;
    }
    const voiceKey = voice as VoiceKey;

    // Persist the voice choice
    if (config.useSupabase) {
      await sbStorage.updateStoryVoice(storyId, voiceKey);
    } else {
      await fsStorage.updateStoryVoice(storyId, voiceKey);
    }

    // Return immediately
    res.json({ status: 'generating_audio' as StoryStatus });

    // Run audio generation in background
    runAudioGenerationPipeline(storyId, story, voiceKey).catch(error => {
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
): Promise<void> {
  const controller = new AbortController();
  activeGenerations.set(storyId, controller);
  const { signal } = controller;

  const scenario = story.scenario!;
  const userId = story.userId;

  try {
    await updateStoryStatus(storyId, 'generating_audio');

    // Only generate audio for pages that don't already have it (defense in depth)
    const pagesNeedingAudio = scenario.pages.filter(p => !p.audioUrl);
    const totalToGenerate = pagesNeedingAudio.length;

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_audio',
      currentPhase: 'Recording narration...',
      completedPages: 0,
      totalPages: totalToGenerate,
      failedPages: [],
      message: `Recording narration with ${voiceKey} voice...`,
    });

    let audioCompletedPages = 0;

    const audioResult = await retryMissingAudio(
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
    activeGenerations.delete(storyId);
    setTimeout(() => {
      const connections = sseConnections.get(storyId);
      if (connections) {
        for (const res of connections) {
          try { res.end(); } catch {}
        }
        sseConnections.delete(storyId);
      }
    }, 2000);
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
          const filename = getCharacterSheetFilename(char.name);
          assets.characterSheets.push({
            name: char.name,
            url: `/api/stories/${storyId}/images/${filename}`,
          });
        }
        for (const page of story.scenario.pages) {
          const filename = `page-${String(page.pageNumber).padStart(2, '0')}.png`;
          assets.pageImages.push({
            pageNumber: page.pageNumber,
            url: `/api/stories/${storyId}/images/${filename}`,
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
      const url = sbStorage.getImageUrl(story.userId, storyId, filename);

      if (filename.startsWith('character-sheet-') && filename.endsWith('.png')) {
        // Extract character name from filename: character-sheet-{name}.png
        const rawName = filename.replace('character-sheet-', '').replace('.png', '');
        // Try to find a matching character from the scenario for the display name
        const matchedChar = story.scenario?.characters.find(c =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, '-') === rawName
        );
        assets.characterSheets.push({
          name: matchedChar?.name || rawName,
          url,
        });
      } else if (filename.startsWith('page-') && filename.endsWith('.png')) {
        const numStr = filename.replace('page-', '').replace('.png', '');
        const pageNumber = parseInt(numStr, 10);
        if (!isNaN(pageNumber)) {
          assets.pageImages.push({ pageNumber, url });
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

// GET /api/stories/:id - Get story details (ownership check for private stories)
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Ownership check when Supabase is enabled
    if (config.useSupabase && story.userId) {
      // Story has an owner - check if current user is the owner or if story is public
      if (!story.isPublic && (!req.authUser || req.authUser.id !== story.userId)) {
        // Return 404 to avoid leaking existence
        res.status(404).json({ error: 'Story not found' });
        return;
      }
    }

    // Enrich pages with image URLs
    if (story.scenario?.pages) {
      for (const page of story.scenario.pages) {
        if (page.status === 'completed') {
          page.imageUrl = getPageImageUrl(story.id, page.pageNumber, story.userId);
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial status from DB (works on refresh with Supabase)
  const story = await getStory(storyId);
  if (story) {
    const completedPages = story.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0;
    const totalPages = story.scenario?.pages?.length ?? 0;
    const failedPages = story.scenario?.pages
      ?.filter(p => p.status === 'failed')
      .map(p => p.pageNumber) ?? [];

    res.write(`data: ${JSON.stringify({
      storyId,
      status: story.status,
      currentPhase: story.status === 'completed' ? 'Done!' : 'In progress...',
      completedPages,
      totalPages,
      failedPages,
      message: story.status === 'completed' ? 'Story generated successfully!' : 'Reconnected to generation progress...',
    })}\n\n`);

    // If already completed, failed, or cancelled, close after sending status
    if (story.status === 'completed' || story.status === 'failed' || story.status === 'cancelled') {
      res.end();
      return;
    }
  } else {
    // Story not yet in DB (race condition) - send initial generating status
    res.write(`data: ${JSON.stringify({
      storyId,
      status: 'generating_scenario',
      currentPhase: 'Generating story scenario...',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Creating your story...',
    })}\n\n`);
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

    // Verify ownership if authenticated
    if (config.useSupabase && req.authUser) {
      const story = await getStory(storyId);
      if (story && story.userId && story.userId !== req.authUser.id) {
        res.status(403).json({ error: 'Forbidden: you can only cancel your own stories' });
        return;
      }
    }

    // Abort the active generation pipeline if still running
    const controller = activeGenerations.get(storyId);
    if (controller) {
      controller.abort();
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
    res.sendFile(audioPath);
  } catch (error) {
    console.error('Failed to serve audio:', error);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

export default router;
