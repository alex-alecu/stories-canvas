ALTER TABLE stories
ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS dislike_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE stories
ADD CONSTRAINT stories_like_count_nonnegative CHECK (like_count >= 0),
ADD CONSTRAINT stories_dislike_count_nonnegative CHECK (dislike_count >= 0);

CREATE TABLE IF NOT EXISTS story_reactions (
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_reactions_user_created_at
  ON story_reactions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_story_reaction(
  p_story_id UUID,
  p_user_id UUID,
  p_reaction TEXT
) RETURNS TABLE (
  story_id UUID,
  like_count BIGINT,
  dislike_count BIGINT,
  my_reaction TEXT
) AS $$
DECLARE
  new_like_count BIGINT;
  new_dislike_count BIGINT;
BEGIN
  IF p_reaction IS NOT NULL AND p_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  PERFORM 1
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id USING ERRCODE = 'P0002';
  END IF;

  IF p_reaction IS NULL THEN
    DELETE FROM story_reactions
    WHERE story_reactions.story_id = p_story_id
      AND story_reactions.user_id = p_user_id;
  ELSE
    INSERT INTO story_reactions (story_id, user_id, reaction, created_at, updated_at)
    VALUES (p_story_id, p_user_id, p_reaction, NOW(), NOW())
    ON CONFLICT (story_id, user_id)
    DO UPDATE SET
      reaction = EXCLUDED.reaction,
      updated_at = NOW()
    WHERE story_reactions.reaction IS DISTINCT FROM EXCLUDED.reaction;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE reaction = 'like'),
    COUNT(*) FILTER (WHERE reaction = 'dislike')
  INTO new_like_count, new_dislike_count
  FROM story_reactions
  WHERE story_reactions.story_id = p_story_id;

  UPDATE stories
  SET
    like_count = new_like_count,
    dislike_count = new_dislike_count
  WHERE id = p_story_id
  RETURNING stories.id, stories.like_count, stories.dislike_count
  INTO story_id, like_count, dislike_count;

  my_reaction := p_reaction;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
