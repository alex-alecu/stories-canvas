-- Credit columns now store USD. One legacy credit converts to one USD.
-- Stop active generation and deploy this migration with the application change.
ALTER TABLE public.user_credit_balances
  DROP CONSTRAINT IF EXISTS user_credit_balances_available_credits_check,
  ALTER COLUMN available_credits TYPE NUMERIC(18,6),
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  ADD COLUMN legacy_credits_converted NUMERIC(18,6),
  ADD COLUMN converted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE public.user_credit_balances SET legacy_credits_converted = available_credits;
COMMENT ON COLUMN public.user_credit_balances.available_credits IS 'USD balance. Legacy credits converted at 1 credit = 1 USD. In-flight provider costs can make the balance negative.';
ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_balance_after_check,
  ALTER COLUMN delta TYPE NUMERIC(18,6),
  ALTER COLUMN balance_after TYPE NUMERIC(18,6),
  ADD COLUMN usage_event_id UUID UNIQUE;
COMMENT ON COLUMN public.credit_ledger.delta IS 'USD amount, with six decimal places for request costs.';
ALTER TABLE public.billing_purchases ALTER COLUMN credits_granted TYPE NUMERIC(18,6);
ALTER TABLE public.stories ALTER COLUMN credit_cost TYPE NUMERIC(18,6);
ALTER TABLE public.story_pack_offers
  DROP CONSTRAINT IF EXISTS story_pack_offers_credits_check,
  DROP CONSTRAINT IF EXISTS story_pack_offers_currency_check,
  ALTER COLUMN credits TYPE NUMERIC(18,6),
  ALTER COLUMN currency SET DEFAULT 'usd';
UPDATE public.story_pack_offers SET
  price_minor = CASE slug WHEN 'pack_5' THEN 1000 WHEN 'pack_12' THEN 2500 ELSE 5000 END,
  credits = CASE slug WHEN 'pack_5' THEN 10 WHEN 'pack_12' THEN 25 ELSE 50 END,
  currency = 'usd', name = CASE slug WHEN 'pack_5' THEN '$10' WHEN 'pack_12' THEN '$25' ELSE '$50' END,
  description = 'Add funds for stories. Funds do not expire.', updated_at = NOW();
ALTER TABLE public.story_pack_offers ADD CONSTRAINT story_pack_offers_currency_check CHECK (currency = 'usd'),
  ADD CONSTRAINT story_pack_offers_credits_check CHECK (credits = price_minor::NUMERIC / 100 AND credits > 0);
ALTER TABLE public.story_usage_events DROP CONSTRAINT IF EXISTS story_usage_events_provider_check;
ALTER TABLE public.story_usage_events ADD CONSTRAINT story_usage_events_provider_check
  CHECK (provider IN ('openrouter', 'openai', 'gemini', 'elevenlabs'));

-- Balance changes and their audit entries commit with each usage event.
-- The UNIQUE usage_event_id and the event primary key prevent duplicate charges.
CREATE FUNCTION public.charge_story_usage_usd() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance NUMERIC(18,6); owner_id UUID;
BEGIN
  SELECT user_id INTO owner_id FROM stories WHERE id = NEW.story_id;
  IF NEW.user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'Usage owner does not match story'; END IF;
  IF owner_id IS NULL OR NEW.cost_usd_micros = 0 THEN RETURN NEW; END IF;
  PERFORM ensure_user_credit_balance(owner_id);
  UPDATE user_credit_balances AS b SET
    available_credits = b.available_credits - NEW.cost_usd_micros::NUMERIC / 1000000,
    updated_at = NOW()
  WHERE b.user_id = owner_id RETURNING b.available_credits INTO new_balance;
  INSERT INTO credit_ledger(user_id, delta, balance_after, reason, story_id, usage_event_id, note)
  VALUES (owner_id, -NEW.cost_usd_micros::NUMERIC / 1000000, new_balance,
    'story_usage', NEW.story_id, NEW.id, NEW.operation || ' · ' || NEW.model);
  RETURN NEW;
END;
$$;
CREATE TRIGGER charge_story_usage_usd AFTER INSERT ON public.story_usage_events
FOR EACH ROW EXECUTE FUNCTION public.charge_story_usage_usd();
REVOKE ALL ON FUNCTION public.charge_story_usage_usd() FROM PUBLIC, anon, authenticated;

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
  new_balance NUMERIC(18,6);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount, 6) THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits + p_amount)::NUMERIC(18,6),
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
    p_amount::NUMERIC(18,6),
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
  new_balance NUMERIC(18,6);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits - p_amount)::NUMERIC(18,6),
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
    (-p_amount)::NUMERIC(18,6),
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
  new_balance NUMERIC(18,6);
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
    available_credits = (ucb.available_credits + story_record.credit_cost)::NUMERIC(18,6),
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
    story_record.credit_cost::NUMERIC(18,6),
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
  grant_usd NUMERIC(18,6);
  new_balance NUMERIC(18,6);
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

  IF p_metadata->>'walletCurrency' = 'USD' THEN
    IF lower(p_currency) <> 'usd' OR p_amount_minor <= 0
      OR (p_metadata->>'walletAmountUsd')::NUMERIC IS DISTINCT FROM p_amount_minor::NUMERIC / 100 THEN
      RAISE EXCEPTION 'Invalid USD checkout amount';
    END IF;
    grant_usd := p_amount_minor::NUMERIC / 100;
  ELSE
    -- Honor Checkout sessions opened before conversion at the same 1:1 rate.
    grant_usd := CASE p_offer_slug WHEN 'pack_5' THEN 5 WHEN 'pack_12' THEN 12 WHEN 'pack_20' THEN 20 END;
  END IF;
  IF purchase_record.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Purchase owner mismatch'; END IF;
  PERFORM ensure_user_credit_balance(p_user_id);

  UPDATE user_credit_balances ucb
  SET
    available_credits = (ucb.available_credits + grant_usd)::NUMERIC(18,6),
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
    credits_granted = grant_usd,
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
    grant_usd,
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

CREATE OR REPLACE FUNCTION public.record_story_usage_event(
  p_id UUID,
  p_story_id UUID,
  p_user_id UUID,
  p_provider TEXT,
  p_operation TEXT,
  p_source TEXT,
  p_status TEXT,
  p_model TEXT,
  p_page_number INTEGER,
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_total_tokens BIGINT,
  p_generated_images BIGINT,
  p_billed_characters BIGINT,
  p_image_output_tokens BIGINT,
  p_cost_usd_micros BIGINT,
  p_usage_details JSONB,
  p_pricing_snapshot JSONB,
  p_pricing_status TEXT,
  p_calculated_at TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted BOOLEAN;
BEGIN
  PERFORM 1
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO story_usage_events (
    id, story_id, user_id, provider, operation, source, status, model,
    page_number, input_tokens, output_tokens, total_tokens, generated_images,
    billed_characters, image_output_tokens, cost_usd_micros, usage_details,
    pricing_snapshot, pricing_status, calculated_at, created_at
  ) VALUES (
    p_id, p_story_id, p_user_id, p_provider, p_operation, p_source, p_status, p_model,
    p_page_number, p_input_tokens, p_output_tokens, p_total_tokens, p_generated_images,
    p_billed_characters, p_image_output_tokens, p_cost_usd_micros, COALESCE(p_usage_details, '{}'::JSONB),
    COALESCE(p_pricing_snapshot, '{}'::JSONB), p_pricing_status, p_calculated_at, p_created_at
  )
  ON CONFLICT (id) DO NOTHING;
  inserted := FOUND;

  UPDATE stories AS story
  SET
    usage_input_tokens = totals.input_tokens,
    usage_output_tokens = totals.output_tokens,
    usage_total_tokens = totals.total_tokens,
    usage_cost_usd_micros = totals.cost_usd_micros,
    usage_text_cost_usd_micros = totals.text_cost_usd_micros,
    usage_image_cost_usd_micros = totals.image_cost_usd_micros,
    usage_audio_cost_usd_micros = totals.audio_cost_usd_micros
  FROM (
    SELECT
      COALESCE(SUM(input_tokens), 0)::BIGINT AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
      COALESCE(SUM(total_tokens), 0)::BIGINT AS total_tokens,
      COALESCE(SUM(cost_usd_micros), 0)::BIGINT AS cost_usd_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (
        WHERE provider IN ('openrouter', 'openai', 'gemini')
          AND operation NOT IN ('character_sheet', 'page_image')
      ), 0)::BIGINT AS text_cost_usd_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (
        WHERE provider = 'gemini'
          AND operation IN ('character_sheet', 'page_image')
      ), 0)::BIGINT AS image_cost_usd_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE provider = 'elevenlabs'), 0)::BIGINT AS audio_cost_usd_micros
    FROM story_usage_events
    WHERE story_id = p_story_id
  ) AS totals
  WHERE story.id = p_story_id;

  RETURN inserted;
END;
$$;


CREATE OR REPLACE FUNCTION public.backfill_story_usage_pricing_snapshots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_record RECORD;
  cached_input_tokens BIGINT;
  cache_write_input_tokens BIGINT;
  standard_input_tokens BIGINT;
  web_search_calls BIGINT;
  input_price_multiplier NUMERIC;
  output_price_multiplier NUMERIC;
  updated_count INTEGER := 0;
BEGIN
  FOR event_record IN
    SELECT
      event.id AS event_id,
      event.provider AS event_provider,
      event.model AS event_model,
      event.operation,
      event.input_tokens,
      event.output_tokens,
      event.billed_characters,
      event.image_output_tokens,
      event.usage_details,
      catalog.roles,
      catalog.unit,
      catalog.input_usd_per_token,
      catalog.cached_input_usd_per_token,
      catalog.cache_write_usd_per_token,
      catalog.output_usd_per_token,
      catalog.image_output_usd_per_token,
      catalog.audio_usd_per_character,
      catalog.web_search_usd_per_call,
      catalog.source_url,
      catalog.endpoint_tag,
      catalog.fetched_at
    FROM story_usage_events AS event
    JOIN model_price_catalog AS catalog ON catalog.model = event.model
    WHERE event.provider <> 'openrouter' AND event.created_at < (SELECT MIN(converted_at) FROM user_credit_balances)
      AND event.pricing_snapshot = '{}'::JSONB
  LOOP
    cached_input_tokens := LEAST(event_record.input_tokens, GREATEST(0, COALESCE(
      NULLIF(event_record.usage_details #>> '{responseUsage,input_tokens_details,cached_tokens}', '')::BIGINT,
      NULLIF(event_record.usage_details #>> '{input_tokens_details,cached_tokens}', '')::BIGINT,
      NULLIF(event_record.usage_details #>> '{inputTokensDetails,cachedTokens}', '')::BIGINT,
      NULLIF(event_record.usage_details ->> 'cached_input_tokens', '')::BIGINT,
      NULLIF(event_record.usage_details ->> 'cachedInputTokens', '')::BIGINT,
      0
    )));
    cache_write_input_tokens := LEAST(
      event_record.input_tokens - cached_input_tokens,
      GREATEST(0, COALESCE(
        NULLIF(event_record.usage_details #>> '{responseUsage,input_tokens_details,cache_write_tokens}', '')::BIGINT,
        NULLIF(event_record.usage_details #>> '{input_tokens_details,cache_write_tokens}', '')::BIGINT,
        NULLIF(event_record.usage_details #>> '{inputTokensDetails,cacheWriteTokens}', '')::BIGINT,
        NULLIF(event_record.usage_details ->> 'cache_write_input_tokens', '')::BIGINT,
        NULLIF(event_record.usage_details ->> 'cacheWriteInputTokens', '')::BIGINT,
        0
      ))
    );
    standard_input_tokens := event_record.input_tokens - cached_input_tokens - cache_write_input_tokens;
    web_search_calls := GREATEST(0, COALESCE(
      NULLIF(event_record.usage_details ->> 'web_search_calls', '')::BIGINT,
      NULLIF(event_record.usage_details ->> 'webSearchCalls', '')::BIGINT,
      0
    ));
    IF event_record.event_provider = 'openai'
      AND event_record.event_model = 'gpt-5.6-sol'
      AND event_record.input_tokens > 272000 THEN
      input_price_multiplier := 2;
      output_price_multiplier := 1.5;
    ELSE
      input_price_multiplier := 1;
      output_price_multiplier := 1;
    END IF;

    UPDATE story_usage_events
    SET
      cost_usd_micros = ROUND(1_000_000 * (
        CASE
          WHEN event_record.event_provider = 'elevenlabs' THEN
            event_record.billed_characters * event_record.audio_usd_per_character
          WHEN event_record.operation IN ('character_sheet', 'page_image') THEN
            event_record.input_tokens * event_record.input_usd_per_token
            + COALESCE(NULLIF(event_record.image_output_tokens, 0), event_record.output_tokens)
              * event_record.image_output_usd_per_token
          ELSE
            input_price_multiplier * (
              standard_input_tokens * event_record.input_usd_per_token
              + cached_input_tokens * event_record.cached_input_usd_per_token
              + cache_write_input_tokens * event_record.cache_write_usd_per_token
            )
            + output_price_multiplier * event_record.output_tokens * event_record.output_usd_per_token
            + web_search_calls * event_record.web_search_usd_per_call
        END
      ))::BIGINT,
      pricing_snapshot = jsonb_build_object(
        'model', event_record.event_model,
        'provider', event_record.event_provider,
        'roles', event_record.roles,
        'unit', event_record.unit,
        'inputUsdPerToken', event_record.input_usd_per_token::TEXT,
        'cachedInputUsdPerToken', event_record.cached_input_usd_per_token::TEXT,
        'cacheWriteUsdPerToken', event_record.cache_write_usd_per_token::TEXT,
        'outputUsdPerToken', event_record.output_usd_per_token::TEXT,
        'imageOutputUsdPerToken', event_record.image_output_usd_per_token::TEXT,
        'audioUsdPerCharacter', event_record.audio_usd_per_character::TEXT,
        'webSearchUsdPerCall', event_record.web_search_usd_per_call::TEXT,
        'sourceUrl', event_record.source_url,
        'endpointTag', event_record.endpoint_tag,
        'fetchedAt', event_record.fetched_at
      ),
      pricing_status = 'estimated',
      calculated_at = NOW()
    WHERE id = event_record.event_id;
    updated_count := updated_count + 1;
  END LOOP;

  RETURN updated_count;
END;
$$;


CREATE OR REPLACE FUNCTION public.rebuild_story_usage_aggregates()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE stories AS story
  SET
    usage_input_tokens = COALESCE(totals.input_tokens, 0),
    usage_output_tokens = COALESCE(totals.output_tokens, 0),
    usage_total_tokens = COALESCE(totals.total_tokens, 0),
    usage_cost_usd_micros = COALESCE(totals.cost_usd_micros, 0),
    usage_text_cost_usd_micros = COALESCE(totals.text_cost_usd_micros, 0),
    usage_image_cost_usd_micros = COALESCE(totals.image_cost_usd_micros, 0),
    usage_audio_cost_usd_micros = COALESCE(totals.audio_cost_usd_micros, 0)
  FROM (
    SELECT
      s.id AS story_id,
      SUM(e.input_tokens)::BIGINT AS input_tokens,
      SUM(e.output_tokens)::BIGINT AS output_tokens,
      SUM(e.total_tokens)::BIGINT AS total_tokens,
      SUM(e.cost_usd_micros)::BIGINT AS cost_usd_micros,
      SUM(e.cost_usd_micros) FILTER (
        WHERE e.provider IN ('openrouter', 'openai', 'gemini')
          AND e.operation NOT IN ('character_sheet', 'page_image')
      )::BIGINT AS text_cost_usd_micros,
      SUM(e.cost_usd_micros) FILTER (
        WHERE e.provider = 'gemini'
          AND e.operation IN ('character_sheet', 'page_image')
      )::BIGINT AS image_cost_usd_micros,
      SUM(e.cost_usd_micros) FILTER (WHERE e.provider = 'elevenlabs')::BIGINT AS audio_cost_usd_micros
    FROM stories s
    LEFT JOIN story_usage_events e ON e.story_id = s.id
    GROUP BY s.id
  ) AS totals
  WHERE story.id = totals.story_id;
END;
$$;
