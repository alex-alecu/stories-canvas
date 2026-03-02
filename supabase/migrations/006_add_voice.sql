-- Add voice column to stories table for narrator voice selection
ALTER TABLE stories ADD COLUMN IF NOT EXISTS voice TEXT;

-- Function to update audio URL for a specific page in the scenario JSONB
CREATE OR REPLACE FUNCTION update_page_audio_url(story_id UUID, page_number INT, audio_url TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE stories
  SET scenario = jsonb_set(
    scenario,
    ARRAY['pages', (
      SELECT ordinality::int - 1
      FROM jsonb_array_elements(scenario->'pages') WITH ORDINALITY
      WHERE (value->>'pageNumber')::int = page_number
      LIMIT 1
    )::text, 'audioUrl'],
    to_jsonb(audio_url)
  )
  WHERE id = story_id
    AND scenario IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(scenario->'pages')
      WHERE (value->>'pageNumber')::int = page_number
    );
END;
$$ LANGUAGE plpgsql;

-- Restrict RPC to service_role only (called server-side, not from client)
REVOKE EXECUTE ON FUNCTION update_page_audio_url(UUID, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_page_audio_url(UUID, INT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION update_page_audio_url(UUID, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION update_page_audio_url(UUID, INT, TEXT) TO service_role;
