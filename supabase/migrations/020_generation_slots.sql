CREATE TABLE IF NOT EXISTS generation_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'story_create',
    'story_retry',
    'story_regenerate_assets',
    'story_add_audio',
    'story_regenerate_image',
    'story_regenerate_audio'
  )),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_slots_active_story
  ON generation_slots(story_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_generation_slots_active_user
  ON generation_slots(user_id, claimed_at DESC)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION claim_generation_slot(
  p_user_id UUID,
  p_story_id UUID,
  p_action TEXT,
  p_limit INTEGER DEFAULT 2
) RETURNS TABLE (
  claimed BOOLEAN,
  active_count INTEGER,
  limit_count INTEGER,
  retry_after_seconds INTEGER
) AS $$
DECLARE
  current_count INTEGER := 0;
  normalized_limit INTEGER := GREATEST(1, COALESCE(p_limit, 2));
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'Story id is required';
  END IF;

  IF p_action IS NULL OR LENGTH(TRIM(p_action)) = 0 THEN
    RAISE EXCEPTION 'Generation action is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::TEXT), 0);

  UPDATE generation_slots
  SET released_at = NOW()
  WHERE user_id = p_user_id
    AND released_at IS NULL
    AND claimed_at < NOW() - INTERVAL '6 hours';

  SELECT COUNT(*)
  INTO current_count
  FROM generation_slots
  WHERE user_id = p_user_id
    AND released_at IS NULL;

  IF current_count >= normalized_limit THEN
    claimed := FALSE;
    active_count := current_count;
    limit_count := normalized_limit;
    retry_after_seconds := 60;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO generation_slots (story_id, user_id, action)
  VALUES (p_story_id, p_user_id, p_action);

  claimed := TRUE;
  active_count := current_count + 1;
  limit_count := normalized_limit;
  retry_after_seconds := 0;
  RETURN NEXT;
EXCEPTION
  WHEN unique_violation THEN
    claimed := FALSE;
    active_count := GREATEST(current_count, 1);
    limit_count := normalized_limit;
    retry_after_seconds := 60;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION release_generation_slot(
  p_story_id UUID
) RETURNS INTEGER AS $$
DECLARE
  released_count INTEGER;
BEGIN
  UPDATE generation_slots
  SET released_at = NOW()
  WHERE story_id = p_story_id
    AND released_at IS NULL;

  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION release_generation_slot_for_terminal_story()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('completed', 'failed', 'cancelled') THEN
    PERFORM release_generation_slot(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_release_generation_slot_for_terminal_story ON stories;
CREATE TRIGGER trg_release_generation_slot_for_terminal_story
AFTER UPDATE OF status ON stories
FOR EACH ROW
WHEN (NEW.status IN ('completed', 'failed', 'cancelled'))
EXECUTE FUNCTION release_generation_slot_for_terminal_story();

REVOKE ALL ON TABLE generation_slots FROM PUBLIC;
REVOKE ALL ON TABLE generation_slots FROM anon;
REVOKE ALL ON TABLE generation_slots FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE generation_slots TO service_role;

REVOKE EXECUTE ON FUNCTION claim_generation_slot(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_generation_slot(UUID, UUID, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION claim_generation_slot(UUID, UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_generation_slot(UUID, UUID, TEXT, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION release_generation_slot(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_generation_slot(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION release_generation_slot(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION release_generation_slot(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION release_generation_slot_for_terminal_story() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_generation_slot_for_terminal_story() FROM anon;
REVOKE EXECUTE ON FUNCTION release_generation_slot_for_terminal_story() FROM authenticated;
GRANT EXECUTE ON FUNCTION release_generation_slot_for_terminal_story() TO service_role;
