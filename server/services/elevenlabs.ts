import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import pRetry, { AbortError } from 'p-retry';
import { config } from '../config.js';
import type { VoiceKey } from '../../shared/types.js';
import type { AudioUsageEvent } from './openrouterAudio.js';

let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
  if (!client) {
    if (!config.elevenLabsApiKey) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }
    client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
  }
  return client;
}

interface VoiceSettings {
  voiceId: string;
  stability: number;
  similarityBoost: number;
}

export function getVoiceSettings(voiceKey: VoiceKey): VoiceSettings {
  return { voiceId: config.voiceIds[voiceKey], stability: 0.5, similarityBoost: 0.8 };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>, timeoutMs = 60_000): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  const readAll = async (): Promise<Buffer> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error('Stream read timed out'));
    }, timeoutMs);
  });

  try { return await Promise.race([readAll(), timeout]); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function generateElevenLabsPageAudio(
  text: string,
  voiceKey: VoiceKey,
  onUsage?: AudioUsageCallback,
  signal?: AbortSignal,
): Promise<Buffer> {
  const elevenlabs = getClient();
  const settings = getVoiceSettings(voiceKey);
  const billedCharacters = text.length;

  const buffer = await pRetry(
    async () => {
      try {
        const audioStream = await elevenlabs.textToSpeech.convert(settings.voiceId, {
          text,
          modelId: config.elevenLabsModel,
          outputFormat: 'mp3_44100_128',
          voiceSettings: {
            stability: settings.stability,
            similarityBoost: settings.similarityBoost,
          },
        }, {
          timeoutInSeconds: 60,
          maxRetries: 0,
          abortSignal: signal,
        });
        const buffer = await streamToBuffer(audioStream, 60_000);
        return buffer;
      } catch (error) {
        await onUsage?.({
          provider: 'elevenlabs',
          model: config.elevenLabsModel,
          status: 'failed',
          billedCharacters: 0,
          usageAvailable: false,
          usageDetails: {
            requestedCharacters: billedCharacters,
            voiceKey,
            voiceId: settings.voiceId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (error) => {
        console.warn(
          `ElevenLabs TTS attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`,
          error.message,
        );
        if (error.message.includes('quota_exceeded')) {
          throw new AbortError('ElevenLabs API key quota exceeded — increase the per-key quota limit in your ElevenLabs dashboard');
        }
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          throw new AbortError('ElevenLabs API key is invalid');
        }
      },
    },
  );
  await onUsage?.({
    provider: 'elevenlabs',
    model: config.elevenLabsModel,
    status: 'succeeded',
    billedCharacters,
    usageAvailable: true,
    usageDetails: {
      voiceKey,
      voiceId: settings.voiceId,
    },
  });
  return buffer;
}
type AudioUsageCallback = (usage: AudioUsageEvent) => void | Promise<void>;

export function isElevenLabsConfigured(): boolean { return !!config.elevenLabsApiKey; }
