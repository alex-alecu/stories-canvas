import type { Page } from '../../shared/types.js';

export const MEDIA_CACHE_MAX_AGE_SECONDS = 31_536_000;
export const MEDIA_CACHE_CONTROL = `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, immutable`;

export function getPageImageFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.png`;
}

export function getPageAudioFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.mp3`;
}

export function pageHasAudio(page: Pick<Page, 'audioUrl'>): boolean {
  return Boolean(page.audioUrl);
}
