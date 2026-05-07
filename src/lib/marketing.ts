import type {
  BillingCheckoutMarketingPayload,
  MarketingAttribution,
  MarketingConsentState,
  StoryPackOffer,
} from '../types';

const CONSENT_STORAGE_KEY = 'stories_canvas_marketing_consent';
const ATTRIBUTION_STORAGE_KEY = 'stories_canvas_marketing_attribution';
const SUCCESS_STORAGE_PREFIX = 'stories_canvas_marketing_success_';

const ATTRIBUTION_PARAM_MAP: Record<string, keyof MarketingAttribution> = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utm_content: 'utmContent',
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  fbclid: 'fbclid',
  ttclid: 'ttclid',
};

type PixelFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  loaded?: boolean;
  push?: PixelFunction;
  queue?: unknown[];
  version?: string;
};

type TikTokQueue = unknown[] & {
  load?: (pixelId: string) => void;
  page?: () => void;
  track?: (...args: unknown[]) => void;
};

type MarketingWindow = Window & typeof globalThis & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: PixelFunction;
  _fbq?: PixelFunction;
  ttq?: TikTokQueue;
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function marketingWindow(): MarketingWindow | null {
  return isBrowser() ? window as MarketingWindow : null;
}

function readJson<T>(key: string): T | null {
  if (!isBrowser()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browsers can disable localStorage; tracking should degrade silently.
  }
}

function readStorage(key: string): string | null {
  if (!isBrowser()) return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Browsers can disable localStorage; tracking should degrade silently.
  }
}

function compactValue(value: string | null | undefined, maxLength = 500): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function appendScript(id: string, src: string): void {
  if (!isBrowser() || document.getElementById(id)) return;

  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function normalizeCurrency(currency: string | undefined): string {
  const code = (currency || 'ron').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'RON';
}

export function getMarketingConsent(): MarketingConsentState | null {
  const consent = readJson<MarketingConsentState>(CONSENT_STORAGE_KEY);
  if (typeof consent?.marketing !== 'boolean') return null;
  return consent;
}

export function hasMarketingConsent(): boolean {
  return getMarketingConsent()?.marketing === true;
}

export function setMarketingConsent(marketing: boolean): MarketingConsentState {
  const consent: MarketingConsentState = {
    marketing,
    decidedAt: new Date().toISOString(),
  };

  writeJson(CONSENT_STORAGE_KEY, consent);

  if (marketing) {
    captureMarketingAttribution();
    loadMarketingPixels();
  }

  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent('marketing-consent-changed', { detail: consent }));
  }

  return consent;
}

export function getMarketingAttribution(): MarketingAttribution | undefined {
  const attribution = readJson<MarketingAttribution>(ATTRIBUTION_STORAGE_KEY);
  if (!attribution || typeof attribution !== 'object') return undefined;
  return attribution;
}

export function captureMarketingAttribution(): MarketingAttribution | undefined {
  if (!isBrowser()) return undefined;

  const existing = getMarketingAttribution() ?? {};
  const params = new URLSearchParams(window.location.search);
  const captured: MarketingAttribution = {};

  for (const [param, key] of Object.entries(ATTRIBUTION_PARAM_MAP)) {
    const value = compactValue(params.get(param), 255);
    if (value) {
      captured[key] = value;
    }
  }

  const hasNewAttribution = Object.keys(captured).length > 0;
  if (!hasNewAttribution && existing.landingPage) {
    return existing;
  }

  const next: MarketingAttribution = {
    ...existing,
    ...captured,
  };

  if (!existing.landingPage || hasNewAttribution) {
    next.landingPage = compactValue(`${window.location.pathname}${window.location.search}`, 500);
  }

  if (!existing.referrer && document.referrer) {
    next.referrer = compactValue(document.referrer, 500);
  }

  if (Object.keys(next).length > 0) {
    writeJson(ATTRIBUTION_STORAGE_KEY, next);
  }

  return next;
}

export function createMarketingEventId(prefix = 'event'): string {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${randomId}`;
}

export function getCheckoutMarketingPayload(eventId = createMarketingEventId('checkout')): BillingCheckoutMarketingPayload {
  const consent = getMarketingConsent() ?? { marketing: false };

  return {
    eventId,
    consent,
    attribution: consent.marketing ? getMarketingAttribution() : undefined,
  };
}

export function loadMarketingPixels(): void {
  const w = marketingWindow();
  if (!w || !hasMarketingConsent()) return;

  const gtmId = compactValue(import.meta.env.VITE_GTM_ID, 80);
  if (gtmId) {
    w.dataLayer = w.dataLayer ?? [];
    if (!document.getElementById('stories-canvas-gtm')) {
      w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    }
    appendScript('stories-canvas-gtm', `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`);
  }

  const ga4MeasurementId = compactValue(import.meta.env.VITE_GA4_MEASUREMENT_ID, 80);
  if (ga4MeasurementId) {
    w.dataLayer = w.dataLayer ?? [];
    w.gtag = w.gtag ?? ((...args: unknown[]) => {
      w.dataLayer?.push(args);
    });

    if (!document.getElementById('stories-canvas-gtag')) {
      w.gtag('js', new Date());
      w.gtag('config', ga4MeasurementId, { send_page_view: false });
    }

    appendScript('stories-canvas-gtag', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4MeasurementId)}`);
  }

  const metaPixelId = compactValue(import.meta.env.VITE_META_PIXEL_ID, 80);
  if (metaPixelId) {
    if (!w.fbq) {
      const fbq = ((...args: unknown[]) => {
        if (fbq.callMethod) {
          fbq.callMethod(...args);
        } else {
          fbq.queue?.push(args);
        }
      }) as PixelFunction;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      w.fbq = fbq;
      w._fbq = fbq;
    }

    if (!document.getElementById('stories-canvas-meta-pixel')) {
      w.fbq('init', metaPixelId);
    }

    appendScript('stories-canvas-meta-pixel', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  const tikTokPixelId = compactValue(import.meta.env.VITE_TIKTOK_PIXEL_ID, 80);
  if (tikTokPixelId) {
    if (!w.ttq) {
      const ttq = [] as unknown as TikTokQueue;
      ttq.load = (pixelId: string) => ttq.push(['load', pixelId]);
      ttq.page = () => ttq.push(['page']);
      ttq.track = (...args: unknown[]) => ttq.push(['track', ...args]);
      w.ttq = ttq;
    }

    if (!document.getElementById('stories-canvas-tiktok-pixel')) {
      w.ttq.load?.(tikTokPixelId);
    }

    appendScript('stories-canvas-tiktok-pixel', `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(tikTokPixelId)}&lib=ttq`);
  }
}

export function trackPageView(path = isBrowser() ? `${window.location.pathname}${window.location.search}` : '/', title = isBrowser() ? document.title : ''): void {
  const w = marketingWindow();
  if (!w || !hasMarketingConsent()) return;

  loadMarketingPixels();

  const pageLocation = window.location.href;
  w.dataLayer?.push({
    event: 'page_view',
    page_path: path,
    page_title: title,
    page_location: pageLocation,
  });
  w.gtag?.('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: pageLocation,
  });
  w.fbq?.('track', 'PageView');
  w.ttq?.page?.();
}

export function trackInitiateCheckout(params: {
  eventId: string;
  offer: StoryPackOffer;
  value: number;
  currency: string;
}): void {
  const w = marketingWindow();
  if (!w || !hasMarketingConsent()) return;

  loadMarketingPixels();

  const currency = normalizeCurrency(params.currency);
  const value = Number(params.value.toFixed(2));
  const item = {
    item_id: params.offer.slug,
    item_name: params.offer.name,
    price: value,
    quantity: 1,
  };

  w.dataLayer?.push({
    event: 'begin_checkout',
    event_id: params.eventId,
    ecommerce: {
      currency,
      value,
      items: [item],
    },
  });
  w.gtag?.('event', 'begin_checkout', {
    currency,
    value,
    items: [item],
    event_id: params.eventId,
  });
  w.fbq?.('track', 'InitiateCheckout', {
    content_ids: [params.offer.slug],
    content_name: params.offer.name,
    content_type: 'product',
    currency,
    value,
  }, {
    eventID: params.eventId,
  });
  w.ttq?.track?.('InitiateCheckout', {
    contents: [{ content_id: params.offer.slug, content_name: params.offer.name, quantity: 1, price: value }],
    currency,
    value,
  }, {
    event_id: params.eventId,
  });
}

export function trackPurchaseSuccessOnce(params: { checkoutSessionId: string }): void {
  const w = marketingWindow();
  if (!w || !hasMarketingConsent()) return;

  const storageKey = `${SUCCESS_STORAGE_PREFIX}${params.checkoutSessionId}`;
  if (readStorage(storageKey)) return;

  writeStorage(storageKey, new Date().toISOString());
  w.dataLayer?.push({
    event: 'checkout_success',
    checkout_session_id: params.checkoutSessionId,
  });
}
