CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE stories ADD COLUMN IF NOT EXISTS art_style TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS scenario_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS rendered_scenario_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS story_mode TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS credit_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS credit_charge_ledger_id UUID;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS credit_refunded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS story_pack_offers (
  slug TEXT PRIMARY KEY CHECK (slug IN ('pack_5', 'pack_12', 'pack_20')),
  credits INTEGER NOT NULL CHECK (credits IN (5, 12, 20)),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ron' CHECK (currency = 'ron'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO story_pack_offers (slug, credits, name, description, price_minor, currency, is_active, display_order)
VALUES
  ('pack_5', 5, '5 stories', 'Five credits for fast stories or upgraded modes.', 3900, 'ron', TRUE, 1),
  ('pack_12', 12, '12 stories', 'Twelve credits for families creating stories regularly.', 7900, 'ron', TRUE, 2),
  ('pack_20', 20, '20 stories', 'Twenty credits for the best per-story value.', 11900, 'ron', TRUE, 3)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_credit_balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_credits INTEGER NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer_slug TEXT NOT NULL REFERENCES story_pack_offers(slug),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_customer_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency = 'ron'),
  credits_granted INTEGER NOT NULL DEFAULT 0 CHECK (credits_granted >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  fulfilled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES billing_purchases(id) ON DELETE SET NULL,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_story_pack_offers_active ON story_pack_offers(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_billing_purchases_user_created_at ON billing_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_purchases_status ON billing_purchases(status);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_status ON billing_webhook_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created_at ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_story_id ON credit_ledger(story_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stories_credit_charge_ledger_id_fkey'
  ) THEN
    ALTER TABLE stories
    ADD CONSTRAINT stories_credit_charge_ledger_id_fkey
    FOREIGN KEY (credit_charge_ledger_id)
    REFERENCES credit_ledger(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ensure_user_credit_balance(
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_credit_balances (user_id, available_credits, updated_at)
  VALUES (p_user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

  UPDATE user_credit_balances
  SET
    available_credits = available_credits + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING user_credit_balances.available_credits INTO new_balance;

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

  UPDATE user_credit_balances
  SET
    available_credits = available_credits - p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND available_credits >= p_amount
  RETURNING user_credit_balances.available_credits INTO new_balance;

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

  UPDATE user_credit_balances
  SET
    available_credits = available_credits + story_record.credit_cost,
    updated_at = NOW()
  WHERE user_id = story_record.user_id
  RETURNING user_credit_balances.available_credits INTO new_balance;

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
    SELECT available_credits
    INTO available_credits
    FROM user_credit_balances
    WHERE user_id = p_user_id;
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

  UPDATE user_credit_balances
  SET
    available_credits = available_credits + offer_record.credits,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING user_credit_balances.available_credits INTO new_balance;

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

REVOKE EXECUTE ON FUNCTION ensure_user_credit_balance(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensure_user_credit_balance(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION ensure_user_credit_balance(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION ensure_user_credit_balance(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION grant_credits(UUID, INTEGER, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION grant_credits(UUID, INTEGER, TEXT, UUID, UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION grant_credits(UUID, INTEGER, TEXT, UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION grant_credits(UUID, INTEGER, TEXT, UUID, UUID, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION consume_credits(UUID, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consume_credits(UUID, INTEGER, TEXT, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION consume_credits(UUID, INTEGER, TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION consume_credits(UUID, INTEGER, TEXT, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION refund_story_credits(UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
