import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario, Page } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makePages(): Page[] {
  return [
    { pageNumber: 1, text: 'Mia smiles at her kite.', imagePrompt: 'Prompt 1', characters: ['Mia'], status: 'pending' },
    { pageNumber: 2, text: 'The wind pulls it away.', imagePrompt: 'Prompt 2', characters: ['Mia'], status: 'pending' },
    { pageNumber: 3, text: 'Mia asks Pip for help.', imagePrompt: 'Prompt 3', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 4, text: 'They try once and fail.', imagePrompt: 'Prompt 4', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 5, text: 'Mia finds a smarter idea.', imagePrompt: 'Prompt 5', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 6, text: 'They celebrate together.', imagePrompt: 'Prompt 6', characters: ['Mia', 'Pip'], status: 'pending' },
  ];
}

function makeScenario(): Scenario {
  return {
    title: 'Mia and the Kite',
    targetAge: 3,
    characters: [
      {
        name: 'Mia',
        role: 'protagonist',
        appearance: 'Small girl with curly brown hair.',
        clothing: 'Yellow raincoat.',
        personality: 'Kind and brave.',
        characterSheetPrompt: 'Character sheet prompt for Mia.',
      },
      {
        name: 'Pip',
        role: 'helper',
        appearance: 'Tiny rabbit with pink ears.',
        clothing: 'Blue scarf.',
        personality: 'Gentle and playful.',
        characterSheetPrompt: 'Character sheet prompt for Pip.',
      },
    ],
    pages: makePages(),
  };
}

test('reviewScenarioWithModel normalizes issue codes and page numbers', async () => {
  const { buildStoryPromptContext } = await import('./storyPrompt.js');
  const { reviewScenarioWithModel } = await import('./scenarioReview.js');

  const context = buildStoryPromptContext(
    'Tell a warm story about Mia and her kite.',
    'en',
    3,
    'storybook',
  );

  const result = await reviewScenarioWithModel(
    context,
    makeScenario(),
    async () => ({
      needsRewrite: false,
      summary: '',
      changedPageNumbers: [2, 2, 99],
      issues: [
        {
          code: 'unknown_code',
          summary: 'The middle pages drift from the prompt.',
          pageNumbers: [3, 0, 3],
        },
      ],
    }) as never,
  );

  assert.equal(result.needsRewrite, true);
  assert.equal(result.summary, 'Editorial review found issues that require rewriting before illustration.');
  assert.deepEqual(result.changedPageNumbers, [2]);
  assert.deepEqual(result.issues, [
    {
      code: 'story_arc',
      summary: 'The middle pages drift from the prompt.',
      pageNumbers: [3],
    },
  ]);
});

test('reviewScenarioWithModel preserves prompt-fidelity findings from the reviewer', async () => {
  const { buildStoryPromptContext } = await import('./storyPrompt.js');
  const { reviewScenarioWithModel } = await import('./scenarioReview.js');

  const context = buildStoryPromptContext(
    'Retell the core beats of a lantern-search story without losing the missing-lantern problem.',
    'en',
    6,
    'storybook',
  );

  const result = await reviewScenarioWithModel(
    context,
    makeScenario(),
    async () => ({
      needsRewrite: true,
      summary: 'The middle pages lose the original lantern-search premise.',
      changedPageNumbers: [3, 4],
      issues: [
        {
          code: 'prompt_fidelity',
          summary: 'Pages 3 and 4 drift into a picnic subplot instead of the lantern search.',
          pageNumbers: [3, 4],
        },
      ],
    }) as never,
  );

  assert.equal(result.needsRewrite, true);
  assert.equal(result.summary, 'The middle pages lose the original lantern-search premise.');
  assert.deepEqual(result.changedPageNumbers, [3, 4]);
  assert.deepEqual(result.issues, [
    {
      code: 'prompt_fidelity',
      summary: 'Pages 3 and 4 drift into a picnic subplot instead of the lantern search.',
      pageNumbers: [3, 4],
    },
  ]);
});

test('rewriteScenarioFromReviewWithModel asks for a conservative full rewrite', async () => {
  const { buildStoryPromptContext } = await import('./storyPrompt.js');
  const { rewriteScenarioFromReviewWithModel } = await import('./scenarioReview.js');

  const context = buildStoryPromptContext(
    'Tell a warm story about Mia keeping her kite.',
    'en',
    3,
    'storybook',
  );

  let capturedPrompt = '';

  const rewrittenScenario = await rewriteScenarioFromReviewWithModel(
    context,
    makeScenario(),
    {
      needsRewrite: true,
      summary: 'The middle pages need to stay focused on the kite problem.',
      changedPageNumbers: [3, 4],
      issues: [
        {
          code: 'prompt_fidelity',
          summary: 'Pages 3 and 4 drift away from Mia solving the kite problem.',
          pageNumbers: [3, 4],
        },
      ],
    },
    async (prompt) => {
      capturedPrompt = prompt;
      return makeScenario();
    },
  );

  assert.equal(rewrittenScenario.title, 'Mia and the Kite');
  assert.match(capturedPrompt, /Preserve page count, page numbers, and the main character set unless a change is truly required/);
  assert.match(capturedPrompt, /If you rewrite any page text, you must also update that page's imagePrompt and characters array so they stay aligned/);
  assert.match(capturedPrompt, /prompt_fidelity/);
  assert.match(capturedPrompt, /pages: 3, 4/);
});
