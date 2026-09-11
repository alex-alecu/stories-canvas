import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario } from '../../shared/types.js';
import type { StoryPromptContext } from './storyPrompt.js';
import type { TextGenerationOptions } from './openrouter.js';


function makeScenario(text = 'Mara lights the lantern and follows the safe path.'): Scenario {
  return {
    title: 'The Little Lantern',
    targetAge: 4,
    characters: [{
      name: 'Mara',
      role: 'hero',
      appearance: 'A small child with brown eyes and black hair.',
      clothing: 'A red coat and yellow boots.',
      personality: 'Careful and kind.',
      characterSheetPrompt: 'Reference sheet for Mara in a red coat and yellow boots.',
    }],
    pages: Array.from({ length: 6 }, (_, index) => ({
      pageNumber: index + 1,
      text,
      imagePrompt: `Mara in a red coat carries a lantern on page ${index + 1}.`,
      characters: ['Mara'],
      status: 'pending',
    })),
  };
}

const context: StoryPromptContext = {
  language: 'en',
  targetAge: 4,
  pageCount: 6,
  style: 'storybook',
  styleDescription: 'Classic storybook art.',
  userPrompt: 'Tell a clear story about Mara and a lantern.',
};

function review(score: number, major = false) {
  return {
    summary: major ? 'The language is hard to understand.' : 'The script is ready.',
    scores: {
      languageFluency: score,
      childClarity: score,
      narrativeCohesion: score,
      pacing: score,
      pageVisualAlignment: score,
      ageSafety: score,
    },
    issues: major ? [{
      code: 'language_fluency',
      severity: 'major',
      summary: 'Page 3 uses an unclear sentence fragment.',
      pageNumbers: [3],
    }] : [],
  };
}

test('enforceStoryQuality returns one validated correction without another review', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const rewritten = makeScenario('Mara raises the lantern. Its warm light shows the safe path.');
  const outputs: unknown[] = [review(3, true), rewritten, review(4)];
  const efforts: unknown[] = [];
  const result = await enforceStoryQuality(context, makeScenario('Mara path light then go.'), {
    generate: (async (_prompt: string, _system: string, _schema: unknown, options: { reasoningEffort?: unknown }) => {
      efforts.push(options.reasoningEffort);
      return outputs.shift();
    }) as never,
  });

  assert.equal(result.pages[0].text, rewritten.pages[0].text);
  assert.deepEqual(efforts, ['medium', 'high']);
  assert.equal(outputs.length, 1);
});

test('an incomplete review cannot start a paid rewrite with lost findings', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  let calls = 0;
  await assert.rejects(enforceStoryQuality(context, makeScenario(), {
    generate: (async () => {
      calls++;
      return { scores: { naturalLanguageWriting: 4, ageSafety: 3 },
        issues: [{ code: 'age_safety', severity: 'major', description: 'Soften the danger.', page: 3 }] };
    }) as never,
  }), /required format.*before rewriting/);
  assert.equal(calls, 1);
});

test('one correction receives all review findings and the original script', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const original = makeScenario('Mara path light then go.');
  const corrected = makeScenario('Mara holds the lantern above the path. Its light shows where to step.');
  const findings = {
    ...review(3, true),
    issues: [...review(3, true).issues,
      { code: 'image_prompt_alignment', severity: 'major',
        summary: 'The lantern is below the path that it must illuminate.', pageNumbers: [1] },
      { code: 'pacing', severity: 'minor', summary: 'Shorten the repeated setup.', pageNumbers: [2] }],
  };
  const outputs: unknown[] = [findings, corrected];
  const prompts: Record<string, any>[] = [];
  const result = await enforceStoryQuality(context, original, {
    generate: (async (prompt: string) => {
      assert.ok(outputs.length > 0, 'No further review or rewrite may start.');
      prompts.push(JSON.parse(prompt));
      return outputs.shift();
    }) as never,
  });

  assert.equal(result.pages[0].text, corrected.pages[0].text);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].task, 'Correct the supplied review findings in the complete script');
  assert.deepEqual(prompts[1].currentScript, original);
  assert.deepEqual(prompts[1].qualityReview.issues, findings.issues);
});

test('a passing review with no findings needs no correction', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const original = makeScenario();
  let calls = 0;
  const progress: string[] = [];
  const result = await enforceStoryQuality(context, original, {
    onProgress: step => progress.push(step),
    generate: (async () => { calls++; return review(4); }) as never,
  });
  assert.deepEqual(result, original);
  assert.equal(calls, 1);
  assert.deepEqual(progress, ['review']);
});

test('minor findings and low scores without findings each get one correction', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const corrected = makeScenario('Mara lifts the lantern. She follows the path.');
  for (const findings of [
    { ...review(4), issues: [{ code: 'pacing', severity: 'minor',
      summary: 'Shorten the repeated setup.', pageNumbers: [2] }] },
    review(3),
  ]) {
    const outputs: unknown[] = [findings, corrected];
    const progress: string[] = [];
    const result = await enforceStoryQuality(context, makeScenario(), {
      onProgress: step => progress.push(step),
      generate: (async () => {
        assert.ok(outputs.length > 0, 'No further review or rewrite may start.');
        return outputs.shift();
      }) as never,
    });
    assert.equal(result.pages[0].text, corrected.pages[0].text);
    assert.equal(outputs.length, 0);
    assert.deepEqual(progress, ['review', 'rewrite']);
  }
});

function rewriteMissingVisibleCharacter(): Scenario {
  const scenario = makeScenario();
  scenario.characters.push({
    ...scenario.characters[0],
    name: 'Împăratul văduv',
    role: 'father',
    characterSheetPrompt: 'Reference sheet for Împăratul văduv.',
  });
  scenario.pages = Array.from({ length: 12 }, (_, index) => ({
    ...scenario.pages[0], pageNumber: index + 1, characters: ['Mara'],
  }));
  scenario.pages[0].characters.push('Împăratul văduv');
  scenario.pages[0].imagePrompt = 'Mara and Împăratul văduv stand together.';
  scenario.pages[11].imagePrompt = 'Mara shows the lantern to Împăratul văduv.';
  return scenario;
}

const longContext = { ...context, pageCount: 20 };

test('allowed source softening reaches every quality review and correction step', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const softenableBeats = [
    'Omit graphic injuries and violent aftermath.',
    'Present the wolf demise as a non-graphic consequence of the trap.',
  ];
  const retellingContext: StoryPromptContext = {
    ...longContext,
    targetAge: 5,
    userPrompt: 'Retell The Goat and Her Three Kids faithfully for a five-year-old.',
    retellingSource: {
      title: 'The Goat and Her Three Kids',
      author: 'Ion Creangă',
      provider: 'wikisource',
      sourceUrl: 'https://ro.wikisource.org/wiki/Capra_cu_trei_iezi',
      licenseNote: 'Public-domain source.',
      canonicalBeatSheet: {
        requiredCharacters: ['Mother Goat', 'Little Goat', 'Wolf'],
        requiredLocations: ['The goat home'],
        magicalObjects: [],
        identityConstraints: ['The wolf is the antagonist.'],
        eventOrder: ['The youngest goat stays hidden.', 'The mother returns.', 'The trap ends the threat.'],
        canonicalEnding: ['The mother and youngest goat survive; the wolf dies in the trap.'],
        forbiddenSubstitutions: ['Do not add a new rescuer.'],
        softenableBeats,
        fidelityWarnings: ['Keep the cause and result of the trap.'],
      },
    },
  };
  const scenario = makeScenario('The little goat stays hidden until his mother comes home.');
  scenario.targetAge = 5;
  scenario.characters = ['Mother Goat', 'Little Goat', 'Wolf'].map(name => ({
    ...scenario.characters[0], name, characterSheetPrompt: `Reference sheet for ${name}.`,
  }));
  scenario.pages = scenario.characters.map((character, index) => ({
    ...scenario.pages[0], pageNumber: index + 1,
    imagePrompt: `${character.name} beside the goat home.`, characters: [character.name],
  }));
  const invalidRewrite = structuredClone(scenario);
  invalidRewrite.pages[0].imagePrompt = 'Mother Goat and Little Goat beside their home.';
  const corrected = structuredClone(invalidRewrite);
  corrected.pages[0].characters.push('Little Goat');
  const outputs: unknown[] = [review(3, true), invalidRewrite, corrected];
  const requests: Array<{ prompt: Record<string, any>; system: string }> = [];

  await enforceStoryQuality(retellingContext, scenario, {
    generate: (async (prompt: string, system: string) => {
      requests.push({ prompt: JSON.parse(prompt), system });
      return outputs.shift();
    }) as never,
  });

  assert.deepEqual(requests.map(request => request.prompt.task), [
    'Final paid-story quality review',
    'Correct the supplied review findings in the complete script',
    'Correct the validation errors in the rewritten script',
  ]);
  for (const { prompt, system } of requests) {
    assert.deepEqual(prompt.compactSourceRules.softenableBeats, softenableBeats);
    assert.deepEqual(prompt.compactSourceRules.canonicalEnding,
      ['The mother and youngest goat survive; the wolf dies in the trap.']);
    assert.match(system, /non-graphic, age-appropriate adaptation/i);
    assert.match(system, /text and image descriptions/i);
    assert.match(system, /do not demand graphic source details/i);
  }
});

test('a correction repairs a missing page character and returns without another review', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const invalid = rewriteMissingVisibleCharacter();
  const corrected = structuredClone(invalid);
  corrected.pages[11].characters.push('Împăratul văduv');
  const outputs: unknown[] = [review(3, true), invalid, corrected];
  const prompts: Record<string, any>[] = [];
  const requestOptions: TextGenerationOptions[] = [];
  const progress: string[] = [];
  const onReviewUsage = async () => {};
  const onRewriteUsage = async () => {};
  const signal = new AbortController().signal;

  const result = await enforceStoryQuality(longContext, makeScenario(), {
    onReviewUsage, onRewriteUsage, signal,
    onProgress: step => progress.push(step),
    generate: (async (prompt: string, _system: string, _schema: unknown, options: TextGenerationOptions) => {
      assert.ok(outputs.length > 0, 'No further review or rewrite may start.');
      assert.equal(progress.length, requestOptions.length + 1, 'Progress must be sent before each request.');
      prompts.push(JSON.parse(prompt));
      requestOptions.push(options);
      return outputs.shift();
    }) as never,
  });

  assert.deepEqual(result.pages[11].characters, ['Mara', 'Împăratul văduv']);
  assert.equal(prompts.length, 3);
  assert.deepEqual(progress, ['review', 'rewrite', 'validation_repair']);
  assert.deepEqual(prompts[2].validationIssues, [{
    code: 'page.characters.missingVisible', path: 'pages[11].characters',
    message: 'imagePrompt names visible character "Împăratul văduv", so the page characters list must include it',
  }]);
  assert.deepEqual(prompts[2].currentScript.pages[11].characters, ['Mara']);
  assert.equal(prompts[2].originalRequest, context.userPrompt);
  assert.deepEqual(prompts[2].qualityReview, prompts[1].qualityReview);
  assert.equal(requestOptions[0].onUsage, onReviewUsage);
  assert.equal(requestOptions[1].onUsage, onRewriteUsage);
  assert.equal(requestOptions[2].onUsage, onRewriteUsage);
  assert.ok(requestOptions.every(options => options.signal === signal));
});

test('an invalid repair stops and reports its remaining validation errors', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const invalid = rewriteMissingVisibleCharacter();
  const badRepair = structuredClone(invalid);
  badRepair.pages[11].characters.push('Împăratul văduv');
  badRepair.pages[11].text = 'A'.repeat(201);
  const outputs: unknown[] = [review(3, true), invalid, badRepair];
  let calls = 0;
  await assert.rejects(enforceStoryQuality(longContext, makeScenario(), {
    generate: (async () => { calls++; return outputs.shift(); }) as never,
  }), /Quality rewrite failed validation: pages\[11\]\.text: page text is too long/);
  assert.equal(calls, 3);
});

test('cancellation after the review prevents a correction or a successful return', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const cancelled = new Error('Cancelled by the user');
  for (const result of [review(3, true), review(4)]) {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(enforceStoryQuality(context, makeScenario(), {
      signal: controller.signal,
      generate: (async () => {
        calls++;
        controller.abort(cancelled);
        return result;
      }) as never,
    }), error => error === cancelled);
    assert.equal(calls, 1);
  }
});

test('unknown review cost stops before a correction', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const { TextCostUnavailableError } = await import('./openrouter.js');
  const costError = new TextCostUnavailableError('The request cost is unavailable.');
  let calls = 0;
  await assert.rejects(enforceStoryQuality(context, makeScenario(), {
    generate: (async () => {
      calls++;
      throw costError;
    }) as never,
  }), error => error === costError);
  assert.equal(calls, 1);
});

test('cancellation after an invalid rewrite prevents a repair request', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const controller = new AbortController();
  const cancelled = new Error('Cancelled by the user');
  let calls = 0;
  await assert.rejects(enforceStoryQuality(longContext, makeScenario(), {
    signal: controller.signal,
    generate: (async () => {
      if (++calls === 1) return review(3, true);
      controller.abort(cancelled);
      return rewriteMissingVisibleCharacter();
    }) as never,
  }), error => error === cancelled);
  assert.equal(calls, 2);
});

test('a failed repair request stops without another model call', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const { TextCostUnavailableError } = await import('./openrouter.js');
  const costError = new TextCostUnavailableError('The request cost is unavailable.');
  let calls = 0;
  await assert.rejects(enforceStoryQuality(longContext, makeScenario(), {
    generate: (async () => {
      if (++calls === 1) return review(3, true);
      if (calls === 2) return rewriteMissingVisibleCharacter();
      throw costError;
    }) as never,
  }), error => error === costError);
  assert.equal(calls, 3);
});
