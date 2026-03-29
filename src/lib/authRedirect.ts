import { readStorageItem, removeStorageItem, writeStorageItem } from './browserStorage';

const RETURN_TO_KEY = 'stories-canvas:returnTo';

export function normalizeReturnToPath(path: string | null | undefined, fallback = '/'): string {
  if (!path) {
    return fallback;
  }

  const trimmed = path.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  return trimmed;
}

export function saveReturnToPath(path: string): void {
  writeStorageItem(RETURN_TO_KEY, normalizeReturnToPath(path));
}

export function getReturnToPath(fallback = '/'): string {
  return normalizeReturnToPath(readStorageItem(RETURN_TO_KEY), fallback);
}

export function clearReturnToPath(): void {
  removeStorageItem(RETURN_TO_KEY);
}

export function consumeReturnToPath(fallback = '/'): string {
  const returnTo = getReturnToPath(fallback);
  clearReturnToPath();
  return returnTo;
}
