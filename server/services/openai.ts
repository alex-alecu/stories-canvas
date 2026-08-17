import OpenAI, { APIConnectionError, APIError } from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  Tool,
} from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import { config } from '../config.js';
import type {
  AgentContent,
  AgentModel,
  AgentModelResponse,
} from './agentRuntime.js';

const OPENAI_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REASONING_EFFORT: TextReasoningEffort = 'medium';

type OpenAIClient = Pick<OpenAI, 'responses'>;

export type TextReasoningEffort = Exclude<ReasoningEffort, null>;

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
  client?: OpenAIClient;
}

export interface OpenAIAgentModelOptions {
  model?: string;
  temperature?: number;
  reasoningEffort?: TextReasoningEffort;
  maxRetries?: number;
  onUsage?: TextGenerationOptions['onUsage'];
  client?: OpenAIClient;
}

export interface TextContent {
  role: 'user' | 'model' | 'assistant';
  parts: Array<Record<string, unknown>>;
}

export type TextContentInput = string | TextContent[];

let openAIClient: OpenAI | undefined;
let openAIClientKey: string | undefined;

/** Creates the OpenAI client only when a text request needs it. */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || config.openaiApiKey;
  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY');
  }

  if (!openAIClient || openAIClientKey !== apiKey) {
    openAIClient = new OpenAI({ apiKey });
    openAIClientKey = apiKey;
  }

  return openAIClient;
}

function toLowerCaseSchemaType(value: unknown): unknown {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return value.map(toLowerCaseSchemaType);
  return value;
}

/** Converts the existing provider-neutral schema objects to OpenAI JSON Schema. */
export function toOpenAIJSONSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenAIJSONSchema);
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = key === 'type'
      ? toLowerCaseSchemaType(entry)
      : toOpenAIJSONSchema(entry);
  }

  const type = result.type;
  const isObject = type === 'object'
    || (Array.isArray(type) && type.includes('object'));
  if (isObject && result.additionalProperties === undefined) {
    result.additionalProperties = false;
  }

  return result;
}

function parseFunctionArguments(call: ResponseFunctionToolCall): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(call.arguments);
  } catch {
    throw new Error(`OpenAI returned invalid JSON arguments for tool ${call.name}`);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`OpenAI returned non-object arguments for tool ${call.name}`);
  }

  return value as Record<string, unknown>;
}

function toFunctionCallOutput(part: Record<string, unknown>): ResponseInputItem | undefined {
  const value = part.functionResponse;
  if (!value || typeof value !== 'object') return undefined;

  const response = value as Record<string, unknown>;
  const callId = typeof response.id === 'string' ? response.id : '';
  if (!callId) {
    throw new Error('OpenAI tool result is missing its call ID');
  }

  return {
    type: 'function_call_output',
    call_id: callId,
    output: JSON.stringify(response.response ?? {}),
  };
}

function toStoredOutputItem(part: Record<string, unknown>): ResponseInputItem | undefined {
  const item = part.openAIOutputItem;
  if (!item || typeof item !== 'object') return undefined;
  return item as ResponseInputItem;
}

function textFromPart(part: Record<string, unknown>): string | undefined {
  return typeof part.text === 'string' ? part.text : undefined;
}

function toResponseInput(contents: TextContentInput | AgentContent[]): ResponseInputItem[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', content: contents }];
  }

  const input: ResponseInputItem[] = [];
  for (const content of contents) {
    const textParts: string[] = [];
    for (const part of content.parts) {
      const storedItem = toStoredOutputItem(part);
      if (storedItem) {
        input.push(storedItem);
        continue;
      }

      const functionOutput = toFunctionCallOutput(part);
      if (functionOutput) {
        input.push(functionOutput);
        continue;
      }

      const text = textFromPart(part);
      if (text !== undefined) textParts.push(text);
    }

    if (textParts.length > 0) {
      input.push({
        role: content.role === 'model' ? 'assistant' : content.role,
        content: textParts.join('\n'),
      });
    }
  }

  return input;
}

function toFunctionTools(
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
): Tool[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toOpenAIJSONSchema(tool.parameters) as Record<string, unknown>,
    strict: true,
  }));
}

function countWebSearchCalls(response: Response): number {
  return response.output.filter(
    item => item.type === 'web_search_call' && item.action.type === 'search',
  ).length;
}

function usageFromResponse(response: Response): Omit<TextUsageEvent, 'model' | 'status'> {
  const usage = response.usage;
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageAvailable: false,
      usageDetails: {
        responseId: response.id,
        responseModel: response.model,
        webSearchCalls: countWebSearchCalls(response),
      },
    };
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    usageAvailable: true,
    usageDetails: {
      input_tokens: usage.input_tokens,
      input_tokens_details: usage.input_tokens_details,
      output_tokens: usage.output_tokens,
      output_tokens_details: usage.output_tokens_details,
      total_tokens: usage.total_tokens,
      responseId: response.id,
      responseModel: response.model,
      webSearchCalls: countWebSearchCalls(response),
    },
  };
}

async function reportResponseUsage(
  callback: TextGenerationOptions['onUsage'],
  model: string,
  response: Response,
  status: TextUsageEvent['status'],
): Promise<void> {
  if (!callback) return;
  await callback({ model, status, ...usageFromResponse(response) });
}

async function reportUnavailableUsage(
  callback: TextGenerationOptions['onUsage'],
  model: string,
  error: Error,
): Promise<void> {
  if (!callback) return;
  await callback({
    model,
    status: 'failed',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageAvailable: false,
    usageDetails: { error: error.message },
  });
}

/** Waits between retries and stops at once when the caller cancels the request. */
function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function responseRequestOptions(signal?: AbortSignal) {
  return {
    maxRetries: 0,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
    signal,
  };
}

function reasoning(
  effort: TextReasoningEffort | undefined,
  context: 'current_turn' | 'all_turns',
) {
  return { effort: effort ?? DEFAULT_REASONING_EFFORT, context } as const;
}

function temperatureForRequest(
  temperature: number | undefined,
  effort: TextReasoningEffort | undefined,
): Pick<ResponseCreateParamsNonStreaming, 'temperature'> | Record<string, never> {
  return effort === 'none' && temperature !== undefined ? { temperature } : {};
}

function refusalMessages(response: Response): string[] {
  return response.output.flatMap(item => {
    if (item.type !== 'message') return [];
    return item.content
      .filter(part => part.type === 'refusal')
      .map(part => part.refusal);
  });
}

function assertCompletedResponse(response: Response, operation: string): void {
  if (response.error) {
    throw new Error(`OpenAI failed ${operation}: ${response.error.code}: ${response.error.message}`);
  }

  const refusals = refusalMessages(response);
  if (refusals.length > 0) {
    throw new Error(`OpenAI refused ${operation}: ${refusals.join(' ')}`);
  }

  if (response.status !== 'completed' || response.incomplete_details) {
    const reason = response.incomplete_details?.reason;
    throw new Error(
      `OpenAI did not complete ${operation}: ${response.status ?? 'unknown status'}${reason ? ` (${reason})` : ''}`,
    );
  }
}

function responseError(response: Response, operation: string): Error {
  return new Error(`OpenAI returned no ${operation}`);
}

function shouldRetryOpenAIError(error: Error): boolean {
  if (error instanceof APIConnectionError) return true;
  if (!(error instanceof APIError)) return false;
  const status = error.status;
  return status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500);
}

export function createOpenAIAgentModel(options: OpenAIAgentModelOptions = {}): AgentModel {
  const model = options.model ?? config.scenarioModel;

  return async request => {
    const maxAttempts = Math.max(1, options.maxRetries ?? config.maxRetries);
    let lastError: Error | undefined;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsMade = attempt;
      let response: Response | undefined;
      let usageReported = false;
      try {
        request.signal?.throwIfAborted();
        const tools = toFunctionTools(request.tools);
        const body: ResponseCreateParamsNonStreaming = {
          model,
          instructions: request.systemInstruction,
          input: toResponseInput(request.contents),
          tools,
          tool_choice: request.forceToolNames
            ? {
                type: 'allowed_tools',
                mode: 'required',
                tools: request.forceToolNames.map(name => ({ type: 'function', name })),
              }
            : 'auto',
          parallel_tool_calls: request.forceToolNames ? false : true,
          reasoning: reasoning(options.reasoningEffort, 'all_turns'),
          include: ['reasoning.encrypted_content'],
          store: false,
          ...temperatureForRequest(options.temperature, options.reasoningEffort),
        };
        response = await (options.client ?? getOpenAIClient()).responses.create(
          body,
          responseRequestOptions(request.signal),
        );
        request.signal?.throwIfAborted();
        assertCompletedResponse(response, 'agent output');

        const unfinishedFunctionCall = response.output.find(
          item => item.type === 'function_call' && item.status !== 'completed',
        );
        if (unfinishedFunctionCall?.type === 'function_call') {
          throw new Error(
            `OpenAI returned an unfinished call for tool ${unfinishedFunctionCall.name}`,
          );
        }

        const functionCallItems = response.output.filter(
          (item): item is ResponseFunctionToolCall => (
            item.type === 'function_call' && item.status === 'completed'
          ),
        );
        const functionCalls = functionCallItems.map(call => ({
          id: call.call_id,
          name: call.name,
          args: parseFunctionArguments(call),
        }));
        const parts: Array<Record<string, unknown>> = response.output
          .map(item => ({ openAIOutputItem: item }));
        if (parts.length === 0 && response.output_text) {
          parts.push({ text: response.output_text });
        }
        if (parts.length === 0) throw responseError(response, 'agent output');

        await reportResponseUsage(options.onUsage, model, response, 'succeeded');
        usageReported = true;
        return {
          content: { role: 'model', parts } as AgentModelResponse['content'],
          functionCalls,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!usageReported) {
          if (response) await reportResponseUsage(options.onUsage, model, response, 'failed');
          else await reportUnavailableUsage(options.onUsage, model, lastError);
        }
        if (request.signal?.aborted) throw request.signal.reason;
        if (attempt < maxAttempts && shouldRetryOpenAIError(lastError)) {
          const delay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 1000;
          await waitForRetry(delay, request.signal);
          continue;
        }
        break;
      }
    }

    throw new Error(
      `OpenAI agent failed after ${attemptsMade} ${attemptsMade === 1 ? 'attempt' : 'attempts'}: ${lastError?.message}`,
    );
  };
}

export async function generateJSONFromContents<T>(
  contents: TextContentInput,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: TextGenerationOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxRetries ?? config.maxRetries);
  const model = options.model ?? config.scenarioModel;
  let lastError: Error | undefined;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    let response: Response | undefined;
    let usageReported = false;
    try {
      options.signal?.throwIfAborted();
      const body: ResponseCreateParamsNonStreaming = {
        model,
        instructions: systemInstruction,
        input: toResponseInput(contents),
        text: {
          format: {
            type: 'json_schema',
            name: 'structured_response',
            strict: true,
            schema: toOpenAIJSONSchema(schema) as Record<string, unknown>,
          },
        },
        reasoning: reasoning(options.reasoningEffort, 'current_turn'),
        tools: options.tools as Tool[] | undefined,
        store: false,
        ...temperatureForRequest(options.temperature, options.reasoningEffort),
      };
      response = await (options.client ?? getOpenAIClient()).responses.create(
        body,
        responseRequestOptions(options.signal),
      );
      options.signal?.throwIfAborted();
      assertCompletedResponse(response, 'structured text output');

      if (!response.output_text) throw responseError(response, 'structured text output');
      const parsed = JSON.parse(response.output_text) as T;
      await reportResponseUsage(options.onUsage, model, response, 'succeeded');
      usageReported = true;
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!usageReported) {
        if (response) await reportResponseUsage(options.onUsage, model, response, 'failed');
        else await reportUnavailableUsage(options.onUsage, model, lastError);
      }
      if (options.signal?.aborted) throw options.signal.reason;
      console.error(`OpenAI attempt ${attempt}/${maxAttempts} failed:`, lastError.message);
      if (attempt < maxAttempts && shouldRetryOpenAIError(lastError)) {
        const delay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 1000;
        await waitForRetry(delay, options.signal);
        continue;
      }
      break;
    }
  }

  throw new Error(
    `OpenAI text generation failed after ${attemptsMade} ${attemptsMade === 1 ? 'attempt' : 'attempts'}: ${lastError?.message}`,
  );
}

export async function generateJSON<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: TextGenerationOptions = {},
): Promise<T> {
  return generateJSONFromContents<T>(prompt, systemInstruction, schema, options);
}
