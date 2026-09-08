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

test('enforceStoryQuality performs one controlled rewrite and requires a passing final review', async () => {
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
  assert.deepEqual(efforts, ['medium', 'high', 'medium']);
  assert.equal(outputs.length, 0);
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

test('enforceStoryQuality fails closed when the rewritten script still has a major issue', async () => {
  const { enforceStoryQuality, StoryQualityError } = await import('./storyQualityGate.js');
  const outputs: unknown[] = [review(2, true), makeScenario('Still unclear.'), review(3, true)];

  await assert.rejects(
    enforceStoryQuality(context, makeScenario('Unclear.'), {
      generate: (async () => outputs.shift()) as never,
    }),
    (error: unknown) => error instanceof StoryQualityError
      && /failed the final quality gate/i.test(error.message),
  );
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

test('a quality rewrite can correct a missing page character before its final review', async () => {
  const { enforceStoryQuality } = await import('./storyQualityGate.js');
  const invalid = rewriteMissingVisibleCharacter();
  const corrected = structuredClone(invalid);
  corrected.pages[11].characters.push('Împăratul văduv');
  const outputs: unknown[] = [review(3, true), invalid, corrected, review(4)];
  const prompts: Record<string, any>[] = [];
  const requestOptions: TextGenerationOptions[] = [];
  const onRewriteUsage = async () => {};
  const signal = new AbortController().signal;

  const result = await enforceStoryQuality(longContext, makeScenario(), {
    onRewriteUsage, signal,
    generate: (async (prompt: string, _system: string, _schema: unknown, options: TextGenerationOptions) => {
      prompts.push(JSON.parse(prompt));
      requestOptions.push(options);
      return outputs.shift();
    }) as never,
  });

  assert.deepEqual(result.pages[11].characters, ['Mara', 'Împăratul văduv']);
  assert.equal(prompts.length, 4);
  assert.deepEqual(prompts[2].validationIssues, [{
    code: 'page.characters.missingVisible', path: 'pages[11].characters',
    message: 'imagePrompt names visible character "Împăratul văduv", so the page characters list must include it',
  }]);
  assert.deepEqual(prompts[2].currentScript.pages[11].characters, ['Mara']);
  assert.equal(prompts[2].originalRequest, context.userPrompt);
  assert.deepEqual(prompts[2].qualityReview, prompts[1].qualityReview);
  assert.equal(requestOptions[2].onUsage, onRewriteUsage);
  assert.equal(requestOptions[2].signal, signal);
  assert.deepEqual(prompts[3].script.pages[11].characters, ['Mara', 'Împăratul văduv']);
});

test('an invalid repair stops before quality review and reports its remaining errors', async () => {
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

test('a repaired rewrite still must pass the final quality review', async () => {
  const { enforceStoryQuality, StoryQualityError } = await import('./storyQualityGate.js');
  const invalid = rewriteMissingVisibleCharacter();
  const corrected = structuredClone(invalid);
  corrected.pages[11].characters.push('Împăratul văduv');
  const outputs: unknown[] = [review(3, true), invalid, corrected, review(3, true)];
  let calls = 0;
  await assert.rejects(enforceStoryQuality(longContext, makeScenario(), {
    generate: (async () => { calls++; return outputs.shift(); }) as never,
  }), StoryQualityError);
  assert.equal(calls, 4);
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
