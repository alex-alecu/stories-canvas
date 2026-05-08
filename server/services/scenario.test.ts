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

test('story prompt assembly keeps age scenario, appearance, and language rules together', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const context = storyPrompt.buildStoryPromptContext(
    'A brave bunny follows a lantern through the rain.',
    'en',
    6,
    'storybook',
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);
  const draftPrompt = storyPrompt.buildDraftScenarioPrompt(context);

  assert.match(systemInstruction, /Age 6 Scenario Prompt/);
  assert.match(systemInstruction, /Required Story Shape/);
  assert.match(systemInstruction, /grounded conflict, active problem-solving, and a dramatic but child-safe reversal/i);
  assert.match(systemInstruction, /Character types may be children, adults, elders, families, animals/i);
  assert.match(systemInstruction, /Write the title, page text, character names, roles, and personality descriptions in English/);
  assert.match(systemInstruction, /keep the exact spelling from characters\[\]\.name whenever you mention a character/i);
  assert.match(systemInstruction, /keep appearance, clothing, characterSheetPrompt, and imagePrompt visually originalized/i);
  assert.match(draftPrompt, /Target age: 6/);
  assert.match(draftPrompt, /Classic hand-drawn storybook illustration/);
  assert.match(draftPrompt, /If the system context includes Faithful Public-Domain Retelling Rules, adapt that source faithfully/);
  assert.match(draftPrompt, /A brave bunny follows a lantern through the rain\./);
});

test('story prompt assembly includes source grounding only for faithful retellings', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const context = storyPrompt.buildStoryPromptContext(
    'Creeaza povestea lui Greuceanu cat mai aproape de original.',
    'ro',
    5,
    'storybook',
    {
      title: 'Greuceanu',
      author: 'Petre Ispirescu',
      provider: 'wikisource',
      sourceUrl: 'https://ro.wikisource.org/wiki/Greuceanu',
      licenseNote: 'Public-domain Romanian folklore text hosted on Wikisource.',
      canonicalBeatSheet: {
        requiredCharacters: ['Greuceanu', 'Imparatul Rosu', 'Faurul Pamantului'],
        requiredLocations: ['curtea imparatului'],
        magicalObjects: ['soarele si luna furate'],
        eventOrder: ['zmeii fura lumina', 'Greuceanu infrange zmeii', 'lumina revine'],
        forbiddenSubstitutions: ['Nu inlocui zmeii cu un singur zmeu prietenos.'],
        softenableBeats: ['Luptele pot fi non-grafice.'],
        fidelityWarnings: ['Pastreaza recuperarea soarelui si lunii.'],
      },
    },
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);
  const reviewPrompt = storyPrompt.buildScenarioReviewPrompt(context, makeScenario({ targetAge: 5 }));

  assert.match(systemInstruction, /Faithful Public-Domain Retelling Rules/);
  assert.match(systemInstruction, /Title: Greuceanu/);
  assert.match(systemInstruction, /Provider: wikisource/);
  assert.match(systemInstruction, /Faurul Pamantului/);
  assert.match(systemInstruction, /Nu inlocui zmeii cu un singur zmeu prietenos/);
  assert.match(reviewPrompt, /For faithful public-domain retellings, prompt fidelity means preserving the canonical source beats/);
  assert.match(reviewPrompt, /fireflies, a trade, or a new helper who solves the mission/);
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

test('story prompt assembly uses the 7-plus scenario prompt for older selected ages', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const context = storyPrompt.buildStoryPromptContext(
    'Retell a cozy lost-and-found story about a lantern and a shy fox.',
    'en',
    7,
    'storybook',
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);

  assert.match(systemInstruction, /Age 7\+ Scenario Prompt/);
  assert.match(systemInstruction, /Trigger the inciting problem within the first third of the pages/);
  assert.match(systemInstruction, /one serious failed attempt, reversal, or discovery/i);
  assert.match(systemInstruction, /Use the final page as the aftermath/);
  assert.match(systemInstruction, /Use 3-6 concise sentences per page/);
  assert.match(systemInstruction, /the protagonist does not have to be a child unless the prompt asks for it/);
  assert.match(systemInstruction, /If a page text changes during revision, update that page's imagePrompt and characters list to match/);
  assert.match(systemInstruction, /Avoid melodrama, random peril, cartoon cruelty, and magical shortcuts/);
});

test('story prompt age resolver matches the UI age groups', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(1), '3');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(2), '3');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(3), '3');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(4), '4');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(5), '5');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(6), '6');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(7), '7-plus');
  assert.equal(storyPrompt.resolveScenarioPromptAgeGroup(12), '7-plus');
});

test('shared age ranges expose only the grouped UI choices', async () => {
  const { AGE_RANGES } = await import('../../shared/types.js');

  assert.deepEqual(AGE_RANGES, [
    { value: 3, label: '3' },
    { value: 4, label: '4' },
    { value: 5, label: '5' },
    { value: 6, label: '6' },
    { value: 7, label: '7+' },
  ]);
});

test('story generator template keeps the reusable under-10 prompt guidance', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Write an original \{\{language\}\} story for children age \{\{age\}\}\./);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Center it on one clear problem, quest, or test\./);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Keep danger gentle and non-graphic/);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /\{\{user_prompt\}\}/);
});

test('generateScenarioWithModel uses draft, repair, and review settings in order', async () => {
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
  ): Promise<any> => {
    calls.push({ prompt, options });
    if (calls.length === 1) return invalidDraft;
    if (calls.length === 2) return repairedScenario;
    return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[0].options?.temperature, config.scenarioTemperature);
  assert.deepEqual(calls[0].options?.thinkingConfig, { thinkingBudget: config.scenarioThinkingBudget });
  assert.equal(calls[1].options?.temperature, config.scenarioReviewTemperature);
  assert.deepEqual(calls[1].options?.thinkingConfig, { thinkingBudget: config.scenarioReviewThinkingBudget });
  assert.match(calls[1].prompt, /Validation issues to fix:/);
  assert.match(calls[1].prompt, /targetAge must match the requested age of 3/);
  assert.match(calls[1].prompt, /pageNumber must be 2/);
  assert.equal(calls[2].options?.temperature, config.scenarioReviewTemperature);
  assert.deepEqual(calls[2].options?.thinkingConfig, { thinkingBudget: config.scenarioReviewThinkingBudget });
  assert.match(calls[2].prompt, /Mode: Review this scenario before illustration generation\./);
  assert.ok(scenario.pages.every(page => page.status === 'pending'));
});

test('generateScenarioWithMetadataWithModel grounds Greuceanu through the source manifest', async () => {
  const scenarioModule = await import('./scenario.js');
  const calls: Array<{ prompt: string; systemInstruction: string }> = [];

  const generateJSON = async (
    prompt: string,
    systemInstruction: string,
  ): Promise<any> => {
    calls.push({ prompt, systemInstruction });
    if (calls.length === 1) return makeScenario({ targetAge: 5 });
    return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
  };

  const result = await scenarioModule.generateScenarioWithMetadataWithModel(
    'Creeaza povestea lui grauceanu cat mai aproape de original.',
    'ro',
    5,
    'storybook',
    generateJSON as never,
  );

  assert.equal(result.retellingMode, 'faithful_retelling');
  assert.equal(result.retellingSource?.title, 'Greuceanu');
  assert.equal(result.retellingSource?.provider, 'wikisource');
  assert.equal(result.retellingSource?.sourceCacheHit, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].systemInstruction, /Faithful Public-Domain Retelling Rules/);
  assert.match(calls[0].systemInstruction, /Faurul Pământului|Faurul Pamantului/);
  assert.match(calls[0].systemInstruction, /Nu reduce zmeii la un singur zmeu prietenos/);
});

test('generateScenarioWithModel keeps editorial review internal to the writing phase', async () => {
  const scenarioModule = await import('./scenario.js');
  const progressUpdates: Array<{ status: string; currentPhase: string; message: string }> = [];
  let callCount = 0;

  const generateJSON = async (): Promise<any> => {
    callCount += 1;
    if (callCount === 1) {
      return makeScenario();
    }

    return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
  };

  await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
    progress => progressUpdates.push(progress),
  );

  assert.ok(progressUpdates.every(update => update.status !== 'reviewing_scenario'));
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

  const generateJSON = async (prompt: string): Promise<any> => {
    calls.push(prompt);
    if (calls.length === 1) return draftScenario;
    if (calls.length === 2) return stillInvalidRepair;
    if (calls.length === 3) return validSecondRepair;
    return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 4);
  assert.match(calls[2], /Repair pass 2/);
  assert.match(calls[2], /page text is too long for age 3/);
  assert.match(calls[3], /Mode: Review this scenario before illustration generation\./);
  assert.ok(scenario.pages.every(page => page.status === 'pending'));
});

test('generateScenarioWithModel rewrites after editorial review when the reviewer requests changes', async () => {
  const scenarioModule = await import('./scenario.js');
  const calls: string[] = [];

  const draftScenario = makeScenario();
  const rewrittenScenario = makeScenario({
    title: 'Mia and the Brave Kite',
  });

  const generateJSON = async (prompt: string): Promise<any> => {
    calls.push(prompt);
    if (calls.length === 1) return draftScenario;
    if (calls.length === 2) {
      return {
        needsRewrite: true,
        summary: 'The middle pages drift away from the prompt.',
        changedPageNumbers: [3, 4],
        issues: [
          {
            code: 'prompt_fidelity',
            summary: 'Pages 3 and 4 drift from Mia solving the kite problem.',
            pageNumbers: [3, 4],
          },
        ],
      };
    }
    return rewrittenScenario;
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 3);
  assert.match(calls[1], /Mode: Review this scenario before illustration generation\./);
  assert.match(calls[2], /Mode: Rewrite the full scenario JSON after editorial review\./);
  assert.match(calls[2], /prompt_fidelity/);
  assert.equal(scenario.title, 'Mia and the Brave Kite');
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
