export function readStorageItem(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStoredEnum<T extends string>(key: string, allowedValues: readonly T[]): T | null {
  const stored = readStorageItem(key);
  if (stored && (allowedValues as readonly string[]).includes(stored)) {
    return stored as T;
  }
  return null;
}

export function readStoredBoolean(key: string, fallback = false): boolean {
  const stored = readStorageItem(key);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return fallback;
}

export function readStoredNumber(
  key: string,
  fallback: number,
  isValid?: (value: number) => boolean,
): number {
  const stored = readStorageItem(key);
  if (stored === null) {
    return fallback;
  }

  const value = Number.parseFloat(stored);
  if (Number.isNaN(value) || (isValid && !isValid(value))) {
    return fallback;
  }

  return value;
}

export function writeStorageItem(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore unavailable or full storage.
  }
}

export function removeStorageItem(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}
