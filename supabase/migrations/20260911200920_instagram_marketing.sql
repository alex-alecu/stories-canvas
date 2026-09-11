CREATE TABLE public.instagram_marketing (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  hour_utc INTEGER NOT NULL DEFAULT 9 CHECK (hour_utc BETWEEN 0 AND 23),
  app_id TEXT,
  app_secret TEXT,
  website_url TEXT,
  account_id TEXT,
  username TEXT,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  oauth_state TEXT,
  oauth_user_id UUID,
  oauth_expires_at TIMESTAMPTZ
);
INSERT INTO public.instagram_marketing (id) VALUES (true);

CREATE TABLE public.instagram_marketing_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  post_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'publishing', 'published', 'failed', 'uncertain', 'skipped')),
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  story JSONB,
  reason TEXT,
  image_url TEXT,
  container_id TEXT,
  media_id TEXT,
  published_at TIMESTAMPTZ,
  insights JSONB,
  insights_at TIMESTAMPTZ,
  insights_error TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, post_date)
);

ALTER TABLE public.instagram_marketing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_marketing_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_marketing, public.instagram_marketing_posts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instagram_marketing, public.instagram_marketing_posts TO service_role;

CREATE TABLE public.instagram_marketing_logs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  post_id UUID REFERENCES public.instagram_marketing_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'info')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_instagram_marketing_logs_recent ON public.instagram_marketing_logs (created_at DESC);
ALTER TABLE public.instagram_marketing_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_marketing_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instagram_marketing_logs TO service_role;

-- One durable claim per account and UTC date. Never repeat an uncertain publish.
CREATE FUNCTION public.claim_instagram_post(p_force BOOLEAN DEFAULT false)
RETURNS SETOF public.instagram_marketing_posts
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE settings public.instagram_marketing;
BEGIN
  SELECT * INTO settings FROM public.instagram_marketing WHERE id FOR UPDATE;
  IF settings.access_token IS NULL OR settings.token_expires_at <= now()
    OR (NOT p_force AND (NOT settings.enabled OR extract(hour FROM now() AT TIME ZONE 'UTC') < settings.hour_utc))
    THEN RETURN;
  END IF;
  RETURN QUERY INSERT INTO public.instagram_marketing_posts (account_id, post_date, status)
    VALUES (settings.account_id, (now() AT TIME ZONE 'UTC')::date, 'preparing')
    ON CONFLICT (account_id, post_date) DO UPDATE
      SET status = 'preparing', attempts = instagram_marketing_posts.attempts + 1, updated_at = now(), error = NULL
      WHERE instagram_marketing_posts.status IN ('preparing', 'failed')
        AND instagram_marketing_posts.updated_at < now() - interval '15 minutes'
        AND instagram_marketing_posts.attempts < 3
    RETURNING *;
END;
$$;

CREATE INDEX idx_instagram_story_recent ON public.stories (created_at DESC)
  WHERE is_public AND status = 'completed' AND cover_image_url IS NOT NULL;
CREATE INDEX idx_instagram_story_popular ON public.stories (like_count DESC, view_count DESC, created_at DESC)
  WHERE is_public AND status = 'completed' AND cover_image_url IS NOT NULL;

-- Filter and shorten in SQL. Do not load full story scripts or the full catalogue.
CREATE FUNCTION public.instagram_story_candidates(p_account_id TEXT)
RETURNS TABLE (id UUID, title TEXT, excerpt TEXT, language TEXT, target_age INTEGER,
  art_style TEXT, view_count BIGINT, like_count BIGINT)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH recent_posts AS (
    SELECT story_id FROM public.instagram_marketing_posts
    WHERE account_id = p_account_id AND post_date >= (now() AT TIME ZONE 'UTC')::date - 14
      AND status IN ('published', 'publishing', 'uncertain')
  ), picks AS (
    (SELECT s.id FROM public.stories s
      WHERE s.is_public AND s.status = 'completed' AND s.cover_image_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM recent_posts p WHERE p.story_id = s.id)
      ORDER BY s.created_at DESC, s.id LIMIT 10)
    UNION
    (SELECT s.id FROM public.stories s
      WHERE s.is_public AND s.status = 'completed' AND s.cover_image_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM recent_posts p WHERE p.story_id = s.id)
      ORDER BY s.like_count DESC, s.view_count DESC, s.created_at DESC, s.id LIMIT 10)
  )
  SELECT s.id, left(coalesce(s.title, 'Story'), 160),
    left(coalesce(s.scenario->'pages'->0->>'text', ''), 300), left(s.language, 10), s.target_age,
    left(s.art_style, 40), s.view_count, s.like_count
  FROM picks JOIN public.stories s ON s.id = picks.id ORDER BY s.created_at DESC, s.id;
$$;

REVOKE ALL ON FUNCTION public.claim_instagram_post(BOOLEAN), public.instagram_story_candidates(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_instagram_post(BOOLEAN), public.instagram_story_candidates(TEXT) TO service_role;
