import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SUBAGENTS_PER_AGENT,
  runAgent,
  type AgentModel,
  type AgentModelRequest,
  type AgentTool,
  type SubagentSpawnRequest,
} from './agentRuntime.js';

function modelToolCall(name: string, args: Record<string, unknown>, id: string) {
  return {
    content: {
      role: 'model' as const,
      parts: [{ functionCall: { id, name, args } }],
    },
    functionCalls: [{ id, name, args }],
  };
}

function modelToolCalls(calls: Array<{ name: string; args: Record<string, unknown>; id: string }>) {
  return {
    content: {
      role: 'model' as const,
      parts: calls.map(call => ({ functionCall: call })),
    },
    functionCalls: calls,
  };
}

test('runAgent exposes remaining turns and completes only through a terminal tool', async () => {
  const requests: Parameters<AgentModel>[0][] = [];
  let modelTurn = 0;
  const model: AgentModel = async request => {
    requests.push(request);
    modelTurn += 1;
    return modelTurn === 1
      ? modelToolCall('work', { value: 2 }, 'work-1')
      : modelToolCall('finish', {}, 'finish-1');
  };
  const tools: Array<AgentTool<{ total: number }, number>> = [
    {
      name: 'work',
      description: 'Do work',
      parameters: { type: 'OBJECT', properties: { value: { type: 'INTEGER' } } },
      execute: (args, context) => {
        context.total += Number(args.value);
        return { response: { ok: true, total: context.total } };
      },
    },
    {
      name: 'finish',
      description: 'Finish',
      parameters: { type: 'OBJECT', properties: {} },
      execute: (_args, context) => ({ response: { ok: true }, terminalValue: context.total }),
    },
  ];

  const result = await runAgent({
    name: 'test agent',
    systemInstruction: 'Use tools.',
    initialPrompt: 'Begin.',
    maxTurns: 3,
    model,
    tools,
    context: { total: 0 },
    terminalToolNames: ['finish'],
  });

  assert.equal(result, 2);
  assert.match(String(requests[0].contents[0].parts[0].text), /3 turns remaining/);
  const toolResponse = requests[1].contents
    .flatMap(content => content.parts)
    .find(part => 'functionResponse' in part)?.functionResponse as {
      response: { turnsRemaining: number };
    };
  assert.equal(toolResponse.response.turnsRemaining, 2);
});

test('runAgent forces terminal tools on the final turn', async () => {
  const forcedTools: Array<string[] | undefined> = [];
  const model: AgentModel = async request => {
    forcedTools.push(request.forceToolNames);
    return request.forceToolNames
      ? modelToolCall('finish', {}, 'finish')
      : { content: { role: 'model', parts: [{ text: 'Still working.' }] }, functionCalls: [] };
  };

  const result = await runAgent({
    name: 'bounded agent',
    systemInstruction: 'Finish.',
    initialPrompt: 'Begin.',
    maxTurns: 2,
    model,
    tools: [{
      name: 'finish',
      description: 'Finish',
      parameters: { type: 'OBJECT', properties: {} },
      execute: () => ({ response: { ok: true }, terminalValue: 'done' }),
    }],
    context: {},
    terminalToolNames: ['finish'],
  });

  assert.equal(result, 'done');
  assert.deepEqual(forcedTools, [undefined, ['finish']]);
});

test('runAgent stops before starting more work after cancellation', async () => {
  const controller = new AbortController();
  let modelCalls = 0;
  const model: AgentModel = async () => {
    modelCalls += 1;
    return modelToolCall('cancel', {}, 'cancel-1');
  };

  await assert.rejects(
    () => runAgent({
      name: 'cancellable agent',
      systemInstruction: 'Use tools.',
      initialPrompt: 'Begin.',
      maxTurns: 3,
      model,
      tools: [{
        name: 'cancel',
        description: 'Cancel the run',
        parameters: { type: 'OBJECT', properties: {} },
        execute: () => {
          controller.abort();
          return { response: { ok: true } };
        },
      }, {
        name: 'finish',
        description: 'Finish',
        parameters: { type: 'OBJECT', properties: {} },
        execute: () => ({ response: { ok: true }, terminalValue: 'done' }),
      }],
      context: {},
      terminalToolNames: ['finish'],
      signal: controller.signal,
    }),
    error => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.equal(modelCalls, 1);
});

test('runAgent batches generic sub-agents and waits for every result before the next turn', async () => {
  const subagentRequests: AgentModelRequest[] = [];
  const spawnRequests: SubagentSpawnRequest[] = [];
  let parentTurns = 0;
  let startedChildren = 0;
  let releaseChildren!: () => void;
  let reportAllStarted!: () => void;
  const childrenMayFinish = new Promise<void>(resolve => { releaseChildren = resolve; });
  const allChildrenStarted = new Promise<void>(resolve => { reportAllStarted = resolve; });
  const parentModel: AgentModel = async request => {
    parentTurns += 1;
    if (parentTurns === 1) {
      return modelToolCalls([
        { name: 'spawn_subagent', args: { task: 'Review pacing.', handoff: 'Complete draft A.' }, id: 'spawn-1' },
        { name: 'spawn_subagent', args: { task: 'Review continuity.', handoff: 'Complete draft A.' }, id: 'spawn-2' },
      ]);
    }

    assert.equal(startedChildren, 2);
    const results = request.contents.flatMap(content => content.parts).flatMap(part => {
      const response = part.functionResponse as { response?: { result?: string } } | undefined;
      return response?.response?.result ? [response.response.result] : [];
    });
    assert.deepEqual(results, ['Findings 1.', 'Findings 2.']);
    return modelToolCall('finish', {}, 'finish');
  };

  const resultPromise = runAgent({
    name: 'parent',
    systemInstruction: 'Complete the assigned task.',
    initialPrompt: 'Prepare a result.',
    maxTurns: 3,
    model: parentModel,
    tools: [{
      name: 'finish',
      description: 'Finish',
      parameters: { type: 'OBJECT', properties: {} },
      execute: () => ({ response: { ok: true }, terminalValue: 'done' }),
    }],
    context: {},
    terminalToolNames: ['finish'],
    subagents: {
      systemInstruction: 'Complete the assigned task and exit through the provided tool.',
      maxTurns: 10,
      modelFactory: request => {
        spawnRequests.push(request);
        return async modelRequest => {
          subagentRequests.push(modelRequest);
          startedChildren += 1;
          if (startedChildren === 2) reportAllStarted();
          await childrenMayFinish;
          return modelToolCall('subagent_exit', { result: `Findings ${request.index}.` }, `exit-${request.index}`);
        };
      },
      createContext: () => ({}),
    },
  });

  await allChildrenStarted;
  assert.equal(parentTurns, 1);
  releaseChildren();
  assert.equal(await resultPromise, 'done');
  assert.deepEqual(spawnRequests, [{
    sessionId: 'parent-subagent-1',
    index: 1,
    task: 'Review pacing.',
    handoff: 'Complete draft A.',
  }, {
    sessionId: 'parent-subagent-2',
    index: 2,
    task: 'Review continuity.',
    handoff: 'Complete draft A.',
  }]);
  assert.equal(subagentRequests[0].systemInstruction, 'Complete the assigned task and exit through the provided tool.');
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /10 turns remaining/);
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /Review pacing/);
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /Complete draft A/);
  assert.deepEqual(subagentRequests[0].tools.map(tool => tool.name), ['subagent_exit']);
});

test('runAgent enforces the five-sub-agent cap', async () => {
  let parentTurn = 0;
  let created = 0;
  let capErrorSeen = false;
  const result = await runAgent({
    name: 'bounded parent',
    systemInstruction: 'Delegate bounded work.',
    initialPrompt: 'Begin.',
    maxTurns: 3,
    model: async request => {
      parentTurn += 1;
      if (parentTurn === 1) {
        return modelToolCalls(Array.from({ length: MAX_SUBAGENTS_PER_AGENT }, (_, index) => ({
          name: 'spawn_subagent',
          args: { task: `Task ${index + 1}`, handoff: 'Shared handoff.' },
          id: `spawn-${index + 1}`,
        })));
      }
      if (parentTurn === 2) {
        assert.equal(request.tools.some(tool => tool.name === 'spawn_subagent'), false);
        return modelToolCall('spawn_subagent', { task: 'Task 6', handoff: 'Shared handoff.' }, 'spawn-6');
      }
      capErrorSeen = request.contents.some(content => content.parts.some(part => {
        const response = part.functionResponse as { response?: { error?: string } } | undefined;
        return response?.response?.error?.includes('0 more sub-agent sessions') ?? false;
      }));
      return modelToolCall('finish', {}, 'finish');
    },
    tools: [{
      name: 'finish',
      description: 'Finish',
      parameters: { type: 'OBJECT', properties: {} },
      execute: () => ({ response: { ok: true }, terminalValue: 'done' }),
    }],
    context: {},
    terminalToolNames: ['finish'],
    subagents: {
      systemInstruction: 'Exit with the result.',
      maxTurns: 1,
      modelFactory: request => async () => {
        created += 1;
        return modelToolCall('subagent_exit', { result: `Result ${request.index}` }, `exit-${request.index}`);
      },
      createContext: () => ({}),
    },
  });

  assert.equal(result, 'done');
  assert.equal(created, MAX_SUBAGENTS_PER_AGENT);
  assert.equal(capErrorSeen, true);
});

test('runAgent rejects mixed dependent calls before executing any of them', async () => {
  let parentTurn = 0;
  let ordinaryCalls = 0;
  let childCalls = 0;
  let mixedErrorSeen = false;
  const result = await runAgent({
    name: 'dependency-safe parent',
    systemInstruction: 'Use results before dependent work.',
    initialPrompt: 'Begin.',
    maxTurns: 2,
    model: async request => {
      parentTurn += 1;
      if (parentTurn === 1) {
        return modelToolCalls([
          { name: 'spawn_subagent', args: { task: 'Review.', handoff: 'Draft.' }, id: 'spawn' },
          { name: 'save', args: {}, id: 'save' },
        ]);
      }
      mixedErrorSeen = request.contents.some(content => content.parts.some(part => {
        const response = part.functionResponse as { response?: { error?: string } } | undefined;
        return response?.response?.error?.includes('cannot call other tools') ?? false;
      }));
      return modelToolCall('finish', {}, 'finish');
    },
    tools: [{
      name: 'save',
      description: 'Save',
      parameters: { type: 'OBJECT', properties: {} },
      execute: () => {
        ordinaryCalls += 1;
        return { response: { ok: true } };
      },
    }, {
      name: 'finish',
      description: 'Finish',
      parameters: { type: 'OBJECT', properties: {} },
      execute: () => ({ response: { ok: true }, terminalValue: 'done' }),
    }],
    context: {},
    terminalToolNames: ['finish'],
    subagents: {
      systemInstruction: 'Exit.',
      maxTurns: 1,
      modelFactory: () => async () => {
        childCalls += 1;
        return modelToolCall('subagent_exit', { result: 'Reviewed.' }, 'exit');
      },
      createContext: () => ({}),
    },
  });

  assert.equal(result, 'done');
  assert.equal(ordinaryCalls, 0);
  assert.equal(childCalls, 0);
  assert.equal(mixedErrorSeen, true);
});
