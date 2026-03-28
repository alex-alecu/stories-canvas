const MEDIA_CACHE = 'stories-canvas-media-v1';
const DATA_CACHE = 'stories-canvas-data-v1';
const APP_SHELL_CACHE_KEY = `${self.location.origin}/__sw_app_shell__`;
const DATA_TTL_MS = 60 * 60 * 1000;
const CACHED_AT_HEADER = 'x-sw-cached-at';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key !== MEDIA_CACHE && key !== DATA_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'WARM_CACHE_URLS' || !Array.isArray(data.urls)) return;

  event.waitUntil(warmMediaUrls(data.urls));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isStoryStatusRequest(url)) return;

  if (isMediaUrl(url)) {
    event.respondWith(cacheFirstMedia(request));
    return;
  }

  if (isDataRequest(request, url)) {
    event.respondWith(networkFirstData(request));
  }
});

function isStoryStatusRequest(url) {
  return url.origin === self.location.origin && /^\/api\/stories\/[^/]+\/status$/.test(url.pathname);
}

function isMediaUrl(url) {
  if (url.origin === self.location.origin) {
    return /^\/api\/stories\/[^/]+\/(images|audio)\/[^/]+$/.test(url.pathname);
  }

  return /^\/storage\/v1\/object\/public\/story-images\//.test(url.pathname);
}

function isDataRequest(request, url) {
  return request.mode === 'navigate' || (url.origin === self.location.origin && url.pathname.startsWith('/api/'));
}

async function cacheFirstMedia(request) {
  const url = new URL(request.url);
  const cache = await caches.open(MEDIA_CACHE);
  const cacheKey = url.toString();
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetchMediaResponse(request, url);
  if (isCacheableMediaResponse(response)) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
}

async function warmMediaUrls(urls) {
  const cache = await caches.open(MEDIA_CACHE);

  await Promise.all(urls.map(async (rawUrl) => {
    try {
      const url = new URL(rawUrl, self.location.origin);
      if (!isMediaUrl(url)) return;

      const cacheKey = url.toString();
      if (await cache.match(cacheKey)) return;

      const response = await fetchWarmMediaResponse(url);
      if (response && isCacheableMediaResponse(response)) {
        await cache.put(cacheKey, response.clone());
      }
    } catch {
      // Ignore warmup failures. Runtime requests still fall back to cache-first fetches.
    }
  }));
}

async function fetchMediaResponse(request, url) {
  if (url.origin === self.location.origin) {
    return fetch(request);
  }

  try {
    return await fetch(new Request(request, { mode: 'cors', credentials: 'omit' }));
  } catch {
    return fetch(request);
  }
}

async function fetchWarmMediaResponse(url) {
  if (url.origin === self.location.origin) {
    return fetch(url.toString());
  }

  try {
    return await fetch(new Request(url.toString(), { mode: 'cors', credentials: 'omit' }));
  } catch {
    return null;
  }
}

function isCacheableMediaResponse(response) {
  return response.status === 200;
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  const cacheKey = await buildDataCacheKey(request);

  try {
    const response = await fetch(request);
    if (isCacheableDataResponse(response)) {
      const stampedResponse = await stampResponse(response.clone());
      await cache.put(cacheKey, stampedResponse.clone());

      if (request.mode === 'navigate') {
        await cache.put(APP_SHELL_CACHE_KEY, stampedResponse.clone());
      }
    }
    return response;
  } catch {
    const cached = await matchFreshData(cache, cacheKey);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await matchFreshData(cache, APP_SHELL_CACHE_KEY);
      if (shell) return shell;
    }

    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function matchFreshData(cache, cacheKey) {
  const cached = await cache.match(cacheKey);
  if (!cached) return null;

  const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER));
  if (Number.isFinite(cachedAt) && (Date.now() - cachedAt) <= DATA_TTL_MS) {
    return cached;
  }

  await cache.delete(cacheKey);
  return null;
}

function isCacheableDataResponse(response) {
  if (!response.ok || response.type === 'opaque') return false;

  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/no-store/i.test(cacheControl);
}

async function stampResponse(response) {
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function buildDataCacheKey(request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');

  if (authHeader && url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    url.searchParams.set('__sw_auth', await hashValue(authHeader));
  }

  return url.toString();
}

async function hashValue(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}
