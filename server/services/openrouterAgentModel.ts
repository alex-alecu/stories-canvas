import { OpenAIChatCompletionsModel, type Model } from '@openai/agents';
import type OpenAI from 'openai';
import { APIError } from 'openai';
import { getOpenRouterClient } from './openrouterClient.js';
import { getTextModelSettings } from './textGenerationContext.js';
import { TEXT_MODELS } from '../../shared/textModels.js';
import { buildTextUsageEvent, type RouterCompletion, type TextUsageEvent } from './openrouter.js';

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
    timeout: 5 * 60 * 1000,
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
            maxTokens: 24_000,
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
      const failed = !!raw.error || !choice || !['stop', 'tool_calls'].includes(choice.finish_reason) ||
        !!choice.message.refusal || choice.message.tool_calls?.length !== 1;
      const usage = await buildTextUsageEvent(raw, failed ? 'failed' : 'succeeded', client);
      await options.onUsage?.(usage);
      if (failed) throw new Error('The model did not complete its response.');
      if (usage.usageDetails.providerCostUsd === null) throw new Error('The request cost is unavailable. Generation stopped.');
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
