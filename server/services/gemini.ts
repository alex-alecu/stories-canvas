import { GoogleGenAI, type ThinkingConfig } from '@google/genai';
import { config } from '../config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export { ai };

export interface JSONGenerationOptions {
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  maxRetries?: number;
}

interface ImageGenerationResponse {
  data?: unknown;
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

function isSafetyImageFailure(response: ImageGenerationResponse): boolean {
  const blockReason = String(response.promptFeedback?.blockReason ?? '').toUpperCase();
  if (blockReason.includes('SAFETY') || blockReason.includes('BLOCKLIST') || blockReason.includes('PROHIBITED_CONTENT')) {
    return true;
  }

  return (response.candidates ?? []).some(candidate => {
    const finishReason = String(candidate.finishReason ?? '').toUpperCase();
    return finishReason.includes('SAFETY')
      || finishReason.includes('BLOCKLIST')
      || finishReason.includes('PROHIBITED_CONTENT');
  });
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
    : `Image generation returned no image data on model ${model}`;

  return `${baseMessage}: ${details.join('; ')}`;
}

export async function generateJSON<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: JSONGenerationOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? config.maxRetries;
  let lastError: Error | null = null;
  let thinkingConfig = options.thinkingConfig;
  let thinkingFallbackUsed = false;
  let remainingRetries = maxRetries;

  while (remainingRetries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: config.scenarioModel,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: options.temperature,
          responseMimeType: 'application/json',
          responseSchema: schema as any,
          thinkingConfig,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const parsed = JSON.parse(text) as T;
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
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
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function generateImage(
  prompt: string,
  referenceImages: Array<{ data: string; mimeType: string }> = [],
  pro?: boolean,
): Promise<string> {
  const contents: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> = [];

  for (const img of referenceImages) {
    contents.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }
  contents.push({ text: prompt });
  const primaryModel = pro ? config.imageModelPro : config.imageModel;
  const fallbackModel = !pro && config.imageModelPro !== primaryModel
    ? config.imageModelPro
    : undefined;

  const modelsToTry = fallbackModel ? [primaryModel, fallbackModel] : [primaryModel];

  for (let index = 0; index < modelsToTry.length; index++) {
    const model = modelsToTry[index];
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        responseModalities: ['IMAGE'],
        imageGenerationConfig: { aspectRatio: '4:3' },
      } as any,
    }) as ImageGenerationResponse;

    const imageData = extractImageData(response);
    if (imageData) {
      return imageData;
    }

    const error = isSafetyImageFailure(response)
      ? new ImageSafetyBlockedError(model, describeImageFailure(response, model))
      : new Error(describeImageFailure(response, model));

    if (fallbackModel && index === 0 && !isSafetyImageFailure(response)) {
      console.warn(
        `Image generation returned no image data from ${primaryModel}. Retrying once with ${fallbackModel}.`,
      );
      continue;
    }

    throw error;
  }

  throw new Error(`Image generation failed on model ${primaryModel}`);
}
