import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario } from '../../shared/types.js';
import type { StoryPromptContext } from './storyPrompt.js';


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
