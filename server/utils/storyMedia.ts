import type { Page } from '../../shared/types.js';

export const MEDIA_CACHE_MAX_AGE_SECONDS = 31_536_000;
export const MEDIA_CACHE_CONTROL = `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, immutable`;
export const COVER_IMAGE_VARIANTS = {
  thumb: { filename: 'cover-thumb.webp', width: 320, height: 240 },
  card: { filename: 'cover-card.webp', width: 640, height: 480 },
} as const;

export type CoverImageVariantKey = keyof typeof COVER_IMAGE_VARIANTS;

export function getPageImageFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.png`;
}

export function isCoverImageSourceFilename(filename: string): boolean {
  return filename === getPageImageFilename(1);
}

export function getCoverImageVariantFilename(variant: CoverImageVariantKey): string {
  return COVER_IMAGE_VARIANTS[variant].filename;
}

export function getPageAudioFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.mp3`;
}

export function pageHasAudio(page: Pick<Page, 'audioUrl'>): boolean {
  return Boolean(page.audioUrl);
}
