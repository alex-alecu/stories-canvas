import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getOfflineStory, listOfflineStorySummaries, removeOfflineStory, type OfflineStoryRecord } from './offlineStories';

function record(id: string, language: string, requestedLanguage?: string): OfflineStoryRecord {
  return {
    id,
    requestedLanguage,
    story: {
      id: 'story-1', prompt: 'A fox', status: 'completed', createdAt: '2026-10-30T00:00:00Z',
      language, requestedLanguage,
      scenario: { title: language, targetAge: 3, characters: [], pages: [] },
    },
    summary: { id: 'story-1', prompt: 'A fox', title: language, status: 'completed', createdAt: '2026-10-30T00:00:00Z', totalPages: 0, completedPages: 0 },
    source: 'manual', downloadedAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', lastViewedAt: '2026-10-30T00:00:00Z',
    assetUrls: ['/shared.png', `/${language}.mp3`], failedAssetUrls: [], mediaBytes: 100,
    scenarioRevision: 0, renderedScenarioRevision: 0, assetSignature: language,
  };
}

// Only the browser storage transport is replaced. Record selection, language
// checks, summary filtering, and shared media deletion use the application code.
function storage(t: TestContext, initial: OfflineStoryRecord[]) {
  const records = new Map(initial.map(item => [item.id, item]));
  const deletedUrls: string[] = [];
  const descriptors = ['indexedDB', 'window'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const request = (result: unknown) => {
    const value = { result, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => value.onsuccess?.());
    return value;
  };
  const db = {
    transaction: () => {
      const tx = {
        oncomplete: undefined as (() => void) | undefined,
        objectStore: () => ({
          get: (id: string) => request(records.get(id)),
          getAll: () => request([...records.values()]),
          delete: (id: string) => records.delete(id),
        }),
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => request(db) } });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://example.test' }, dispatchEvent: () => true,
      caches: { open: async () => ({ delete: async (url: string) => { deletedUrls.push(url); return true; } }) },
    },
  });
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { records, deletedUrls };
}

test('offline reads return the requested language version of one story', async t => {
  storage(t, [record('story-1:en', 'en', 'en'), record('story-1:ro', 'ro', 'ro')]);
  assert.equal((await getOfflineStory('story-1', 'en'))?.story.language, 'en');
  assert.equal((await getOfflineStory('story-1', 'ro'))?.story.language, 'ro');
  assert.equal(await getOfflineStory('story-1', 'fr'), null);
});

test('old downloads remain readable in their original language only', async t => {
  storage(t, [record('story-1', 'ro')]);
  assert.equal((await getOfflineStory('story-1', 'ro'))?.story.language, 'ro');
  assert.equal(await getOfflineStory('story-1', 'en'), null);
});

test('offline lists show the selected language without duplicate stories', async t => {
  storage(t, [record('story-1', 'en'), record('story-1:en', 'en', 'en'), record('story-1:ro', 'ro', 'ro')]);
  assert.deepEqual((await listOfflineStorySummaries(undefined, 'ro')).map(item => item.title), ['ro']);
  assert.equal((await listOfflineStorySummaries(undefined, 'en')).length, 1);
});

test('removing one language keeps shared images and the other audio', async t => {
  const { records, deletedUrls } = storage(t, [record('story-1:en', 'en', 'en'), record('story-1:ro', 'ro', 'ro')]);
  await removeOfflineStory('story-1', 'en');
  assert.equal(records.has('story-1:en'), false);
  assert.equal(records.has('story-1:ro'), true);
  assert.deepEqual(deletedUrls, ['https://example.test/en.mp3']);
});
