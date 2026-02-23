import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { saveScenario, updateStoryStatus, getStory, listStories, deleteStory, getImagePath } from '../utils/storage.js';
import { generateScenario } from '../services/scenario.js';
import { generateAllCharacterSheets } from '../services/characterSheet.js';
import { generateAllSceneImages } from '../services/sceneGenerator.js';
import type { GenerationProgress, CreateStoryRequest, StoryStatus } from '../../shared/types.js';

const router = Router();

// SSE connections map: storyId -> Set of Response objects
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

// GET /api/stories - List stories
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stories = await listStories();
    // Strip scenario data for listing (only send metadata + cover)
    const summaries = stories.map(s => ({
      id: s.id,
      prompt: s.prompt,
      status: s.status,
      createdAt: s.createdAt,
      title: s.scenario?.title,
      coverImage: s.scenario?.pages?.[0]?.status === 'completed' ? `/api/stories/${s.id}/images/page-01.png` : undefined,
      totalPages: s.scenario?.pages?.length ?? 0,
      completedPages: s.scenario?.pages?.filter(p => p.status === 'completed').length ?? 0,
    }));
    res.json(summaries);
  } catch (error) {
    console.error('Failed to list stories:', error);
    res.status(500).json({ error: 'Failed to list stories' });
  }
});

// POST /api/stories - Create a new story
router.post('/', async (req: Request, res: Response) => {
  try {
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

    // Return immediately, generation happens in background
    res.status(201).json({ id: storyId, status: 'generating_scenario' as StoryStatus });

    // Background generation pipeline
    runGenerationPipeline(storyId, trimmedPrompt).catch(error => {
      console.error(`Generation pipeline failed for ${storyId}:`, error);
    });
  } catch (error) {
    console.error('Failed to create story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

async function runGenerationPipeline(storyId: string, prompt: string): Promise<void> {
  try {
    // Phase 1: Generate scenario
    sendSSE(storyId, {
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

    sendSSE(storyId, {
      storyId,
      status: 'generating_characters',
      currentPhase: 'Se generează fișele personajelor...',
      completedPages: 0,
      totalPages: scenario.pages.length,
      failedPages: [],
      message: `Povestea „${scenario.title}" a fost creată cu ${scenario.pages.length} pagini. Se generează fișele personajelor...`,
    });

    // Phase 2: Generate character sheets (sequential)
    const characterSheets = await generateAllCharacterSheets(storyId, scenario.characters);
    await updateStoryStatus(storyId, 'generating_images');

    sendSSE(storyId, {
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

        sendSSE(storyId, {
          storyId,
          status: 'generating_images',
          currentPhase: 'Se generează ilustrațiile paginilor...',
          completedPages,
          totalPages: scenario.pages.length,
          failedPages,
          message: progress.message || '',
        });
      },
    );

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

// GET /api/stories/:id - Get story details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const story = await getStory(req.params.id as string);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
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

  // Send initial status
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

    // If already completed, close after sending status
    if (story.status === 'completed' || story.status === 'failed') {
      res.end();
      return;
    }
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

// DELETE /api/stories/:id - Delete a story
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteStory(req.params.id as string);
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

// GET /api/stories/:id/images/:filename - Serve story images
router.get('/:id/images/:filename', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const filename = req.params.filename as string;

    // Basic security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const imagePath = await getImagePath(id, filename);
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
