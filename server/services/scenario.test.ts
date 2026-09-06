import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario, Page } from '../../shared/types.js';


function makeValidPages(count = 10): Page[] {
  const basePages: Page[] = [
    { pageNumber: 1, text: 'Mia loved the red kite that whooshed over her garden.', imagePrompt: 'Prompt 1', characters: ['Mia'], status: 'pending' },
    { pageNumber: 2, text: 'A gust of wind tugged the string and whisked the kite away.', imagePrompt: 'Prompt 2', characters: ['Mia'], status: 'pending' },
    { pageNumber: 3, text: 'Mia ran after it, but her first jump was too small.', imagePrompt: 'Prompt 3', characters: ['Mia'], status: 'pending' },
    { pageNumber: 4, text: 'She asked Pip the rabbit for help, but the branch still shook.', imagePrompt: 'Prompt 4', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 5, text: 'Then Mia stacked two boxes, climbed carefully, and reached the knot.', imagePrompt: 'Prompt 5', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 6, text: 'The kite fluttered free, but its tail had twisted into a loop.', imagePrompt: 'Prompt 6', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 7, text: 'Pip held the string while Mia smoothed every ribbon flat.', imagePrompt: 'Prompt 7', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 8, text: 'They counted to three and gave the kite a gentle toss.', imagePrompt: 'Prompt 8', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 9, text: 'This time it climbed high and painted loops in the sky.', imagePrompt: 'Prompt 9', characters: ['Mia', 'Pip'], status: 'pending' },
    { pageNumber: 10, text: 'Back on the grass, Mia shared the breeze with Pip.', imagePrompt: 'Prompt 10', characters: ['Mia', 'Pip'], status: 'pending' },
  ];

  if (count <= basePages.length) {
    return basePages.slice(0, count);
  }

  return [
    ...basePages,
    ...Array.from({ length: count - basePages.length }, (_, index) => {
      const pageNumber = basePages.length + index + 1;
      return {
        pageNumber,
        text: `Mia and Pip followed one more bright clue on page ${pageNumber}.`,
        imagePrompt: `Prompt ${pageNumber}`,
        characters: ['Mia', 'Pip'],
        status: 'pending' as const,
      };
    }),
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
  const agentInstruction = storyPrompt.buildStoryAgentSystemInstruction(context);
  const draftPrompt = storyPrompt.buildDraftScenarioPrompt(context);

  assert.match(systemInstruction, /Age 6 Scenario Prompt/);
  assert.match(systemInstruction, /Required Story Shape/);
  assert.match(systemInstruction, /grounded conflict, active problem-solving, and a dramatic but child-safe reversal/i);
  assert.match(systemInstruction, /Character types may be children, adults, elders, families, animals/i);
  assert.match(systemInstruction, /Keep generic adventures, fantasies, retellings, and other premises generic/i);
  assert.match(systemInstruction, /current fear, worry, separation, transition, social conflict, or mistake/i);
  assert.match(systemInstruction, /never shame, tease, dismiss, test, or force the child into bravery/i);
  assert.match(systemInstruction, /end the final page text with that sentence verbatim/i);
  assert.match(systemInstruction, /Write the title, page text, character names, roles, and personality descriptions in English/);
  assert.match(systemInstruction, /except for any exact wording the user explicitly requires verbatim/i);
  assert.match(systemInstruction, /keep the exact spelling from characters\[\]\.name whenever you mention a character/i);
  assert.match(systemInstruction, /keep appearance, clothing, characterSheetPrompt, and imagePrompt visually originalized/i);
  assert.doesNotMatch(agentInstruction, /sub-?agent|spawn_subagent/i);
  assert.match(agentInstruction, /fresh, independent review/i);
  assert.match(agentInstruction, /original request, target age, language/i);
  assert.match(agentInstruction, /exact required final wording/i);
  assert.match(agentInstruction, /Apply the review yourself/);
  assert.match(draftPrompt, /Target age: 6/);
  assert.match(draftPrompt, /Return no more than 10 pages, numbered sequentially from 1/);
  assert.match(draftPrompt, /Classic hand-drawn storybook illustration/);
  assert.match(draftPrompt, /If the system context includes Faithful Public-Domain Retelling Rules, adapt that source faithfully/);
  assert.match(draftPrompt, /A brave bunny follows a lantern through the rain\./);
});

test('story prompts preserve everyday child scenarios and an exact requested ending', async () => {
  const storyPrompt = await import('./storyPrompt.js');
  const situations = [
    'First day at kindergarten',
    'Being afraid of the dark',
    'Sharing a favourite toy',
    'Visiting the dentist',
    'Missing a parent',
    'Making a new friend',
    'Welcoming a sibling',
    'Learning to apologise',
  ];
  const requiredEnding = 'Create a version about your child.';

  for (const situation of situations) {
    const userRequest = `${situation}\n\nEach story should end with: “${requiredEnding}”`;
    const context = storyPrompt.buildStoryPromptContext(userRequest, 'en', 4, 'storybook');
    const draftPrompt = storyPrompt.buildDraftScenarioPrompt(context);
    const reviewPrompt = storyPrompt.buildScenarioReviewPrompt(context, makeScenario({ targetAge: 4 }));

    assert.match(draftPrompt, new RegExp(situation));
    assert.match(draftPrompt, new RegExp(requiredEnding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(reviewPrompt, /verify that the final page text ends with it verbatim/i);
    assert.match(reviewPrompt, new RegExp(situation));
    assert.match(reviewPrompt, new RegExp(requiredEnding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
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
        sourceAnalysisVersion: 2,
        requiredCharacters: ['Greuceanu', 'Imparatul Rosu', 'Faurul Pamantului'],
        requiredLocations: ['curtea imparatului'],
        magicalObjects: ['soarele si luna furate'],
        identityConstraints: ['Greuceanu ramane viteaz matur, nu copil.'],
        eventOrder: ['zmeii fura lumina', 'Greuceanu infrange zmeii', 'lumina revine'],
        canonicalEnding: ['Lumina revine pe cer.'],
        forbiddenSubstitutions: ['Nu inlocui zmeii cu un singur zmeu prietenos.'],
        softenableBeats: ['Luptele pot fi non-grafice.'],
        fidelityWarnings: ['Pastreaza recuperarea soarelui si lunii.'],
      },
    },
  );

  const systemInstruction = storyPrompt.buildStorySystemInstruction(context);
  const reviewPrompt = storyPrompt.buildScenarioReviewPrompt(context, makeScenario({ targetAge: 5 }));

  assert.match(systemInstruction, /Faithful Public-Domain Retelling Rules/);
  assert.match(systemInstruction, /Use up to 20 pages/);
  assert.match(systemInstruction, /Title: Greuceanu/);
  assert.match(systemInstruction, /Provider: wikisource/);
  assert.match(systemInstruction, /Faurul Pamantului/);
  assert.match(systemInstruction, /Greuceanu ramane viteaz matur, nu copil/);
  assert.match(systemInstruction, /Lumina revine pe cer/);
  assert.match(systemInstruction, /Nu inlocui zmeii cu un singur zmeu prietenos/);
  assert.match(systemInstruction, /small-cast preference for original stories does not override source fidelity/i);
  assert.match(reviewPrompt, /Mode: Deep editorial review before final script\./);
  assert.match(reviewPrompt, /A simpler adaptation is acceptable; a shortcut that weakens causality is not/);
  assert.match(reviewPrompt, /Flag missing native diacritics/);
  assert.match(reviewPrompt, /do not demand visual perfection/);
});

test('deep scenario review prompt stays concise and targets script quality', async () => {
  const storyPrompt = await import('./storyPrompt.js');
  const context = storyPrompt.buildStoryPromptContext(
    'Creează Povestea porcului, urmează originalul exact.',
    'ro',
    7,
    'storybook',
  );

  const reviewPrompt = storyPrompt.buildScenarioReviewPrompt(context, makeScenario({ targetAge: 7 }));
  const instructionBlock = reviewPrompt.replace(/\r\n/g, '\n').split('\n\nTarget age:')[0];

  assert.ok(instructionBlock.split('\n').length < 30);
  assert.match(instructionBlock, /Flag missing native diacritics/);
  assert.match(instructionBlock, /antagonist has clear identity, motive, obstacle behavior, and final consequence/);
  assert.match(instructionBlock, /earned struggle, agency, consequence, or emotional payoff/);
  assert.match(instructionBlock, /do not demand visual perfection/);
});

test('story page limit uses 10 pages by default and 20 for faithful or complex stories', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  const shortRetelling = storyPrompt.resolveScenarioPageCount('', {
    title: 'Short Tale',
    provider: 'wikisource',
    sourceUrl: 'https://example.test/short',
    licenseNote: 'Public domain.',
    canonicalBeatSheet: {
      sourceAnalysisVersion: 2,
      requiredCharacters: ['hero'],
      requiredLocations: ['home'],
      magicalObjects: [],
      eventOrder: ['opening', 'test', 'ending'],
      canonicalEnding: ['ending'],
      forbiddenSubstitutions: [],
      softenableBeats: [],
      fidelityWarnings: [],
    },
  });
  const longRetelling = storyPrompt.resolveScenarioPageCount('', {
    title: 'Long Tale',
    provider: 'wikisource',
    sourceUrl: 'https://example.test/long',
    licenseNote: 'Public domain.',
    canonicalBeatSheet: {
      sourceAnalysisVersion: 2,
      requiredCharacters: Array.from({ length: 10 }, (_, index) => `character ${index}`),
      requiredLocations: Array.from({ length: 8 }, (_, index) => `location ${index}`),
      magicalObjects: Array.from({ length: 6 }, (_, index) => `object ${index}`),
      eventOrder: Array.from({ length: 14 }, (_, index) => `event ${index}`),
      canonicalEnding: ['ending'],
      forbiddenSubstitutions: [],
      softenableBeats: [],
      fidelityWarnings: [],
    },
  });

  assert.equal(storyPrompt.resolveScenarioPageCount(), 10);
  assert.equal(storyPrompt.resolveScenarioPageCount('A sleepy moon helps a child rest.'), 10);
  assert.equal(storyPrompt.resolveScenarioPageCount('A complex dragon quest across a magic kingdom.'), 20);
  assert.equal(shortRetelling, 20);
  assert.equal(longRetelling, 20);
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
  assert.match(systemInstruction, /Do not put readable or pseudo-readable text, letters, symbols, labels, captions/);
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

test('story generator template keeps the reusable prompt guidance', async () => {
  const storyPrompt = await import('./storyPrompt.js');

  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Write an original \{\{language\}\} story for children age \{\{age\}\}\./);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Center it on one clear problem, quest, or test\./);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /Keep danger gentle and non-graphic/);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /\{\{output_contract\}\}/);
  assert.match(storyPrompt.STORY_GENERATOR_TEMPLATE, /\{\{user_prompt\}\}/);
});

test('generateScenarioWithModel uses draft, repair, deep review, and apply settings in order', async () => {
  const scenarioModule = await import('./scenario.js');
  const { config } = await import('../config.js');
  const calls: Array<{ prompt: string; options?: { temperature?: number; reasoningEffort?: string } }> = [];

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
    options?: { temperature?: number; reasoningEffort?: string },
  ): Promise<any> => {
    calls.push({ prompt, options });
    if (calls.length === 1) return invalidDraft;
    if (calls.length === 2) return repairedScenario;
    if (calls.length === 3) return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
    return repairedScenario;
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm adventure story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 4);
  assert.equal(calls[0].options?.temperature, undefined);
  assert.equal(calls[0].options?.reasoningEffort, 'high');
  assert.equal(calls[1].options?.temperature, undefined);
  assert.equal(calls[1].options?.reasoningEffort, 'high');
  assert.match(calls[1].prompt, /Validation issues to fix:/);
  assert.match(calls[1].prompt, /targetAge must match the requested age of 3/);
  assert.match(calls[1].prompt, /pageNumber must be 2/);
  assert.equal(calls[2].options?.temperature, undefined);
  assert.equal(calls[2].options?.reasoningEffort, 'high');
  assert.match(calls[2].prompt, /Mode: Deep editorial review before final script\./);
  assert.equal(calls[3].options?.temperature, undefined);
  assert.equal(calls[3].options?.reasoningEffort, 'high');
  assert.match(calls[3].prompt, /Mode: Apply the deep editorial review to produce the final scenario JSON\./);
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
    if (calls.length === 1) return makeScenario({ targetAge: 5, pages: makeValidPages(16) });
    if (calls.length === 2) return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
    return makeScenario({ targetAge: 5, pages: makeValidPages(16) });
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
  assert.equal(result.pageCount, 20);
  assert.equal(result.scenario.pages.length, 16);
  assert.equal(calls.length, 3);
  assert.match(calls[0].systemInstruction, /Faithful Public-Domain Retelling Rules/);
  assert.match(calls[0].systemInstruction, /Faurul Pământului|Faurul Pamantului/);
  assert.match(calls[0].systemInstruction, /Nu reduce zmeii la un singur zmeu prietenos/);
  assert.match(calls[0].systemInstruction, /Canonical ending/);
});

test('generateScenarioWithMetadataWithModel grounds Harap-Alb with canonical identity and ending', async () => {
  const scenarioModule = await import('./scenario.js');
  const calls: Array<{ prompt: string; systemInstruction: string }> = [];

  const generateJSON = async (
    prompt: string,
    systemInstruction: string,
  ): Promise<any> => {
    calls.push({ prompt, systemInstruction });
    if (calls.length === 1) return makeScenario({ targetAge: 5, title: 'Povestea lui Harap-Alb', pages: makeValidPages(20) });
    if (calls.length === 2) return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
    return makeScenario({ targetAge: 5, title: 'Povestea lui Harap-Alb', pages: makeValidPages(20) });
  };

  const result = await scenarioModule.generateScenarioWithMetadataWithModel(
    'Adapteaza fidel Povestea lui Harap-Alb cat mai aproape de original',
    'ro',
    5,
    'storybook',
    generateJSON as never,
  );

  assert.equal(result.retellingMode, 'faithful_retelling');
  assert.equal(result.retellingSource?.title, 'Povestea lui Harap-Alb');
  assert.equal(result.retellingSource?.sourceCacheHit, true);
  assert.equal(result.pageCount, 20);
  assert.equal(result.scenario.pages.length, 20);
  assert.match(calls[0].systemInstruction, /Harap-Alb este fiul cel mic al craiului/);
  assert.match(calls[0].systemInstruction, /nu un baietel mic/);
  assert.match(calls[0].systemInstruction, /Gerilă/);
  assert.match(calls[0].systemInstruction, /fata Împăratului Roș/);
  assert.match(calls[0].systemInstruction, /apa vie/);
  assert.match(calls[0].systemInstruction, /nunta/);
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

    if (callCount === 2) return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };

    return makeScenario();
  };

  await scenarioModule.generateScenarioWithModel(
    'Tell a warm adventure story about Mia and a kite.',
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
    if (calls.length === 4) return {
      needsRewrite: false,
      summary: 'Scenario is already strong.',
      changedPageNumbers: [],
      issues: [],
    };
    return validSecondRepair;
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm adventure story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 5);
  assert.match(calls[2], /Repair pass 2/);
  assert.match(calls[2], /page text is too long for age 3/);
  assert.match(calls[3], /Mode: Deep editorial review before final script\./);
  assert.match(calls[4], /Mode: Apply the deep editorial review to produce the final scenario JSON\./);
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
    'Tell a warm adventure story about Mia and a kite.',
    'en',
    3,
    'storybook',
    generateJSON as never,
  );

  assert.equal(calls.length, 3);
  assert.match(calls[1], /Mode: Deep editorial review before final script\./);
  assert.match(calls[2], /Mode: Apply the deep editorial review to produce the final scenario JSON\./);
  assert.match(calls[2], /prompt_fidelity/);
  assert.equal(scenario.title, 'Mia and the Brave Kite');
  assert.ok(scenario.pages.every(page => page.status === 'pending'));
});

test('generateScenarioWithModel fails after the second repair if validation issues remain', async () => {
  const scenarioModule = await import('./scenario.js');

  const invalidScenario = makeScenario({
    pages: makeValidPages().map((page, index) => index === 0
      ? {
          ...page,
          imagePrompt: '',
        }
      : page),
  });

  const generateJSON = async (): Promise<Scenario> => invalidScenario;

  await assert.rejects(
    () => scenarioModule.generateScenarioWithModel(
      'Tell a warm adventure story about Mia and a kite.',
      'en',
      3,
      'storybook',
      generateJSON as never,
    ),
    /Scenario failed validation after repair: pages\[0\]\.imagePrompt: imagePrompt must not be empty/,
  );
});

test('generateScenarioWithModel applies deterministic text repair after model repairs keep page text over age limits', async () => {
  const scenarioModule = await import('./scenario.js');
  const {
    getScenarioTextRules,
    OVERLAY_SAFE_MAX_CHARS,
    validateScenario,
  } = await import('./scenarioValidation.js');
  const calls: string[] = [];
  const tooManySentences = 'Mia saw the kite. It dipped low. Pip waved. The string slipped. Mia took a breath.';
  const tooLongPageText = 'Mia carefully described every bright ribbon on the kite while Pip held the spool beside the garden gate '.repeat(4).trim();

  const invalidTextScenario = makeScenario({
    targetAge: 5,
    pages: makeValidPages().map((page, index) => {
      if (index === 1) {
        return {
          ...page,
          text: tooManySentences,
        };
      }

      if (index === 2) {
        return {
          ...page,
          text: tooLongPageText,
        };
      }

      return page;
    }),
  });

  const generateJSON = async (prompt: string): Promise<any> => {
    calls.push(prompt);
    if (calls.length <= 3) return invalidTextScenario;
    if (calls.length === 4) return {
      needsRewrite: false,
      summary: 'Scenario is ready after deterministic text repair.',
      changedPageNumbers: [],
      issues: [],
    };
    return makeScenario({
      targetAge: 5,
      pages: makeValidPages().map((page, index) => {
        if (index === 1) {
          return {
            ...page,
            text: 'Mia saw the kite. It dipped low. Pip waved. The string slipped.',
          };
        }

        if (index === 2) {
          return {
            ...page,
            text: 'Mia carefully described every bright ribbon while Pip held the spool beside the garden gate.',
          };
        }

        return page;
      }),
    });
  };

  const scenario = await scenarioModule.generateScenarioWithModel(
    'Tell a warm adventure story about Mia and a kite.',
    'en',
    5,
    'storybook',
    generateJSON as never,
  );
  const textRules = getScenarioTextRules(5);

  assert.equal(calls.length, 5);
  assert.match(calls[2], /Repair pass 2/);
  assert.match(calls[3], /Mode: Deep editorial review before final script\./);
  assert.match(calls[4], /Mode: Apply the deep editorial review to produce the final scenario JSON\./);
  assert.equal(scenario.pages[1].text, 'Mia saw the kite. It dipped low. Pip waved. The string slipped.');
  assert.equal(scenario.pages[1].imagePrompt, 'Prompt 2');
  assert.deepEqual(scenario.pages[1].characters, ['Mia']);
  assert.ok(scenario.pages[2].text.length <= Math.min(textRules.maxChars, OVERLAY_SAFE_MAX_CHARS));
  assert.deepEqual(validateScenario(scenario, 5), []);
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

test('validateScenario rejects a visible named character missing from the page character list', async () => {
  const { validateScenario } = await import('./scenarioValidation.js');
  const scenario = makeScenario({
    pages: makeValidPages().map((page, index) => index === 1
      ? {
          ...page,
          imagePrompt: 'Mia and Pip hold the kite together in the garden.',
          characters: ['Mia'],
        }
      : page),
  });

  const issues = validateScenario(scenario, scenario.targetAge);
  assert.ok(issues.some(issue => issue.code === 'page.characters.missingVisible'));
});

test('validateScenario keeps original casts small but allows expanded retelling casts', async () => {
  const {
    MAX_RETELLING_SCENARIO_CHARACTERS,
    validateScenario,
  } = await import('./scenarioValidation.js');

  const retellingCastScenario = makeScenario({
    characters: [
      ...makeScenario().characters,
      {
        name: 'Magic Horse',
        role: 'canonical helper',
        appearance: 'Tall chestnut horse with bright eyes.',
        clothing: 'Simple woven reins.',
        personality: 'Wise and loyal.',
        characterSheetPrompt: 'Character sheet prompt for Magic Horse.',
      },
      {
        name: "Red Emperor's Daughter",
        role: 'canonical princess',
        appearance: 'Young royal woman with long dark hair.',
        clothing: 'Red embroidered court dress.',
        personality: 'Clever and brave.',
        characterSheetPrompt: "Character sheet prompt for Red Emperor's Daughter.",
      },
    ],
    pages: makeValidPages().map((page, index) => index === 2
      ? { ...page, characters: ['Mia', 'Pip', 'Magic Horse'] }
      : index === 4
        ? { ...page, characters: ['Mia', 'Pip', "Red Emperor's Daughter"] }
        : page),
  });

  const originalIssues = validateScenario(retellingCastScenario, 3);
  const retellingIssues = validateScenario(retellingCastScenario, 3, {
    maxCharacters: MAX_RETELLING_SCENARIO_CHARACTERS,
  });

  assert.ok(originalIssues.some(issue => issue.code === 'characters.max'));
  assert.ok(!retellingIssues.some(issue => issue.code === 'characters.max'));
});

test('validateScenario accepts page counts up to the requested limit', async () => {
  const { validateScenario } = await import('./scenarioValidation.js');

  const scenario = makeScenario({ pages: makeValidPages(14) });
  const shortScenario = makeScenario({ pages: makeValidPages(6) });

  assert.ok(validateScenario(scenario, 3).some(issue => issue.code === 'pages.range'));
  assert.deepEqual(validateScenario(shortScenario, 3), []);
  assert.deepEqual(validateScenario(scenario, 3, { pageCount: 14 }), []);
});
