import crypto from 'crypto';
import type { Page } from '../../shared/types.js';

export const MEDIA_CACHE_MAX_AGE_SECONDS = 31_536_000;
export const MEDIA_CACHE_CONTROL = `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, immutable`;

export function createAssetVersion(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function getPageImageFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.png`;
}

export function getPageAudioFilename(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(2, '0')}.mp3`;
}

export function appendAssetVersion(url: string, version?: string): string {
  if (!version) return url;

  const isAbsolute = /^[a-z][a-z\d+\-.]*:\/\//i.test(url);
  const parsed = new URL(url, 'http://asset.local');
  parsed.searchParams.set('v', version);

  if (isAbsolute) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function resolveAssetVersion(version: string | undefined, createdAt?: string): string | undefined {
  if (version) return version;
  if (!createdAt) return undefined;

  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return undefined;
  return timestamp.toString(36);
}

export function pageHasAudio(page: Pick<Page, 'audioUrl' | 'audioVersion'>): boolean {
  return Boolean(page.audioUrl || page.audioVersion);
}
