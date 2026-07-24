import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type Content,
  type ContentListUnion,
  type SafetySetting,
  type ThinkingConfig,
} from '@google/genai';
import { config } from '../config.js';
import type { AgentModel, AgentModelResponse } from './agentRuntime.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const IMAGE_SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({
  category,
  threshold: HarmBlockThreshold.OFF,
}));

export { ai };

export interface JSONGenerationOptions {
  model?: string;
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  tools?: unknown[];
  maxRetries?: number;
  signal?: AbortSignal;
  onUsage?: (usage: {
    model: string;
    status: 'succeeded' | 'failed';
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageAvailable: boolean;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface GeminiAgentModelOptions {
  model?: string;
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  maxRetries?: number;
  onUsage?: JSONGenerationOptions['onUsage'];
}

const GEMINI_25_PRO_THINKING_BUDGET = 32768;
const GEMINI_25_FLASH_THINKING_BUDGET = 24576;

export function getMaxThinkingConfig(model = config.scenarioModel): ThinkingConfig {
  const normalizedModel = model.toLowerCase();

  if (/\bgemini-3(?:\.|\b|-)/.test(normalizedModel)) {
    return { thinkingLevel: ThinkingLevel.HIGH };
  }

  if (/\bgemini-2\.5(?:\.|\b|-).*pro/.test(normalizedModel)) {
    return { thinkingBudget: GEMINI_25_PRO_THINKING_BUDGET };
  }

  if (/\bgemini-2\.5(?:\.|\b|-).*(?:flash|lite)/.test(normalizedModel)) {
    return { thinkingBudget: GEMINI_25_FLASH_THINKING_BUDGET };
  }

  return { thinkingLevel: ThinkingLevel.HIGH };
}

interface ImageGenerationResponse {
  data?: unknown;
  usageMetadata?: unknown;
  generatedImages?: Array<{
    image?: {
      imageBytes?: unknown;
    };
    raiFilteredReason?: unknown;
  }>;
  promptFeedback?: {
    blockReason?: unknown;
    blockReasonMessage?: unknown;
  };
  candidates?: Array<{
    finishReason?: unknown;
    finishMessage?: unknown;
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: unknown;
        };
      }>;
    };
  }>;
}

function readNumberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractUsageMetadata(response: { usageMetadata?: unknown }): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageDetails: Record<string, unknown>;
  available: boolean;
} {
  const usageMetadata = response.usageMetadata;
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageDetails: {},
      available: false,
    };
  }

  const usage = usageMetadata as Record<string, unknown>;
  const inputTokens = readNumberField(
    usage.promptTokenCount ?? usage.inputTokenCount ?? usage.cachedContentTokenCount,
  );
  const outputTokens = readNumberField(
    usage.candidatesTokenCount ?? usage.outputTokenCount,
  );
  const totalTokens = readNumberField(usage.totalTokenCount) || (inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageDetails: usage,
    available: true,
  };
}

/** Waits between retries while allowing cancellation to stop the retry loop immediately. */
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

export function createGeminiAgentModel(options: GeminiAgentModelOptions = {}): AgentModel {
  const model = options.model ?? config.scenarioModel;

  return async request => {
    const maxRetries = options.maxRetries ?? config.maxRetries;
    let remainingRetries = maxRetries;
    let thinkingConfig = options.thinkingConfig;
    let thinkingFallbackUsed = false;
    let lastError: Error | undefined;

    while (remainingRetries > 0) {
      let usageReported = false;
      try {
        request.signal?.throwIfAborted();
        const response = await ai.models.generateContent({
          model,
          contents: request.contents as Content[],
          config: {
            abortSignal: request.signal,
            systemInstruction: request.systemInstruction,
            temperature: options.temperature,
            thinkingConfig,
            tools: [{
              functionDeclarations: request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as any,
              })),
            }],
            toolConfig: {
              functionCallingConfig: request.forceToolNames
                ? {
                    mode: FunctionCallingConfigMode.ANY,
                    allowedFunctionNames: request.forceToolNames,
                  }
                : { mode: FunctionCallingConfigMode.AUTO },
            },
          },
        });
        request.signal?.throwIfAborted();

        const usage = extractUsageMetadata(response as { usageMetadata?: unknown });
        const content = response.candidates?.[0]?.content;
        if (options.onUsage) {
          await options.onUsage({
            model,
            status: content?.parts?.length ? 'succeeded' : 'failed',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            usageAvailable: usage.available,
            usageDetails: usage.usageDetails,
          });
          usageReported = true;
        }

        if (!content?.parts?.length) {
          throw new Error('Empty agent response from Gemini');
        }

        return {
          content: content as AgentModelResponse['content'],
          functionCalls: (response.functionCalls ?? [])
            .filter(call => typeof call.name === 'string' && call.name.length > 0)
            .map(call => ({
              id: call.id,
              name: call.name!,
              args: call.args ?? {},
            })),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!usageReported && options.onUsage) {
          await options.onUsage({
            model,
            status: 'failed',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            usageAvailable: false,
            usageDetails: { error: lastError.message },
          });
        }
        if (request.signal?.aborted) {
          throw request.signal.reason;
        }
        if (thinkingConfig && !thinkingFallbackUsed && shouldRetryWithoutThinking(lastError)) {
          thinkingFallbackUsed = true;
          thinkingConfig = undefined;
          continue;
        }

        remainingRetries -= 1;
        if (remainingRetries > 0) {
          const failedAttempts = maxRetries - remainingRetries;
          const delay = Math.pow(2, failedAttempts - 1) * 1000 + Math.random() * 1000;
          await waitForRetry(delay, request.signal);
        }
      }
    }

    throw new Error(`Agent model failed after ${maxRetries} attempts: ${lastError?.message}`);
  };
}

export class ImageSafetyBlockedError extends Error {
  readonly model: string;

  constructor(model: string, message: string) {
    super(message);
    this.name = 'ImageSafetyBlockedError';
    this.model = model;
  }
}

export function isImageSafetyBlockedError(error: unknown): error is ImageSafetyBlockedError {
  return error instanceof ImageSafetyBlockedError;
}

export class ImagePolicyBlockedError extends Error {
  readonly model: string;

  constructor(model: string, message: string) {
    super(message);
    this.name = 'ImagePolicyBlockedError';
    this.model = model;
  }
}

export function isImagePolicyBlockedError(error: unknown): error is ImagePolicyBlockedError {
  return error instanceof ImagePolicyBlockedError;
}

function shouldRetryWithoutThinking(error: Error): boolean {
  const message = error.message.toLowerCase();
  const mentionsThinking = message.includes('thinking')
    || message.includes('thinkingconfig')
    || message.includes('thinkingbudget');

  if (!mentionsThinking) {
    return false;
  }

  return message.includes('unsupported')
    || message.includes('not supported')
    || message.includes('unknown field')
    || message.includes('unknown name')
    || message.includes('cannot find field')
    || message.includes('invalid argument')
    || message.includes('not available');
}

function extractImageData(response: ImageGenerationResponse): string | undefined {
  if (typeof response.data === 'string' && response.data.length > 0) {
    return response.data;
  }

  for (const generatedImage of response.generatedImages ?? []) {
    if (typeof generatedImage.image?.imageBytes === 'string' && generatedImage.image.imageBytes.length > 0) {
      return generatedImage.image.imageBytes;
    }
  }

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.inlineData?.data === 'string' && part.inlineData.data.length > 0) {
        return part.inlineData.data;
      }
    }
  }

  return undefined;
}

function matchesPromptOrCandidateReason(
  response: ImageGenerationResponse,
  patterns: string[],
): boolean {
  const blockReason = String(response.promptFeedback?.blockReason ?? '').toUpperCase();
  if (patterns.some(pattern => blockReason.includes(pattern))) {
    return true;
  }

  return (response.candidates ?? []).some(candidate => {
    const finishReason = String(candidate.finishReason ?? '').toUpperCase();
    return patterns.some(pattern => finishReason.includes(pattern));
  });
}

function isSafetyImageFailure(response: ImageGenerationResponse): boolean {
  return matchesPromptOrCandidateReason(response, ['SAFETY', 'IMAGE_SAFETY']);
}

function isPolicyImageFailure(response: ImageGenerationResponse): boolean {
  return matchesPromptOrCandidateReason(response, [
    'BLOCKLIST',
    'PROHIBITED_CONTENT',
    'IMAGE_PROHIBITED_CONTENT',
    'SPII',
    'IMAGE_RECITATION',
  ]);
}

function describeImageFailure(response: ImageGenerationResponse, model: string): string {
  const details: string[] = [];

  if (response.promptFeedback?.blockReason) {
    const blockReason = String(response.promptFeedback.blockReason);
    const blockMessage = typeof response.promptFeedback.blockReasonMessage === 'string'
      ? response.promptFeedback.blockReasonMessage
      : undefined;
    details.push(
      blockMessage
        ? `prompt blocked (${blockReason}: ${blockMessage})`
        : `prompt blocked (${blockReason})`,
    );
  }

  const candidateSummaries = (response.candidates ?? [])
    .map((candidate, index) => {
      const parts: string[] = [`candidate ${index + 1}`];

      if (candidate.finishReason) {
        parts.push(`finishReason=${String(candidate.finishReason)}`);
      }

      if (typeof candidate.finishMessage === 'string' && candidate.finishMessage.length > 0) {
        parts.push(`finishMessage=${candidate.finishMessage}`);
      }

      const partCount = candidate.content?.parts?.length;
      if (typeof partCount === 'number') {
        parts.push(`parts=${partCount}`);
      } else {
        parts.push('parts=missing');
      }

      return parts.join(', ');
    });

  if (candidateSummaries.length > 0) {
    details.push(candidateSummaries.join('; '));
  } else {
    details.push('no candidates returned');
  }

  const filteredReasons = (response.generatedImages ?? [])
    .map(image => image.raiFilteredReason)
    .filter((reason): reason is string => typeof reason === 'string' && reason.length > 0);

  if (filteredReasons.length > 0) {
    details.push(`filtered=${filteredReasons.join(', ')}`);
  }

  const baseMessage = isSafetyImageFailure(response)
    ? `Image generation blocked by safety filters on model ${model}`
    : isPolicyImageFailure(response)
      ? `Image generation blocked by provider policy on model ${model}`
      : `Image generation returned no image data on model ${model}`;

  return `${baseMessage}: ${details.join('; ')}`;
}

export async function generateJSONFromContents<T>(
  contents: ContentListUnion,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: JSONGenerationOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const model = options.model ?? config.scenarioModel;
  let lastError: Error | null = null;
  let thinkingConfig = options.thinkingConfig;
  let thinkingFallbackUsed = false;
  let remainingRetries = maxRetries;

  while (remainingRetries > 0) {
    let usageReported = false;
    try {
      options.signal?.throwIfAborted();
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          abortSignal: options.signal,
          systemInstruction,
          temperature: options.temperature,
          responseMimeType: 'application/json',
          responseSchema: schema as any,
          thinkingConfig,
          tools: options.tools as any,
        },
      });
      options.signal?.throwIfAborted();

      const text = response.text;
      const usage = extractUsageMetadata(response as { usageMetadata?: unknown });
      if (options.onUsage) {
        await options.onUsage({
          model,
          status: text ? 'succeeded' : 'failed',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          usageAvailable: usage.available,
          usageDetails: usage.usageDetails,
        });
        usageReported = true;
      }
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const parsed = JSON.parse(text) as T;
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!usageReported && options.onUsage) {
        await options.onUsage({
          model,
          status: 'failed',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          usageAvailable: false,
          usageDetails: { error: lastError.message },
        });
      }
      if (options.signal?.aborted) {
        throw options.signal.reason;
      }
      console.error(`Attempt ${maxRetries - remainingRetries + 1}/${maxRetries} failed:`, lastError.message);

      if (thinkingConfig && !thinkingFallbackUsed && shouldRetryWithoutThinking(lastError)) {
        thinkingFallbackUsed = true;
        thinkingConfig = undefined;
        console.warn('Retrying JSON generation without thinkingConfig after unsupported-model error');
        continue;
      }

      remainingRetries--;

      if (remainingRetries > 0) {
        const failedAttempts = maxRetries - remainingRetries;
        const delay = Math.pow(2, failedAttempts - 1) * 1000 + Math.random() * 1000;
        await waitForRetry(delay, options.signal);
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function generateJSON<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: JSONGenerationOptions = {},
): Promise<T> {
  return generateJSONFromContents<T>(
    prompt,
    systemInstruction,
    schema,
    options,
  );
}

export async function generateImage(
  prompt: string,
  referenceImages: Array<{ data: string; mimeType: string }> = [],
  proOrOptions?: boolean | {
    pro?: boolean;
    onUsage?: (usage: {
      model: string;
      status: 'succeeded' | 'failed';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      generatedImages: number;
      imageOutputTokens: number;
      usageAvailable: boolean;
      usageDetails: Record<string, unknown>;
    }) => void | Promise<void>;
  },
): Promise<string> {
  const options = typeof proOrOptions === 'boolean' ? { pro: proOrOptions } : (proOrOptions ?? {});
  const contents: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> = [];

  for (const img of referenceImages) {
    contents.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }
  contents.push({ text: prompt });
  const primaryModel = options.pro ? config.imageModelPro : config.imageModel;
  const fallbackModel = !options.pro && config.imageModelPro !== primaryModel
    ? config.imageModelPro
    : undefined;

  const modelsToTry = fallbackModel ? [primaryModel, fallbackModel] : [primaryModel];

  for (let index = 0; index < modelsToTry.length; index++) {
    const model = modelsToTry[index];
    let response: ImageGenerationResponse;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseModalities: ['IMAGE'],
          imageGenerationConfig: { aspectRatio: '4:3' },
          safetySettings: IMAGE_SAFETY_SETTINGS,
        } as any,
      }) as ImageGenerationResponse;
    } catch (error) {
      await options.onUsage?.({
        model,
        status: 'failed',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        generatedImages: 0,
        imageOutputTokens: 0,
        usageAvailable: false,
        usageDetails: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    const imageData = extractImageData(response);
    if (imageData) {
      if (options.onUsage) {
        const usage = extractUsageMetadata(response);
        await options.onUsage({
          model,
          status: 'succeeded',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          generatedImages: 1,
          imageOutputTokens: usage.outputTokens,
          usageAvailable: usage.available,
          usageDetails: usage.usageDetails,
        });
      }
      return imageData;
    }

    const message = describeImageFailure(response, model);
    if (options.onUsage) {
      const usage = extractUsageMetadata(response);
      await options.onUsage({
        model,
        status: 'failed',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        generatedImages: 0,
        imageOutputTokens: usage.outputTokens,
        usageAvailable: usage.available,
        usageDetails: usage.usageDetails,
      });
    }
    const error = isSafetyImageFailure(response)
      ? new ImageSafetyBlockedError(model, message)
      : isPolicyImageFailure(response)
        ? new ImagePolicyBlockedError(model, message)
        : new Error(message);

    if (fallbackModel && index === 0 && !(isSafetyImageFailure(response) || isPolicyImageFailure(response))) {
      console.warn(
        `Image generation returned no image data from ${primaryModel}. Retrying once with ${fallbackModel}.`,
      );
      continue;
    }

    throw error;
  }

  throw new Error(`Image generation failed on model ${primaryModel}`);
}
