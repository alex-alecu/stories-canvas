ALTER TABLE stories
  ALTER COLUMN credit_cost TYPE NUMERIC(10,1) USING credit_cost::NUMERIC(10,1);

ALTER TABLE story_pack_offers
  DROP CONSTRAINT IF EXISTS story_pack_offers_credits_check,
  ALTER COLUMN credits TYPE NUMERIC(10,1) USING credits::NUMERIC(10,1),
  ADD CONSTRAINT story_pack_offers_credits_check CHECK (credits IN (5, 12, 20));

UPDATE story_pack_offers
SET
  name = CASE slug
    WHEN 'pack_5' THEN '5 credits'
    WHEN 'pack_12' THEN '12 credits'
    WHEN 'pack_20' THEN '20 credits'
    ELSE name
  END,
  description = CASE slug
    WHEN 'pack_5' THEN 'Up to 50 fast pages, 25 pro pages, or 50 audio pages.'
    WHEN 'pack_12' THEN 'Up to 120 fast pages, 60 pro pages, or 120 audio pages.'
    WHEN 'pack_20' THEN 'Up to 200 fast pages, 100 pro pages, or 200 audio pages.'
    ELSE description
  END
WHERE slug IN ('pack_5', 'pack_12', 'pack_20');

ALTER TABLE user_credit_balances
  ALTER COLUMN available_credits TYPE NUMERIC(10,1) USING available_credits::NUMERIC(10,1);

ALTER TABLE billing_purchases
  ALTER COLUMN credits_granted TYPE NUMERIC(10,1) USING credits_granted::NUMERIC(10,1);

ALTER TABLE credit_ledger
  ALTER COLUMN delta TYPE NUMERIC(10,1) USING delta::NUMERIC(10,1),
  ALTER COLUMN balance_after TYPE NUMERIC(10,1) USING balance_after::NUMERIC(10,1);

ALTER TABLE story_usage_events
DROP CONSTRAINT IF EXISTS story_usage_events_source_check;

ALTER TABLE story_usage_events
ADD CONSTRAINT story_usage_events_source_check
CHECK (source IN (
  'initial_generation',
  'retry',
  'regenerate_assets',
  'add_audio',
  'regenerate_page_image',
  'regenerate_page_audio'
));

DROP FUNCTION IF EXISTS grant_credits(UUID, INTEGER, TEXT, UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS consume_credits(UUID, INTEGER, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS refund_story_credits(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB);

CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_purchase_id UUID DEFAULT NULL,
  p_admin_user_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  available_credits NUMERIC
) AS $$
DECLARE
  new_balance NUMERIC(10,1);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits + p_amount)::NUMERIC(10,1),
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
  RETURNING ucb.available_credits INTO new_balance;

  INSERT INTO credit_ledger (
    user_id,
    delta,
    balance_after,
    reason,
    story_id,
    purchase_id,
    admin_user_id,
    note
  ) VALUES (
    p_user_id,
    p_amount::NUMERIC(10,1),
    new_balance,
    p_reason,
    p_story_id,
    p_purchase_id,
    p_admin_user_id,
    p_note
  )
  RETURNING id INTO ledger_id;

  available_credits := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION consume_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  available_credits NUMERIC
) AS $$
DECLARE
  new_balance NUMERIC(10,1);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits - p_amount)::NUMERIC(10,1),
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
    AND ucb.available_credits >= p_amount
  RETURNING ucb.available_credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO credit_ledger (
    user_id,
    delta,
    balance_after,
    reason,
    story_id,
    note
  ) VALUES (
    p_user_id,
    (-p_amount)::NUMERIC(10,1),
    new_balance,
    p_reason,
    p_story_id,
    p_note
  )
  RETURNING id INTO ledger_id;

  available_credits := new_balance;
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
  available_credits NUMERIC
) AS $$
DECLARE
  story_record stories%ROWTYPE;
  new_balance NUMERIC(10,1);
BEGIN
  SELECT *
  INTO story_record
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;

  IF NOT FOUND
    OR story_record.user_id IS NULL
    OR story_record.credit_cost <= 0
    OR story_record.credit_charge_ledger_id IS NULL
    OR story_record.credit_refunded_at IS NOT NULL THEN
    refunded := FALSE;
    ledger_id := NULL;
    available_credits := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM ensure_user_credit_balance(story_record.user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits + story_record.credit_cost)::NUMERIC(10,1),
    updated_at = NOW()
  WHERE ucb.user_id = story_record.user_id
  RETURNING ucb.available_credits INTO new_balance;

  INSERT INTO credit_ledger (
    user_id,
    delta,
    balance_after,
    reason,
    story_id,
    note
  ) VALUES (
    story_record.user_id,
    story_record.credit_cost::NUMERIC(10,1),
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
  available_credits := new_balance;
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
  available_credits NUMERIC
) AS $$
DECLARE
  purchase_record billing_purchases%ROWTYPE;
  offer_record story_pack_offers%ROWTYPE;
  new_balance NUMERIC(10,1);
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
    SELECT ucb.available_credits
    INTO available_credits
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

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits + offer_record.credits)::NUMERIC(10,1),
    updated_at = NOW()
  WHERE ucb.user_id = p_user_id
  RETURNING ucb.available_credits INTO new_balance;

  UPDATE billing_purchases
  SET
    user_id = p_user_id,
    offer_slug = offer_record.slug,
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
    stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
    amount_minor = COALESCE(p_amount_minor, amount_minor),
    currency = COALESCE(p_currency, currency),
    credits_granted = offer_record.credits,
    status = 'completed',
    fulfilled_at = COALESCE(fulfilled_at, NOW()),
    metadata = COALESCE(p_metadata, metadata),
    updated_at = NOW()
  WHERE id = purchase_record.id
  RETURNING * INTO purchase_record;

  INSERT INTO credit_ledger (
    user_id,
    delta,
    balance_after,
    reason,
    purchase_id,
    note
  ) VALUES (
    p_user_id,
    offer_record.credits,
    new_balance,
    'pack_purchase',
    purchase_record.id,
    offer_record.slug
  )
  RETURNING id INTO ledger_id;

  purchase_id := purchase_record.id;
  already_fulfilled := FALSE;
  available_credits := new_balance;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
