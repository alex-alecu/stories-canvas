import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const migrationName = '20260907150817_wallet_microdollars.sql';
const userId = '10000000-0000-4000-8000-000000000001';
const storyId = '20000000-0000-4000-8000-000000000001';

test('wallet migration preserves existing money and uses integer microdollars for new transactions', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
    CREATE TABLE storage.objects (id UUID, bucket_id TEXT);
  `);
  for (const name of (await fs.readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (name >= migrationName) break;
    const sql = await fs.readFile(new URL(name, migrations), 'utf8');
    // PGlite has the built-in gen_random_uuid used by these migrations, but not pgcrypto.
    await db.exec(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  }
  await db.exec(`
    INSERT INTO auth.users VALUES ('${userId}');
    INSERT INTO stories (id, user_id, prompt, credit_cost) VALUES ('${storyId}', '${userId}', 'A rabbit', 0.030001);
    INSERT INTO user_credit_balances (user_id, available_credits, legacy_credits_converted)
      VALUES ('${userId}', 9.990001, 12.3);
    INSERT INTO credit_ledger (user_id, delta, balance_after, reason, story_id)
      VALUES ('${userId}', -0.009999, 9.990001, 'story_usage', '${storyId}');
    INSERT INTO billing_purchases (user_id, offer_slug, stripe_checkout_session_id, amount_minor, currency, credits_granted, status)
      VALUES ('${userId}', 'pack_5', 'historical-ron', 3900, 'ron', 5, 'completed');
  `);
  await db.exec(await fs.readFile(new URL(migrationName, migrations), 'utf8'));
  const balance = await db.query(`SELECT balance_usd_micros::text AS balance,
    legacy_credits_converted::text AS legacy FROM user_credit_balances WHERE user_id = '${userId}'`);
  assert.deepEqual(balance.rows, [{ balance: '9990001', legacy: '12.300000' }]);
  assert.deepEqual((await db.query(`SELECT amount_usd_micros::text AS amount,
    balance_after_usd_micros::text AS balance FROM credit_ledger WHERE user_id = '${userId}'`)).rows,
  [{ amount: '-9999', balance: '9990001' }]);
  assert.deepEqual((await db.query(`SELECT credited_usd_micros::text AS amount, amount_minor, currency FROM billing_purchases`)).rows,
    [{ amount: '5000000', amount_minor: 3900, currency: 'ron' }]);
  assert.deepEqual((await db.query(`SELECT credit_cost_usd_micros::text AS cost FROM stories`)).rows, [{ cost: '30001' }]);
  assert.deepEqual((await db.query(`SELECT amount_usd_micros::text AS amount FROM story_pack_offers ORDER BY display_order`)).rows,
    [{ amount: '10000000' }, { amount: '25000000' }, { amount: '50000000' }]);

  const columns = await db.query<{ data_type: string }>(`SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('balance_usd_micros', 'amount_usd_micros',
      'balance_after_usd_micros', 'credited_usd_micros', 'credit_cost_usd_micros')`);
  assert.equal(columns.rows.length, 6);
  assert.ok(columns.rows.every(column => column.data_type === 'bigint'));
  const readBalance = async () => (await db.query<{ balance: string }>(
    `SELECT balance_usd_micros::text AS balance FROM user_credit_balances WHERE user_id = '${userId}'`)).rows[0].balance;
  await db.query(`SELECT * FROM grant_credits('${userId}', 1::bigint, 'admin_grant')`);
  assert.equal(await readBalance(), '9990002');
  await db.query(`SELECT * FROM consume_credits('${userId}', 2::bigint, 'usage')`);
  assert.equal(await readBalance(), '9990000');
  await assert.rejects(db.query(`SELECT * FROM consume_credits('${userId}', 10000000::bigint, 'usage')`), /INSUFFICIENT_CREDITS/);
  await assert.rejects(db.query(`SELECT * FROM grant_credits('${userId}', 0::bigint, 'admin_grant')`), /Amount must be positive/);
  assert.equal(await readBalance(), '9990000');

  const recordUsage = (id: string, cost: number) => db.query(`SELECT record_story_usage_event(
    '${id}', '${storyId}', '${userId}', 'openrouter', 'page_image', 'initial_generation', 'succeeded',
    'google/gemini-3.1-flash-image-preview', 1, 0, 0, 0, 1, 0, 0, ${cost}, '{}', '{}', 'complete', now(), now())`);
  const eventId = '30000000-0000-4000-8000-000000000001';
  await recordUsage(eventId, 1);
  await recordUsage(eventId, 1);
  assert.equal(await readBalance(), '9989999');
  assert.deepEqual((await db.query(`SELECT amount_usd_micros::text AS amount FROM credit_ledger WHERE usage_event_id = '${eventId}'`)).rows,
    [{ amount: '-1' }]);
  await db.query(`SELECT rebuild_story_usage_aggregates()`);
  assert.equal(await readBalance(), '9989999');

  await db.exec(`UPDATE stories SET credit_charge_ledger_id =
    (SELECT id FROM credit_ledger WHERE story_id = '${storyId}' AND usage_event_id IS NULL LIMIT 1) WHERE id = '${storyId}'`);
  assert.equal((await db.query<{ refunded: boolean }>(`SELECT * FROM refund_story_credits('${storyId}')`)).rows[0].refunded, true);
  assert.equal(await readBalance(), '10020000');
  assert.equal((await db.query<{ refunded: boolean }>(`SELECT * FROM refund_story_credits('${storyId}')`)).rows[0].refunded, false);

  const fulfill = () => db.query<{ already_fulfilled: boolean }>(`SELECT * FROM fulfill_story_pack_purchase(
    '${userId}', 'pack_5', 'usd-checkout', NULL, NULL, 1234, 'usd', '{"walletCurrency":"USD","walletAmountUsd":12.34}')`);
  assert.equal((await fulfill()).rows[0].already_fulfilled, false);
  assert.equal((await fulfill()).rows[0].already_fulfilled, true);
  assert.equal(await readBalance(), '22360000');
  await db.query(`SELECT * FROM fulfill_story_pack_purchase('${userId}', 'pack_12', 'old-checkout', NULL, NULL, 7900, 'ron', '{}')`);
  assert.equal(await readBalance(), '34360000');
  await recordUsage('30000000-0000-4000-8000-000000000002', 34360001);
  assert.equal(await readBalance(), '-1');

  for (const signature of [
    'grant_credits(uuid,bigint,text,uuid,uuid,uuid,text)', 'consume_credits(uuid,bigint,text,uuid,text)',
    'refund_story_credits(uuid,text,text)', 'fulfill_story_pack_purchase(uuid,text,text,text,text,integer,text,jsonb)',
  ]) {
    assert.deepEqual((await db.query(`SELECT has_function_privilege('anon', '${signature}', 'execute') AS anon,
      has_function_privilege('authenticated', '${signature}', 'execute') AS authenticated,
      has_function_privilege('service_role', '${signature}', 'execute') AS service`)).rows,
    [{ anon: false, authenticated: false, service: true }]);
  }
  await db.query(`SELECT apply_story_pack_environment_defaults('${'a'.repeat(64)}', 'usd', 1234, 2500, 5000)`);
  assert.deepEqual((await db.query(`SELECT amount_usd_micros::text AS amount FROM story_pack_offers WHERE slug = 'pack_5'`)).rows,
    [{ amount: '12340000' }]);

  await t.test('speech migration keeps audio totals and charges one debit per request', async () => {
    await db.exec(await fs.readFile(new URL('20260911072001_openrouter_audio_usage.sql', migrations), 'utf8'));
    const before = BigInt(await readBalance());
    const audioEventId = '30000000-0000-4000-8000-000000000003';
    const recordAudio = () => db.query(`SELECT record_story_usage_event(
      '${audioEventId}', '${storyId}', '${userId}', 'openrouter', 'page_audio', 'add_audio', 'succeeded',
      'minimax/speech-2.8-hd', 1, 0, 0, 0, 0, 100, 0, 1234, '{}', '{}', 'complete', now(), now())`);
    await recordAudio();
    await recordAudio();
    assert.equal(BigInt(await readBalance()), before - 1234n);
    const readCosts = () => db.query(`SELECT usage_text_cost_usd_micros::text AS text,
      usage_image_cost_usd_micros::text AS image, usage_audio_cost_usd_micros::text AS audio
      FROM stories WHERE id = '${storyId}'`);
    const expected = [{ text: '0', image: '34360002', audio: '1234' }];
    assert.deepEqual((await readCosts()).rows, expected);
    await db.query('SELECT rebuild_story_usage_aggregates()');
    assert.deepEqual((await readCosts()).rows, expected);
    assert.equal(BigInt(await readBalance()), before - 1234n);
  });
});
