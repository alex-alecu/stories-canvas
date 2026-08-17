import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response } from 'openai/resources/responses/responses';
import type { TextUsageEvent } from './openai.js';

process.env.GEMINI_API_KEY ??= 'test-key';

const {
  createOpenAIAgentModel,
  generateJSON,
  generateJSONFromContents,
  toOpenAIJSONSchema,
} = await import('./openai.js');

function response(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    billing: { payer: 'developer' },
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: 'gpt-5.6-sol',
    output: [],
    parallel_tool_calls: true,
    reasoning: { effort: 'medium', summary: null },
    safety_identifier: null,
    service_tier: 'default',
    store: false,
    temperature: 1,
    text: { format: { type: 'text' }, verbosity: 'medium' },
    tool_choice: 'auto',
    tools: [],
    top_logprobs: 0,
    top_p: 1,
    truncation: 'disabled',
    usage: {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 27,
    },
    user: null,
    metadata: {},
    output_text: '',
    ...overrides,
  } as Response;
}

function fakeClient(
  create: (body: Record<string, unknown>, options: Record<string, unknown>) => Promise<Response>,
) {
  return { responses: { create } } as never;
}

test('toOpenAIJSONSchema converts nested Gemini-style schema types', () => {
  assert.deepEqual(
    toOpenAIJSONSchema({
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
        },
      },
      required: ['items'],
    }),
    {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  );
});

test('generateJSON uses Responses structured output and reports detailed use', async () => {
  const calls: Array<{ body: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const usageEvents: TextUsageEvent[] = [];
  const controller = new AbortController();
  const client = fakeClient(async (body, options) => {
    calls.push({ body, options });
    return response({
      output: [
        {
          id: 'search_1',
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', query: 'public domain story', sources: [] },
        },
        {
          id: 'open_1',
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'open_page', url: 'https://example.test/story' },
        },
        {
          id: 'find_1',
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'find_in_page',
            url: 'https://example.test/story',
            pattern: 'public domain',
          },
        },
      ],
      output_text: '{"ok":true}',
    });
  });

  const result = await generateJSON<{ ok: boolean }>(
    'User prompt',
    'System instruction',
    { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
    {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      temperature: 0.4,
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      maxRetries: 1,
      signal: controller.signal,
      client,
      onUsage: event => { usageEvents.push(event); },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'gpt-5.6-sol');
  assert.equal(calls[0].body.instructions, 'System instruction');
  assert.deepEqual(calls[0].body.input, [{ role: 'user', content: 'User prompt' }]);
  assert.deepEqual(calls[0].body.reasoning, { effort: 'medium', context: 'current_turn' });
  assert.equal(calls[0].body.temperature, undefined);
  assert.equal(calls[0].body.store, false);
  assert.deepEqual(calls[0].body.tools, [{ type: 'web_search', search_context_size: 'high' }]);
  assert.deepEqual(calls[0].body.text, {
    format: {
      type: 'json_schema',
      name: 'structured_response',
      strict: true,
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    },
  });
  assert.equal(calls[0].options.maxRetries, 0);
  assert.equal(calls[0].options.timeout, 300_000);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(usageEvents, [{
    model: 'gpt-5.6-sol',
    status: 'succeeded',
    inputTokens: 20,
    outputTokens: 7,
    totalTokens: 27,
    usageAvailable: true,
    usageDetails: {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 27,
      responseId: 'resp_1',
      responseModel: 'gpt-5.6-sol',
      webSearchCalls: 1,
    },
  }]);
});

test('generateJSONFromContents maps model text to an assistant message', async () => {
  let body: Record<string, unknown> | undefined;
  const result = await generateJSONFromContents<{ ok: boolean }>(
    [
      { role: 'user', parts: [{ text: 'Review this.' }] },
      { role: 'model', parts: [{ text: '{"needsRewrite":false}' }] },
      { role: 'user', parts: [{ text: 'Apply it.' }] },
    ],
    'System',
    { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
    {
      maxRetries: 1,
      client: fakeClient(async requestBody => {
        body = requestBody;
        return response({ output_text: '{"ok":true}' });
      }),
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(body?.input, [
    { role: 'user', content: 'Review this.' },
    { role: 'assistant', content: '{"needsRewrite":false}' },
    { role: 'user', content: 'Apply it.' },
  ]);
});

test('createOpenAIAgentModel preserves output items and tool call IDs', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const reasoningItem = {
    id: 'reason_1',
    type: 'reasoning' as const,
    encrypted_content: 'encrypted',
    summary: [],
  };
  const functionCall = {
    id: 'item_1',
    type: 'function_call' as const,
    call_id: 'call_1',
    name: 'finish',
    arguments: '{"ok":true}',
    status: 'completed' as const,
  };
  const client = fakeClient(async body => {
    calls.push(body);
    return response({ output: [reasoningItem, functionCall] });
  });
  const model = createOpenAIAgentModel({
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    maxRetries: 1,
    client,
  });

  const first = await model({
    systemInstruction: 'Use tools.',
    contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
    tools: [{
      name: 'finish',
      description: 'Finish the task.',
      parameters: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
    }],
    forceToolNames: ['finish'],
  });
  assert.deepEqual(first.functionCalls, [{ id: 'call_1', name: 'finish', args: { ok: true } }]);
  assert.deepEqual(calls[0].tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [{ type: 'function', name: 'finish' }],
  });
  assert.equal(calls[0].parallel_tool_calls, false);
  assert.deepEqual(calls[0].reasoning, { effort: 'high', context: 'all_turns' });
  assert.deepEqual(calls[0].include, ['reasoning.encrypted_content']);
  assert.deepEqual(calls[0].tools, [{
    type: 'function',
    name: 'finish',
    description: 'Finish the task.',
    parameters: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    strict: true,
  }]);

  await model({
    systemInstruction: 'Use tools.',
    contents: [
      { role: 'user', parts: [{ text: 'Begin.' }] },
      first.content,
      {
        role: 'user',
        parts: [{
          functionResponse: {
            id: 'call_1',
            name: 'finish',
            response: { ok: true },
          },
        }],
      },
    ],
    tools: [],
  });
  assert.deepEqual(calls[1].input, [
    { role: 'user', content: 'Begin.' },
    reasoningItem,
    functionCall,
    { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
  ]);
  assert.equal(calls[1].parallel_tool_calls, true);
});

test('generateJSON reports refusals as failed use', async () => {
  const events: TextUsageEvent[] = [];
  let calls = 0;
  await assert.rejects(
    generateJSON(
      'Prompt',
      'System',
      { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      {
        maxRetries: 3,
        client: fakeClient(async () => {
          calls += 1;
          return response({
            output: [{
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'refusal', refusal: 'Cannot complete this request.' }],
            }],
          });
        }),
        onUsage: event => { events.push(event); },
      },
    ),
    /OpenAI refused structured text output/,
  );
  assert.equal(calls, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
  assert.equal(events[0].inputTokens, 20);
});

test('generateJSON rejects incomplete responses even when they contain valid JSON', async () => {
  const events: TextUsageEvent[] = [];
  await assert.rejects(
    generateJSON(
      'Prompt',
      'System',
      { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      {
        maxRetries: 1,
        client: fakeClient(async () => response({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: '{"ok":true}',
        })),
        onUsage: event => { events.push(event); },
      },
    ),
    /did not complete structured text output: incomplete \(max_output_tokens\)/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
});

test('generateJSON rejects failed response errors', async () => {
  const events: TextUsageEvent[] = [];
  await assert.rejects(
    generateJSON(
      'Prompt',
      'System',
      { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      {
        maxRetries: 1,
        client: fakeClient(async () => response({
          status: 'failed',
          error: { code: 'server_error', message: 'Generation stopped.' },
          output_text: '{"ok":true}',
        })),
        onUsage: event => { events.push(event); },
      },
    ),
    /OpenAI failed structured text output: server_error: Generation stopped/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
});

test('createOpenAIAgentModel does not run an incomplete function call', async () => {
  const events: TextUsageEvent[] = [];
  const model = createOpenAIAgentModel({
    maxRetries: 1,
    client: fakeClient(async () => response({
      output: [{
        id: 'item_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'finish',
        arguments: '{"ok":true}',
        status: 'incomplete',
      }],
    })),
    onUsage: event => { events.push(event); },
  });

  await assert.rejects(
    model({
      systemInstruction: 'Use tools.',
      contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
      tools: [{
        name: 'finish',
        description: 'Finish the task.',
        parameters: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      }],
    }),
    /unfinished call for tool finish/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
});

test('createOpenAIAgentModel rejects malformed tool arguments', async () => {
  const events: TextUsageEvent[] = [];
  const model = createOpenAIAgentModel({
    maxRetries: 1,
    client: fakeClient(async () => response({
      output: [{
        id: 'item_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'finish',
        arguments: '{not-json}',
        status: 'completed',
      }],
    })),
    onUsage: event => { events.push(event); },
  });

  await assert.rejects(
    model({
      systemInstruction: 'Use tools.',
      contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
      tools: [{
        name: 'finish',
        description: 'Finish the task.',
        parameters: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      }],
    }),
    /invalid JSON arguments for tool finish/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
});

test('createOpenAIAgentModel stops on a refusal', async () => {
  const events: TextUsageEvent[] = [];
  const model = createOpenAIAgentModel({
    maxRetries: 1,
    client: fakeClient(async () => response({
      output: [{
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'refusal', refusal: 'Cannot complete this request.' }],
      }],
    })),
    onUsage: event => { events.push(event); },
  });

  await assert.rejects(
    model({
      systemInstruction: 'Use tools.',
      contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
      tools: [],
    }),
    /OpenAI refused agent output/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
});

test('createOpenAIAgentModel passes cancellation to the SDK request', async () => {
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  const model = createOpenAIAgentModel({
    maxRetries: 1,
    client: fakeClient(async (_body, options) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    }),
  });
  const pending = model({
    systemInstruction: 'Use tools.',
    contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
    tools: [],
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(signal, controller.signal);
});
