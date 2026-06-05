import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { StoryMeta } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makePublicStory(): StoryMeta {
  return {
    id: 'public-story',
    prompt: 'O poveste publică.',
    status: 'completed',
    createdAt: '2026-06-01T12:00:00.000Z',
    isPublic: true,
    language: 'ro',
    coverImage: '/api/stories/public-story/images/page-1.webp',
    scenario: {
      title: 'Poveste publică',
      targetAge: 5,
      characters: [],
      pages: [
        {
          pageNumber: 1,
          text: 'O fetiță descoperă o bibliotecă magică.',
          imagePrompt: 'Magic library',
          characters: [],
          status: 'completed',
        },
      ],
    },
  };
}

async function createSeoAppHarness() {
  const { config } = await import('../config.js');
  const appModule = await import('../app.js');
  const originalConfig = { ...config };
  const distPath = mkdtempSync(path.join(os.tmpdir(), 'stories-seo-dist-'));

  Object.assign(config, {
    appBaseUrl: 'https://basmul.ro',
    useSupabase: true,
  });

  await fs.writeFile(
    path.join(distPath, 'index.html'),
    '<html lang="ro"><head><meta name="description" content="old" /><title>Old title</title></head><body><div id="root"></div></body></html>',
  );

  const app = appModule.createApp({ serveStatic: true, distPath });
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind SEO app test server');
  }

  return {
    appModule,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      Object.assign(config, originalConfig);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

test('production static fallback injects story metadata and dynamic robots/sitemap routes', async (t) => {
  const harness = await createSeoAppHarness();
  t.after(harness.close);

  t.mock.method(harness.appModule.seoStorageOps, 'getStory', async () => makePublicStory());
  t.mock.method(harness.appModule.seoStorageOps, 'listPublicStories', async () => [makePublicStory()]);

  const storyResponse = await fetch(`${harness.baseUrl}/story/public-story`);
  assert.equal(storyResponse.status, 200);
  const storyHtml = await storyResponse.text();
  assert.match(storyHtml, /<title>Poveste publică \| Povești Magice<\/title>/);
  assert.match(storyHtml, /<link rel="canonical" href="https:\/\/basmul\.ro\/story\/public-story" \/>/);
  assert.match(storyHtml, /<meta name="robots" content="index,follow" \/>/);
  assert.match(storyHtml, /application\/ld\+json/);

  const robotsResponse = await fetch(`${harness.baseUrl}/robots.txt`);
  assert.equal(robotsResponse.status, 200);
  assert.match(await robotsResponse.text(), /Sitemap: https:\/\/basmul\.ro\/sitemap\.xml/);

  const sitemapResponse = await fetch(`${harness.baseUrl}/sitemap.xml`);
  assert.equal(sitemapResponse.status, 200);
  assert.match(await sitemapResponse.text(), /<loc>https:\/\/basmul\.ro\/story\/public-story<\/loc>/);
});
