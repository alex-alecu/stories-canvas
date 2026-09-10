import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import type { Scenario } from '../../shared/types.js';
import { parseTextModelSettings } from '../../shared/textModels.js';
import { generateJSON, type TextUsageEvent } from './openrouter.js';
import { createOpenRouterAgentModel } from './openrouterAgentModel.js';
import { runStoryAgent } from './storyAgentRunner.js';
import { storyScriptSchema } from './storyScriptSchema.js';
import { validateScenario } from './scenarioValidation.js';
import { withTextModelSettings } from './textGenerationContext.js';

const scenario: Scenario = {
  title: 'The Little Lantern',
  targetAge: 5,
  characters: [{ name: 'Mara', role: 'hero', appearance: 'A child with brown hair.',
    clothing: 'A green coat.', personality: 'Kind.', characterSheetPrompt: 'Mara in a green coat.' }],
  pages: Array.from({ length: 20 }, (_, index) => ({ pageNumber: index + 1,
    text: 'Mara lifts the lantern. Its light shows the path home.',
    imagePrompt: 'Mara holds a lantern beside the forest path.', characters: ['Mara'], status: 'pending' })),
};

type Adapter = 'json' | 'agent';
const recordedWorkloads = [
  // Reasoning from the failed Sarea rewrite plus visible output from its complete draft.
  { model: 'openai/gpt-6-astra', reasoningTokens: 16_023, storyTokens: 13_196 },
  // Apply the same complete-story workload to the reasoning observed in the Capra failure.
  { model: 'google/gemini-3.8-flash', reasoningTokens: 19_718, storyTokens: 13_196 },
];

function providerFixture(adapter: Adapter, workload: typeof recordedWorkloads[number], forceLimit = false) {
  const requests: Array<Record<string, any>> = [];
  const usage: TextUsageEvent[] = [];
  const fetchResponse: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const budget = Number(body.max_tokens ?? body.max_completion_tokens);
    const requiredTokens = workload.reasoningTokens + workload.storyTokens;
    const truncated = forceLimit || !Number.isFinite(budget) || budget < requiredTokens;
    const completionTokens = truncated ? budget : requiredTokens;
    const message = adapter === 'agent'
      ? { role: 'assistant', content: null, ...(truncated ? {} : {
          tool_calls: [{ id: 'call-story', type: 'function', function: {
            name: 'submit_story_script', arguments: JSON.stringify({ script: scenario }),
          } }],
        }) }
      : { role: 'assistant', content: truncated ? '{"title":' : JSON.stringify(scenario) };
    return Response.json({ id: 'gen-story', model: body.model,
      choices: [{ index: 0, finish_reason: truncated ? 'length' : adapter === 'agent' ? 'tool_calls' : 'stop',
        native_finish_reason: truncated ? 'max_output_tokens' : 'stop', message }],
      usage: { prompt_tokens: 18_710, completion_tokens: completionTokens,
        total_tokens: 18_710 + completionTokens, cost: 1.4338675,
        completion_tokens_details: { reasoning_tokens: workload.reasoningTokens } },
    });
  };
  const client = new OpenAI({ apiKey: 'local-test', baseURL: 'https://openrouter.test/api/v1', fetch: fetchResponse });
  const record = (event: TextUsageEvent) => { usage.push(event); };
  const run = () => withTextModelSettings(parseTextModelSettings(workload.model, 'high'), async () => {
    if (adapter === 'json') {
      return generateJSON<Scenario>('Rewrite the complete story.', 'Keep every page complete.',
        storyScriptSchema as unknown as Record<string, unknown>, { client, maxRetries: 3, onUsage: record });
    }
    return runStoryAgent({
      systemInstruction: 'Write a complete story and submit it.', initialPrompt: 'A twenty-page lantern story.',
      dependencies: { model: createOpenRouterAgentModel({ client, fetch: fetchResponse, onUsage: record }) },
      validate: value => {
        const candidate = value as Scenario;
        const issues = validateScenario(candidate, 5, { pageCount: 20 });
        return issues.length ? { error: JSON.stringify(issues) } : { scenario: candidate };
      },
    });
  });
  return { requests, usage, run };
}

for (const adapter of ['json', 'agent'] as const) {
  test(`${adapter} completes a full story with room for the recorded reasoning workload`, async () => {
    for (const workload of recordedWorkloads) {
      const api = providerFixture(adapter, workload);
      assert.deepEqual(await api.run(), scenario);
      assert.equal(api.requests.length, 1);
      assert.equal(api.requests[0].model, workload.model);
      assert.deepEqual(api.requests[0].reasoning, { effort: 'high' });
      assert.equal(api.usage.length, 1);
      assert.equal(api.usage[0].status, 'succeeded');
      assert.equal(api.usage[0].usageDetails.providerCostUsd, 1.4338675);
    }
  });

  test(`${adapter} records a remaining output limit and stops without a second paid request`, async () => {
    const api = providerFixture(adapter, recordedWorkloads[0], true);
    await assert.rejects(api.run(), (error: Error) => error.name === 'TextOutputLimitError'
      && error.message === 'The model reached its response length limit. Please try a shorter story.');
    assert.equal(api.requests.length, 1);
    assert.equal(api.usage.length, 1);
    assert.equal(api.usage[0].status, 'failed');
    assert.equal(api.usage[0].usageDetails.finishReason, 'length');
    assert.equal(api.usage[0].usageDetails.nativeFinishReason, 'max_output_tokens');
    assert.equal(api.usage[0].usageDetails.providerCostUsd, 1.4338675);
  });
}
