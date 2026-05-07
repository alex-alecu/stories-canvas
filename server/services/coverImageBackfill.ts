import type { SupabaseClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import type { Scenario, StoryImageSources } from '../../shared/types.js';
import { MEDIA_CACHE_MAX_AGE_SECONDS, getPageImageFilename } from '../utils/storyMedia.js';
import { generateCoverImageVariantSources, STORY_IMAGES_BUCKET } from './coverImageVariants.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 2;

interface CoverImageBackfillStory {
  id: string;
  user_id: string | null;
  cover_image_url: string | null;
  cover_image_sources?: unknown;
  scenario: Scenario | null;
}

interface ListCompletedStoriesRange {
  from: number;
  to: number;
}

export interface CoverImageBackfillStore {
  listCompletedStories(range: ListCompletedStoriesRange): Promise<CoverImageBackfillStory[]>;
  downloadObject(path: string): Promise<Buffer | null>;
  uploadObject(path: string, buffer: Buffer, contentType: string): Promise<void>;
  updateCoverImageSources(storyId: string, sources: StoryImageSources): Promise<void>;
}

export interface CoverImageBackfillOptions {
  supabaseUrl: string;
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
  concurrency?: number;
  batchSize?: number;
  logger?: Pick<Console, 'log' | 'warn'>;
}

export interface CoverImageBackfillStats {
  scanned: number;
  eligible: number;
  updated: number;
  dryRun: number;
  skippedComplete: number;
  skippedNoSource: number;
  skippedUnsupportedSource: number;
  skippedMissingSource: number;
  failed: number;
}

function normalizeStoryImageSources(value: unknown): StoryImageSources | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const sources: StoryImageSources = {};
  if (typeof raw.thumb === 'string' && raw.thumb) sources.thumb = raw.thumb;
  if (typeof raw.card === 'string' && raw.card) sources.card = raw.card;
  if (typeof raw.full === 'string' && raw.full) sources.full = raw.full;

  return sources.thumb || sources.card || sources.full ? sources : undefined;
}

function hasCompleteCoverSources(value: unknown): boolean {
  const sources = normalizeStoryImageSources(value);
  return Boolean(sources?.thumb && sources.card);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getPublicObjectUrl(supabaseUrl: string, objectPath: string): string {
  return `${trimTrailingSlash(supabaseUrl)}/storage/v1/object/public/${STORY_IMAGES_BUCKET}/${objectPath}`;
}

function getFallbackPageOneUrl(story: CoverImageBackfillStory, supabaseUrl: string): string | undefined {
  const pageOne = story.scenario?.pages?.find(page => page.pageNumber === 1);
  if (pageOne?.status !== 'completed') {
    return undefined;
  }

  if (pageOne.imageUrl) {
    return pageOne.imageUrl;
  }

  const path = story.user_id
    ? `${story.user_id}/${story.id}/${getPageImageFilename(1)}`
    : `${story.id}/${getPageImageFilename(1)}`;
  return getPublicObjectUrl(supabaseUrl, path);
}

function getSourceCoverUrl(story: CoverImageBackfillStory, supabaseUrl: string): string | undefined {
  const sources = normalizeStoryImageSources(story.cover_image_sources);
  return sources?.full || story.cover_image_url || getFallbackPageOneUrl(story, supabaseUrl);
}

function getStoryImagesObjectPath(url: string, supabaseUrl: string): string | undefined {
  let parsedUrl: URL;
  let parsedSupabaseUrl: URL;

  try {
    parsedUrl = new URL(url);
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    return undefined;
  }

  if (parsedUrl.origin !== parsedSupabaseUrl.origin) {
    return undefined;
  }

  const prefix = `/storage/v1/object/public/${STORY_IMAGES_BUCKET}/`;
  if (!parsedUrl.pathname.startsWith(prefix)) {
    return undefined;
  }

  const objectPath = parsedUrl.pathname.slice(prefix.length);
  return objectPath ? decodeURIComponent(objectPath) : undefined;
}

function getObjectDirectory(objectPath: string): string {
  const lastSlash = objectPath.lastIndexOf('/');
  return lastSlash >= 0 ? objectPath.slice(0, lastSlash + 1) : '';
}

function createEmptyStats(): CoverImageBackfillStats {
  return {
    scanned: 0,
    eligible: 0,
    updated: 0,
    dryRun: 0,
    skippedComplete: 0,
    skippedNoSource: 0,
    skippedUnsupportedSource: 0,
    skippedMissingSource: 0,
    failed: 0,
  };
}

export function createSupabaseCoverImageBackfillStore(supabase: SupabaseClient): CoverImageBackfillStore {
  return {
    async listCompletedStories({ from, to }) {
      const { data, error } = await supabase
        .from('stories')
        .select('id,user_id,cover_image_url,cover_image_sources,scenario')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        throw new Error(`Failed to list completed stories: ${error.message}`);
      }

      return (data ?? []) as CoverImageBackfillStory[];
    },
    async downloadObject(path) {
      const { data, error } = await supabase.storage.from(STORY_IMAGES_BUCKET).download(path);
      if (error || !data) {
        return null;
      }

      return Buffer.from(await data.arrayBuffer());
    },
    async uploadObject(path, buffer, contentType) {
      const { error } = await supabase.storage
        .from(STORY_IMAGES_BUCKET)
        .upload(path, buffer, {
          cacheControl: String(MEDIA_CACHE_MAX_AGE_SECONDS),
          contentType,
          upsert: true,
        });

      if (error) {
        throw new Error(`Failed to upload ${path}: ${error.message}`);
      }
    },
    async updateCoverImageSources(storyId, sources) {
      const { error } = await supabase
        .from('stories')
        .update({
          cover_image_url: sources.full,
          cover_image_sources: sources,
        })
        .eq('id', storyId);

      if (error) {
        throw new Error(`Failed to update ${storyId}: ${error.message}`);
      }
    },
  };
}

export async function backfillCoverImageSources(
  store: CoverImageBackfillStore,
  options: CoverImageBackfillOptions,
): Promise<CoverImageBackfillStats> {
  const stats = createEmptyStats();
  const logger = options.logger ?? console;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const maxEligible = typeof options.limit === 'number' && options.limit > 0 ? options.limit : Infinity;
  const runLimited = pLimit(concurrency);
  let from = 0;
  let reachedLimit = false;

  async function processStory(story: CoverImageBackfillStory): Promise<void> {
    const sourceUrl = getSourceCoverUrl(story, options.supabaseUrl);
    if (!sourceUrl) {
      stats.skippedNoSource += 1;
      return;
    }

    const sourcePath = getStoryImagesObjectPath(sourceUrl, options.supabaseUrl);
    if (!sourcePath) {
      stats.skippedUnsupportedSource += 1;
      logger.warn(`[cover-backfill] Skipping ${story.id}: source is not in ${STORY_IMAGES_BUCKET}`);
      return;
    }

    if (options.dryRun) {
      stats.dryRun += 1;
      logger.log(`[cover-backfill] Would backfill ${story.id} from ${sourcePath}`);
      return;
    }

    const sourceBuffer = await store.downloadObject(sourcePath);
    if (!sourceBuffer) {
      stats.skippedMissingSource += 1;
      logger.warn(`[cover-backfill] Skipping ${story.id}: source object missing at ${sourcePath}`);
      return;
    }

    const objectDirectory = getObjectDirectory(sourcePath);
    const sources = await generateCoverImageVariantSources({
      sourceBuffer,
      fullUrl: sourceUrl,
      uploadVariant: async ({ filename, buffer, contentType }) => {
        const variantPath = `${objectDirectory}${filename}`;
        await store.uploadObject(variantPath, buffer, contentType);
        return getPublicObjectUrl(options.supabaseUrl, variantPath);
      },
    });

    await store.updateCoverImageSources(story.id, sources);
    stats.updated += 1;
  }

  while (!reachedLimit) {
    const batch = await store.listCompletedStories({ from, to: from + batchSize - 1 });
    if (batch.length === 0) {
      break;
    }

    const tasks: Array<Promise<void>> = [];
    for (const story of batch) {
      if (stats.eligible >= maxEligible) {
        reachedLimit = true;
        break;
      }

      stats.scanned += 1;

      if (!options.force && hasCompleteCoverSources(story.cover_image_sources)) {
        stats.skippedComplete += 1;
        continue;
      }

      stats.eligible += 1;
      tasks.push(runLimited(async () => {
        try {
          await processStory(story);
        } catch (error) {
          stats.failed += 1;
          logger.warn(
            `[cover-backfill] Failed ${story.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }));
    }

    await Promise.all(tasks);
    if (batch.length < batchSize) {
      break;
    }
    from += batchSize;
  }

  return stats;
}
