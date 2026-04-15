import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

async function createBillingHarness(configOverrides: Record<string, unknown> = {}) {
  const express = (await import('express')).default;
  const { config } = await import('../config.js');
  const billingModule = await import('./billing.js');
  const originalConfig = {
    stripeSecretKey: config.stripeSecretKey,
    stripeWebhookSecret: config.stripeWebhookSecret,
  };

  Object.assign(config, {
    stripeSecretKey: 'sk_test_123',
    stripeWebhookSecret: 'whsec_test_123',
    ...configOverrides,
  });

  const app = express();
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingModule.billingWebhookRouter);

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
