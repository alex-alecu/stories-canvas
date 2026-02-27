CREATE OR REPLACE FUNCTION update_page_status(
  story_id UUID,
  page_number INTEGER,
  new_status TEXT
) RETURNS VOID AS $$
DECLARE
  page_index INTEGER;
BEGIN
  -- Find the index of the page with the matching pageNumber
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
    ARRAY['pages', page_index::TEXT, 'status'],
    to_jsonb(new_status)
  )
  WHERE id = story_id;
END;
$$ LANGUAGE plpgsql;
