-- Avoid PL/pgSQL variable/column collisions for RETURNS TABLE output fields.

CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_purchase_id UUID DEFAULT NULL,
  p_admin_user_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  available_credits INTEGER
) AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances AS ucb
  SET
    available_credits = ucb.available_credits + p_amount,
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
    p_amount,
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
  p_amount INTEGER,
  p_reason TEXT,
  p_story_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (
  ledger_id UUID,
  available_credits INTEGER
) AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances AS ucb
  SET
    available_credits = ucb.available_credits - p_amount,
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
    -p_amount,
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
  available_credits INTEGER
) AS $$
DECLARE
  story_record stories%ROWTYPE;
  new_balance INTEGER;
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

  UPDATE user_credit_balances AS ucb
  SET
    available_credits = ucb.available_credits + story_record.credit_cost,
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
    story_record.credit_cost,
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
  available_credits INTEGER
) AS $$
DECLARE
  purchase_record billing_purchases%ROWTYPE;
  offer_record story_pack_offers%ROWTYPE;
  new_balance INTEGER;
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
    FROM user_credit_balances AS ucb
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

  UPDATE user_credit_balances AS ucb
  SET
    available_credits = ucb.available_credits + offer_record.credits,
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
