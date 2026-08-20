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
    'page_image_review',
    'character_sheet',
    'page_image',
    'page_audio'
  ));

UPDATE public.model_price_catalog
SET
  roles = CASE
    WHEN 'page image review' = ANY(roles) THEN roles
    ELSE array_append(roles, 'page image review')
  END,
  updated_at = NOW()
WHERE model = 'gpt-5.6-sol';
