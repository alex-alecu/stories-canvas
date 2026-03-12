import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import pRetry, { AbortError } from 'p-retry';
import { config } from '../config.js';
import { uploadAudio } from './supabaseStorage.js';
import { saveAudio } from '../utils/storage.js';
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
  style?: number;
}

function getVoiceSettings(voiceKey: VoiceKey): VoiceSettings {
  const baseSettings: Record<VoiceKey, VoiceSettings> = {
    grandma: {
      voiceId: config.voiceIds.grandma,
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0.4,
    },
    grandpa: {
      voiceId: config.voiceIds.grandpa,
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0.4,
    },
    dad: {
      voiceId: config.voiceIds.dad,
      stability: 0.65,
      similarityBoost: 0.75,
      style: 0.3,
    },
    mom: {
      voiceId: config.voiceIds.mom,
      stability: 0.65,
      similarityBoost: 0.75,
      style: 0.3,
    },
    whisper: {
      voiceId: config.voiceIds.whisper,
      stability: 0.3,
      similarityBoost: 0.85,
      style: 0.8,
    },
  };

  return baseSettings[voiceKey];
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function generatePageAudio(
  text: string,
  voiceKey: VoiceKey,
): Promise<Buffer> {
  const elevenlabs = getClient();
  const settings = getVoiceSettings(voiceKey);

  const audioStream = await pRetry(
    async () => {
      const response = await elevenlabs.textToSpeech.convert(settings.voiceId, {
        text,
        modelId: config.elevenLabsModel,
        outputFormat: 'mp3_44100_128',
        voiceSettings: {
          stability: settings.stability,
          similarityBoost: settings.similarityBoost,
          style: settings.style,
        },
      });
      return response;
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
        // Don't retry on quota or auth errors (both return 401)
        if (error.message.includes('quota_exceeded')) {
          throw new AbortError('ElevenLabs API key quota exceeded — increase the per-key quota limit in your ElevenLabs dashboard');
        }
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          throw new AbortError('ElevenLabs API key is invalid');
        }
      },
    },
  );

  return streamToBuffer(audioStream);
}

async function savePageAudio(storyId: string, filename: string, audioBuffer: Buffer, userId?: string): Promise<string> {
  if (config.useSupabase) {
    return uploadAudio(userId, storyId, filename, audioBuffer);
  } else {
    await saveAudio(storyId, filename, audioBuffer);
    return `/api/stories/${storyId}/audio/${filename}`;
  }
}

type AudioProgressCallback = (progress: Partial<GenerationProgress>) => void;

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
): Promise<AudioGenerationResult> {
  let completedCount = 0;
  let failedCount = 0;
  let fatalError: string | undefined;

  for (const page of pages) {
    if (signal.aborted) throw new Error('Generation cancelled');

    // On unrecoverable error (auth/quota), skip remaining pages
    if (fatalError) break;

    const pageNum = String(page.pageNumber).padStart(2, '0');
    const filename = `page-${pageNum}.mp3`;

    try {
      onProgress?.({
        message: `Generating narration for page ${page.pageNumber}/${pages.length}...`,
        pageNumber: page.pageNumber,
        pageStatus: 'generating',
      });

      const audioBuffer = await generatePageAudio(page.text, voiceKey);
      const audioUrl = await savePageAudio(storyId, filename, audioBuffer, userId);

      // Update the page object's audioUrl in the scenario (persisted to DB or filesystem)
      if (config.useSupabase) {
        const { getSupabase } = await import('./supabase.js');
        const supabase = getSupabase();
        // Update the audioUrl in the JSONB scenario
        await supabase.rpc('update_page_audio_url', {
          story_id: storyId,
          page_number: page.pageNumber,
          audio_url: audioUrl,
        });
      } else {
        const { updatePageAudioUrl } = await import('../utils/storage.js');
        await updatePageAudioUrl(storyId, page.pageNumber, audioUrl);
      }

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
