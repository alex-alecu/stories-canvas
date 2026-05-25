import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

type TestAuthUser = {
  id: string;
  email?: string;
  isAdmin?: boolean;
};

async function createBillingHarness(
  configOverrides: Record<string, unknown> = {},
  options: { authUser?: TestAuthUser } = {},
) {
  const express = (await import('express')).default;
  const { config } = await import('../config.js');
  const billingModule = await import('./billing.js');
  const originalConfig = { ...config };

  Object.assign(config, {
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    ...configOverrides,
  });

  const app = express();
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingModule.billingWebhookRouter);
  app.use('/api/billing', express.json(), (req, _res, next) => {
    if (options.authUser) {
      req.authUser = options.authUser;
    }
    next();
  }, billingModule.default);

  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind billing test server');
  }

  return {
    billingModule,
    close: async () => {
      Object.assign(config, originalConfig);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('checkout forwards compact consent and attribution metadata to Stripe session creation', async (t) => {
  const harness = await createBillingHarness({ useSupabase: true }, {
    authUser: {
      id: 'user-checkout',
      email: 'buyer@example.com',
    },
  });
  t.after(async () => {
    await harness.close();
  });

  const longValue = 'x'.repeat(700);
  const offer = {
    slug: 'pack_5',
    name: 'Small pack',
    description: 'Five story credits',
    credits: 5,
    priceMinor: 3900,
    currency: 'ron',
    isActive: true,
  };

  let checkoutParams: Record<string, any> | null = null;
  let pendingPurchaseParams: Record<string, any> | null = null;

  t.mock.method(harness.billingModule.billingStripeOps, 'isStripeConfigured', () => true);
  t.mock.method(harness.billingModule.billingStorageOps, 'getStoryPackOffer', async () => offer);
  t.mock.method(harness.billingModule.billingStripeOps, 'createStoryPackCheckoutSession', async (params) => {
    checkoutParams = params;
    return {
      checkoutUrl: 'https://checkout.stripe.test/session',
      checkoutSessionId: 'cs_checkout_123',
      stripeCustomerId: 'cus_checkout_123',
      amountMinor: offer.priceMinor,
      currency: offer.currency,
      metadata: {
        userId: 'user-checkout',
        offerSlug: 'pack_5',
        marketingEventId: 'checkout-event-123',
      },
    };
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'createPendingStoryPackPurchase', async (params) => {
    pendingPurchaseParams = params;
  });

  const response = await fetch(`${harness.baseUrl}/api/billing/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Billing metadata test',
      'X-Forwarded-For': '203.0.113.10, 10.0.0.2',
    },
    body: JSON.stringify({
      offerSlug: 'pack_5',
      eventId: `checkout-${longValue}`,
      consent: {
        marketing: true,
        decidedAt: '2026-05-07T10:00:00.000Z',
        ignored: 'not stored',
      },
      attribution: {
        utmSource: '  newsletter  ',
        utmMedium: 'email',
        utmCampaign: longValue,
        gclid: 'gclid-123',
        fbclid: 'fbclid-123',
        ttclid: 'ttclid-123',
        landingPage: `/billing?utm_campaign=${longValue}`,
        referrer: 'https://example.com/start',
        ignored: 'not stored',
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    checkoutUrl: 'https://checkout.stripe.test/session',
    checkoutSessionId: 'cs_checkout_123',
  });
  assert.ok(checkoutParams);
  assert.equal(checkoutParams.userId, 'user-checkout');
  assert.equal(checkoutParams.email, 'buyer@example.com');
  assert.equal(checkoutParams.marketing.clientIp, '203.0.113.10');
  assert.equal(checkoutParams.marketing.userAgent, 'Billing metadata test');
  assert.equal(checkoutParams.marketing.eventId.length, 120);
  assert.deepEqual(checkoutParams.marketing.consent, {
    marketing: true,
    decidedAt: '2026-05-07T10:00:00.000Z',
  });
  assert.equal(checkoutParams.marketing.attribution.utmSource, 'newsletter');
  assert.equal(checkoutParams.marketing.attribution.utmMedium, 'email');
  assert.equal(checkoutParams.marketing.attribution.utmCampaign.length, 255);
  assert.equal(checkoutParams.marketing.attribution.gclid, 'gclid-123');
  assert.equal(checkoutParams.marketing.attribution.fbclid, 'fbclid-123');
  assert.equal(checkoutParams.marketing.attribution.ttclid, 'ttclid-123');
  assert.equal(checkoutParams.marketing.attribution.landingPage.length, 500);
  assert.equal(checkoutParams.marketing.attribution.referrer, 'https://example.com/start');
  assert.equal(checkoutParams.marketing.attribution.ignored, undefined);
  assert.deepEqual(pendingPurchaseParams, {
    userId: 'user-checkout',
    offerSlug: 'pack_5',
    stripeCheckoutSessionId: 'cs_checkout_123',
    stripeCustomerId: 'cus_checkout_123',
    amountMinor: 3900,
    currency: 'ron',
    metadata: {
      userId: 'user-checkout',
      offerSlug: 'pack_5',
      marketingEventId: 'checkout-event-123',
    },
  });
});

test('billing webhook does not fulfill unpaid completed sessions', async (t) => {
  const harness = await createBillingHarness();
  t.after(async () => {
    await harness.close();
  });

  const event = {
    id: 'evt_unpaid_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_unpaid_123',
        payment_status: 'unpaid',
        metadata: {
          userId: 'user-1',
          offerSlug: 'pack_5',
        },
        payment_intent: 'pi_unpaid_123',
        customer: 'cus_unpaid_123',
        amount_total: 3900,
      },
    },
  };

  let fulfilled = false;

  t.mock.method(harness.billingModule.billingStripeOps, 'verifyStripeWebhookEvent', () => event as any);
  t.mock.method(harness.billingModule.billingStorageOps, 'createWebhookEvent', async () => {});
  t.mock.method(harness.billingModule.billingStorageOps, 'fulfillStoryPackPurchase', async () => {
    fulfilled = true;
    return {
      purchase_id: 'purchase_1',
      ledger_id: null,
      already_fulfilled: false,
      available_credits: 5,
    };
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventProcessed', async () => {});
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventFailed', async () => {});

  const response = await fetch(`${harness.baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'test-signature',
    },
    body: JSON.stringify({ id: event.id }),
  });

  assert.equal(response.status, 200);
  assert.equal(fulfilled, false);
});

test('billing webhook does not block fulfillment when marketing conversions fail', async (t) => {
  const harness = await createBillingHarness();
  t.after(async () => {
    await harness.close();
  });

  const event = {
    id: 'evt_paid_marketing_failure',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_paid_marketing_failure',
        payment_status: 'paid',
        metadata: {
          userId: 'user-3',
          offerSlug: 'pack_20',
          marketingConsent: 'granted',
          marketingEventId: 'checkout-event-3',
        },
        payment_intent: 'pi_paid_123',
        customer: 'cus_paid_123',
        customer_details: {
          email: 'buyer@example.com',
        },
        amount_total: 11900,
        currency: 'ron',
      },
    },
  };

  let fulfilled = false;
  let processed = false;
  let conversionParams: Record<string, unknown> | null = null;
  let conversionErrorLogs = 0;

  t.mock.method(harness.billingModule.billingStripeOps, 'verifyStripeWebhookEvent', () => event as any);
  t.mock.method(harness.billingModule.billingStorageOps, 'createWebhookEvent', async () => {});
  t.mock.method(harness.billingModule.billingStorageOps, 'fulfillStoryPackPurchase', async () => {
    fulfilled = true;
    return {
      purchase_id: 'purchase_3',
      ledger_id: 'ledger_3',
      already_fulfilled: false,
      available_credits: 20,
    };
  });
  t.mock.method(harness.billingModule.billingMarketingOps, 'sendPurchaseConversions', async (params) => {
    conversionParams = params;
    throw new Error('Marketing API unavailable');
  });
  t.mock.method(console, 'error', (message) => {
    if (String(message).includes('Failed to send marketing purchase conversions')) {
      conversionErrorLogs += 1;
    }
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventProcessed', async () => {
    processed = true;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventFailed', async () => {});

  const response = await fetch(`${harness.baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'test-signature',
    },
    body: JSON.stringify({ id: event.id }),
  });

  assert.equal(response.status, 200);
  assert.equal(fulfilled, true);
  assert.equal(processed, true);
  assert.ok(conversionParams);
  assert.equal(conversionParams.stripeCheckoutSessionId, 'cs_paid_marketing_failure');
  assert.equal(conversionParams.email, 'buyer@example.com');
  assert.equal(conversionErrorLogs, 1);
});

test('billing webhook fulfills async payment success after delayed checkout', async (t) => {
  const harness = await createBillingHarness();
  t.after(async () => {
    await harness.close();
  });

  const event = {
    id: 'evt_async_checkout',
    type: 'checkout.session.async_payment_succeeded',
    data: {
      object: {
        id: 'cs_async_123',
        payment_status: 'paid',
        metadata: {
          userId: 'user-2',
          offerSlug: 'pack_12',
        },
        payment_intent: 'pi_async_123',
        customer: 'cus_async_123',
        amount_total: 7900,
      },
    },
  };

  let fulfillmentParams: Record<string, unknown> | null = null;

  t.mock.method(harness.billingModule.billingStripeOps, 'verifyStripeWebhookEvent', () => event as any);
  t.mock.method(harness.billingModule.billingStorageOps, 'createWebhookEvent', async () => {});
  t.mock.method(harness.billingModule.billingStorageOps, 'fulfillStoryPackPurchase', async (params) => {
    fulfillmentParams = params;
    return {
      purchase_id: 'purchase_2',
      ledger_id: 'ledger_2',
      already_fulfilled: false,
      available_credits: 12,
    };
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventProcessed', async () => {});
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventFailed', async () => {});

  const response = await fetch(`${harness.baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'test-signature',
    },
    body: JSON.stringify({ id: event.id }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(fulfillmentParams, {
    userId: 'user-2',
    offerSlug: 'pack_12',
    stripeCheckoutSessionId: 'cs_async_123',
    stripePaymentIntentId: 'pi_async_123',
    stripeCustomerId: 'cus_async_123',
    amountMinor: 7900,
    currency: 'ron',
    metadata: {
      userId: 'user-2',
      offerSlug: 'pack_12',
    },
  });
});

test('billing webhook marks async payment failure without fulfillment', async (t) => {
  const harness = await createBillingHarness();
  t.after(async () => {
    await harness.close();
  });

  const event = {
    id: 'evt_async_checkout_failed',
    type: 'checkout.session.async_payment_failed',
    data: {
      object: {
        id: 'cs_async_failed_123',
        payment_status: 'unpaid',
        metadata: {
          userId: 'user-4',
          offerSlug: 'pack_5',
        },
        payment_intent: 'pi_async_failed_123',
        customer: 'cus_async_failed_123',
        amount_total: 3900,
        currency: 'ron',
      },
    },
  };

  let failedParams: Record<string, unknown> | null = null;
  let createdWebhookEvent: Record<string, unknown> | null = null;
  let fulfilled = false;
  let conversionSent = false;
  let processed = false;

  t.mock.method(harness.billingModule.billingStripeOps, 'verifyStripeWebhookEvent', () => event as any);
  t.mock.method(harness.billingModule.billingStorageOps, 'createWebhookEvent', async (eventId, eventType) => {
    createdWebhookEvent = { eventId, eventType };
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markStoryPackPurchaseFailed', async (params) => {
    failedParams = params;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'fulfillStoryPackPurchase', async () => {
    fulfilled = true;
    return {
      purchase_id: 'purchase_failed',
      ledger_id: null,
      already_fulfilled: false,
      available_credits: 5,
    };
  });
  t.mock.method(harness.billingModule.billingMarketingOps, 'sendPurchaseConversions', async () => {
    conversionSent = true;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventProcessed', async () => {
    processed = true;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventFailed', async () => {});

  const response = await fetch(`${harness.baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'test-signature',
    },
    body: JSON.stringify({ id: event.id }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(createdWebhookEvent, {
    eventId: 'evt_async_checkout_failed',
    eventType: 'checkout.session.async_payment_failed',
  });
  assert.equal(processed, true);
  assert.equal(fulfilled, false);
  assert.equal(conversionSent, false);
  assert.deepEqual(failedParams, {
    userId: 'user-4',
    offerSlug: 'pack_5',
    stripeCheckoutSessionId: 'cs_async_failed_123',
    stripePaymentIntentId: 'pi_async_failed_123',
    stripeCustomerId: 'cus_async_failed_123',
    amountMinor: 3900,
    currency: 'ron',
    metadata: {
      userId: 'user-4',
      offerSlug: 'pack_5',
    },
  });
});

test('billing webhook marks expired checkout without fulfillment', async (t) => {
  const harness = await createBillingHarness();
  t.after(async () => {
    await harness.close();
  });

  const event = {
    id: 'evt_checkout_expired',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: 'cs_expired_123',
        payment_status: 'unpaid',
        metadata: {
          userId: 'user-5',
          offerSlug: 'pack_20',
        },
        payment_intent: null,
        customer: 'cus_expired_123',
        amount_total: 11900,
        currency: 'ron',
      },
    },
  };

  let expiredParams: Record<string, unknown> | null = null;
  let createdWebhookEvent: Record<string, unknown> | null = null;
  let fulfilled = false;
  let conversionSent = false;
  let processed = false;

  t.mock.method(harness.billingModule.billingStripeOps, 'verifyStripeWebhookEvent', () => event as any);
  t.mock.method(harness.billingModule.billingStorageOps, 'createWebhookEvent', async (eventId, eventType) => {
    createdWebhookEvent = { eventId, eventType };
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markStoryPackPurchaseExpired', async (params) => {
    expiredParams = params;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'fulfillStoryPackPurchase', async () => {
    fulfilled = true;
    return {
      purchase_id: 'purchase_expired',
      ledger_id: null,
      already_fulfilled: false,
      available_credits: 20,
    };
  });
  t.mock.method(harness.billingModule.billingMarketingOps, 'sendPurchaseConversions', async () => {
    conversionSent = true;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventProcessed', async () => {
    processed = true;
  });
  t.mock.method(harness.billingModule.billingStorageOps, 'markWebhookEventFailed', async () => {});

  const response = await fetch(`${harness.baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'test-signature',
    },
    body: JSON.stringify({ id: event.id }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(createdWebhookEvent, {
    eventId: 'evt_checkout_expired',
    eventType: 'checkout.session.expired',
  });
  assert.equal(processed, true);
  assert.equal(fulfilled, false);
  assert.equal(conversionSent, false);
  assert.deepEqual(expiredParams, {
    userId: 'user-5',
    offerSlug: 'pack_20',
    stripeCheckoutSessionId: 'cs_expired_123',
    stripePaymentIntentId: undefined,
    stripeCustomerId: 'cus_expired_123',
    amountMinor: 11900,
    currency: 'ron',
    metadata: {
      userId: 'user-5',
      offerSlug: 'pack_20',
    },
  });
});
