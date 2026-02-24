ALTER TABLE stories ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'ro';

-- User preferences table for storing language preference
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'ro',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
