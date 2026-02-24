-- Stories table
CREATE TABLE stories (
  id UUID PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating_scenario',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT,
  target_age INTEGER,
  scenario JSONB,
  cover_image_url TEXT,
  total_pages INTEGER DEFAULT 0,
  completed_pages INTEGER DEFAULT 0,
  failed_pages INTEGER[] DEFAULT '{}',
  current_phase TEXT,
  progress_message TEXT
);

CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_created_at ON stories(created_at DESC);

-- Storage bucket for story images (run in Supabase dashboard or via API)
-- Create a bucket named 'story-images' with public access
INSERT INTO storage.buckets (id, name, public) VALUES ('story-images', 'story-images', true);

-- Allow public read access to all files in the bucket
CREATE POLICY "Public read access" ON storage.objects FOR SELECT USING (bucket_id = 'story-images');

-- Allow service role to insert/update/delete
CREATE POLICY "Service role full access" ON storage.objects FOR ALL USING (auth.role() = 'service_role');
