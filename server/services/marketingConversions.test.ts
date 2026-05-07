import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PurchaseConversionParams } from './marketingConversions.js';

process.env.GEMINI_API_KEY ??= 'test-key';

const { config } = await import('../config.js');
const {
  marketingConversionsTestHooks,
  sendPurchaseConversions,
} = await import('./marketingConversions.js');

const marketingConfigKeys = [
  'ga4MeasurementId',
  'ga4ApiSecret',
  'metaPixelId',
  'metaCapiAccessToken',
  'metaTestEventCode',
  'tikTokPixelId',
  'tikTokEventsAccessToken',
  'tikTokAdvertiserId',
  'tikTokTestEventCode',
  'googleAdsDeveloperToken',
  'googleAdsClientId',
  'googleAdsClientSecret',
  'googleAdsRefreshToken',
  'googleAdsCustomerId',
  'googleAdsLoginCustomerId',
  'googleAdsPurchaseConversionActionId',
  'googleAdsApiVersion',
] as const;

type MarketingConfigKey = typeof marketingConfigKeys[number];

function setMarketingConfig(
  t: test.TestContext,
  overrides: Partial<Record<MarketingConfigKey, string | undefined>>,
): void {
  const originalConfig = Object.fromEntries(
    marketingConfigKeys.map((key) => [key, config[key]]),
  ) as Partial<Record<MarketingConfigKey, string | undefined>>;

  Object.assign(config, Object.fromEntries(marketingConfigKeys.map((key) => [key, undefined])), {
    googleAdsApiVersion: 'v22',
    ...overrides,
  });

  t.after(() => {
    Object.assign(config, originalConfig);
  });
}

function purchaseParams(overrides: Partial<PurchaseConversionParams> = {}): PurchaseConversionParams {
  return {
    userId: 'user-1',
    offerSlug: 'pack_5',
    stripeCheckoutSessionId: 'cs_purchase_123',
    stripePaymentIntentId: 'pi_purchase_123',
    stripeCustomerId: 'cus_purchase_123',
    amountMinor: 3900,
    currency: 'ron',
    email: 'Buyer@Example.COM',
    metadata: {
      marketingConsent: 'granted',
      marketingEventId: 'checkout-event-123',
      gclid: 'gclid-123',
      fbclid: 'fbclid-123',
      ttclid: 'ttclid-123',
      landingPage: '/billing?utm_source=newsletter',
      referrer: 'https://example.com/start',
    },
    eventTime: new Date('2026-05-07T10:20:30.000Z'),
    ...overrides,
  };
}

test('marketing conversion normalization requires granted marketing consent', () => {
  const purchase = marketingConversionsTestHooks.normalizePurchase(purchaseParams({
    metadata: {
      marketingConsent: 'denied',
      marketingEventId: 'checkout-event-123',
    },
  }));

  assert.equal(purchase, null);
});

test('marketing conversion normalization keeps Stripe session as the purchase order id', () => {
  const purchase = marketingConversionsTestHooks.normalizePurchase(purchaseParams());

  assert.ok(purchase);
  assert.equal(purchase.stripeCheckoutSessionId, 'cs_purchase_123');
  assert.equal(purchase.eventId, 'checkout-event-123');
  assert.equal(purchase.currency, 'RON');
  assert.equal(purchase.value, 39);
  assert.equal(purchase.eventTimeSeconds, 1778149230);
  assert.equal(
    purchase.emailHash,
    createHash('sha256').update('buyer@example.com').digest('hex'),
  );
});

test('purchase conversions skip all providers when credentials are missing', async (t) => {
  setMarketingConfig(t, {});

  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 200 });
  });

  await sendPurchaseConversions(purchaseParams());

  assert.equal(fetchCalls, 0);
});

test('Meta purchase conversion uses checkout event id for dedup and Stripe session id for order id', async (t) => {
  setMarketingConfig(t, {
    metaPixelId: 'meta-pixel-123',
    metaCapiAccessToken: 'meta-token-123',
    metaTestEventCode: 'TEST123',
  });

  let requestUrl = '';
  let requestBody: any = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body));
    return new Response('{}', { status: 200 });
  });

  await sendPurchaseConversions(purchaseParams());

  assert.equal(requestUrl, 'https://graph.facebook.com/v20.0/meta-pixel-123/events?access_token=meta-token-123');
  assert.equal(requestBody.test_event_code, 'TEST123');
  assert.equal(requestBody.data[0].event_id, 'checkout-event-123');
  assert.equal(requestBody.data[0].custom_data.order_id, 'cs_purchase_123');
  assert.equal(requestBody.data[0].custom_data.value, 39);
  assert.deepEqual(requestBody.data[0].user_data.em, [
    createHash('sha256').update('buyer@example.com').digest('hex'),
  ]);
});

test('purchase conversion API failures are logged but do not reject fulfillment flow', async (t) => {
  setMarketingConfig(t, {
    metaPixelId: 'meta-pixel-123',
    metaCapiAccessToken: 'meta-token-123',
  });

  let fetchCalls = 0;
  let errorLogs = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('network unavailable');
  });
  t.mock.method(console, 'error', () => {
    errorLogs += 1;
  });

  await assert.doesNotReject(() => sendPurchaseConversions(purchaseParams()));

  assert.equal(fetchCalls, 1);
  assert.equal(errorLogs, 1);
});
