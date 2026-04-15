import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { normalizeVoiceKey, type ArtStyleKey, type StoryMeta, type StoryMode, type Scenario, type StoryStatus, type VoiceKey } from '../../shared/types.js';

const writeLocks = new Map<string, Promise<void>>();

function getStoriesDir(): string {
  return config.dataDir;
}

async function withLock<T>(storyId: string, fn: () => Promise<T>): Promise<T> {
  const existing = writeLocks.get(storyId) ?? Promise.resolve();
  let resolve: () => void;
  const newLock = new Promise<void>(r => { resolve = r; });
  writeLocks.set(storyId, newLock);
  await existing;
  try {
    return await fn();
  } finally {
    resolve!();
    if (writeLocks.get(storyId) === newLock) {
      writeLocks.delete(storyId);
    }
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function normalizeStoryMetaVoice(story: StoryMeta): StoryMeta {
  const scenarioRevision = Number.isInteger(story.scenarioRevision)
    ? Math.max(0, story.scenarioRevision!)
    : story.scenario
      ? 1
      : 0;
  const renderedScenarioRevision = Number.isInteger(story.renderedScenarioRevision)
    ? Math.max(0, story.renderedScenarioRevision!)
    : scenarioRevision;

  return {
    ...story,
    voice: normalizeVoiceKey(story.voice),
    language: story.language ?? 'ro',
    scenarioRevision,
    renderedScenarioRevision,
    assetsStale: scenarioRevision > renderedScenarioRevision,
  };
}

async function readRawStory(storyId: string): Promise<StoryMeta | null> {
  const filePath = path.join(getStoriesDir(), storyId, 'scenario.json');
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as StoryMeta;
  } catch {
    return null;
  }
}

export interface SaveScenarioOptions {
  voice?: VoiceKey;
  artStyle?: ArtStyleKey;
  language?: string;
  scenarioRevision?: number;
  renderedScenarioRevision?: number;
  storyMode?: StoryMode;
  creditCost?: number;
}

export async function getStoryDir(storyId: string): Promise<string> {
  const dir = path.join(getStoriesDir(), storyId);
  await ensureDir(dir);
  return dir;
}

export async function saveScenario(
  storyId: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
  options: SaveScenarioOptions = {},
): Promise<void> {
  const dir = await getStoryDir(storyId);
  const existing = await readRawStory(storyId);
  const meta: StoryMeta = {
    ...existing,
    id: storyId,
    prompt,
    status,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    scenario,
    artStyle: options.artStyle ?? existing?.artStyle,
    voice: options.voice ?? existing?.voice,
    language: options.language ?? existing?.language ?? 'ro',
    scenarioRevision: options.scenarioRevision ?? existing?.scenarioRevision ?? 1,
    renderedScenarioRevision: options.renderedScenarioRevision ?? existing?.renderedScenarioRevision ?? 1,
    storyMode: options.storyMode ?? existing?.storyMode,
    creditCost: options.creditCost ?? existing?.creditCost,
    creditRefundedAt: existing?.creditRefundedAt,
  };
  await fs.writeFile(path.join(dir, 'scenario.json'), JSON.stringify(meta, null, 2));
}

export async function updateStoryScenario(
  storyId: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
  options: SaveScenarioOptions = {},
): Promise<void> {
  await saveScenario(storyId, scenario, status, prompt, options);
}

export async function updateStoryStatus(storyId: string, status: StoryStatus): Promise<void> {
  await withLock(storyId, async () => {
    const dir = path.join(getStoriesDir(), storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.status = status;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function updatePageStatus(storyId: string, pageNumber: number, status: 'pending' | 'generating' | 'completed' | 'failed'): Promise<void> {
  await withLock(storyId, async () => {
    const dir = path.join(getStoriesDir(), storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    if (data.scenario) {
      const page = data.scenario.pages.find(p => p.pageNumber === pageNumber);
      if (page) {
        page.status = status;
      }
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function updatePageAudioUrl(storyId: string, pageNumber: number, audioUrl: string): Promise<void> {
  await withLock(storyId, async () => {
    const dir = path.join(getStoriesDir(), storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;

    if (data.scenario) {
      const page = data.scenario.pages.find(p => p.pageNumber === pageNumber);
      if (page) {
        page.audioUrl = audioUrl;
      }
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function saveImage(storyId: string, filename: string, base64Data: string): Promise<void> {
  const dir = await getStoryDir(storyId);
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.writeFile(path.join(dir, filename), buffer);
}

export async function getImagePath(storyId: string, filename: string): Promise<string | null> {
  const filePath = path.join(getStoriesDir(), storyId, filename);
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

export async function saveAudio(storyId: string, filename: string, audioBuffer: Buffer): Promise<void> {
  const dir = await getStoryDir(storyId);
  await fs.writeFile(path.join(dir, filename), audioBuffer);
}

export async function updateStoryVoice(storyId: string, voice: VoiceKey): Promise<void> {
  await withLock(storyId, async () => {
    const dir = path.join(getStoriesDir(), storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.voice = voice;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function updateStoryRenderedScenarioRevision(
  storyId: string,
  renderedScenarioRevision: number,
): Promise<void> {
  await withLock(storyId, async () => {
    const dir = path.join(getStoriesDir(), storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.renderedScenarioRevision = renderedScenarioRevision;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function getAudioPath(storyId: string, filename: string): Promise<string | null> {
  const filePath = path.join(getStoriesDir(), storyId, filename);
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

export async function getStory(storyId: string): Promise<StoryMeta | null> {
  const story = await readRawStory(storyId);
  return story ? normalizeStoryMetaVoice(story) : null;
}

export async function listStories(limit = 27): Promise<StoryMeta[]> {
  try {
    const storiesDir = getStoriesDir();
    await ensureDir(storiesDir);
    const entries = await fs.readdir(storiesDir, { withFileTypes: true });
    const stories: StoryMeta[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const story = await getStory(entry.name);
        if (story) {
          stories.push(story);
        }
      }
    }

    stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return stories.slice(0, limit);
  } catch {
    return [];
  }
}

export async function deleteStory(storyId: string): Promise<boolean> {
  const dir = path.join(getStoriesDir(), storyId);
  try {
    await fs.access(dir);
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
