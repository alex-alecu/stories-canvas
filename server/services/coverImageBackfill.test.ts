import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import type { StoryImageSources } from '../../shared/types.js';
import {
  backfillCoverImageSources,
  type CoverImageBackfillStore,
} from './coverImageBackfill.js';

const SUPABASE_URL = 'https://project.supabase.co';

function makeStorageUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/story-images/${path}`;
}

async function makeSourceImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: '#8fb5ff',
    },
  })
    .png()
    .toBuffer();
}

test('cover image backfill skips stories that already have complete variants', async () => {
  let downloaded = false;
  let uploaded = false;
  let updated = false;
  const store: CoverImageBackfillStore = {
    async listCompletedStories() {
      return [{
        id: 'story-complete',
        user_id: 'user-1',
        cover_image_url: makeStorageUrl('user-1/story-complete/page-01.png'),
        cover_image_sources: {
          full: makeStorageUrl('user-1/story-complete/page-01.png'),
          thumb: makeStorageUrl('user-1/story-complete/cover-thumb.webp'),
          card: makeStorageUrl('user-1/story-complete/cover-card.webp'),
        },
        scenario: null,
      }];
    },
    async downloadObject() {
      downloaded = true;
      return null;
    },
    async uploadObject() {
      uploaded = true;
    },
    async updateCoverImageSources() {
      updated = true;
    },
  };

  const stats = await backfillCoverImageSources(store, {
    supabaseUrl: SUPABASE_URL,
    logger: { log() {}, warn() {} },
  });

  assert.equal(stats.scanned, 1);
  assert.equal(stats.eligible, 0);
  assert.equal(stats.skippedComplete, 1);
  assert.equal(downloaded, false);
  assert.equal(uploaded, false);
  assert.equal(updated, false);
});

test('cover image backfill generates missing thumb and card variants from storage cover URL', async () => {
  const sourceUrl = makeStorageUrl('user-1/story-missing/page-01.png');
  const sourceBuffer = await makeSourceImage();
  const uploads: Array<{ path: string; contentType: string; size: number }> = [];
  let updatedSources: StoryImageSources | undefined;
  const store: CoverImageBackfillStore = {
    async listCompletedStories({ from }) {
      return from === 0
        ? [{
          id: 'story-missing',
          user_id: 'user-1',
          cover_image_url: sourceUrl,
          cover_image_sources: undefined,
          scenario: null,
        }]
        : [];
    },
    async downloadObject(path) {
      assert.equal(path, 'user-1/story-missing/page-01.png');
      return sourceBuffer;
    },
    async uploadObject(path, buffer, contentType) {
      uploads.push({ path, contentType, size: buffer.byteLength });
    },
    async updateCoverImageSources(storyId, sources) {
      assert.equal(storyId, 'story-missing');
      updatedSources = sources;
    },
  };

  const stats = await backfillCoverImageSources(store, {
    supabaseUrl: SUPABASE_URL,
    concurrency: 1,
    limit: 1,
    logger: { log() {}, warn() {} },
  });

  assert.equal(stats.eligible, 1);
  assert.equal(stats.updated, 1);
  assert.deepEqual(uploads.map(upload => upload.path).sort(), [
    'user-1/story-missing/cover-card.webp',
    'user-1/story-missing/cover-thumb.webp',
  ]);
  assert.deepEqual([...new Set(uploads.map(upload => upload.contentType))], ['image/webp']);
  assert.ok(uploads.every(upload => upload.size > 0));
  assert.deepEqual(updatedSources, {
    full: sourceUrl,
    thumb: makeStorageUrl('user-1/story-missing/cover-thumb.webp'),
    card: makeStorageUrl('user-1/story-missing/cover-card.webp'),
  });
});

test('cover image backfill ignores unsupported and missing source URLs without failing the run', async () => {
  const store: CoverImageBackfillStore = {
    async listCompletedStories({ from }) {
      return from === 0
        ? [
          {
            id: 'story-unsupported',
            user_id: 'user-1',
            cover_image_url: 'https://example.com/page-01.png',
            cover_image_sources: undefined,
            scenario: null,
          },
          {
            id: 'story-missing-source',
            user_id: 'user-1',
            cover_image_url: makeStorageUrl('user-1/story-missing-source/page-01.png'),
            cover_image_sources: undefined,
            scenario: null,
          },
        ]
        : [];
    },
    async downloadObject(path) {
      assert.equal(path, 'user-1/story-missing-source/page-01.png');
      return null;
    },
    async uploadObject() {
      assert.fail('missing source should not upload variants');
    },
    async updateCoverImageSources() {
      assert.fail('missing source should not update story metadata');
    },
  };

  const stats = await backfillCoverImageSources(store, {
    supabaseUrl: SUPABASE_URL,
    concurrency: 1,
    logger: { log() {}, warn() {} },
  });

  assert.equal(stats.eligible, 2);
  assert.equal(stats.updated, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.skippedUnsupportedSource, 1);
  assert.equal(stats.skippedMissingSource, 1);
});
