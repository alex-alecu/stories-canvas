import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { config } from '../config.js';
import { generateAllSceneImages } from './sceneGenerator.js';
import type { Page } from '../../shared/types.js';

for (const failure of ['connection', 'missing-cost'] as const) {
  test(`an unknown image cost stops later pages after ${failure}`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-cost-'));
    const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = `local-test-${failure}`;
    Object.assign(config, { dataDir: directory, useSupabase: false });
    const storyId = 'test-story';
    const pages: Page[] = [1, 2].map(pageNumber => ({ pageNumber, text: 'A rabbit waves.',
      imagePrompt: 'A rabbit on a hill', characters: [], status: 'pending' }));
    await fs.mkdir(path.join(directory, storyId));
    await fs.writeFile(path.join(directory, storyId, 'scenario.json'), JSON.stringify({ scenario: { pages } }));
    let requests = 0;
    const costs: unknown[] = [];
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      requests++;
      if (failure === 'connection') throw new TypeError('Connection lost');
      return Response.json({ data: [{ b64_json: 'invalid-image' }] });
    };
    try {
      await assert.rejects(generateAllSceneImages(storyId, pages, [], new Map(),
        undefined, undefined, undefined, controller.signal, false,
        (_page, usage) => { costs.push(usage.usageDetails.providerCostUsd); }));
      const saved = JSON.parse(await fs.readFile(path.join(directory, storyId, 'scenario.json'), 'utf8'));
      assert.deepEqual(saved.scenario.pages.map((page: Page) => page.status), ['failed', 'pending']);
      assert.equal(requests, 1);
      assert.deepEqual(costs, [null]);
      assert.equal(controller.signal.aborted, false);
    } finally {
      globalThis.fetch = originalFetch;
      Object.assign(config, previous);
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}

test('successful images are saved directly and remain references for later pages', async (t) => {
  const { withImageModel } = await import('./imageGenerationContext.js');
  const { parseImageModel } = await import('../../shared/imageModels.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-direct-'));
  const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'local-image-only-test';
  Object.assign(config, { dataDir: directory, useSupabase: false });
  t.after(async () => {
    Object.assign(config, previous);
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const storyId = 'direct-story';
  const pages: Page[] = [1, 2].map(pageNumber => ({ pageNumber, text: 'A rabbit waves.',
    imagePrompt: 'A rabbit on a hill', characters: [], status: 'pending' }));
  await fs.mkdir(path.join(directory, storyId));
  await fs.writeFile(path.join(directory, storyId, 'scenario.json'), JSON.stringify({ scenario: { pages } }));
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = input instanceof Request ? await input.json() : JSON.parse(String(init?.body));
    requests.push({ url, body });
    if (!url.endsWith('/images')) return Response.json({ error: 'Only image requests are allowed' }, { status: 400 });
    return Response.json({ id: `image-${requests.length}`, data: [{ b64_json: png.toString('base64') }], usage: { cost: 0.01 } });
  });
  const costs: unknown[] = [];
  await withImageModel(parseImageModel('black-forest-labs/flux.2-klein-4b'), () =>
    generateAllSceneImages(storyId, pages, [], new Map(), undefined, undefined, undefined, undefined, false,
      (_page, usage) => { costs.push(usage.usageDetails.providerCostUsd); }));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url.endsWith('/images')));
  assert.deepEqual(requests.map(request => request.body.model), ['black-forest-labs/flux.2-klein-4b', 'black-forest-labs/flux.2-klein-4b']);
  assert.deepEqual(requests[0].body.input_references, []);
  assert.deepEqual(requests[1].body.input_references, [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }]);
  assert.deepEqual(costs, [0.01, 0.01]);
  const saved = JSON.parse(await fs.readFile(path.join(directory, storyId, 'scenario.json'), 'utf8'));
  assert.deepEqual(saved.scenario.pages.map((page: Page) => page.status), ['completed', 'completed']);
  for (const filename of ['page-01.png', 'page-02.png']) {
    assert.deepEqual(await fs.readFile(path.join(directory, storyId, filename)), png);
  }
});
