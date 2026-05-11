import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import pRetry, { AbortError } from 'p-retry';
import { config } from '../config.js';
import { uploadAudio, updatePageAudioUrl as sbUpdatePageAudioUrl } from './supabaseStorage.js';
import { saveAudio, updatePageAudioUrl as fsUpdatePageAudioUrl } from '../utils/storage.js';
import { getPageAudioFilename } from '../utils/storyMedia.js';
import type { Page, VoiceKey, GenerationProgress } from '../../shared/types.js';

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
  style: number;
  speed: number;
}

export function getVoiceSettings(voiceKey: VoiceKey): VoiceSettings {
  const baseSettings: Record<VoiceKey, VoiceSettings> = {
    bunica: {
      voiceId: config.voiceIds.corina,
      stability: 0.82,
      similarityBoost: 0.8,
      style: 0.18,
      speed: 0.82,
    },
    jora: {
      voiceId: config.voiceIds.jora,
      stability: 0.8,
      similarityBoost: 0.8,
      style: 0.2,
      speed: 0.84,
    },
    serban: {
      voiceId: config.voiceIds.serban,
      stability: 0.74,
      similarityBoost: 0.8,
      style: 0.38,
      speed: 0.88,
    },
    corina: {
      voiceId: config.voiceIds.corina,
      stability: 0.74,
      similarityBoost: 0.8,
      style: 0.42,
      speed: 0.88,
    },
  };

  return baseSettings[voiceKey];
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

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error('Stream read timed out'));
    }, timeoutMs);
  });

  return Promise.race([readAll(), timeout]);
}

export async function generatePageAudio(
  text: string,
  voiceKey: VoiceKey,
  onUsage?: AudioUsageCallback,
): Promise<Buffer> {
  const elevenlabs = getClient();
  const settings = getVoiceSettings(voiceKey);
  const billedCharacters = text.length;

  return pRetry(
    async () => {
      try {
        const audioStream = await elevenlabs.textToSpeech.convert(settings.voiceId, {
          text,
          modelId: config.elevenLabsModel,
          outputFormat: 'mp3_44100_128',
          voiceSettings: {
            stability: settings.stability,
            similarityBoost: settings.similarityBoost,
            style: settings.style,
            speed: settings.speed,
          },
        }, {
          timeoutInSeconds: 60,
          maxRetries: 0,
        });
        const buffer = await streamToBuffer(audioStream, 60_000);
        await onUsage?.({
          model: config.elevenLabsModel,
          status: 'succeeded',
          billedCharacters,
          usageDetails: {
            voiceKey,
            voiceId: settings.voiceId,
          },
        });
        return buffer;
      } catch (error) {
        await onUsage?.({
          model: config.elevenLabsModel,
          status: 'failed',
          billedCharacters,
          usageDetails: {
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
}

export async function savePageAudio(storyId: string, filename: string, audioBuffer: Buffer, userId?: string): Promise<string> {
  if (config.useSupabase) {
    return uploadAudio(userId, storyId, filename, audioBuffer);
  } else {
    await saveAudio(storyId, filename, audioBuffer);
    return `/api/stories/${storyId}/audio/${filename}`;
  }
}

async function updatePageAudioUrlBoth(storyId: string, pageNumber: number, audioUrl: string): Promise<void> {
  if (config.useSupabase) {
    await sbUpdatePageAudioUrl(storyId, pageNumber, audioUrl);
  } else {
    await fsUpdatePageAudioUrl(storyId, pageNumber, audioUrl);
  }
}

type AudioProgressCallback = (progress: Partial<GenerationProgress>) => void;
type AudioUsageCallback = (usage: {
  model: string;
  status: 'succeeded' | 'failed';
  billedCharacters: number;
  usageDetails: Record<string, unknown>;
}) => void | Promise<void>;

export interface AudioGenerationResult {
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  error?: string;
}

export async function generateAllPageAudio(
  storyId: string,
  pages: Page[],
  voiceKey: VoiceKey,
  userId: string | undefined,
  signal: AbortSignal,
  onProgress?: AudioProgressCallback,
  onUsage?: (page: Page, usage: {
    model: string;
    status: 'succeeded' | 'failed';
    billedCharacters: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>,
): Promise<AudioGenerationResult> {
  let completedCount = 0;
  let failedCount = 0;
  let fatalError: string | undefined;

  for (const page of pages) {
    if (signal.aborted) throw new Error('Generation cancelled');

    // On unrecoverable error (auth/quota), skip remaining pages
    if (fatalError) break;

    const filename = getPageAudioFilename(page.pageNumber);

    try {
      onProgress?.({
        message: `Generating narration for page ${page.pageNumber}/${pages.length}...`,
        pageNumber: page.pageNumber,
        pageStatus: 'generating',
      });

      const audioBuffer = await generatePageAudio(page.text, voiceKey, usage => onUsage?.(page, usage));
      const audioUrl = await savePageAudio(storyId, filename, audioBuffer, userId);
      await updatePageAudioUrlBoth(storyId, page.pageNumber, audioUrl);
      page.audioUrl = audioUrl;

      completedCount++;
      onProgress?.({
        message: `Narration for page ${page.pageNumber} complete`,
        pageNumber: page.pageNumber,
        pageStatus: 'completed',
      });
    } catch (error) {
      if (signal.aborted) throw new Error('Generation cancelled');
      failedCount++;
      console.error(`Failed to generate audio for page ${page.pageNumber}:`, error);
      onProgress?.({
        message: `Narration for page ${page.pageNumber} failed`,
        pageNumber: page.pageNumber,
        pageStatus: 'failed',
      });

      // Detect unrecoverable errors (auth/quota) and abort remaining pages
      if (error instanceof Error && error.name === 'AbortError') {
        fatalError = error.message;
        console.warn(`Fatal audio error â skipping remaining ${pages.length - completedCount - failedCount} pages: ${fatalError}`);
        break;
      }
      // Other errors are non-fatal â continue with remaining pages
    }
  }

  const skippedCount = pages.length - completedCount - failedCount;
  return { completedCount, failedCount, skippedCount, error: fatalError };
}

export function isElevenLabsConfigured(): boolean {
  return !!config.elevenLabsApiKey;
}

/**
 * Retry audio generation only for pages that are missing audioUrl.
 */
export async function retryMissingAudio(
  storyId: string,
  pages: Page[],
  voiceKey: VoiceKey,
  userId: string | undefined,
  signal: AbortSignal,
  onProgress?: AudioProgressCallback,
  onUsage?: (page: Page, usage: {
    model: string;
    status: 'succeeded' | 'failed';
    billedCharacters: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>,
): Promise<AudioGenerationResult> {
  // Filter to only pages missing audio
  const pagesNeedingAudio = pages.filter(p => !p.audioUrl);

  if (pagesNeedingAudio.length === 0) {
    return { completedCount: 0, failedCount: 0, skippedCount: 0 };
  }

  let completedCount = 0;
  let failedCount = 0;
  let fatalError: string | undefined;

  for (const page of pagesNeedingAudio) {
    if (signal.aborted) throw new Error('Generation cancelled');
    if (fatalError) break;

    const filename = getPageAudioFilename(page.pageNumber);

    try {
      onProgress?.({
        message: `Retrying narration for page ${page.pageNumber}...`,
        pageNumber: page.pageNumber,
        pageStatus: 'generating',
      });

      const audioBuffer = await generatePageAudio(page.text, voiceKey, usage => onUsage?.(page, usage));
      const audioUrl = await savePageAudio(storyId, filename, audioBuffer, userId);
      await updatePageAudioUrlBoth(storyId, page.pageNumber, audioUrl);
      page.audioUrl = audioUrl;

      completedCount++;
      onProgress?.({
        message: `Narration for page ${page.pageNumber} complete`,
        pageNumber: page.pageNumber,
        pageStatus: 'completed',
      });
    } catch (error) {
      if (signal.aborted) throw new Error('Generation cancelled');
      failedCount++;
      console.error(`Failed to retry audio for page ${page.pageNumber}:`, error);
      onProgress?.({
        message: `Narration for page ${page.pageNumber} failed`,
        pageNumber: page.pageNumber,
        pageStatus: 'failed',
      });

      if (error instanceof Error && error.name === 'AbortError') {
        fatalError = error.message;
        break;
      }
    }
  }

  const skippedCount = pagesNeedingAudio.length - completedCount - failedCount;
  return { completedCount, failedCount, skippedCount, error: fatalError };
}
