CREATE TABLE IF NOT EXISTS public.model_price_catalog (
  model TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'elevenlabs')),
  roles TEXT[] NOT NULL DEFAULT '{}',
  unit TEXT NOT NULL,
  input_usd_per_token NUMERIC(30,18) NOT NULL DEFAULT 0 CHECK (input_usd_per_token >= 0),
  output_usd_per_token NUMERIC(30,18) NOT NULL DEFAULT 0 CHECK (output_usd_per_token >= 0),
  image_output_usd_per_token NUMERIC(30,18) NOT NULL DEFAULT 0 CHECK (image_output_usd_per_token >= 0),
  audio_usd_per_character NUMERIC(30,18) NOT NULL DEFAULT 0 CHECK (audio_usd_per_character >= 0),
  source_url TEXT NOT NULL,
  endpoint_tag TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.price_catalog_refresh_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ
);

INSERT INTO public.price_catalog_refresh_state (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.story_usage_events
  ADD COLUMN IF NOT EXISTS generated_images BIGINT NOT NULL DEFAULT 0 CHECK (generated_images >= 0),
  ADD COLUMN IF NOT EXISTS billed_characters BIGINT NOT NULL DEFAULT 0 CHECK (billed_characters >= 0),
  ADD COLUMN IF NOT EXISTS image_output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (image_output_tokens >= 0),
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS pricing_status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (pricing_status IN ('complete', 'incomplete', 'estimated')),
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ;

ALTER TABLE public.story_usage_events
  DROP CONSTRAINT IF EXISTS story_usage_events_operation_check;
ALTER TABLE public.story_usage_events
  ADD CONSTRAINT story_usage_events_operation_check
  CHECK (operation IN (
    'source_analysis',
    'scenario_draft',
    'scenario_validation_repair',
    'scenario_review',
    'scenario_review_rewrite',
    'page_text_review',
    'character_sheet',
    'page_image',
    'page_audio'
  ));

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
      SUM(e.cost_usd_micros) FILTER (WHERE e.provider = 'gemini' AND e.operation NOT IN ('character_sheet', 'page_image'))::BIGINT AS text_cost_usd_micros,
      SUM(e.cost_usd_micros) FILTER (WHERE e.provider = 'gemini' AND e.operation IN ('character_sheet', 'page_image'))::BIGINT AS image_cost_usd_micros,
      SUM(e.cost_usd_micros) FILTER (WHERE e.provider = 'elevenlabs')::BIGINT AS audio_cost_usd_micros
    FROM stories s
    LEFT JOIN story_usage_events e ON e.story_id = s.id
    GROUP BY s.id
  ) AS totals
  WHERE story.id = totals.story_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_story_usage_pricing_snapshots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE story_usage_events AS event
  SET
    cost_usd_micros = ROUND(1_000_000 * (
      event.input_tokens * catalog.input_usd_per_token
      + CASE
          WHEN event.provider = 'elevenlabs' THEN event.billed_characters * catalog.audio_usd_per_character
          WHEN event.operation IN ('character_sheet', 'page_image') THEN
            COALESCE(NULLIF(event.image_output_tokens, 0), event.output_tokens) * catalog.image_output_usd_per_token
          ELSE event.output_tokens * catalog.output_usd_per_token
        END
    ))::BIGINT,
    pricing_snapshot = jsonb_build_object(
      'model', catalog.model,
      'provider', catalog.provider,
      'inputUsdPerToken', catalog.input_usd_per_token::TEXT,
      'outputUsdPerToken', catalog.output_usd_per_token::TEXT,
      'imageOutputUsdPerToken', catalog.image_output_usd_per_token::TEXT,
      'audioUsdPerCharacter', catalog.audio_usd_per_character::TEXT,
      'sourceUrl', catalog.source_url,
      'endpointTag', catalog.endpoint_tag,
      'fetchedAt', catalog.fetched_at
    ),
    pricing_status = 'estimated',
    calculated_at = NOW()
  FROM model_price_catalog AS catalog
  WHERE event.model = catalog.model
    AND event.pricing_snapshot = '{}'::JSONB;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

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
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE provider = 'gemini' AND operation NOT IN ('character_sheet', 'page_image')), 0)::BIGINT AS text_cost_usd_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE provider = 'gemini' AND operation IN ('character_sheet', 'page_image')), 0)::BIGINT AS image_cost_usd_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE provider = 'elevenlabs'), 0)::BIGINT AS audio_cost_usd_micros
    FROM story_usage_events
    WHERE story_id = p_story_id
  ) AS totals
  WHERE story.id = p_story_id;

  RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_price_catalog_refresh(
  p_owner TEXT,
  p_force BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  state price_catalog_refresh_state%ROWTYPE;
BEGIN
  SELECT * INTO state
  FROM price_catalog_refresh_state
  WHERE singleton = TRUE
  FOR UPDATE;

  IF state.lease_expires_at IS NOT NULL AND state.lease_expires_at > NOW() THEN
    RETURN FALSE;
  END IF;
  IF NOT p_force AND state.last_success_at IS NOT NULL AND state.last_success_at > NOW() - INTERVAL '24 hours' THEN
    RETURN FALSE;
  END IF;

  UPDATE price_catalog_refresh_state
  SET
    last_attempt_at = NOW(),
    lease_owner = p_owner,
    lease_expires_at = NOW() + INTERVAL '10 minutes'
  WHERE singleton = TRUE;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_price_catalog_refresh(
  p_owner TEXT,
  p_error TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE price_catalog_refresh_state
  SET
    last_success_at = CASE WHEN p_error IS NULL THEN NOW() ELSE last_success_at END,
    last_error = p_error,
    lease_owner = NULL,
    lease_expires_at = NULL
  WHERE singleton = TRUE
    AND lease_owner = p_owner;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_error IS NULL THEN
    PERFORM backfill_story_usage_pricing_snapshots();
    PERFORM rebuild_story_usage_aggregates();
  END IF;
END;
$$;

ALTER TABLE public.model_price_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_catalog_refresh_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.model_price_catalog, public.price_catalog_refresh_state FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.model_price_catalog, public.price_catalog_refresh_state TO service_role;

REVOKE EXECUTE ON FUNCTION public.rebuild_story_usage_aggregates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_story_usage_pricing_snapshots() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_story_usage_event(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_price_catalog_refresh(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_price_catalog_refresh(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_story_usage_aggregates() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_story_usage_pricing_snapshots() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_story_usage_event(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_price_catalog_refresh(TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_price_catalog_refresh(TEXT, TEXT) TO service_role;
