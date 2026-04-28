ALTER TABLE story_usage_events
DROP CONSTRAINT IF EXISTS story_usage_events_source_check;

ALTER TABLE story_usage_events
ADD CONSTRAINT story_usage_events_source_check
CHECK (source IN ('initial_generation', 'retry', 'regenerate_assets', 'add_audio'));
