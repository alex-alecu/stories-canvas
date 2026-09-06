import OpenAI, { APIError } from 'openai';
import { AbortError } from 'p-retry';
import sharp from 'sharp';
import { config } from '../config.js';
import { getOpenRouterClient, resolveOpenRouterCost } from './openrouterClient.js';

export interface ImageUsageEvent {
  model: string;
  status: 'succeeded' | 'failed';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  generatedImages: number;
  imageOutputTokens: number;
  usageAvailable: boolean;
  usageDetails: Record<string, unknown>;
}

interface ImageResponse {
  id?: string;
  model?: string;
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
}

export interface ImageGenerationOptions {
  pro?: boolean;
  signal?: AbortSignal;
  onUsage?: (usage: ImageUsageEvent) => void | Promise<void>;
  client?: Pick<OpenAI, 'post' | 'get'>;
}

export class ImageSafetyBlockedError extends Error {
  constructor(readonly model: string, message: string) { super(message); this.name = 'ImageSafetyBlockedError'; }
}
export class ImagePolicyBlockedError extends Error {
  constructor(readonly model: string, message: string) { super(message); this.name = 'ImagePolicyBlockedError'; }
}
export function isImageSafetyBlockedError(error: unknown): error is ImageSafetyBlockedError { return error instanceof ImageSafetyBlockedError; }
export function isImagePolicyBlockedError(error: unknown): error is ImagePolicyBlockedError { return error instanceof ImagePolicyBlockedError; }

// The caller controls retries. Accounting and invalid paid output must never repeat the request.
async function reportUsage(options: ImageGenerationOptions, usage: ImageUsageEvent): Promise<void> {
  try { await options.onUsage?.(usage); }
  catch (error) { throw new AbortError(error instanceof Error ? error : new Error(String(error))); }
}

export async function generateImage(
  prompt: string,
  referenceImages: Array<{ data: string; mimeType: string }> = [],
  options: ImageGenerationOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const model = options.pro ? config.imageModelPro : config.imageModel;
  const api = options.client ?? getOpenRouterClient();
  let response: ImageResponse;
  let responseId: string | undefined;
  try {
    const result = await api.post<ImageResponse>('/images', {
      body: { model, prompt, n: 1, aspect_ratio: '4:3', resolution: '1K', output_format: 'png',
        input_references: referenceImages.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })),
        provider: { sort: 'price' } },
      timeout: 5 * 60 * 1000, maxRetries: 0, signal: options.signal,
    }).withResponse();
    response = result.data;
    responseId = response.id || result.response.headers.get('x-generation-id') || undefined;
  } catch (error) {
    if (options.signal?.aborted) throw new AbortError('Generation cancelled');
    const providerFailure = error instanceof APIError && typeof error.status === 'number';
    // OpenRouter's Image API does not bill failed or cancelled generations.
    await reportUsage(options, { model, status: 'failed', inputTokens: 0, outputTokens: 0, totalTokens: 0,
      generatedImages: 0, imageOutputTokens: 0, usageAvailable: false,
      usageDetails: { providerCostUsd: providerFailure ? 0 : null,
        costSource: 'openrouter', error: error instanceof Error ? error.message : String(error) } });
    if (providerFailure) {
      const details = JSON.stringify(error.error ?? { message: error.message });
      if (/PROHIBITED_CONTENT|BLOCKLIST|RECITATION|content_policy|policy violation/i.test(details)) throw new ImagePolicyBlockedError(model, error.message);
      if (/SAFETY|content_filter|moderation/i.test(details)) throw new ImageSafetyBlockedError(model, error.message);
      if (error.status !== 429 && (error.status ?? 0) < 500) throw new AbortError(error);
    }
    // A lost connection does not confirm the provider's result or cost. Do not buy a second image.
    if (!providerFailure) {
      throw new AbortError(error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  }

  let image: string | undefined;
  let outputError: Error | undefined;
  try {
    const data = response.data?.[0]?.b64_json;
    if (!data) throw new Error(`OpenRouter returned no image data for ${model}`);
    // Stored images and future reference images use PNG, including with model overrides.
    image = (await sharp(Buffer.from(data, 'base64')).png().toBuffer()).toString('base64');
  } catch (error) { outputError = error instanceof Error ? error : new Error(String(error)); }

  const cost = await resolveOpenRouterCost(response.usage?.cost, responseId, api);
  await reportUsage(options, { model: response.model || model, status: outputError ? 'failed' : 'succeeded',
    inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0, generatedImages: image ? 1 : 0,
    imageOutputTokens: response.usage?.completion_tokens ?? 0, usageAvailable: !!response.usage,
    usageDetails: { ...response.usage, responseId, responseModel: response.model || model,
      providerCostUsd: cost, costSource: 'openrouter', referenceImageCount: referenceImages.length,
      ...(outputError ? { error: outputError.message } : {}) } });
  if (cost === null) throw new AbortError('The image request cost is unavailable. Generation stopped.');
  if (outputError) throw new AbortError(outputError);
  return image!;
}
