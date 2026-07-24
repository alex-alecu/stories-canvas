ALTER TABLE public.story_pack_offers
  DROP CONSTRAINT IF EXISTS story_pack_offers_currency_check;
ALTER TABLE public.story_pack_offers
  ADD CONSTRAINT story_pack_offers_currency_check
  CHECK (currency ~ '^[a-z]{3}$');

ALTER TABLE public.billing_purchases
  DROP CONSTRAINT IF EXISTS billing_purchases_currency_check;
ALTER TABLE public.billing_purchases
  ADD CONSTRAINT billing_purchases_currency_check
  CHECK (currency ~ '^[a-z]{3}$');

CREATE TABLE IF NOT EXISTS public.app_environment_config (
  config_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.apply_story_pack_environment_defaults(
  p_fingerprint TEXT,
  p_currency TEXT,
  p_pack_5_price_minor INTEGER,
  p_pack_12_price_minor INTEGER,
  p_pack_20_price_minor INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_fingerprint TEXT;
BEGIN
  IF p_fingerprint IS NULL OR LENGTH(p_fingerprint) <> 64 THEN
    RAISE EXCEPTION 'Invalid environment pricing fingerprint';
  END IF;
  IF p_currency !~ '^[a-z]{3}$' THEN
    RAISE EXCEPTION 'Invalid story pack currency';
  END IF;
  IF p_pack_5_price_minor < 0 OR p_pack_12_price_minor < 0 OR p_pack_20_price_minor < 0 THEN
    RAISE EXCEPTION 'Story pack prices must be non-negative';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('story_pack_pricing'));

  SELECT fingerprint INTO previous_fingerprint
  FROM app_environment_config
  WHERE config_key = 'story_pack_pricing';

  IF previous_fingerprint = p_fingerprint THEN
    RETURN FALSE;
  END IF;

  UPDATE story_pack_offers
  SET
    currency = p_currency,
    price_minor = CASE slug
      WHEN 'pack_5' THEN p_pack_5_price_minor
      WHEN 'pack_12' THEN p_pack_12_price_minor
      WHEN 'pack_20' THEN p_pack_20_price_minor
    END,
    updated_at = NOW()
  WHERE slug IN ('pack_5', 'pack_12', 'pack_20');

  INSERT INTO app_environment_config (config_key, fingerprint, applied_at)
  VALUES ('story_pack_pricing', p_fingerprint, NOW())
  ON CONFLICT (config_key) DO UPDATE
  SET fingerprint = EXCLUDED.fingerprint, applied_at = EXCLUDED.applied_at;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON TABLE public.app_environment_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_environment_config TO service_role;
REVOKE EXECUTE ON FUNCTION public.apply_story_pack_environment_defaults(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_story_pack_environment_defaults(TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
