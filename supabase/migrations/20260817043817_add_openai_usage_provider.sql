ALTER TABLE public.story_usage_events
  DROP CONSTRAINT IF EXISTS story_usage_events_provider_check;
ALTER TABLE public.story_usage_events
  ADD CONSTRAINT story_usage_events_provider_check
  CHECK (provider IN ('openai', 'gemini', 'elevenlabs'));

ALTER TABLE public.model_price_catalog
  DROP CONSTRAINT IF EXISTS model_price_catalog_provider_check;
ALTER TABLE public.model_price_catalog
  ADD CONSTRAINT model_price_catalog_provider_check
  CHECK (provider IN ('openai', 'gemini', 'elevenlabs'));

ALTER TABLE public.model_price_catalog
  ADD COLUMN IF NOT EXISTS cached_input_usd_per_token NUMERIC(30,18) NOT NULL DEFAULT 0
    CHECK (cached_input_usd_per_token >= 0),
  ADD COLUMN IF NOT EXISTS cache_write_usd_per_token NUMERIC(30,18) NOT NULL DEFAULT 0
    CHECK (cache_write_usd_per_token >= 0),
  ADD COLUMN IF NOT EXISTS web_search_usd_per_call NUMERIC(30,18) NOT NULL DEFAULT 0
    CHECK (web_search_usd_per_call >= 0);

INSERT INTO public.model_price_catalog (
  model,
  provider,
  roles,
  unit,
  input_usd_per_token,
  cached_input_usd_per_token,
  cache_write_usd_per_token,
  output_usd_per_token,
  image_output_usd_per_token,
  audio_usd_per_character,
  web_search_usd_per_call,
  source_url,
  endpoint_tag,
  fetched_at,
  updated_at
) VALUES (
  'gpt-5.6-sol',
  'openai',
  ARRAY['source analysis', 'draft', 'validation repair', 'review', 'review rewrite', 'page text review'],
  'input/output tokens and web search calls',
  0.000005,
  0.0000005,
  0.00000625,
  0.00003,
  0,
  0,
  0.01,
  'https://developers.openai.com/api/docs/pricing',
  'openai-standard-tiered-context',
  '2026-08-17T00:00:00.000Z'::TIMESTAMPTZ,
  NOW()
)
ON CONFLICT (model) DO UPDATE SET
  provider = EXCLUDED.provider,
  roles = EXCLUDED.roles,
  unit = EXCLUDED.unit,
  input_usd_per_token = EXCLUDED.input_usd_per_token,
  cached_input_usd_per_token = EXCLUDED.cached_input_usd_per_token,
  cache_write_usd_per_token = EXCLUDED.cache_write_usd_per_token,
  output_usd_per_token = EXCLUDED.output_usd_per_token,
  image_output_usd_per_token = EXCLUDED.image_output_usd_per_token,
  audio_usd_per_character = EXCLUDED.audio_usd_per_character,
  web_search_usd_per_call = EXCLUDED.web_search_usd_per_call,
  source_url = EXCLUDED.source_url,
  endpoint_tag = EXCLUDED.endpoint_tag,
  fetched_at = EXCLUDED.fetched_at,
  updated_at = EXCLUDED.updated_at;

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
        WHERE e.provider IN ('openai', 'gemini')
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
    WHERE event.pricing_snapshot = '{}'::JSONB
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
        WHERE provider IN ('openai', 'gemini')
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

REVOKE EXECUTE ON FUNCTION public.rebuild_story_usage_aggregates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_story_usage_pricing_snapshots() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_story_usage_event(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebuild_story_usage_aggregates() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_story_usage_pricing_snapshots() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_story_usage_event(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
