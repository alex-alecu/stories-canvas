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

for (const failure of ['connection', 'malformed-output'] as const) {
  test(`an unknown text review cost stops later pages after ${failure}`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-review-cost-'));
    const previous = { dataDir: config.dataDir, useSupabase: config.useSupabase };
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = `local-review-${failure}`;
    Object.assign(config, { dataDir: directory, useSupabase: false });
    t.after(async () => {
      Object.assign(config, previous);
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      await fs.rm(directory, { recursive: true, force: true });
    });
    const storyId = 'test-story';
    const pages: Page[] = [1, 2].map(pageNumber => ({ pageNumber, text: 'A rabbit waves.',
      imagePrompt: 'A rabbit on a hill', characters: [], status: 'pending' }));
    await fs.mkdir(path.join(directory, storyId));
    await fs.writeFile(path.join(directory, storyId, 'scenario.json'), JSON.stringify({ scenario: { pages } }));
    const png = (await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64');
    let images = 0;
    let reviews = 0;
    const costs: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/images')) {
        images++;
        return Response.json({ id: 'image-1', data: [{ b64_json: png }], usage: { cost: 0.01 } });
      }
      if (url.includes('/generation')) return Response.json({ error: 'Cost unavailable' }, { status: 404 });
      assert.ok(url.endsWith('/chat/completions'));
      reviews++;
      if (failure === 'connection') throw new TypeError('Connection lost');
      return Response.json({ id: 'review-1', choices: [{ finish_reason: 'stop', message: { content: 'invalid JSON' } }] });
    });
    await assert.rejects(generateAllSceneImages(storyId, pages, [], new Map(),
      undefined, undefined, undefined, undefined, false, undefined,
      (_page, usage) => { costs.push(usage.usageDetails.providerCostUsd); }));
    assert.equal(images, 1);
    assert.equal(reviews, 1);
    assert.deepEqual(costs, [null]);
    const saved = JSON.parse(await fs.readFile(path.join(directory, storyId, 'scenario.json'), 'utf8'));
    assert.deepEqual(saved.scenario.pages.map((page: Page) => page.status), ['failed', 'pending']);
  });
}
