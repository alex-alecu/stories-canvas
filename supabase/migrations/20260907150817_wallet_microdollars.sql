-- Store booked USD amounts as integer microdollars: USD 1 = 1000000.
-- Stop generation and apply this migration with the matching application release.
-- Original payment currencies, Stripe minor units, provider records, and legacy credit counts stay intact.
BEGIN;
ALTER TABLE public.story_pack_offers DROP CONSTRAINT story_pack_offers_credits_check;
ALTER TABLE public.user_credit_balances RENAME COLUMN available_credits TO balance_usd_micros;
ALTER TABLE public.user_credit_balances ALTER COLUMN balance_usd_micros TYPE BIGINT USING ROUND(balance_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.user_credit_balances.balance_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.credit_ledger RENAME COLUMN delta TO amount_usd_micros;
ALTER TABLE public.credit_ledger ALTER COLUMN amount_usd_micros TYPE BIGINT USING ROUND(amount_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.credit_ledger.amount_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.credit_ledger RENAME COLUMN balance_after TO balance_after_usd_micros;
ALTER TABLE public.credit_ledger ALTER COLUMN balance_after_usd_micros TYPE BIGINT USING ROUND(balance_after_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.credit_ledger.balance_after_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.billing_purchases RENAME COLUMN credits_granted TO credited_usd_micros;
ALTER TABLE public.billing_purchases ALTER COLUMN credited_usd_micros TYPE BIGINT USING ROUND(credited_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.billing_purchases.credited_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.stories RENAME COLUMN credit_cost TO credit_cost_usd_micros;
ALTER TABLE public.stories ALTER COLUMN credit_cost_usd_micros TYPE BIGINT USING ROUND(credit_cost_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.stories.credit_cost_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.story_pack_offers RENAME COLUMN credits TO amount_usd_micros;
ALTER TABLE public.story_pack_offers ALTER COLUMN amount_usd_micros TYPE BIGINT USING ROUND(amount_usd_micros * 1000000)::BIGINT;
COMMENT ON COLUMN public.story_pack_offers.amount_usd_micros IS 'USD microdollars. USD 1 = 1000000.';
ALTER TABLE public.story_pack_offers ADD CONSTRAINT story_pack_offers_amount_usd_micros_check
  CHECK (amount_usd_micros = price_minor::BIGINT * 10000 AND amount_usd_micros > 0);

-- Remove the decimal-dollar RPC signatures. All replacements use microdollar parameters and results.
DROP FUNCTION public.grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT);
DROP FUNCTION public.consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT);
DROP FUNCTION public.refund_story_credits(UUID, TEXT, TEXT);
DROP FUNCTION public.fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB);

CREATE OR REPLACE FUNCTION ensure_user_credit_balance(
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_credit_balances (user_id, balance_usd_micros, updated_at)
  VALUES (p_user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.charge_story_usage_usd() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance BIGINT; owner_id UUID;
BEGIN
  SELECT user_id INTO owner_id FROM stories WHERE id = NEW.story_id;
  IF NEW.user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'Usage owner does not match story'; END IF;
  IF owner_id IS NULL OR NEW.cost_usd_micros = 0 THEN RETURN NEW; END IF;
  PERFORM ensure_user_credit_balance(owner_id);
  UPDATE user_credit_balances AS b SET
    balance_usd_micros = b.balance_usd_micros - NEW.cost_usd_micros,
    updated_at = NOW()
  WHERE b.user_id = owner_id RETURNING b.balance_usd_micros INTO new_balance;
  INSERT INTO credit_ledger(user_id, amount_usd_micros, balance_after_usd_micros, reason, story_id, usage_event_id, note)
  VALUES (owner_id, -NEW.cost_usd_micros, new_balance,
    'story_usage', NEW.story_id, NEW.id, NEW.operation || ' · ' || NEW.model);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount_usd_micros BIGINT,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_purchase_id UUID DEFAULT NULL,
  p_admin_user_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  balance_usd_micros BIGINT
) AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  IF p_amount_usd_micros IS NULL OR p_amount_usd_micros <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    balance_usd_micros = (ucb.balance_usd_micros + p_amount_usd_micros)::BIGINT,
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
  RETURNING ucb.balance_usd_micros INTO new_balance;

  INSERT INTO credit_ledger (
    user_id,
    amount_usd_micros,
    balance_after_usd_micros,
    reason,
    story_id,
    purchase_id,
    admin_user_id,
    note
  ) VALUES (
    p_user_id,
    p_amount_usd_micros::BIGINT,
    new_balance,
    p_reason,
    p_story_id,
    p_purchase_id,
    p_admin_user_id,
    p_note
  )
  RETURNING id INTO ledger_id;

  balance_usd_micros := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION consume_credits(
  p_user_id UUID,
  p_amount_usd_micros BIGINT,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  balance_usd_micros BIGINT
) AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  IF p_amount_usd_micros IS NULL OR p_amount_usd_micros <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    balance_usd_micros = (ucb.balance_usd_micros - p_amount_usd_micros)::BIGINT,
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
    AND ucb.balance_usd_micros >= p_amount_usd_micros
  RETURNING ucb.balance_usd_micros INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO credit_ledger (
    user_id,
    amount_usd_micros,
    balance_after_usd_micros,
    reason,
    story_id,
    note
  ) VALUES (
    p_user_id,
    (-p_amount_usd_micros)::BIGINT,
    new_balance,
    p_reason,
    p_story_id,
    p_note
  )
  RETURNING id INTO ledger_id;

  balance_usd_micros := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION refund_story_credits(
  p_story_id UUID,
  p_reason TEXT DEFAULT 'story_refund',
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  refunded BOOLEAN,
  ledger_id UUID,
  balance_usd_micros BIGINT
) AS $$
DECLARE
  story_record stories%ROWTYPE;
  new_balance BIGINT;
BEGIN
  SELECT *
  INTO story_record
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;

  IF NOT FOUND
    OR story_record.user_id IS NULL
    OR story_record.credit_cost_usd_micros <= 0
    OR story_record.credit_charge_ledger_id IS NULL
    OR story_record.credit_refunded_at IS NOT NULL THEN
    refunded := FALSE;
    ledger_id := NULL;
    balance_usd_micros := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM ensure_user_credit_balance(story_record.user_id);

  UPDATE user_credit_balances ucb
  SET
    balance_usd_micros = (ucb.balance_usd_micros + story_record.credit_cost_usd_micros)::BIGINT,
    updated_at = NOW()
  WHERE ucb.user_id = story_record.user_id
  RETURNING ucb.balance_usd_micros INTO new_balance;

  INSERT INTO credit_ledger (
    user_id,
    amount_usd_micros,
    balance_after_usd_micros,
    reason,
    story_id,
    note
  ) VALUES (
    story_record.user_id,
    story_record.credit_cost_usd_micros::BIGINT,
    new_balance,
    p_reason,
    p_story_id,
    p_note
  )
  RETURNING id INTO ledger_id;

  UPDATE stories
  SET credit_refunded_at = NOW()
  WHERE id = p_story_id;

  refunded := TRUE;
  balance_usd_micros := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION fulfill_story_pack_purchase(
  p_user_id UUID,
  p_offer_slug TEXT,
  p_stripe_checkout_session_id TEXT,
  p_stripe_payment_intent_id TEXT DEFAULT NULL,
  p_stripe_customer_id TEXT DEFAULT NULL,
  p_amount_minor INTEGER DEFAULT 0,
  p_currency TEXT DEFAULT 'ron',
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS TABLE (
  purchase_id UUID,
  ledger_id UUID,
  already_fulfilled BOOLEAN,
  balance_usd_micros BIGINT
) AS $$
DECLARE
  purchase_record billing_purchases%ROWTYPE;
  offer_record story_pack_offers%ROWTYPE;
  grant_micros BIGINT;
  new_balance BIGINT;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR LENGTH(TRIM(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Stripe checkout session id is required';
  END IF;

  INSERT INTO billing_purchases (
    user_id,
    offer_slug,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    stripe_customer_id,
    amount_minor,
    currency,
    status,
    metadata,
    updated_at
  ) VALUES (
    p_user_id,
    p_offer_slug,
    p_stripe_checkout_session_id,
    p_stripe_payment_intent_id,
    p_stripe_customer_id,
    COALESCE(p_amount_minor, 0),
    COALESCE(p_currency, 'ron'),
    'pending',
    COALESCE(p_metadata, '{}'::JSONB),
    NOW()
  )
  ON CONFLICT (stripe_checkout_session_id) DO NOTHING;

  SELECT *
  INTO purchase_record
  FROM billing_purchases
  WHERE stripe_checkout_session_id = p_stripe_checkout_session_id
  FOR UPDATE;

  IF purchase_record.fulfilled_at IS NOT NULL OR purchase_record.status = 'completed' THEN
    purchase_id := purchase_record.id;
    ledger_id := NULL;
    already_fulfilled := TRUE;
    SELECT ucb.balance_usd_micros
    INTO balance_usd_micros
    FROM user_credit_balances ucb
    WHERE ucb.user_id = p_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO offer_record
  FROM story_pack_offers
  WHERE slug = COALESCE(purchase_record.offer_slug, p_offer_slug);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown offer slug %', p_offer_slug;
  END IF;

  IF p_metadata->>'walletCurrency' = 'USD' THEN
    IF lower(p_currency) <> 'usd' OR p_amount_minor <= 0
      OR (p_metadata->>'walletAmountUsd')::NUMERIC IS DISTINCT FROM p_amount_minor::NUMERIC / 100 THEN
      RAISE EXCEPTION 'Invalid USD checkout amount';
    END IF;
    grant_micros := p_amount_minor::BIGINT * 10000;
  ELSE
    -- Honor Checkout sessions opened before conversion at the same 1:1 rate.
    grant_micros := CASE p_offer_slug WHEN 'pack_5' THEN 5000000 WHEN 'pack_12' THEN 12000000 WHEN 'pack_20' THEN 20000000 END;
  END IF;
  IF purchase_record.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Purchase owner mismatch'; END IF;
  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    balance_usd_micros = (ucb.balance_usd_micros + grant_micros)::BIGINT,
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
  RETURNING ucb.balance_usd_micros INTO new_balance;

  UPDATE billing_purchases
  SET
    user_id = p_user_id,
    offer_slug = offer_record.slug,
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
    stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
    amount_minor = COALESCE(p_amount_minor, amount_minor),
    currency = COALESCE(p_currency, currency),
    credited_usd_micros = grant_micros,
    status = 'completed',
    fulfilled_at = COALESCE(fulfilled_at, NOW()),
    metadata = COALESCE(p_metadata, metadata),
    updated_at = NOW()
  WHERE id = purchase_record.id
  RETURNING * INTO purchase_record;

  INSERT INTO credit_ledger (
    user_id,
    amount_usd_micros,
    balance_after_usd_micros,
    reason,
    purchase_id,
    note
  ) VALUES (
    p_user_id,
    grant_micros,
    new_balance,
    'pack_purchase',
    purchase_record.id,
    offer_record.slug
  )
  RETURNING id INTO ledger_id;

  purchase_id := purchase_record.id;
  already_fulfilled := FALSE;
  balance_usd_micros := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.grant_credits(UUID, BIGINT, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, BIGINT, TEXT, UUID, UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.consume_credits(UUID, BIGINT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, BIGINT, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.refund_story_credits(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_story_credits(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_story_pack_environment_defaults(
  p_fingerprint TEXT,
  p_currency TEXT,
  p_pack_5_price_minor INTEGER,
  p_pack_12_price_minor INTEGER,
  p_pack_20_price_minor INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_fingerprint TEXT;
BEGIN
  IF p_fingerprint IS NULL OR LENGTH(p_fingerprint) <> 64 THEN
    RAISE EXCEPTION 'Invalid environment pricing fingerprint';
  END IF;
  IF p_currency !~ '^[a-z]{3}$' THEN
    RAISE EXCEPTION 'Invalid story pack currency';
  END IF;
  IF p_pack_5_price_minor < 0 OR p_pack_12_price_minor < 0 OR p_pack_20_price_minor < 0 THEN
    RAISE EXCEPTION 'Story pack prices must be non-negative';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('story_pack_pricing'));

  SELECT fingerprint INTO previous_fingerprint
  FROM app_environment_config
  WHERE config_key = 'story_pack_pricing';

  IF previous_fingerprint = p_fingerprint THEN
    RETURN FALSE;
  END IF;

  UPDATE story_pack_offers
  SET
    currency = p_currency,
    amount_usd_micros = (CASE slug
      WHEN 'pack_5' THEN p_pack_5_price_minor
      WHEN 'pack_12' THEN p_pack_12_price_minor
      WHEN 'pack_20' THEN p_pack_20_price_minor
    END)::BIGINT * 10000,
    price_minor = CASE slug
      WHEN 'pack_5' THEN p_pack_5_price_minor
      WHEN 'pack_12' THEN p_pack_12_price_minor
      WHEN 'pack_20' THEN p_pack_20_price_minor
    END,
    updated_at = NOW()
  WHERE slug IN ('pack_5', 'pack_12', 'pack_20');

  INSERT INTO app_environment_config (config_key, fingerprint, applied_at)
  VALUES ('story_pack_pricing', p_fingerprint, NOW())
  ON CONFLICT (config_key) DO UPDATE
  SET fingerprint = EXCLUDED.fingerprint, applied_at = EXCLUDED.applied_at;

  RETURN TRUE;
END;
$$;


COMMIT;
