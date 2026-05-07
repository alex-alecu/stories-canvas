import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { MarketingAttribution, StoryPackOffer } from '../../shared/types.js';

export interface PurchaseConversionParams {
  userId: string;
  offerSlug: StoryPackOffer['slug'];
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  amountMinor: number;
  currency: string;
  email?: string;
  metadata: Record<string, unknown>;
  eventTime?: Date;
}

interface NormalizedPurchaseConversion {
  userId: string;
  offerSlug: StoryPackOffer['slug'];
  stripeCheckoutSessionId: string;
  amountMinor: number;
  value: number;
  currency: string;
  emailHash?: string;
  eventId: string;
  eventTime: Date;
  eventTimeSeconds: number;
  eventSourceUrl: string;
  attribution: MarketingAttribution;
  clientIp?: string;
  userAgent?: string;
}

const ATTRIBUTION_KEYS = [
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'ttclid',
  'landingPage',
  'referrer',
] as const satisfies ReadonlyArray<keyof MarketingAttribution>;

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeCurrency(currency: string | undefined): string {
  const code = (currency || 'ron').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'RON';
}

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function toEventSourceUrl(pathOrUrl: string | undefined): string {
  if (!pathOrUrl) return config.appBaseUrl;

  try {
    return new URL(pathOrUrl).toString();
  } catch {
    try {
      return new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, config.appBaseUrl).toString();
    } catch {
      return config.appBaseUrl;
    }
  }
}

function toGoogleAdsDateTime(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

function normalizePurchase(params: PurchaseConversionParams): NormalizedPurchaseConversion | null {
  if (metadataString(params.metadata, 'marketingConsent') !== 'granted') {
    return null;
  }

  const eventTime = params.eventTime ?? new Date();
  const attribution: MarketingAttribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = metadataString(params.metadata, key);
    if (value) {
      attribution[key] = value;
    }
  }

  return {
    userId: params.userId,
    offerSlug: params.offerSlug,
    stripeCheckoutSessionId: params.stripeCheckoutSessionId,
    amountMinor: params.amountMinor,
    value: Number((params.amountMinor / 100).toFixed(2)),
    currency: normalizeCurrency(params.currency),
    emailHash: params.email ? sha256(params.email) : undefined,
    eventId: metadataString(params.metadata, 'marketingEventId') ?? params.stripeCheckoutSessionId,
    eventTime,
    eventTimeSeconds: Math.floor(eventTime.getTime() / 1000),
    eventSourceUrl: toEventSourceUrl(attribution.landingPage),
    attribution,
    clientIp: metadataString(params.metadata, 'clientIp'),
    userAgent: metadataString(params.metadata, 'userAgent'),
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
}

async function sendMetaPurchase(purchase: NormalizedPurchaseConversion): Promise<void> {
  if (!config.metaPixelId || !config.metaCapiAccessToken) return;

  const userData: Record<string, unknown> = {};
  if (purchase.emailHash) userData.em = [purchase.emailHash];
  if (purchase.clientIp) userData.client_ip_address = purchase.clientIp;
  if (purchase.userAgent) userData.client_user_agent = purchase.userAgent;
  if (purchase.attribution.fbclid) {
    userData.fbc = `fb.1.${purchase.eventTime.getTime()}.${purchase.attribution.fbclid}`;
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: 'Purchase',
        event_time: purchase.eventTimeSeconds,
        event_id: purchase.eventId,
        action_source: 'website',
        event_source_url: purchase.eventSourceUrl,
        user_data: userData,
        custom_data: {
          currency: purchase.currency,
          value: purchase.value,
          order_id: purchase.stripeCheckoutSessionId,
          content_ids: [purchase.offerSlug],
          content_type: 'product',
        },
      },
    ],
  };

  if (config.metaTestEventCode) {
    body.test_event_code = config.metaTestEventCode;
  }

  await postJson(
    `https://graph.facebook.com/v20.0/${encodeURIComponent(config.metaPixelId)}/events?access_token=${encodeURIComponent(config.metaCapiAccessToken)}`,
    body,
  );
}

async function sendTikTokPurchase(purchase: NormalizedPurchaseConversion): Promise<void> {
  if (!config.tikTokPixelId || !config.tikTokEventsAccessToken) return;

  const body: Record<string, unknown> = {
    pixel_code: config.tikTokPixelId,
    event: 'CompletePayment',
    event_id: purchase.eventId,
    timestamp: purchase.eventTime.toISOString(),
    context: {
      ad: purchase.attribution.ttclid ? { callback: purchase.attribution.ttclid } : undefined,
      page: {
        url: purchase.eventSourceUrl,
        referrer: purchase.attribution.referrer,
      },
      user: {
        email: purchase.emailHash,
        ip: purchase.clientIp,
        user_agent: purchase.userAgent,
      },
    },
    properties: {
      value: purchase.value,
      currency: purchase.currency,
      contents: [
        {
          content_id: purchase.offerSlug,
          content_type: 'product',
          quantity: 1,
          price: purchase.value,
        },
      ],
    },
  };

  if (config.tikTokAdvertiserId) {
    body.advertiser_id = config.tikTokAdvertiserId;
  }

  if (config.tikTokTestEventCode) {
    body.test_event_code = config.tikTokTestEventCode;
  }

  await postJson('https://business-api.tiktok.com/open_api/v1.3/event/track/', body, {
    'Access-Token': config.tikTokEventsAccessToken,
  });
}

async function sendGa4Purchase(purchase: NormalizedPurchaseConversion): Promise<void> {
  if (!config.ga4MeasurementId || !config.ga4ApiSecret) return;

  await postJson(
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(config.ga4MeasurementId)}&api_secret=${encodeURIComponent(config.ga4ApiSecret)}`,
    {
      client_id: purchase.stripeCheckoutSessionId,
      user_id: purchase.userId,
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: purchase.stripeCheckoutSessionId,
            value: purchase.value,
            currency: purchase.currency,
            items: [
              {
                item_id: purchase.offerSlug,
                item_name: purchase.offerSlug,
                quantity: 1,
                price: purchase.value,
              },
            ],
          },
        },
      ],
    },
  );
}

async function getGoogleAdsAccessToken(): Promise<string | null> {
  if (!config.googleAdsClientId || !config.googleAdsClientSecret || !config.googleAdsRefreshToken) {
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleAdsClientId,
      client_secret: config.googleAdsClientSecret,
      refresh_token: config.googleAdsRefreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`Google OAuth refresh failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  const tokenResponse = await response.json() as { access_token?: string };
  return tokenResponse.access_token ?? null;
}

async function sendGoogleAdsPurchase(purchase: NormalizedPurchaseConversion): Promise<void> {
  if (
    !config.googleAdsDeveloperToken
    || !config.googleAdsCustomerId
    || !config.googleAdsPurchaseConversionActionId
  ) {
    return;
  }

  const clickId = purchase.attribution.gclid
    ? { gclid: purchase.attribution.gclid }
    : purchase.attribution.gbraid
      ? { gbraid: purchase.attribution.gbraid }
      : purchase.attribution.wbraid
        ? { wbraid: purchase.attribution.wbraid }
        : null;

  if (!clickId) return;

  const accessToken = await getGoogleAdsAccessToken();
  if (!accessToken) return;

  const customerId = config.googleAdsCustomerId.replace(/-/g, '');
  const body = {
    conversions: [
      {
        conversionAction: `customers/${customerId}/conversionActions/${config.googleAdsPurchaseConversionActionId}`,
        conversionDateTime: toGoogleAdsDateTime(purchase.eventTime),
        conversionValue: purchase.value,
        currencyCode: purchase.currency,
        orderId: purchase.stripeCheckoutSessionId,
        ...clickId,
      },
    ],
    partialFailure: true,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.googleAdsDeveloperToken,
  };

  if (config.googleAdsLoginCustomerId) {
    headers['login-customer-id'] = config.googleAdsLoginCustomerId.replace(/-/g, '');
  }

  await postJson(
    `https://googleads.googleapis.com/${config.googleAdsApiVersion}/customers/${customerId}/conversionUploads:uploadClickConversions`,
    body,
    headers,
  );
}

export async function sendPurchaseConversions(params: PurchaseConversionParams): Promise<void> {
  const purchase = normalizePurchase(params);
  if (!purchase) return;

  const tasks = [
    ['Meta Conversions API', sendMetaPurchase],
    ['TikTok Events API', sendTikTokPurchase],
    ['GA4 Measurement Protocol', sendGa4Purchase],
    ['Google Ads API', sendGoogleAdsPurchase],
  ] as const;

  await Promise.all(tasks.map(async ([name, send]) => {
    try {
      await send(purchase);
    } catch (error) {
      console.error(`${name} purchase conversion failed:`, error);
    }
  }));
}

export const marketingConversionsTestHooks = {
  normalizePurchase,
};
