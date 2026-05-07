import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import {
  normalizeVoiceKey,
  type ArtStyleKey,
  type StoryGenerationInputs,
  type StoryMeta,
  type StoryMode,
  type Scenario,
  type StoryStatus,
  type StoryUsageEvent,
  type StoryUsageTotals,
  type VoiceKey,
} from '../../shared/types.js';
import { EMPTY_STORY_USAGE_TOTALS, normalizeStoryUsageTotals } from '../services/storyUsage.js';

const writeLocks = new Map<string, Promise<void>>();
const storyDirOverrides = new Map<string, string>();

function getStoriesDir(): string {
  return config.dataDir;
}

function resolveStoryDir(storyId: string): string {
  return storyDirOverrides.get(storyId) ?? path.join(getStoriesDir(), storyId);
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

function normalizeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
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
    usageTotals: normalizeStoryUsageTotals(story.usageTotals),
    generationInputs: story.generationInputs,
    viewCount: normalizeCount(story.viewCount),
    likeCount: normalizeCount(story.likeCount),
    dislikeCount: normalizeCount(story.dislikeCount),
    myReaction: null,
  };
}

async function readRawStory(storyId: string): Promise<StoryMeta | null> {
  const filePath = path.join(resolveStoryDir(storyId), 'scenario.json');
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    storyDirOverrides.set(storyId, path.dirname(filePath));
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
  generationInputs?: StoryGenerationInputs;
  usageTotals?: StoryUsageTotals;
}

function getUsageEventsPath(storyId: string): string {
  return path.join(resolveStoryDir(storyId), 'usage-events.json');
}

async function readUsageEvents(storyId: string): Promise<StoryUsageEvent[]> {
  try {
    const raw = await fs.readFile(getUsageEventsPath(storyId), 'utf-8');
    return JSON.parse(raw) as StoryUsageEvent[];
  } catch {
    return [];
  }
}

async function writeUsageEvents(storyId: string, events: StoryUsageEvent[]): Promise<void> {
  const dir = await getStoryDir(storyId);
  await fs.writeFile(path.join(dir, 'usage-events.json'), JSON.stringify(events, null, 2));
}

function mergeUsageTotals(
  current: StoryUsageTotals | undefined,
  delta: StoryUsageTotals,
): StoryUsageTotals {
  const existing = normalizeStoryUsageTotals(current);
  return {
    inputTokens: existing.inputTokens + delta.inputTokens,
    outputTokens: existing.outputTokens + delta.outputTokens,
    totalTokens: existing.totalTokens + delta.totalTokens,
    costUsdMicros: existing.costUsdMicros + delta.costUsdMicros,
    textCostUsdMicros: existing.textCostUsdMicros + delta.textCostUsdMicros,
    imageCostUsdMicros: existing.imageCostUsdMicros + delta.imageCostUsdMicros,
    audioCostUsdMicros: existing.audioCostUsdMicros + delta.audioCostUsdMicros,
  };
}

export async function getStoryDir(storyId: string): Promise<string> {
  const dir = resolveStoryDir(storyId);
  await ensureDir(dir);
  storyDirOverrides.set(storyId, dir);
  return dir;
}

export async function createStory(
  storyId: string,
  prompt: string,
  status: StoryStatus,
  userId?: string,
  language?: string,
  voice?: VoiceKey,
  artStyle?: ArtStyleKey,
  storyMode?: StoryMode,
  creditCost = 0,
  generationInputs?: StoryGenerationInputs,
): Promise<void> {
  const dir = await getStoryDir(storyId);
  const meta: StoryMeta = {
    id: storyId,
    prompt,
    status,
    createdAt: new Date().toISOString(),
    userId,
    language: language ?? 'ro',
    voice,
    artStyle,
    storyMode,
    creditCost,
    currentPhase: 'Generating story scenario...',
    progressMessage: 'Creating your story...',
    generationInputs,
    usageTotals: { ...EMPTY_STORY_USAGE_TOTALS },
    viewCount: 0,
    likeCount: 0,
    dislikeCount: 0,
    scenarioRevision: 0,
    renderedScenarioRevision: 0,
  };
  await fs.writeFile(path.join(dir, 'scenario.json'), JSON.stringify(meta, null, 2));
  await writeUsageEvents(storyId, []);
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
    generationInputs: existing?.generationInputs ?? options.generationInputs,
    usageTotals: normalizeStoryUsageTotals(existing?.usageTotals ?? options.usageTotals),
    viewCount: normalizeCount(existing?.viewCount),
    likeCount: normalizeCount(existing?.likeCount),
    dislikeCount: normalizeCount(existing?.dislikeCount),
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
    const dir = resolveStoryDir(storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.status = status;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function updatePageStatus(storyId: string, pageNumber: number, status: 'pending' | 'generating' | 'completed' | 'failed'): Promise<void> {
  await withLock(storyId, async () => {
    const dir = resolveStoryDir(storyId);
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
    const dir = resolveStoryDir(storyId);
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
  const filePath = path.join(resolveStoryDir(storyId), filename);
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
    const dir = resolveStoryDir(storyId);
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
    const dir = resolveStoryDir(storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.renderedScenarioRevision = renderedScenarioRevision;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
}

export async function getAudioPath(storyId: string, filename: string): Promise<string | null> {
  const filePath = path.join(resolveStoryDir(storyId), filename);
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

export async function appendStoryUsageEvent(
  storyId: string,
  event: StoryUsageEvent,
  totalsDelta: StoryUsageTotals,
): Promise<void> {
  await withLock(storyId, async () => {
    const dir = await getStoryDir(storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    data.usageTotals = mergeUsageTotals(data.usageTotals, totalsDelta);
    const events = await readUsageEvents(storyId);
    events.push(event);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    await writeUsageEvents(storyId, events);
  });
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

export async function incrementStoryViewCount(storyId: string): Promise<number> {
  return withLock(storyId, async () => {
    const dir = resolveStoryDir(storyId);
    const filePath = path.join(dir, 'scenario.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as StoryMeta;
    const viewCount = normalizeCount(data.viewCount) + 1;
    data.viewCount = viewCount;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return viewCount;
  });
}

export async function deleteStory(storyId: string): Promise<boolean> {
  const dir = resolveStoryDir(storyId);
  try {
    await fs.access(dir);
    await fs.rm(dir, { recursive: true, force: true });
    storyDirOverrides.delete(storyId);
    return true;
  } catch {
    return false;
  }
}
