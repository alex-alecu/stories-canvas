const SERVICE_WORKER_URL = '/service-worker.js';
const WARM_CACHE_MESSAGE = 'WARM_CACHE_URLS';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(SERVICE_WORKER_URL)
      .then(() => navigator.storage?.persist?.())
      .catch((error) => {
        console.error('Failed to register service worker:', error);
      });
  }, { once: true });
}

export function warmMediaCache(urls: string[]): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

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

  window.setTimeout(() => {
    void postWarmup();
  }, 0);
}
