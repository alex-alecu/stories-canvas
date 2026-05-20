import assert from 'node:assert/strict';
import test from 'node:test';

import type { Page, Scenario, StoryMeta } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    pageNumber: 1,
    text: 'A fox watches the sunrise.',
    imagePrompt: 'Sunrise fox scene',
    characters: [],
    status: 'completed',
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    title: 'Sunrise Story',
    targetAge: 3,
    characters: [],
    pages: [makePage()],
    ...overrides,
  };
}

function makeStoryMeta(overrides: Partial<StoryMeta> = {}): StoryMeta {
  return {
    id: 'story-1',
    prompt: 'A sunrise story.',
    status: 'generating_images',
    createdAt: '2026-03-30T00:00:00.000Z',
    scenario: makeScenario(),
    ...overrides,
  };
}

function makeActiveGenerationsClient(result: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      assert.equal(table, 'stories');
      return {
        select(selection: string) {
          assert.equal(selection, '*');
          return {
            in(column: string, filter: string[]) {
              assert.equal(column, 'status');
              assert.deepEqual(filter, [
                'generating_scenario',
                'reviewing_scenario',
                'generating_characters',
                'generating_images',
                'generating_audio',
              ]);
              return {
                order(orderColumn: string, options: { ascending: boolean }) {
                  assert.equal(orderColumn, 'created_at');
                  assert.deepEqual(options, { ascending: false });
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
}

test('getActiveGenerations classifies HTML 502 responses as transient dependency errors', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  const client = makeActiveGenerationsClient({
    data: null,
    error: {
      message: '<!DOCTYPE html><html><title>502: Bad gateway</title><body>Cloudflare Ray ID</body></html>',
      status: 502,
    },
  });

  await assert.rejects(
    () => supabaseStorage.getActiveGenerations(client as never),
    error => {
      assert.ok(error instanceof supabaseStorage.TransientDependencyError);
      assert.match(error.message, /Supabase temporarily unavailable during active generation lookup/);
      assert.match(error.message, /HTTP 502/);
      assert.doesNotMatch(error.message, /<!DOCTYPE html>/);
      return true;
    },
  );
});

test('getActiveGenerations classifies HTTP 500 internal server errors as transient dependency errors', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  const client = makeActiveGenerationsClient({
    data: null,
    error: {
      message: 'Internal server error',
      status: 500,
    },
  });

  await assert.rejects(
    () => supabaseStorage.getActiveGenerations(client as never),
    error => {
      assert.ok(error instanceof supabaseStorage.TransientDependencyError);
      assert.match(error.message, /Supabase temporarily unavailable during active generation lookup/);
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /upstream internal server error/);
      return true;
    },
  );
});

test('getActiveGenerations preserves non-transient query failures as regular errors', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  const client = makeActiveGenerationsClient({
    data: null,
    error: {
      code: 'PGRST116',
      message: 'permission denied for relation stories',
    },
  });

  await assert.rejects(
    () => supabaseStorage.getActiveGenerations(client as never),
    error => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof supabaseStorage.TransientDependencyError));
      assert.match(error.message, /Failed during active generation lookup: permission denied for relation stories/);
      return true;
    },
  );
});

test('recoverStuckStories does not mutate story status when active generation lookup is transiently unavailable', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  let updateCalls = 0;

  await assert.rejects(
    () => supabaseStorage.recoverStuckStories({
      loadActiveGenerations: async () => {
        throw new supabaseStorage.TransientDependencyError(
          'Supabase',
          'active generation lookup',
          'upstream bad gateway',
          { status: 502 },
        );
      },
      updateStatus: async () => {
        updateCalls++;
      },
      log: { log() {} },
    }),
    error => {
      assert.ok(error instanceof supabaseStorage.TransientDependencyError);
      return true;
    },
  );

  assert.equal(updateCalls, 0);
});

test('recoverStuckStories keeps successful recovery behavior unchanged for stale completed content', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  const updates: Array<{ id: string; status: string }> = [];

  const recoveredCount = await supabaseStorage.recoverStuckStories({
    loadActiveGenerations: async () => [
      makeStoryMeta({
        id: 'story-stale',
        createdAt: '2026-03-30T00:00:00.000Z',
        scenario: makeScenario({
          pages: [
            makePage({ pageNumber: 1, status: 'completed' }),
            makePage({ pageNumber: 2, status: 'completed' }),
          ],
        }),
      }),
    ],
    now: () => Date.parse('2026-03-31T00:10:00.000Z'),
    updateStatus: async (id, status) => {
      updates.push({ id, status });
    },
    log: { log() {} },
  });

  assert.equal(recoveredCount, 1);
  assert.deepEqual(updates, [{ id: 'story-stale', status: 'completed' }]);
});

test('recoverStuckStories skips stories that are still active on this server', async () => {
  const supabaseStorage = await import('./supabaseStorage.js');
  const updates: Array<{ id: string; status: string }> = [];

  const recoveredCount = await supabaseStorage.recoverStuckStories({
    isGenerationActive: storyId => storyId === 'story-live',
    loadActiveGenerations: async () => [
      makeStoryMeta({
        id: 'story-live',
        createdAt: '2026-03-30T00:00:00.000Z',
        scenario: makeScenario({
          pages: [
            makePage({ pageNumber: 1, status: 'failed' }),
          ],
        }),
      }),
    ],
    now: () => Date.parse('2026-03-31T00:10:00.000Z'),
    updateStatus: async (id, status) => {
      updates.push({ id, status });
    },
    log: { log() {} },
  });

  assert.equal(recoveredCount, 0);
  assert.deepEqual(updates, []);
});
