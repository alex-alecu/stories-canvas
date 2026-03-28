CREATE OR REPLACE FUNCTION update_page_image_version(
  story_id UUID,
  page_number INT,
  image_version TEXT
) RETURNS VOID AS $$
DECLARE
  page_index INTEGER;
BEGIN
  SELECT idx - 1 INTO page_index
  FROM jsonb_array_elements(
    (SELECT scenario->'pages' FROM stories WHERE id = story_id)
  ) WITH ORDINALITY AS t(page, idx)
  WHERE (page->>'pageNumber')::INTEGER = page_number;

  IF page_index IS NULL THEN
    RAISE EXCEPTION 'Page % not found in story %', page_number, story_id;
  END IF;

  UPDATE stories
  SET scenario = jsonb_set(
    scenario,
    ARRAY['pages', page_index::TEXT, 'imageVersion'],
    to_jsonb(image_version),
    true
  )
  WHERE id = story_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION update_page_image_version(UUID, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_page_image_version(UUID, INT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION update_page_image_version(UUID, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION update_page_image_version(UUID, INT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION update_page_audio_fields(
  story_id UUID,
  page_number INT,
  audio_url TEXT,
  audio_version TEXT
) RETURNS VOID AS $$
DECLARE
  page_index INTEGER;
BEGIN
  SELECT idx - 1 INTO page_index
  FROM jsonb_array_elements(
    (SELECT scenario->'pages' FROM stories WHERE id = story_id)
  ) WITH ORDINALITY AS t(page, idx)
  WHERE (page->>'pageNumber')::INTEGER = page_number;

  IF page_index IS NULL THEN
    RAISE EXCEPTION 'Page % not found in story %', page_number, story_id;
  END IF;

  UPDATE stories
  SET scenario = jsonb_set(
    jsonb_set(
      scenario,
      ARRAY['pages', page_index::TEXT, 'audioUrl'],
      to_jsonb(audio_url),
      true
    ),
    ARRAY['pages', page_index::TEXT, 'audioVersion'],
    to_jsonb(audio_version),
    true
  )
  WHERE id = story_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION update_page_audio_fields(UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_page_audio_fields(UUID, INT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION update_page_audio_fields(UUID, INT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION update_page_audio_fields(UUID, INT, TEXT, TEXT) TO service_role;
