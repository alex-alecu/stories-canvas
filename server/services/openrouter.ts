import OpenAI, { APIConnectionError, APIError } from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOpenRouterClient, resolveOpenRouterCost } from './openrouterClient.js';
import { config } from '../config.js';
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
export type RouterCompletion = ChatCompletion & { usage?: ChatCompletion['usage'] & { cost?: number }; error?: { message?: string } };

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

export function toChatMessages(contents: TextContentInput): ChatCompletionMessageParam[] {
  if (typeof contents === 'string') return [{ role: 'user', content: contents }];
  const messages: ChatCompletionMessageParam[] = [];
  for (const content of contents) {
    const parts: Array<Record<string, unknown>> = [];
    for (const part of content.parts) {
      if (typeof part.text === 'string') {
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

export async function buildTextUsageEvent(response: RouterCompletion, status: TextUsageEvent['status'], api: RouterClient): Promise<TextUsageEvent> {
  const cost = await resolveOpenRouterCost(response.usage?.cost, response.id, api);
  return {
    model: response.model || getTextModelSettings().textModel,
    status,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    usageAvailable: !!response.usage,
    usageDetails: { ...response.usage, responseId: response.id, responseModel: response.model,
      providerCostUsd: cost, costSource: 'openrouter',
      thinkingLevel: getTextModelSettings().thinkingLevel },
  };
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
    const usage = await buildTextUsageEvent(response, outputError ? 'failed' : 'succeeded', api);
    await options.onUsage?.(usage);
    if (outputError) throw outputError;
    if (usage.usageDetails.providerCostUsd === null) throw new Error('The request cost is unavailable. Generation stopped.');
    options.signal?.throwIfAborted();
    return value as T;
  }
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
