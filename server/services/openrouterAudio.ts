import OpenAI, { APIError } from 'openai';
import { AbortError } from 'p-retry';
import type { AudioModelSettings } from '../../shared/audioModels.js';
import { getOpenRouterClient, resolveOpenRouterCost } from './openrouterClient.js';

export interface AudioUsageEvent {
  provider: 'openrouter' | 'elevenlabs';
  model: string;
  status: 'succeeded' | 'failed';
  billedCharacters: number;
  usageAvailable: boolean;
  usageDetails: Record<string, unknown>;
}

export interface OpenRouterAudioOptions {
  signal?: AbortSignal;
  onUsage?: (usage: AudioUsageEvent) => void | Promise<void>;
  client?: Pick<OpenAI, 'audio' | 'get'>;
}

export class AudioCostUnavailableError extends Error {
  name = 'AudioCostUnavailableError';
}

async function reportUsage(options: OpenRouterAudioOptions, usage: AudioUsageEvent): Promise<void> {
  try { await options.onUsage?.(usage); }
  catch (error) { throw new AbortError(error instanceof Error ? error : new Error(String(error))); }
}

async function readAudio(response: Response, signal?: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const abort = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function generateOpenRouterPageAudio(
  text: string,
  settings: AudioModelSettings,
  options: OpenRouterAudioOptions = {},
): Promise<Buffer> {
  options.signal?.throwIfAborted();
  if (!settings.audioVoice) throw new Error('Select a voice for this audio model.');
  const api = options.client ?? getOpenRouterClient();
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  let response: Response;
  let responseId: string | undefined;
  try {
    const result = await api.audio.speech.create({
      model: settings.audioModel,
      input: text,
      voice: settings.audioVoice,
      response_format: 'mp3',
    }, { timeout: 60_000, maxRetries: 0, signal: requestSignal }).withResponse();
    response = result.data;
    responseId = result.response.headers.get('x-generation-id') || undefined;
  } catch (error) {
    if (requestSignal.aborted) throw new AbortError(options.signal?.aborted ? 'Generation cancelled' : 'Audio generation timed out');
    const confirmedFailure = error instanceof APIError && error.status !== undefined;
    await reportUsage(options, {
      provider: 'openrouter', model: settings.audioModel, status: 'failed', billedCharacters: 0,
      usageAvailable: false, usageDetails: { responseId, providerCostUsd: confirmedFailure ? 0 : null,
        costSource: 'openrouter', audioVoice: settings.audioVoice,
        error: error instanceof Error ? error.message : String(error) },
    });
    if (!confirmedFailure) throw new AbortError(new AudioCostUnavailableError('The audio request cost is unavailable. Generation stopped.', { cause: error }));
    if ([401, 403, 429].includes(error.status!)) throw new AbortError(error);
    throw error;
  }

  let audio: Buffer | undefined;
  let outputError: Error | undefined;
  try {
    audio = await readAudio(response, requestSignal);
    requestSignal.throwIfAborted();
    if (audio.length === 0) throw new Error(`OpenRouter returned no audio data for ${settings.audioModel}`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw new Error(`OpenRouter returned ${contentType || 'an unknown content type'} instead of audio`);
    }
  } catch (error) {
    outputError = error instanceof Error ? error : new Error(String(error));
  }
  const cost = await resolveOpenRouterCost(undefined, responseId, api);
  await reportUsage(options, {
    provider: 'openrouter', model: settings.audioModel, status: outputError ? 'failed' : 'succeeded',
    billedCharacters: text.length, usageAvailable: cost !== null,
    usageDetails: { responseId, providerCostUsd: cost, costSource: 'openrouter',
      audioVoice: settings.audioVoice, ...(outputError ? { error: outputError.message } : {}) },
  });
  if (cost === null) throw new AbortError(new AudioCostUnavailableError('The audio request cost is unavailable. Generation stopped.'));
  if (outputError) throw new AbortError(outputError);
  return audio!;
}
