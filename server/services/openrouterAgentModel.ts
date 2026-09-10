import { OpenAIChatCompletionsModel, type Model } from '@openai/agents';
import type OpenAI from 'openai';
import { APIError } from 'openai';
import { getOpenRouterClient, TEXT_MAX_COMPLETION_TOKENS, TEXT_REQUEST_TIMEOUT_MS } from './openrouterClient.js';
import { getTextModelSettings } from './textGenerationContext.js';
import { TEXT_MODELS } from '../../shared/textModels.js';
import { buildTextUsageEvent, getTextResponseError, TextCostUnavailableError, type RouterCompletion, type TextUsageEvent } from './openrouter.js';

export interface StoryAgentModelOptions {
  onUsage?: (usage: TextUsageEvent) => void | Promise<void>;
  onRequest?: () => void;
  client?: OpenAI;
  fetch?: typeof fetch;
}

// The official SDK owns messages, tool execution, and the run loop. This adapter adds
// OpenRouter settings, exact cost records, and opaque reasoning on tool continuations.
export function createOpenRouterAgentModel(options: StoryAgentModelOptions = {}): Model {
  const settings = getTextModelSettings();
  const supportsToolChoice = TEXT_MODELS.find(model => model.id === settings.textModel)?.supportsToolChoice !== false;
  const reasoningByCall = new Map<string, unknown[]>();
  const retryableErrors = new WeakSet<Error>();
  let previousInput: unknown;
  const client = (options.client ?? getOpenRouterClient()).withOptions({
    maxRetries: 0,
    timeout: TEXT_REQUEST_TIMEOUT_MS,
    fetch: async (url, init) => {
      if (typeof init?.body === 'string' && String(url).endsWith('/chat/completions')) {
        const body = JSON.parse(init.body);
        for (const message of body.messages ?? []) {
          const reasoning = reasoningByCall.get(message.tool_calls?.[0]?.id);
          if (reasoning) message.reasoning_details = reasoning;
        }
        init = { ...init, body: JSON.stringify(body) };
      }
      return (options.fetch ?? fetch)(url, init);
    },
  });
  const sdk = new OpenAIChatCompletionsModel(client, settings.textModel);
  return {
    async getResponse(request) {
      request.signal?.throwIfAborted();
      if (request.input !== previousInput) {
        previousInput = request.input;
        options.onRequest?.();
      }
      let response;
      try {
        response = await sdk.getResponse({
          ...request,
          tracing: false,
          modelSettings: {
            ...request.modelSettings,
            reasoning: undefined,
            maxTokens: TEXT_MAX_COMPLETION_TOKENS,
            providerData: {
              ...request.modelSettings.providerData,
              ...(settings.thinkingLevel ? { reasoning: { effort: settings.thinkingLevel } } : {}),
              provider: { require_parameters: true, sort: 'price' },
              parallel_tool_calls: undefined,
              ...(!supportsToolChoice ? { tool_choice: undefined } : {}),
            },
          },
        });
      } catch (error) {
        await options.onUsage?.({ model: settings.textModel, status: 'failed', inputTokens: 0, outputTokens: 0,
          totalTokens: 0, usageAvailable: false, usageDetails: { costSource: 'openrouter', providerCostUsd: null,
            error: error instanceof Error ? error.message : 'Request failed' } });
        // Only confirmed HTTP failures can be retried. A lost connection or a cost
        // write failure must not start another potentially paid request.
        if (error instanceof APIError && error.status !== undefined &&
            (error.status === 429 || (error.status >= 500 && error.status < 600))) {
          retryableErrors.add(error);
        }
        throw error;
      }
      const raw = response.providerData as RouterCompletion;
      const choice = raw.choices?.[0];
      const responseError = getTextResponseError(raw, true);
      const usage = await buildTextUsageEvent(raw, responseError ? 'failed' : 'succeeded', client);
      await options.onUsage?.(usage);
      if (usage.usageDetails.providerCostUsd === null) throw new TextCostUnavailableError('The request cost is unavailable. Generation stopped.', { cause: responseError });
      if (responseError) throw responseError;
      const message = choice.message as typeof choice.message & { reasoning_details?: unknown[] };
      if (message.reasoning_details) {
        for (const call of message.tool_calls ?? []) reasoningByCall.set(call.id, message.reasoning_details);
      }
      request.signal?.throwIfAborted();
      return response;
    },
    getRetryAdvice(args) {
      return args.error instanceof Error && retryableErrors.has(args.error)
        ? sdk.getRetryAdvice(args)
        : { suggested: false };
    },
    async *getStreamedResponse() { throw new Error('Story scripts use complete responses for cost accounting.'); },
  };
}
