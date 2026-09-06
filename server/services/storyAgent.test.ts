import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { generateStoryScriptWithAgents } from './storyAgent.js';
import { createOpenRouterAgentModel } from './openrouterAgentModel.js';
import { withTextModelSettings } from './textGenerationContext.js';
import { parseTextModelSettings } from '../../shared/textModels.js';
import type { Scenario } from '../../shared/types.js';
import type { TextUsageEvent } from './openrouter.js';

function makeScenario(): Scenario {
  return { title: 'The Little Lantern', targetAge: 4,
    characters: [{ name: 'Mara', role: 'hero', appearance: 'A small child with brown hair.',
      clothing: 'A green coat.', personality: 'Kind.', characterSheetPrompt: 'Mara in a green coat, front and back.' }],
    pages: Array.from({ length: 6 }, (_, i) => ({ pageNumber: i + 1, text: 'Mara lifts the lantern. She can see the path.',
      imagePrompt: 'Mara holds a lantern beside the forest path.', characters: ['Mara'], status: 'pending' })),
  };
}

function fixture(scripts: unknown[], onUsage?: (usage: TextUsageEvent) => void | Promise<void>,
  failures: Array<number | 'disconnect'> = []) {
  const requests: any[] = [];
  const usage: TextUsageEvent[] = [];
  const model = createOpenRouterAgentModel({
    client: new OpenAI({ apiKey: 'local-test', baseURL: 'https://openrouter.test/api/v1' }),
    onUsage: async event => { usage.push(event); await onUsage?.(event); },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const failure = failures[requests.length - 1];
      if (failure === 'disconnect') throw new Error('Connection lost');
      if (failure) return new Response(JSON.stringify({ error: { message: 'Provider busy', code: failure } }),
        { status: failure, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } });
      return new Response(JSON.stringify({ id: `gen-${requests.length}`, model: body.model,
        choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-data' }],
          tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: {
            name: 'submit_story_script', arguments: JSON.stringify({ script: scripts[Math.min(requests.length - 1, scripts.length - 1)] }),
          } }] } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.012345 },
      }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  return { model, requests, usage };
}

test('the official SDK repairs invalid submissions, preserves reasoning, and requires the quality review', async () => {
  const invalid = makeScenario();
  invalid.pages[2].text = 'One. Two. Three. Four. Five.';
  const api = fixture([invalid, makeScenario()]);
  let reviewed = false;
  const progress: string[] = [];
  const result = await generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook',
    update => progress.push(update.activity.kind), undefined, {
      runner: { model: api.model }, resolveSource: async () => undefined,
      enforceQuality: async (_context, scenario) => { reviewed = true; return scenario; },
    });
  assert.equal(result.scenario.pages.length, 6);
  assert.equal(reviewed, true);
  assert.ok(progress.includes('subagent'));
  assert.equal(api.requests.length, 2);
  const toolResult = api.requests[1].messages.find((message: any) => message.role === 'tool');
  assert.match(toolResult.content, /too many sentences/);
  assert.equal(toolResult.tool_call_id, 'call-1');
  const previous = api.requests[1].messages.find((message: any) => message.tool_calls);
  assert.deepEqual(previous.reasoning_details, [{ type: 'reasoning.encrypted', data: 'opaque-data' }]);
  assert.equal(api.usage.length, 2);
  assert.equal(api.usage[0].usageDetails.providerCostUsd, 0.012345);
  assert.deepEqual(api.requests[0].reasoning, { effort: 'medium' });
  assert.equal('parallel_tool_calls' in api.requests[0], false);
});

test('Fable uses the selected model without unsupported tool options', async () => {
  await withTextModelSettings(parseTextModelSettings('anthropic/claude-fable-5.1', 'high'), async () => {
    const api = fixture([makeScenario()]);
    await generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined, {
      runner: { model: api.model }, resolveSource: async () => undefined, enforceQuality: async (_context, scenario) => scenario,
    });
    assert.equal(api.requests[0].model, 'anthropic/claude-fable-5.1');
    assert.equal('tool_choice' in api.requests[0], false);
    assert.equal('parallel_tool_calls' in api.requests[0], false);
    assert.deepEqual(api.requests[0].reasoning, { effort: 'high' });
  });
});

test('a failed cost write stops the SDK before tool execution or another paid request', async () => {
  const api = fixture([makeScenario()], () => { throw new Error('Database unavailable'); });
  let reviewed = false;
  await assert.rejects(generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined, {
    runner: { model: api.model }, resolveSource: async () => undefined,
    enforceQuality: async (_context, scenario) => { reviewed = true; return scenario; },
  }), /Database unavailable/);
  assert.equal(api.requests.length, 1);
  assert.equal(api.usage.length, 1);
  assert.equal(reviewed, false);
});

test('the SDK retries confirmed temporary HTTP failures and records each attempt', async () => {
  const api = fixture([makeScenario()], undefined, [429, 503]);
  await generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined, {
    runner: { model: api.model }, resolveSource: async () => undefined, enforceQuality: async (_context, scenario) => scenario,
  });
  assert.equal(api.requests.length, 3);
  assert.deepEqual(api.usage.map(event => event.status), ['failed', 'failed', 'succeeded']);
  assert.equal(api.usage[2].usageDetails.providerCostUsd, 0.012345);
});

test('retry limits and unknown connection outcomes stop further requests', async () => {
  for (const failures of [[503, 503, 503], ['disconnect']] as Array<Array<number | 'disconnect'>>) {
    const api = fixture([makeScenario()], undefined, failures);
    await assert.rejects(generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined, {
      runner: { model: api.model }, resolveSource: async () => undefined,
    }), /Provider busy|Connection/i);
    assert.equal(api.requests.length, failures.length);
    assert.equal(api.usage.length, failures.length);
  }
});

test('invalid scripts stop at the SDK turn limit', async () => {
  const api = fixture([{}]);
  await assert.rejects(generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined, {
    runner: { model: api.model }, resolveSource: async () => undefined,
  }), /Max turns|maximum.*turn|turn.*exceeded/i);
  assert.equal(api.requests.length, 6);
});

test('cancellation reaches the active SDK request', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const model = createOpenRouterAgentModel({
    client: new OpenAI({ apiKey: 'local-test', baseURL: 'https://openrouter.test/api/v1' }),
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      started();
    }),
  });
  const pending = generateStoryScriptWithAgents('A child finds a lantern.', 'en', 4, 'storybook', undefined, undefined,
    { runner: { model }, resolveSource: async () => undefined }, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, /abort|cancel/i);
  assert.equal(calls, 1);
});
