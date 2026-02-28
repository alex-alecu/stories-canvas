-- Add user_id column to stories table
ALTER TABLE stories ADD COLUMN user_id UUID REFERENCES auth.users(id);
CREATE INDEX idx_stories_user_id ON stories(user_id);
