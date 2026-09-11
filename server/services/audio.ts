import { config } from '../config.js';
import type { GenerationProgress, Page, VoiceKey } from '../../shared/types.js';
import { DEFAULT_AUDIO_MODEL } from '../../shared/audioModels.js';
import { getPageAudioFilename } from '../utils/storyMedia.js';
import { saveAudio, updatePageAudioUrl as fsUpdatePageAudioUrl } from '../utils/storage.js';
import { uploadAudio, updatePageAudioUrl as sbUpdatePageAudioUrl } from './supabaseStorage.js';
import { getAudioModelSettings } from './audioGenerationContext.js';
import { generateElevenLabsPageAudio, isElevenLabsConfigured } from './elevenlabs.js';
import { generateOpenRouterPageAudio, type AudioUsageEvent } from './openrouterAudio.js';

type AudioProgressCallback = (progress: Partial<GenerationProgress>) => void;
type PageUsageCallback = (page: Page, usage: AudioUsageEvent) => void | Promise<void>;

export interface AudioGenerationResult {
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  error?: string;
}

export function isAudioConfigured(): boolean {
  return getAudioModelSettings().audioModel === DEFAULT_AUDIO_MODEL
    ? isElevenLabsConfigured()
    : !!config.openrouterApiKey || !!process.env.OPENROUTER_API_KEY?.trim();
}

export function generatePageAudio(
  text: string,
  voiceKey: VoiceKey,
  onUsage?: (usage: AudioUsageEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<Buffer> {
  const settings = getAudioModelSettings();
  return settings.audioModel === DEFAULT_AUDIO_MODEL
    ? generateElevenLabsPageAudio(text, voiceKey, onUsage, signal)
    : generateOpenRouterPageAudio(text, settings, { onUsage, signal });
}

export async function savePageAudio(storyId: string, filename: string, audioBuffer: Buffer, userId?: string): Promise<string> {
  if (config.useSupabase) return uploadAudio(userId, storyId, filename, audioBuffer);
  await saveAudio(storyId, filename, audioBuffer);
  return `/api/stories/${storyId}/audio/${filename}`;
}

async function updatePageAudioUrl(storyId: string, pageNumber: number, audioUrl: string): Promise<void> {
  if (config.useSupabase) await sbUpdatePageAudioUrl(storyId, pageNumber, audioUrl);
  else await fsUpdatePageAudioUrl(storyId, pageNumber, audioUrl);
}

async function generatePages(
  storyId: string,
  pages: Page[],
  voiceKey: VoiceKey,
  userId: string | undefined,
  signal: AbortSignal,
  retry: boolean,
  onProgress?: AudioProgressCallback,
  onUsage?: PageUsageCallback,
): Promise<AudioGenerationResult> {
  let completedCount = 0;
  let failedCount = 0;
  let fatalError: string | undefined;
  for (const page of pages) {
    if (signal.aborted) throw new Error('Generation cancelled');
    try {
      onProgress?.({ message: `${retry ? 'Retrying' : 'Generating'} narration for page ${page.pageNumber}${retry ? '...' : `/${pages.length}...`}`,
        pageNumber: page.pageNumber, pageStatus: 'generating' });
      const audio = await generatePageAudio(page.text, voiceKey, usage => onUsage?.(page, usage), signal);
      const audioUrl = await savePageAudio(storyId, getPageAudioFilename(page.pageNumber), audio, userId);
      await updatePageAudioUrl(storyId, page.pageNumber, audioUrl);
      page.audioUrl = audioUrl;
      completedCount++;
      onProgress?.({ message: `Narration for page ${page.pageNumber} complete`, pageNumber: page.pageNumber, pageStatus: 'completed' });
    } catch (error) {
      if (signal.aborted) throw new Error('Generation cancelled');
      failedCount++;
      console.error(`Failed to ${retry ? 'retry' : 'generate'} audio for page ${page.pageNumber}:`, error);
      onProgress?.({ message: `Narration for page ${page.pageNumber} failed`, pageNumber: page.pageNumber, pageStatus: 'failed' });
      if (error instanceof Error && error.name === 'AbortError') {
        fatalError = error.message;
        break;
      }
    }
  }
  return { completedCount, failedCount, skippedCount: pages.length - completedCount - failedCount, error: fatalError };
}

export function generateAllPageAudio(
  storyId: string, pages: Page[], voiceKey: VoiceKey, userId: string | undefined, signal: AbortSignal,
  onProgress?: AudioProgressCallback, onUsage?: PageUsageCallback,
): Promise<AudioGenerationResult> {
  return generatePages(storyId, pages, voiceKey, userId, signal, false, onProgress, onUsage);
}

export function retryMissingAudio(
  storyId: string, pages: Page[], voiceKey: VoiceKey, userId: string | undefined, signal: AbortSignal,
  onProgress?: AudioProgressCallback, onUsage?: PageUsageCallback,
): Promise<AudioGenerationResult> {
  return generatePages(storyId, pages.filter(page => !page.audioUrl), voiceKey, userId, signal, true, onProgress, onUsage);
}
