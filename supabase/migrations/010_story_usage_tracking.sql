ALTER TABLE stories ADD COLUMN IF NOT EXISTS generation_inputs JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_total_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_cost_usd_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_text_cost_usd_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_image_cost_usd_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_audio_cost_usd_micros BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS story_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'elevenlabs')),
  operation TEXT NOT NULL CHECK (
    operation IN (
      'scenario_draft',
      'scenario_validation_repair',
      'scenario_review',
      'scenario_review_rewrite',
      'character_sheet',
      'page_image',
      'page_audio'
    )
  ),
  source TEXT NOT NULL CHECK (source IN ('initial_generation', 'retry', 'regenerate_assets')),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  model TEXT NOT NULL,
  page_number INTEGER,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cost_usd_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_usd_micros >= 0),
  usage_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_usage_events_story_id_created_at
  ON story_usage_events(story_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_story_usage_events_user_id_created_at
  ON story_usage_events(user_id, created_at DESC);
