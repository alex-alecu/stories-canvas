import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSpawnSubagentTool,
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

test('generic spawn tool creates an isolated bounded session from task and handoff', async () => {
  const subagentRequests: AgentModelRequest[] = [];
  const spawnRequests: SubagentSpawnRequest[] = [];
  const spawnTool = createSpawnSubagentTool<Record<string, never>, string, Record<string, never>>({
    parentName: 'parent',
    systemInstruction: 'Complete the assigned task and exit through the provided tool.',
    maxTurns: 10,
    modelFactory: request => {
      spawnRequests.push(request);
      return async modelRequest => {
        subagentRequests.push(modelRequest);
        return modelToolCall('subagent_exit', { result: 'Independent findings.' }, 'exit-1');
      };
    },
    createContext: () => ({}),
  });

  const result = await spawnTool.execute({
    task: 'Inspect the supplied result for inconsistencies.',
    handoff: 'Original request: make a result.\nResults so far: complete draft.',
  }, {});

  assert.deepEqual(result.response, {
    ok: true,
    sessionId: 'parent-subagent-1',
    result: 'Independent findings.',
  });
  assert.deepEqual(spawnRequests, [{
    sessionId: 'parent-subagent-1',
    index: 1,
    task: 'Inspect the supplied result for inconsistencies.',
    handoff: 'Original request: make a result.\nResults so far: complete draft.',
  }]);
  assert.equal(subagentRequests[0].systemInstruction, 'Complete the assigned task and exit through the provided tool.');
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /10 turns remaining/);
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /Inspect the supplied result/);
  assert.match(String(subagentRequests[0].contents[0].parts[0].text), /Results so far: complete draft/);
  assert.deepEqual(subagentRequests[0].tools.map(tool => tool.name), ['subagent_exit']);
});
