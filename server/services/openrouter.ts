import OpenAI, { APIConnectionError, APIError } from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { AgentContent, AgentModel } from './agentRuntime.js';
import { getTextModelSettings } from './textGenerationContext.js';
import type { ThinkingLevel } from '../../shared/textModels.js';

export type TextReasoningEffort = ThinkingLevel | 'none' | 'minimal' | 'xhigh';
type RouterClient = Pick<OpenAI, 'chat' | 'get'>;
export interface TextUsageEvent {
  model: string;
  status: 'succeeded' | 'failed';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageAvailable: boolean;
  usageDetails: Record<string, unknown>;
}
export interface TextGenerationOptions {
  model?: string;
  temperature?: number;
  reasoningEffort?: TextReasoningEffort;
  tools?: Array<Record<string, unknown>>;
  maxRetries?: number;
  signal?: AbortSignal;
  onUsage?: (usage: TextUsageEvent) => void | Promise<void>;
  client?: RouterClient;
}
export interface TextContent {
  role: 'user' | 'model' | 'assistant';
  parts: Array<Record<string, unknown>>;
}
export type TextContentInput = string | TextContent[];
type RouterMessage = ChatCompletion['choices'][number]['message'] & { reasoning_details?: unknown[] };
type RouterCompletion = ChatCompletion & { usage?: ChatCompletion['usage'] & { cost?: number }; error?: { message?: string } };
let client: OpenAI | undefined;
let clientKey: string | undefined;

export function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || config.openrouterApiKey;
  if (!apiKey) throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0,
      defaultHeaders: { 'HTTP-Referer': config.appBaseUrl, 'X-OpenRouter-Title': config.appSiteName } });
    clientKey = apiKey;
  }
  return client;
}

export function toJSONSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJSONSchema);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = key === 'type' && typeof entry === 'string' ? entry.toLowerCase() : toJSONSchema(entry);
  }
  if (result.type === 'object') result.additionalProperties ??= false;
  return result;
}

export function toChatMessages(contents: TextContentInput | AgentContent[]): ChatCompletionMessageParam[] {
  if (typeof contents === 'string') return [{ role: 'user', content: contents }];
  const messages: ChatCompletionMessageParam[] = [];
  for (const content of contents) {
    const parts: Array<Record<string, unknown>> = [];
    for (const part of content.parts) {
      if (part.routerMessage) {
        messages.push(part.routerMessage as ChatCompletionMessageParam);
      } else if (part.functionResponse) {
        const response = part.functionResponse as { id?: string; response?: unknown };
        if (!response.id) throw new Error('Tool result is missing its call ID');
        messages.push({ role: 'tool', tool_call_id: response.id, content: JSON.stringify(response.response ?? {}) });
      } else if (typeof part.text === 'string') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.inlineData) {
        const data = part.inlineData as { mimeType: string; data: string; detail?: string };
        parts.push({ type: 'image_url', image_url: { url: `data:${data.mimeType};base64,${data.data}`, detail: data.detail === 'high' ? 'high' : 'auto' } });
      }
    }
    if (parts.length) messages.push({ role: content.role === 'model' ? 'assistant' : content.role, content: parts } as unknown as ChatCompletionMessageParam);
  }
  return messages;
}

function validCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1_000_000));
}

async function usageEvent(response: RouterCompletion, status: TextUsageEvent['status'], api: RouterClient): Promise<TextUsageEvent> {
  let cost = response.usage?.cost;
  if (!validCost(cost) && response.id) {
    try {
      const result = await api.get<{ data: { total_cost?: number } }>('/generation', {
        query: { id: response.id }, timeout: 15_000, maxRetries: 2,
      });
      cost = result.data.total_cost;
    } catch { /* Keep an incomplete event for account support. Never infer a zero charge. */ }
  }
  return {
    model: response.model || getTextModelSettings().textModel,
    status,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    usageAvailable: !!response.usage,
    usageDetails: { ...response.usage, responseId: response.id, responseModel: response.model,
      providerCostUsd: validCost(cost) ? cost : null, costSource: 'openrouter',
      thinkingLevel: getTextModelSettings().thinkingLevel },
  };
}

// The response ID keeps accounting idempotent when a database write is retried.
export function requestUsageId(storyId: string, responseId: string): string {
  const hex = createHash('sha256').update(`openrouter:${storyId}:${responseId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function request<T>(body: Record<string, unknown>, options: TextGenerationOptions, read: (response: RouterCompletion) => T): Promise<T> {
  const settings = getTextModelSettings();
  const api = options.client ?? getOpenRouterClient();
  const attempts = Math.max(1, options.maxRetries ?? config.maxRetries);
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted();
    let response: RouterCompletion;
    try {
      response = await api.chat.completions.create({
        ...body, model: settings.textModel, stream: false, max_tokens: 24_000,
        ...(settings.thinkingLevel ? { reasoning: { effort: settings.thinkingLevel } } : {}),
        provider: { require_parameters: true, sort: 'price' },
      } as unknown as ChatCompletionCreateParamsNonStreaming, {
        timeout: 5 * 60 * 1000, maxRetries: 0, signal: options.signal,
      }) as RouterCompletion;
    } catch (error) {
      // Retry transport and rate errors only. Never repeat a paid response after an accounting error.
      await options.onUsage?.({ model: settings.textModel, status: 'failed', inputTokens: 0, outputTokens: 0,
        totalTokens: 0, usageAvailable: false, usageDetails: { costSource: 'openrouter', providerCostUsd: null,
          error: error instanceof Error ? error.message : 'Request failed' } });
      options.signal?.throwIfAborted();
      const retry = error instanceof APIConnectionError || (error instanceof APIError &&
        (error.status === 429 || (error.status ?? 0) >= 500));
      if (!retry || attempt >= attempts) throw error;
      await new Promise<void>((resolve, reject) => {
        const done = () => { options.signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, 1000 * 2 ** (attempt - 1));
        const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
        options.signal?.addEventListener('abort', abort, { once: true });
      });
      continue;
    }
    let value: T | undefined;
    let outputError: unknown;
    try {
      if (response.error) throw new Error(response.error.message || 'OpenRouter request failed');
      const choice = response.choices?.[0];
      if (!choice || !['stop', 'tool_calls'].includes(choice.finish_reason) || choice.message.refusal) {
        throw new Error('The model did not complete its response.');
      }
      value = read(response);
    } catch (error) { outputError = error; }
    const usage = await usageEvent(response, outputError ? 'failed' : 'succeeded', api);
    await options.onUsage?.(usage);
    if (outputError) throw outputError;
    if (usage.usageDetails.providerCostUsd === null) throw new Error('The request cost is unavailable. Generation stopped.');
    options.signal?.throwIfAborted();
    return value as T;
  }
}

export function createOpenRouterAgentModel(options: TextGenerationOptions = {}): AgentModel {
  return async input => request({
    messages: [{ role: 'system', content: input.systemInstruction }, ...toChatMessages(input.contents)],
    tools: input.tools.filter(tool => !input.forceToolNames || input.forceToolNames.includes(tool.name))
      .map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description,
        parameters: toJSONSchema(tool.parameters), strict: true } })),
    tool_choice: input.forceToolNames ? 'required' : 'auto',
  }, { ...options, signal: input.signal }, response => {
    const message = response.choices[0].message as RouterMessage;
    const functionCalls = (message.tool_calls ?? []).map(call => {
      if (call.type !== 'function') throw new Error('Unsupported tool call');
      const args: unknown = JSON.parse(call.function.arguments);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
      if (!input.tools.some(tool => tool.name === call.function.name)
        || (input.forceToolNames && !input.forceToolNames.includes(call.function.name))) throw new Error('Unexpected tool call');
      return { id: call.id, name: call.function.name, args: args as Record<string, unknown> };
    });
    if (!functionCalls.length && (!message.content || input.forceToolNames)) throw new Error('The model returned no required tool output');
    // Keep tool IDs and reasoning details unchanged across agent turns.
    const stored = { role: 'assistant', content: message.content, tool_calls: message.tool_calls,
      ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}) };
    return { content: { role: 'model', parts: [{ routerMessage: stored }] }, functionCalls };
  });
}

export function generateJSONFromContents<T>(contents: TextContentInput, systemInstruction: string,
  schema: Record<string, unknown>, options: TextGenerationOptions = {}): Promise<T> {
  return request({
    messages: [{ role: 'system', content: systemInstruction }, ...toChatMessages(contents)],
    response_format: { type: 'json_schema', json_schema: { name: 'structured_response', strict: true, schema: toJSONSchema(schema) } },
    ...(options.tools?.some(tool => tool.type === 'web_search') ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
  }, options, response => {
    const content = response.choices[0].message.content;
    if (!content) throw new Error('The model returned no text');
    return JSON.parse(content) as T;
  });
}

export function generateJSON<T>(prompt: string, systemInstruction: string, schema: Record<string, unknown>, options: TextGenerationOptions = {}): Promise<T> {
  return generateJSONFromContents<T>(prompt, systemInstruction, schema, options);
}
