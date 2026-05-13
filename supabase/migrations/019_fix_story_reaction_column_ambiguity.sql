CREATE OR REPLACE FUNCTION set_story_reaction(
  p_story_id UUID,
  p_user_id UUID,
  p_reaction TEXT,
  p_feedback TEXT DEFAULT NULL
) RETURNS TABLE (
  story_id UUID,
  like_count BIGINT,
  dislike_count BIGINT,
  my_reaction TEXT,
  latest_dislike_feedback TEXT
) AS $$
DECLARE
  new_like_count BIGINT;
  new_dislike_count BIGINT;
  normalized_feedback TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_reaction IS NOT NULL AND p_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  normalized_feedback := NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(p_feedback, ''), '[[:space:]]+', ' ', 'g')), '');
  IF normalized_feedback IS NOT NULL AND LENGTH(normalized_feedback) > 500 THEN
    RAISE EXCEPTION 'Feedback is too long';
  END IF;

  PERFORM 1
  FROM stories AS s
  WHERE s.id = p_story_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id USING ERRCODE = 'P0002';
  END IF;

  IF p_reaction IS NULL THEN
    DELETE FROM story_reactions AS sr
    WHERE sr.story_id = p_story_id
      AND sr.user_id = p_user_id;
  ELSE
    INSERT INTO story_reactions AS sr (story_id, user_id, reaction, created_at, updated_at)
    VALUES (p_story_id, p_user_id, p_reaction, NOW(), NOW())
    ON CONFLICT ON CONSTRAINT story_reactions_pkey
    DO UPDATE SET
      reaction = EXCLUDED.reaction,
      updated_at = NOW()
    WHERE sr.reaction IS DISTINCT FROM EXCLUDED.reaction;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE sr.reaction = 'like'),
    COUNT(*) FILTER (WHERE sr.reaction = 'dislike')
  INTO new_like_count, new_dislike_count
  FROM story_reactions AS sr
  WHERE sr.story_id = p_story_id;

  IF p_reaction = 'dislike' AND normalized_feedback IS NOT NULL THEN
    UPDATE stories AS s
    SET
      like_count = new_like_count,
      dislike_count = new_dislike_count,
      latest_dislike_feedback = normalized_feedback,
      latest_dislike_feedback_user_id = p_user_id,
      latest_dislike_feedback_at = NOW()
    WHERE s.id = p_story_id
    RETURNING s.id, s.like_count, s.dislike_count, s.latest_dislike_feedback
    INTO story_id, like_count, dislike_count, latest_dislike_feedback;
  ELSE
    UPDATE stories AS s
    SET
      like_count = new_like_count,
      dislike_count = new_dislike_count
    WHERE s.id = p_story_id
    RETURNING s.id, s.like_count, s.dislike_count, s.latest_dislike_feedback
    INTO story_id, like_count, dislike_count, latest_dislike_feedback;
  END IF;

  my_reaction := p_reaction;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION set_story_reaction(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_story_reaction(UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION set_story_reaction(UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION set_story_reaction(UUID, UUID, TEXT, TEXT) TO service_role;
