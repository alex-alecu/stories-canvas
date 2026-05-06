ALTER TABLE stories
ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_story_view_count(story_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_view_count BIGINT;
BEGIN
  UPDATE stories
  SET view_count = view_count + 1
  WHERE id = story_id
  RETURNING view_count INTO new_view_count;

  IF new_view_count IS NULL THEN
    RAISE EXCEPTION 'Story % not found', story_id USING ERRCODE = 'P0002';
  END IF;

  RETURN new_view_count;
END;
$$;
