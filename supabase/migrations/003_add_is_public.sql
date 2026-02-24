-- Add is_public column for future public stories feature (default false = private)
ALTER TABLE stories ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_stories_is_public ON stories(is_public) WHERE is_public = true;
