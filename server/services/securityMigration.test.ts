import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('security migration locks application tables and RPCs to the service role', async () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260724102605_secure_application_data.sql',
  );
  const sql = await fs.readFile(migrationPath, 'utf-8');
  const tables = [
    'stories',
    'user_preferences',
    'user_roles',
    'story_pack_offers',
    'user_credit_balances',
    'billing_customers',
    'billing_purchases',
    'billing_webhook_events',
    'credit_ledger',
    'story_usage_events',
    'story_source_cache',
    'story_reactions',
    'generation_slots',
    'app_environment_config',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /TO service_role;/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.increment_story_view_count\(UUID\)/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.set_story_reaction\(UUID, UUID, TEXT, TEXT\)/);
  assert.doesNotMatch(sql, /ALTER TABLE storage\.objects/);
  assert.match(sql, /story-images bucket keeps[\s\S]+public SELECT policy/);
});
