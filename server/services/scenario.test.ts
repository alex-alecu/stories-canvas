import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario, Page } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeValidPages(): Page[] {
  return [
    { pageNumber: 1, text: 'Mia loved the red kite that whooshed over her garden.', imagePrompt: 'Prompt 1', characters: ['Mia'], status: 'pending' },
    { pageNumber: 2, text: 'A gust of wind tugged the string and whisked the kite away.', imagePrompt: 'Prompt 2', characters: ['Mia'], status: 'pending' },
    { pageNumber: 3, text: 'Mia ran after it, but her first jump was too small.', imagePrompt: 'Prompt 3', characters: ['Mia'], status: 'pending' },
    { pageNumber: 4, text: 'She asked Pip the rabbit for help, but the branch still shook.', imagePrompt: 'Prompt 4', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 5, text: 'Then Mia stacked two boxes, climbed carefully, and reached the knot.', imagePrompt: 'Prompt 5', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 6, text: 'Back on the grass, Mia flew the kite again and shared the breeze with Pip.', imagePrompt: 'Prompt 6', characters: ['Mia', 'Pip'], status: 'pending' },
  ];
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    title: 'Mia and the Windy Kite',
    targetAge: 3,
    characters: [
      {
        name: 'Mia',
        role: 'protagonist',
        appearance: 'Small girl with curly brown hair and bright eyes.',
        clothing: 'Yellow raincoat and red boots.',
        personality: 'Kind, brave, and curious.',
        characterSheetPrompt: 'Character sheet prompt for Mia.',
      },
      {
        name: 'Pip',
        role: 'helper',
        appearance: 'Tiny white rabbit with pink ears.',
        clothing: 'Blue scarf.',
        personality: 'Gentle and playful.',
        characterSheetPrompt: 'Character sheet prompt for Pip.',
      },
    ],
    pages: makeValidPages(),
    ...overrides,
  };
}

test('story prompt assembly keeps shared rubric and language-specific rules together', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const context = storyPrompt.buildStoryPromptContext(
    'A brave bunny follows a lantern through the rain.',
    'en',
    6,
    'storybook',
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);
  const draftPrompt = storyPrompt.buildDraftScenarioPrompt(context);

  assert.match(systemInstruction, /Required Story Shape/);
  assert.match(systemInstruction, /Write every field in English unless it is explicitly listed below as English-only/);
  assert.match(draftPrompt, /Target age: 6/);
  assert.match(draftPrompt, /Classic hand-drawn storybook illustration/);
  assert.match(draftPrompt, /A brave bunny follows a lantern through the rain\./);
});

test('story prompt assembly preserves the selected illustration style in system rules', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const context = storyPrompt.buildStoryPromptContext(
    'A shy fox follows a lantern.',
    'en',
    6,
    'watercolor',
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);

  assert.match(systemInstruction, /Soft watercolor illustration style/);
  assert.match(systemInstruction, /Later pages in the same location must repeat that spatial layout faithfully/);
  assert.match(systemInstruction, /Do not put text, letters, symbols, or readable words inside the image description/);
});

test('generateScenarioWithModel uses draft settings first and repair settings second', async () => {
  const scenarioModule = await import('./scenario.js');
  const { config } = await import('../config.js');
  const calls: Array<{ prompt: string; options?: { temperature?: number; thinkingConfig?: { thinkingBudget?: number } } }> = [];

  const invalidDraft = makeScenario({
    targetAge: 4,
    pages: makeValidPages().map((page, index) => ({
      ...page,
      pageNumber: index === 1 ? 4 : page.pageNumber,
    })),
  });

  const repairedScenario = makeScenario();

  const generateJSON = async (
    prompt: string,
    _systemInstruction: string,
    _schema: Record<string, unknown>,
    options?: { temperature?: number; thinkingConfig?: { thinkingBudget?: number } },
  ): Promise<Scenario> => {
    calls.push({ prompt, options });
    return calls.length === 1 ? invalidDraft : repairedScenario;
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options?.temperature, config.scenarioTemperature);
  assert.deepEqual(calls[0].options?.thinkingConfig, { thinkingBudget: config.scenarioThinkingBudget });
  assert.equal(calls[1].options?.temperature, config.scenarioReviewTemperature);
  assert.deepEqual(calls[1].options?.thinkingConfig, { thinkingBudget: config.scenarioReviewThinkingBudget });
  assert.match(calls[1].prompt, /Validation issues to fix:/);
  assert.match(calls[1].prompt, /targetAge must match the requested age of 3/);
  assert.match(calls[1].prompt, /pageNumber must be 2/);
  assert.ok(scenario.pages.every(page => page.status === 'pending'));
});

test('generateScenarioWithModel performs one additional repair when the first repair still fails validation', async () => {
  const scenarioModule = await import('./scenario.js');
  const calls: string[] = [];

  const draftScenario = makeScenario({
    pages: makeValidPages().map(page => ({
      ...page,
      text: `${page.text} ${'Very long sentence. '.repeat(20)}`.trim(),
    })),
  });

  const stillInvalidRepair = makeScenario({
    pages: makeValidPages().map(page => ({
      ...page,
      text: `${page.text} ${'Still too long. '.repeat(18)}`.trim(),
    })),
  });

  const validSecondRepair = makeScenario();

  const generateJSON = async (prompt: string): Promise<Scenario> => {
    calls.push(prompt);
    if (calls.length === 1) return draftScenario;
    if (calls.length === 2) return stillInvalidRepair;
    return validSecondRepair;
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 3);
  assert.match(calls[2], /Repair pass 2/);
  assert.match(calls[2], /page text is too long for age 3/);
  assert.ok(scenario.pages.every(page => page.status === 'pending'));
});

test('generateScenarioWithModel fails after the second repair if validation issues remain', async () => {
  const scenarioModule = await import('./scenario.js');

  const invalidScenario = makeScenario({
    pages: makeValidPages().map(page => ({
      ...page,
      text: `${page.text} ${'This page keeps overflowing the overlay. '.repeat(18)}`.trim(),
    })),
  });

  const generateJSON = async (): Promise<Scenario> => invalidScenario;

  await assert.rejects(
    () => scenarioModule.generateScenarioWithModel(
      'Tell a warm story about Mia and a kite.',
      'en',
      3,
      'storybook',
      generateJSON as never,
    ),
    /Scenario failed validation after repair:/,
  );
});

test('validateScenario rejects age-6 pages that are too long for the overlay budget', async () => {
  const { validateScenario } = await import('./scenarioValidation.js');

  const scenario = makeScenario({
    targetAge: 6,
    pages: makeValidPages().map((page, index) => index === 0
      ? {
          ...page,
          text: `${page.text} ${'Extra detail about the village lantern parade. '.repeat(6)}`.trim(),
        }
      : page),
  });

  const issues = validateScenario(scenario, 6);

  assert.ok(issues.some(issue => issue.code === 'page.text.ageLength'));
});
