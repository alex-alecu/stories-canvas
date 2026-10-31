CREATE TABLE public.story_localizations (
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN (
    'ro', 'de', 'es', 'en', 'fr', 'it', 'pt', 'nl', 'hu', 'pl',
    'cs', 'sk', 'sv', 'no', 'da', 'fi', 'ja', 'zh', 'ko'
  )),
  source_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  pages JSONB NOT NULL CHECK (jsonb_typeof(pages) = 'array'),
  voice TEXT,
  audio_model TEXT,
  audio_voice TEXT,
  PRIMARY KEY (story_id, language)
);

ALTER TABLE public.story_localizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.story_localizations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.story_localizations TO service_role;

ALTER TABLE public.story_usage_events
  DROP CONSTRAINT IF EXISTS story_usage_events_operation_check;
ALTER TABLE public.story_usage_events
  ADD CONSTRAINT story_usage_events_operation_check CHECK (operation IN (
    'source_analysis',
    'scenario_draft',
    'scenario_validation_repair',
    'scenario_review',
    'scenario_review_rewrite',
    'page_text_review',
    'page_image_review',
    'character_sheet',
    'page_image',
    'page_audio',
    'story_translation'
  ));
