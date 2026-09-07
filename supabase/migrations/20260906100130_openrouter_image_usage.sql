-- Count OpenRouter image costs in the image totals. Preserve all historical usage.
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
        WHERE provider IN ('openrouter', 'gemini')
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
        WHERE e.provider IN ('openrouter', 'gemini')
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
SELECT public.rebuild_story_usage_aggregates();
