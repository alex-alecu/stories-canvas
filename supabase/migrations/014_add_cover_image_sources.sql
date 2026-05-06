ALTER TABLE stories
ADD COLUMN IF NOT EXISTS cover_image_sources JSONB;
