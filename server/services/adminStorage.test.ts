import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoryMeta } from '../../shared/types.js';


function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  return {
    id: 'story-1',
    prompt: 'A dragon story.',
    status: 'completed',
    createdAt: '2026-04-01T00:00:00.000Z',
    creditCost: 3,
    generationInputs: {
      prompt: 'A dragon story.',
      language: 'en',
      age: 5,
      artStyle: 'watercolor',
      storyMode: 'pro_audio',
      voice: 'corina',
      audioEnabled: true,
      proModel: true,
      scenarioModel: 'gpt-5.6-sol',
      imageModel: 'gemini-3.1-flash-image-preview',
      imageModelPro: 'gemini-3-pro-image-preview',
      audioModel: 'eleven_multilingual_v2',
      pricingVersion: '2026-04-15',
    },
    usageTotals: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      costUsdMicros: 123_000,
      textCostUsdMicros: 80_000,
      imageCostUsdMicros: 33_000,
      audioCostUsdMicros: 10_000,
    },
    ...overrides,
  };
}

test('getAdminUserDetail includes story cost summaries and aggregate metrics', async () => {
  const adminStorage = await import('./adminStorage.js');
  const detail = await adminStorage.getAdminUserDetail('user-1', {
    getSupabase: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: 'user-1',
              email: 'parent@example.com',
              created_at: '2026-01-01T00:00:00.000Z',
              user_metadata: {
                full_name: 'Parent One',
              },
            },
          },
          error: null,
        }),
      },
    },
    from(table: string) {
      assert.equal(table, 'user_roles');
      return {
        select(selection: string) {
          assert.equal(selection, 'role');
          return {
            eq(column: string, value: string) {
              assert.ok(
                (column === 'user_id' && value === 'user-1')
                || (column === 'role' && value === 'admin'),
              );
              return this;
            },
            maybeSingle: async () => ({
              data: { role: 'admin' },
              error: null,
            }),
          };
        },
      };
    },
    }) as never,
    getUserCreditBalance: async () => ({ availableCredits: 7 }),
    getBillingHistory: async () => ({
      purchases: [
        {
          id: 'purchase-1',
          offerSlug: 'pack_5',
          amountMinor: 3900,
          currency: 'ron' as const,
          creditsGranted: 5,
          status: 'completed' as const,
          createdAt: '2026-04-02T00:00:00.000Z',
        },
      ],
      ledger: [],
    }),
    listBillingPurchases: async (_userId: string, limit?: number) => {
      assert.equal(limit, undefined);
      return [
      {
        id: 'purchase-1',
        offerSlug: 'pack_5',
        amountMinor: 3900,
        currency: 'ron' as const,
        creditsGranted: 5,
        status: 'completed' as const,
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'purchase-2',
        offerSlug: 'pack_12',
        amountMinor: 7900,
        currency: 'ron' as const,
        creditsGranted: 12,
        status: 'failed' as const,
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    ];
    },
    listStoriesByUser: async (_userId: string, limit?: number) => {
      assert.equal(limit, undefined);
      return [
        makeStory(),
        makeStory({
        id: 'story-2',
        createdAt: '2026-04-02T00:00:00.000Z',
        usageTotals: {
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
          costUsdMicros: 77_000,
          textCostUsdMicros: 40_000,
          imageCostUsdMicros: 27_000,
          audioCostUsdMicros: 10_000,
        },
      }),
      ];
    },
  });
  assert.ok(detail);
  assert.equal(detail.email, 'parent@example.com');
  assert.equal(detail.stories.length, 2);
  assert.equal(detail.stories[0].generationInputs?.storyMode, 'pro_audio');
  assert.deepEqual(detail.metrics, {
    revenueMinor: 3900,
    revenueCurrency: 'ron',
    costUsdMicros: 200_000,
    inputTokens: 150,
    outputTokens: 65,
    totalTokens: 215,
  });
});
