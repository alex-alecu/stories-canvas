import type { StoryAssets, StoryMeta, StorySummary } from '../types';
import { cacheStoryMedia, deleteCachedStoryMedia } from './serviceWorker';
import { fetchStory, fetchStoryAssets } from './storyApi';

const DB_NAME = 'stories-canvas-offline';
const DB_VERSION = 1;
const STORE_NAME = 'stories';
const RECENT_DOWNLOAD_LIMIT = 15;
const CHANGE_EVENT = 'stories-canvas:offline-stories-changed';

export type OfflineDownloadSource = 'manual' | 'recent';

export interface OfflineStoryRecord {
  id: string;
  story: StoryMeta;
  summary: StorySummary;
  source: OfflineDownloadSource;
  downloadedAt: string;
  updatedAt: string;
  lastViewedAt: string;
  assetUrls: string[];
  failedAssetUrls: string[];
  mediaBytes: number;
  scenarioRevision: number;
  renderedScenarioRevision: number;
  assetSignature: string;
}

export interface OfflineDownloadsSummary {
  totalCount: number;
  manualCount: number;
  recentCount: number;
  totalBytes: number;
}

export function subscribeOfflineStories(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export async function getOfflineStory(id: string): Promise<OfflineStoryRecord | null> {
  const db = await openOfflineDb();
  return requestToPromise<OfflineStoryRecord | undefined>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id),
  ).then(record => record ?? null);
}

export async function listOfflineStories(): Promise<OfflineStoryRecord[]> {
  const db = await openOfflineDb();
  const records = await requestToPromise<OfflineStoryRecord[]>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
  );

  return records.sort((a, b) => Date.parse(b.lastViewedAt) - Date.parse(a.lastViewedAt));
}

export async function listOfflineStorySummaries(search?: string): Promise<StorySummary[]> {
  const normalizedSearch = search?.trim().toLowerCase();
  const records = await listOfflineStories();
  const filtered = normalizedSearch
    ? records.filter(record => {
      const haystack = `${record.summary.title ?? ''} ${record.summary.prompt}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    : records;

  return filtered.map(record => record.summary);
}

export async function getOfflineDownloadsSummary(): Promise<OfflineDownloadsSummary> {
  const records = await listOfflineStories();
  return records.reduce<OfflineDownloadsSummary>((summary, record) => {
    summary.totalCount += 1;
    summary.totalBytes += record.mediaBytes;
    if (record.source === 'manual') {
      summary.manualCount += 1;
    } else {
      summary.recentCount += 1;
    }
    return summary;
  }, {
    totalCount: 0,
    manualCount: 0,
    recentCount: 0,
    totalBytes: 0,
  });
}

export async function downloadStoryForOffline(
  storyId: string,
  source: OfflineDownloadSource,
  existingStory?: StoryMeta,
): Promise<OfflineStoryRecord> {
  const story = existingStory?.scenario ? existingStory : await fetchStory(storyId);
  if (story.status !== 'completed' || story.assetsStale || !story.scenario) {
    throw new Error('Only completed stories can be downloaded');
  }

  const assets = await fetchStoryAssets(storyId).catch(() => undefined);
  const assetUrls = collectStoryAssetUrls(story, assets);
  const existingRecord = await getOfflineStory(storyId);
  const now = new Date().toISOString();
  const nextSource: OfflineDownloadSource = source === 'manual' || existingRecord?.source === 'manual'
    ? 'manual'
    : 'recent';
  const assetSignature = buildAssetSignature(story, assetUrls);

  if (existingRecord && existingRecord.assetSignature === assetSignature) {
    const record: OfflineStoryRecord = {
      ...existingRecord,
      story,
      summary: summarizeStory(story),
      source: nextSource,
      updatedAt: now,
      lastViewedAt: now,
      scenarioRevision: story.scenarioRevision ?? 0,
      renderedScenarioRevision: story.renderedScenarioRevision ?? 0,
    };
    await putOfflineStory(record);
    if (source === 'recent') {
      await pruneRecentDownloads();
    }
    notifyOfflineStoriesChanged();
    return record;
  }

  const cacheResult = await cacheStoryMedia(assetUrls);
  if (cacheResult.failedUrls.length > 0) {
    throw new Error('Some story media could not be downloaded');
  }

  const record: OfflineStoryRecord = {
    id: storyId,
    story,
    summary: summarizeStory(story),
    source: nextSource,
    downloadedAt: existingRecord?.downloadedAt ?? now,
    updatedAt: now,
    lastViewedAt: now,
    assetUrls,
    failedAssetUrls: [],
    mediaBytes: cacheResult.bytes || existingRecord?.mediaBytes || 0,
    scenarioRevision: story.scenarioRevision ?? 0,
    renderedScenarioRevision: story.renderedScenarioRevision ?? 0,
    assetSignature,
  };

  await putOfflineStory(record);
  if (existingRecord) {
    const oldUrls = existingRecord.assetUrls.filter(url => !assetUrls.includes(url));
    await deleteCachedStoryMedia(oldUrls);
  }

  if (source === 'recent') {
    await pruneRecentDownloads();
  }

  notifyOfflineStoriesChanged();
  return record;
}

export async function promoteOfflineStory(storyId: string): Promise<OfflineStoryRecord | null> {
  const record = await getOfflineStory(storyId);
  if (!record) return null;

  const nextRecord: OfflineStoryRecord = {
    ...record,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };
  await putOfflineStory(nextRecord);
  notifyOfflineStoriesChanged();
  return nextRecord;
}

export async function removeOfflineStory(storyId: string): Promise<void> {
  const record = await getOfflineStory(storyId);
  if (!record) return;

  await deleteCachedStoryMedia(record.assetUrls);

  const db = await openOfflineDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(storyId);
  await transactionDone(tx);
  notifyOfflineStoriesChanged();
}

export async function clearOfflineStories(): Promise<void> {
  const records = await listOfflineStories();
  const urls = [...new Set(records.flatMap(record => record.assetUrls))];
  await deleteCachedStoryMedia(urls);

  const db = await openOfflineDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await transactionDone(tx);
  notifyOfflineStoriesChanged();
}

function collectStoryAssetUrls(story: StoryMeta, assets?: StoryAssets): string[] {
  const urls = new Set<string>();

  for (const page of story.scenario?.pages ?? []) {
    if (page.status === 'completed' && page.imageUrl) {
      urls.add(page.imageUrl);
    }
    if (page.audioUrl) {
      urls.add(page.audioUrl);
    }
  }

  for (const sheet of assets?.characterSheets ?? []) {
    urls.add(sheet.url);
  }

  for (const image of assets?.pageImages ?? []) {
    urls.add(image.url);
  }

  return [...urls];
}

function summarizeStory(story: StoryMeta): StorySummary {
  const pages = story.scenario?.pages ?? [];
  const firstCompletedPage = pages.find(page => page.status === 'completed' && page.imageUrl);

  return {
    id: story.id,
    prompt: story.prompt,
    status: story.status,
    createdAt: story.createdAt,
    title: story.scenario?.title,
    coverImage: story.coverImage ?? firstCompletedPage?.imageUrl,
    totalPages: pages.length,
    completedPages: pages.filter(page => page.status === 'completed').length,
    isPublic: story.isPublic,
    hasAudio: pages.some(page => !!page.audioUrl),
    assetsStale: story.assetsStale,
    viewCount: story.viewCount ?? 0,
  };
}

function buildAssetSignature(story: StoryMeta, assetUrls: string[]): string {
  return [
    story.scenarioRevision ?? 0,
    story.renderedScenarioRevision ?? 0,
    story.assetsStale ? 'stale' : 'fresh',
    ...assetUrls,
  ].join('|');
}

async function pruneRecentDownloads(limit = RECENT_DOWNLOAD_LIMIT): Promise<void> {
  const records = await listOfflineStories();
  const recentRecords = records
    .filter(record => record.source === 'recent')
    .sort((a, b) => Date.parse(b.lastViewedAt) - Date.parse(a.lastViewedAt));

  const recordsToRemove = recentRecords.slice(limit);
  await Promise.all(recordsToRemove.map(record => removeOfflineStory(record.id)));
}

async function putOfflineStory(record: OfflineStoryRecord): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(record);
  await transactionDone(tx);
}

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Offline storage is not available'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('source', 'source');
        store.createIndex('lastViewedAt', 'lastViewedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open offline storage'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Offline storage transaction was aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Offline storage transaction failed'));
  });
}

function notifyOfflineStoriesChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
