ALTER TABLE story_usage_events
DROP CONSTRAINT IF EXISTS story_usage_events_operation_check;

ALTER TABLE story_usage_events
ADD CONSTRAINT story_usage_events_operation_check
CHECK (
  operation IN (
    'source_analysis',
    'scenario_draft',
    'scenario_validation_repair',
    'scenario_review',
    'scenario_review_rewrite',
    'character_sheet',
    'page_image',
    'page_audio'
  )
);

CREATE TABLE IF NOT EXISTS story_source_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  author TEXT,
  language TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license_note TEXT NOT NULL,
  source_text_hash TEXT NOT NULL,
  canonical_beat_sheet JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (language, normalized_title)
);

CREATE INDEX IF NOT EXISTS idx_story_source_cache_hash
  ON story_source_cache(source_text_hash);
