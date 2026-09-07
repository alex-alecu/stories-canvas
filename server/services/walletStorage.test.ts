import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
import * as billing from './billingStorage.js';

test('billing converts database microdollars at the dollar API boundary', async (t) => {
  Object.assign(config, { supabaseUrl: 'https://wallet.test', supabaseServiceKey: 'local-test' });
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const offer = { slug: 'pack_5', name: '$10', description: 'Funds', amount_usd_micros: 10000000,
    price_minor: 1000, currency: 'usd', is_active: true };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body) writes.push({ path, body });
    const rows: Record<string, unknown> = {
      '/rest/v1/user_credit_balances': { balance_usd_micros: '9990001' },
      '/rest/v1/credit_ledger': [{ id: 'ledger-1', amount_usd_micros: -1, balance_after_usd_micros: 9990001,
        reason: 'story_usage', note: null, story_id: 'story-1', purchase_id: null, admin_user_id: null, created_at: '2026-09-07' }],
      '/rest/v1/billing_purchases': [{ id: 'purchase-1', offer_slug: 'pack_5', stripe_checkout_session_id: 'session-1',
        amount_minor: 1000, currency: 'usd', credited_usd_micros: 10000000, status: 'completed',
        created_at: '2026-09-07', updated_at: '2026-09-07', fulfilled_at: '2026-09-07' }],
      '/rest/v1/story_pack_offers': init?.method === 'PATCH' ? { ...offer, ...body } : [offer],
      '/rest/v1/rpc/grant_credits': [{ ledger_id: 'grant-1', balance_usd_micros: 9990002 }],
      '/rest/v1/rpc/consume_credits': [{ ledger_id: 'debit-1', balance_usd_micros: 9990000 }],
      '/rest/v1/rpc/refund_story_credits': [{ refunded: true, ledger_id: 'refund-1', balance_usd_micros: 10000000 }],
      '/rest/v1/rpc/fulfill_story_pack_purchase': [{ purchase_id: 'purchase-1', ledger_id: 'purchase-ledger-1',
        already_fulfilled: false, balance_usd_micros: 19990001 }],
    };
    assert.ok(path in rows, `Unexpected request: ${path}`);
    return Response.json(rows[path]);
  });
  assert.deepEqual(await billing.getUserCreditBalance('user-1'), { availableCredits: 9.990001 });
  const [entry] = await billing.listCreditLedger('user-1');
  assert.equal(entry.delta, -0.000001);
  assert.equal(entry.balanceAfter, 9.990001);
  assert.equal((await billing.listBillingPurchases('user-1'))[0].creditsGranted, 10);
  assert.equal((await billing.listStoryPackOffers())[0].credits, 10);
  assert.equal((await billing.grantCredits('user-1', 0.000001, { reason: 'admin_grant' })).available_credits, 9.990002);
  assert.equal((await billing.consumeCredits('user-1', 0.000001, { reason: 'usage' })).available_credits, 9.99);
  assert.equal((await billing.refundStoryCredits('story-1')).available_credits, 10);
  assert.equal((await billing.fulfillStoryPackPurchase({ userId: 'user-1', offerSlug: 'pack_5',
    stripeCheckoutSessionId: 'session-1', amountMinor: 1000, currency: 'usd' })).available_credits, 19.990001);
  await billing.updateStoryPackOffer('pack_5', { name: '$12.34', description: 'Funds', priceMinor: 1234, isActive: true });
  assert.equal(writes.find(write => write.path.endsWith('/grant_credits'))?.body.p_amount_usd_micros, 1);
  assert.equal(writes.find(write => write.path.endsWith('/consume_credits'))?.body.p_amount_usd_micros, 1);
  assert.equal(writes.find(write => write.path.endsWith('/story_pack_offers'))?.body.amount_usd_micros, 12340000);
});
