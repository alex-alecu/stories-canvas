import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import * as fsStorage from '../utils/storage.js';
import * as sbStorage from '../services/supabaseStorage.js';
import { generateScenario } from '../services/scenario.js';
import { generateAllCharacterSheets } from '../services/characterSheet.js';
import { generateAllSceneImages } from '../services/sceneGenerator.js';
import { optionalAuth } from '../middleware/auth.js';
import type { GenerationProgress, CreateStoryRequest, StoryStatus, StoryMeta, Scenario } from '../../shared/types.js';

const router = Router();

// ---------- Storage adapter (delegates to Supabase or filesystem) ----------

async function saveScenario(storyId: string, scenario: Scenario, status: StoryStatus, prompt: string): Promise<void> {
  if (config.useSupabase) {
    await sbStorage.updateStoryScenario(storyId, scenario, status, prompt);
  } else {
    await fsStorage.saveScenario(storyId, scenario, status, prompt);
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

    const { prompt } = req.body as CreateStoryRequest;

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

    const storyId = crypto.randomUUID();
    const userId = req.authUser?.id;

    // Create the story in DB IMMEDIATELY so it's available for SSE and refresh
    if (config.useSupabase) {
      await sbStorage.createStory(storyId, trimmedPrompt, 'generating_scenario', userId);
    }

    // Return immediately, generation happens in background
    res.status(201).json({ id: storyId, status: 'generating_scenario' as StoryStatus });

    // Background generation pipeline
    runGenerationPipeline(storyId, trimmedPrompt, userId).catch(error => {
      console.error(`Generation pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to create story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

async function runGenerationPipeline(storyId: string, prompt: string, userId?: string): Promise<void> {
  try {
    // Phase 1: Generate scenario
    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_scenario',
      currentPhase: 'Se generează scenariul poveștii...',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Se creează povestea ta...',
    });

    const scenario = await generateScenario(prompt);
    await saveScenario(storyId, scenario, 'generating_characters', prompt);

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_characters',
      currentPhase: 'Se generează fișele personajelor...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Povestea „${scenario.title}" a fost creată cu ${scenario.pages.length} pagini. Se generează fișele personajelor...`,
    });

    // Phase 2: Generate character sheets (sequential)
    const characterSheets = await generateAllCharacterSheets(storyId, scenario.characters, userId);
    await updateStoryStatus(storyId, 'generating_images');

    await sendProgressUpdate(storyId, {
      storyId,
      status: 'generating_images',
      currentPhase: 'Se generează ilustrațiile paginilor...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Fișele personajelor sunt gata. Se generează ${scenario.pages.length} ilustrații...`,
    });

    // Phase 3: Generate scene images (parallel with rate limiting)
    let completedPages = 0;
    const failedPages: number[] = [];

    await generateAllSceneImages(
      storyId,
      scenario.pages,
      scenario.characters,
      characterSheets,
      (progress) => {
        // Track completion
        if (progress.message?.includes('completed')) {
          completedPages++;
        } else if (progress.message?.includes('failed')) {
          const match = progress.message.match(/Pagina (\d+)/);
          if (match) failedPages.push(parseInt(match[1]));
        }

        // Fire-and-forget the async persist, but always sync-send SSE
        sendProgressUpdate(storyId, {
          storyId,
          status: 'generating_images',
          currentPhase: 'Se generează ilustrațiile paginilor...',
          completedPages,
          totalPages: scenario.pages.length,
          failedPages,
          message: progress.message || '',
        });
      },
      userId,
    );

    // Update cover image URL
    if (config.useSupabase) {
      const coverUrl = getPageImageUrl(storyId, 1, userId);
      try {
        await sbStorage.updateStoryProgress(storyId, {
          status: 'completed',
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

    // Complete
    await updateStoryStatus(storyId, 'completed');
    sendSSE(storyId, {
      storyId,
      status: 'completed',
      currentPhase: 'Gata!',
      completedPages,
      totalPages: scenario.pages.length,
      failedPages,
      message: 'Povestea a fost generată cu succes!',
    });
  } catch (error) {
    console.error(`Pipeline failed for ${storyId}:`, error);
    try {
      await updateStoryStatus(storyId, 'failed');
    } catch {}
    sendSSE(storyId, {
      storyId,
      status: 'failed',
      currentPhase: 'Eșuat',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: error instanceof Error ? error.message : 'Generarea a eșuat',
    });
  } finally {
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
      currentPhase: story.status === 'completed' ? 'Gata!' : 'În progres...',
      completedPages,
      totalPages,
      failedPages,
      message: story.status === 'completed' ? 'Povestea a fost generată cu succes!' : 'Reconectat la progresul generării...',
    })}\n\n`);

    // If already completed or failed, close after sending status
    if (story.status === 'completed' || story.status === 'failed') {
      res.end();
      return;
    }
  } else {
    // Story not yet in DB (race condition) - send initial generating status
    res.write(`data: ${JSON.stringify({
      storyId,
      status: 'generating_scenario',
      currentPhase: 'Se generează scenariul poveștii...',
      completedPages: 0,
      totalPages: 0,
      failedPages: [],
      message: 'Se creează povestea ta...',
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

// GET /api/stories/:id/images/:filename - Serve story images (filesystem fallback)
router.get('/:id/images/:filename', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const filename = req.params.filename as string;

    // Basic security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
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

export default router;
