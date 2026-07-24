ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_pack_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_source_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_environment_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.stories,
  public.user_preferences,
  public.user_roles,
  public.story_pack_offers,
  public.user_credit_balances,
  public.billing_customers,
  public.billing_purchases,
  public.billing_webhook_events,
  public.credit_ledger,
  public.story_usage_events,
  public.story_source_cache,
  public.story_reactions,
  public.generation_slots,
  public.app_environment_config
FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.stories,
  public.user_preferences,
  public.user_roles,
  public.story_pack_offers,
  public.user_credit_balances,
  public.billing_customers,
  public.billing_purchases,
  public.billing_webhook_events,
  public.credit_ledger,
  public.story_usage_events,
  public.story_source_cache,
  public.story_reactions,
  public.generation_slots,
  public.app_environment_config
TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_page_status(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_page_audio_url(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_user_credit_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_story_credits(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_story_view_count(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_story_reaction(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_generation_slot(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_generation_slot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_generation_slot_for_terminal_story() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_story_pack_environment_defaults(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_page_status(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_page_audio_url(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_user_credit_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, NUMERIC, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_story_credits(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_story_pack_purchase(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_story_view_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_story_reaction(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_generation_slot(UUID, UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_generation_slot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_generation_slot_for_terminal_story() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_story_pack_environment_defaults(TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

-- storage.objects intentionally remains unchanged. The story-images bucket keeps
-- its existing public SELECT policy while writes remain service-role only.
