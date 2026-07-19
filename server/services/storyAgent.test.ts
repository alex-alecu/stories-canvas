import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scenario } from '../../shared/types.js';
import type { AgentModel } from './agentRuntime.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeScenario(characterCount = 2, tooManySentences = false): Scenario {
  const characters = Array.from({ length: characterCount }, (_, index) => ({
    name: `Friend ${index + 1}`,
    role: index === 0 ? 'protagonist' : 'helper',
    appearance: `Friendly character ${index + 1} with a distinct round silhouette.`,
    clothing: `Solid color scarf ${index + 1}.`,
    personality: 'Kind and patient.',
    characterSheetPrompt: `Front and back character sheet for Friend ${index + 1}.`,
  }));

  return {
    title: 'The Little Lantern',
    targetAge: 4,
    characters,
    pages: Array.from({ length: 6 }, (_, index) => ({
      pageNumber: index + 1,
      text: tooManySentences && index === 2
        ? 'One. Two. Three. Four. Five.'
        : `Friend 1 takes a gentle step on page ${index + 1}.`,
      imagePrompt: `A warm storybook scene for page ${index + 1}, with no text.`,
      characters: [characters[index % characters.length].name],
      status: 'pending',
    })),
  };
}

function toolCall(name: string, args: Record<string, unknown>, id: string) {
  return {
    content: {
      role: 'model' as const,
      parts: [{ functionCall: { id, name, args } }],
    },
    functionCalls: [{ id, name, args }],
  };
}

test('story agent validates revisions and uses prompt-driven independent review results', async () => {
  const { generateStoryScriptWithAgents } = await import('./storyAgent.js');
  const userPrompt = 'Tell a gentle story about a lantern.';
  const invalidScenario = makeScenario(4, true);
  const validScenario = makeScenario();
  const handoff = (scenario: Scenario, cycle: number) => JSON.stringify({
    originalRequest: userPrompt,
    targetAge: 4,
    language: 'en',
    reviewCycle: cycle,
    currentScript: scenario,
  });
  const mainCalls = [
    toolCall('save_story_script', { script: invalidScenario }, 'save-invalid'),
    toolCall('save_story_script', { script: validScenario }, 'save-draft'),
    toolCall('spawn_subagent', {
      task: 'Review the handed-off story script only and report actionable findings.',
      handoff: handoff(validScenario, 1),
    }, 'review-1'),
    toolCall('save_story_script', { script: validScenario }, 'save-review-1'),
    toolCall('spawn_subagent', {
      task: 'Independently review the handed-off story script only and report actionable findings.',
      handoff: handoff(validScenario, 2),
    }, 'review-2'),
    toolCall('save_story_script', { script: validScenario }, 'save-review-2'),
    toolCall('submit_story_script', {}, 'submit'),
  ];
  let mainIndex = 0;
  let subagentsCreated = 0;
  let invalidResponseSeen = false;
  let firstReviewSeen = false;
  let secondReviewSeen = false;
  const progressKinds: string[] = [];

  const modelFactory = (role: 'main' | 'subagent'): AgentModel => {
    if (role === 'subagent') {
      subagentsCreated += 1;
      return async () => toolCall('subagent_exit', {
        result: JSON.stringify({
          needsRewrite: false,
          summary: 'The script is coherent and age appropriate.',
          changedPageNumbers: [],
          issues: [],
        }),
      }, `review-exit-${subagentsCreated}`);
    }

    return async request => {
      if (mainIndex === 1) {
        invalidResponseSeen = request.contents.some(content => content.parts.some(part => {
          const functionResponse = part.functionResponse as { response?: { ok?: boolean; error?: string } } | undefined;
          return functionResponse?.response?.ok === false
            && functionResponse.response.error?.includes('no more than 3 main characters')
            && functionResponse.response.error?.includes('too many sentences');
        }));
      }
      if (mainIndex === 3 || mainIndex === 5) {
        const reviewSeen = request.contents.some(content => content.parts.some(part => {
          const functionResponse = part.functionResponse as { response?: { result?: string } } | undefined;
          return functionResponse?.response?.result?.includes('coherent and age appropriate') ?? false;
        }));
        if (mainIndex === 3) firstReviewSeen = reviewSeen;
        if (mainIndex === 5) secondReviewSeen = reviewSeen;
      }
      const response = mainCalls[mainIndex];
      mainIndex += 1;
      return response;
    };
  };

  const result = await generateStoryScriptWithAgents(
    userPrompt,
    'en',
    4,
    'storybook',
    update => progressKinds.push(update.activity.kind),
    undefined,
    {
      runner: { modelFactory },
      resolveSource: async () => undefined,
    },
  );

  assert.equal(result.scenario.characters.length, 2);
  assert.equal(result.scenario.pages[2].text, validScenario.pages[2].text);
  assert.equal(subagentsCreated, 2);
  assert.equal(mainIndex, mainCalls.length);
  assert.equal(invalidResponseSeen, true);
  assert.equal(firstReviewSeen, true);
  assert.equal(secondReviewSeen, true);
  assert.ok(progressKinds.includes('main_agent'));
  assert.ok(progressKinds.includes('subagent'));
  assert.ok(progressKinds.includes('script'));
});
