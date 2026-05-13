const SERVICE_WORKER_URL = '/service-worker.js';
const WARM_CACHE_MESSAGE = 'WARM_CACHE_URLS';
const CACHE_MEDIA_MESSAGE = 'CACHE_MEDIA_URLS';
const DELETE_MEDIA_MESSAGE = 'DELETE_MEDIA_URLS';
const MEDIA_CACHE = 'stories-canvas-media-v2';

export interface CacheMediaResult {
  cachedUrls: string[];
  failedUrls: string[];
  bytes: number;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const register = () => {
      void navigator.serviceWorker.register(SERVICE_WORKER_URL)
        .then(() => navigator.storage?.persist?.())
        .catch((error) => {
          console.error('Failed to register service worker:', error);
        });
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(register, { timeout: 3000 });
      return;
    }

    setTimeout(register, 3000);
  }, { once: true });
}

export function warmMediaCache(urls: string[]): void {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) return;

  const postWarmup = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const target = registration.active ?? navigator.serviceWorker.controller;
      target?.postMessage({ type: WARM_CACHE_MESSAGE, urls: uniqueUrls });
    } catch (error) {
      console.error('Failed to warm media cache:', error);
    }
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      void postWarmup();
    }, { timeout: 1500 });
    return;
  }

  setTimeout(() => {
    void postWarmup();
  }, 0);
}

export async function cacheStoryMedia(urls: string[]): Promise<CacheMediaResult> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) {
    return { cachedUrls: [], failedUrls: [], bytes: 0 };
  }

  if ('serviceWorker' in navigator) {
    try {
      return await postServiceWorkerMessage<CacheMediaResult>(CACHE_MEDIA_MESSAGE, { urls: uniqueUrls });
    } catch {
      // Fall through to direct Cache Storage when the service worker is not active yet.
    }
  }

  return cacheMediaUrlsDirect(uniqueUrls);
}

export async function deleteCachedStoryMedia(urls: string[]): Promise<void> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) return;

  if ('serviceWorker' in navigator) {
    try {
      await postServiceWorkerMessage<{ deletedUrls: string[] }>(DELETE_MEDIA_MESSAGE, { urls: uniqueUrls });
      return;
    } catch {
      // Fall through to direct Cache Storage when the service worker is not active yet.
    }
  }

  await deleteMediaUrlsDirect(uniqueUrls);
}

async function postServiceWorkerMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    2_000,
    'Service worker is not ready',
  );
  const target = registration.active ?? navigator.serviceWorker.controller;
  if (!target) {
    throw new Error('Service worker is not active');
  }

  return new Promise<T>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Service worker response timed out'));
    }, 60_000);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();

      if (event.data?.ok === false) {
        reject(new Error(event.data?.error || 'Service worker request failed'));
        return;
      }

      resolve(event.data?.result as T);
    };

    target.postMessage({ type, ...payload }, [channel.port2]);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        reject(error);
      });
  });
}

async function cacheMediaUrlsDirect(urls: string[]): Promise<CacheMediaResult> {
  if (!('caches' in window)) {
    return { cachedUrls: [], failedUrls: urls, bytes: 0 };
  }

  const cache = await window.caches.open(MEDIA_CACHE);
  const cachedUrls: string[] = [];
  const failedUrls: string[] = [];
  let bytes = 0;

  await Promise.all(urls.map(async (rawUrl) => {
    try {
      const url = new URL(rawUrl, window.location.origin);
      const cacheKey = url.toString();
      const cached = await cache.match(cacheKey);
      if (cached) {
        cachedUrls.push(cacheKey);
        bytes += await getResponseByteLength(cached.clone());
        return;
      }

      const response = await fetchMediaResponse(url);
      if (response.status !== 200) {
        failedUrls.push(cacheKey);
        return;
      }

      bytes += await getResponseByteLength(response.clone());
      await cache.put(cacheKey, response.clone());
      cachedUrls.push(cacheKey);
    } catch {
      failedUrls.push(rawUrl);
    }
  }));

  return { cachedUrls, failedUrls, bytes };
}

async function deleteMediaUrlsDirect(urls: string[]): Promise<void> {
  if (!('caches' in window)) return;

  const cache = await window.caches.open(MEDIA_CACHE);
  await Promise.all(urls.map(async (rawUrl) => {
    const url = new URL(rawUrl, window.location.origin);
    await cache.delete(url.toString());
  }));
}

async function fetchMediaResponse(url: URL): Promise<Response> {
  if (url.origin === window.location.origin) {
    return fetch(url.toString());
  }

  try {
    return await fetch(new Request(url.toString(), { mode: 'cors', credentials: 'omit' }));
  } catch {
    return fetch(url.toString());
  }
}

async function getResponseByteLength(response: Response): Promise<number> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  try {
    return (await response.arrayBuffer()).byteLength;
  } catch {
    return 0;
  }
}
