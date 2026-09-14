import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page, Scenario } from '../../shared/types.js';

const scenario: Scenario = { title: 'A story', targetAge: 3, characters: [], pages: [] };

test('asset staleness requires a previous render and a newer scenario revision', async () => {
  const { storyAssetsAreStale } = await import('../../shared/storyCompletion.js');
  for (const [story, expected] of [
    [{ scenario, scenarioRevision: 1, renderedScenarioRevision: 0 }, false],
    [{ scenario, scenarioRevision: 3, renderedScenarioRevision: 0 }, true],
    [{ scenario, scenarioRevision: 2, renderedScenarioRevision: 1 }, true],
    [{ scenario, scenarioRevision: 2, renderedScenarioRevision: 2 }, false],
    [{ scenario }, false],
    [{}, false],
    [{ scenario, renderedScenarioRevision: -1 }, false],
  ] as const) {
    assert.equal(storyAssetsAreStale(story), expected);
  }
});

test('image summary includes pending, generating, and failed pages as incomplete', async () => {
  const { summarizeStoryImages } = await import('../../shared/storyCompletion.js');
  const pages = ['completed', 'pending', 'generating', 'failed'].map((status, index) => ({
    pageNumber: index + 1, text: '', imagePrompt: '', characters: [], status,
  } as Page));
  assert.deepEqual(summarizeStoryImages({ ...scenario, pages }), {
    completedPages: 1, totalPages: 4, failedPages: [2, 3, 4],
  });
  assert.deepEqual(summarizeStoryImages(undefined), {
    completedPages: 0, totalPages: 0, failedPages: [],
  });
});

test('continuation copy is clear in Romanian and English', async () => {
  const { getStoryContinuationCopy } = await import('../../shared/storyCompletion.js');
  assert.deepEqual(getStoryContinuationCopy('ro'), {
    message: 'Generarea poveștii s-a oprit înainte ca toate imaginile să fie gata.',
    action: 'Continuă generarea',
    pendingAction: 'Generarea continuă…',
  });
  assert.deepEqual(getStoryContinuationCopy('en'), {
    message: 'Story generation stopped before all images were ready.',
    action: 'Continue generation',
    pendingAction: 'Continuing generation…',
  });
});
