import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
