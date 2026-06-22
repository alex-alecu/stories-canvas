const APP_CACHE = 'stories-canvas-app-v3';
const MEDIA_CACHE = 'stories-canvas-media-v2';
const DATA_CACHE = 'stories-canvas-data-v2';
const APP_SHELL_CACHE_KEY = `${self.location.origin}/__sw_app_shell__`;
const DATA_TTL_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = 'x-sw-cached-at';
const APP_SHELL_ASSET_PATHS = [
  '/manifest.webmanifest',
  '/icon.png',
  '/icon-small.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-big.png',
  '/logo-big-256.avif',
  '/logo-big-256.png',
  '/logo-big-256.webp',
  '/logo-big-384.avif',
  '/logo-big-384.png',
  '/logo-big-384.webp',
  '/logo-big-512.avif',
  '/logo-big-512.png',
  '/logo-big-512.webp',
  '/fonts/nunito-latin.woff2',
  '/fonts/nunito-latin-ext.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key !== APP_CACHE && key !== MEDIA_CACHE && key !== DATA_CACHE)
        .map((key) => caches.delete(key)),
    );
    await cacheAppShell();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !Array.isArray(data.urls)) return;

  if (data.type === 'WARM_CACHE_URLS') {
    event.waitUntil(cacheMediaUrls(data.urls));
    return;
  }

  if (data.type === 'CACHE_MEDIA_URLS') {
    event.waitUntil(replyToMessage(event, () => cacheMediaUrls(data.urls)));
    return;
  }

  if (data.type === 'DELETE_MEDIA_URLS') {
    event.waitUntil(replyToMessage(event, () => deleteMediaUrls(data.urls)));
  }
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

  if (isAppAssetRequest(request, url)) {
    event.respondWith(cacheFirstAppAsset(request));
    return;
  }

  if (isDataRequest(request, url)) {
    event.respondWith(networkFirstData(request));
  }
});

async function cacheAppShell() {
  const cache = await caches.open(APP_CACHE);
  let response;
  try {
    response = await fetch('/', { cache: 'no-cache' });
  } catch {
    return;
  }
  if (!response.ok) return;

  const stampedResponse = await stampResponse(response.clone());
  await cache.put(APP_SHELL_CACHE_KEY, stampedResponse.clone());
  await cache.put(`${self.location.origin}/`, stampedResponse.clone());
  await cache.put(`${self.location.origin}/index.html`, stampedResponse.clone());

  const html = await response.text();
  const assetUrls = [...new Set([
    ...collectAppAssetUrls(html),
    ...APP_SHELL_ASSET_PATHS.map((assetPath) => new URL(assetPath, self.location.origin).toString()),
  ])];
  await Promise.all(assetUrls.map(async (assetUrl) => {
    try {
      const assetResponse = await fetch(assetUrl, { cache: 'reload' });
      if (assetResponse.ok) {
        await cache.put(assetUrl, assetResponse.clone());
      }
    } catch {
      // Runtime fetches still fill the app cache when an install-time fetch fails.
    }
  }));
}

function collectAppAssetUrls(html) {
  const urls = new Set();
  const addUrl = (rawUrl) => {
    try {
      const url = new URL(rawUrl, self.location.origin);
      if (url.origin === self.location.origin) {
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed URLs.
    }
  };

  const urlAttributePattern = /<(?:script|link|img|source)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(urlAttributePattern)) {
    addUrl(match[1]);
  }

  const srcSetPattern = /\b(?:srcset|imagesrcset)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(srcSetPattern)) {
    for (const candidate of match[1].split(',')) {
      const rawUrl = candidate.trim().split(/\s+/)[0];
      if (rawUrl) addUrl(rawUrl);
    }
  }

  return [...urls];
}

function isStoryStatusRequest(url) {
  return url.origin === self.location.origin && /^\/api\/stories\/[^/]+\/status$/.test(url.pathname);
}

function isMediaUrl(url) {
  if (url.origin === self.location.origin) {
    return /^\/api\/stories\/[^/]+\/(images|audio)\/[^/]+$/.test(url.pathname);
  }

  return /^\/storage\/v1\/object\/public\/story-images\//.test(url.pathname);
}

function isAppAssetRequest(request, url) {
  if (request.mode === 'navigate') return false;

  if (url.origin === self.location.origin && (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    isSameOriginStaticImage(url) ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/manifest.webmanifest'
  )) {
    return true;
  }

  return request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'worker';
}

function isSameOriginStaticImage(url) {
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return false;
  }

  return /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname);
}

function isDataRequest(request, url) {
  return request.mode === 'navigate' || (url.origin === self.location.origin && url.pathname.startsWith('/api/'));
}

async function cacheFirstAppAsset(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') {
    await cache.put(request, response.clone());
  }
  return response;
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

async function cacheMediaUrls(urls) {
  const cache = await caches.open(MEDIA_CACHE);
  const cachedUrls = [];
  const failedUrls = [];
  let bytes = 0;

  await Promise.all(urls.map(async (rawUrl) => {
    try {
      const url = new URL(rawUrl, self.location.origin);
      const cacheKey = url.toString();
      if (!isMediaUrl(url)) {
        failedUrls.push(cacheKey);
        return;
      }

      const cached = await cache.match(cacheKey);
      if (cached) {
        cachedUrls.push(cacheKey);
        bytes += await getResponseByteLength(cached.clone());
        return;
      }

      const response = await fetchWarmMediaResponse(url);
      if (response && isCacheableMediaResponse(response)) {
        bytes += await getResponseByteLength(response.clone());
        await cache.put(cacheKey, response.clone());
        cachedUrls.push(cacheKey);
        return;
      }

      failedUrls.push(cacheKey);
    } catch {
      failedUrls.push(rawUrl);
    }
  }));

  return { cachedUrls, failedUrls, bytes };
}

async function deleteMediaUrls(urls) {
  const cache = await caches.open(MEDIA_CACHE);
  const deletedUrls = [];

  await Promise.all(urls.map(async (rawUrl) => {
    try {
      const url = new URL(rawUrl, self.location.origin);
      const cacheKey = url.toString();
      await cache.delete(cacheKey);
      deletedUrls.push(cacheKey);
    } catch {
      // Ignore malformed URLs.
    }
  }));

  return { deletedUrls };
}

async function replyToMessage(event, work) {
  const port = event.ports?.[0];
  if (!port) {
    await work();
    return;
  }

  try {
    const result = await work();
    port.postMessage({ ok: true, result });
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Service worker request failed',
    });
  }
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

async function getResponseByteLength(response) {
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
        const appCache = await caches.open(APP_CACHE);
        await appCache.put(APP_SHELL_CACHE_KEY, stampedResponse.clone());
      }
    }
    return response;
  } catch {
    const cached = await matchFreshData(cache, cacheKey);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const appCache = await caches.open(APP_CACHE);
      const shell = await appCache.match(APP_SHELL_CACHE_KEY);
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
