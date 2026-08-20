import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('generation cost migration freezes snapshots and repairs aggregates atomically', async () => {
  const sql = await fs.readFile(path.join(
    process.cwd(), 'supabase', 'migrations', '20260724102840_generation_cost_accounting.sql',
  ), 'utf-8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.model_price_catalog/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.price_catalog_refresh_state/);
  assert.match(sql, /'page_text_review'/);
  assert.match(sql, /pricing_snapshot JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_story_usage_event/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(sql, /WHERE id = p_story_id\s+FOR UPDATE;/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rebuild_story_usage_aggregates/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.backfill_story_usage_pricing_snapshots/);
  assert.match(sql, /pricing_status = 'estimated'/);
  assert.match(sql, /image_output_tokens[\s\S]+image_output_usd_per_token/);
  assert.match(sql, /lease_expires_at > NOW\(\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test('image review usage migration adds the OpenAI visual review operation', async () => {
  const sql = await fs.readFile(path.join(
    process.cwd(), 'supabase', 'migrations', '20260820120311_add_page_image_review_usage.sql',
  ), 'utf-8');

  assert.match(sql, /'page_image_review'/);
  assert.match(sql, /story_usage_events_operation_check/);
  assert.match(sql, /'page image review' = ANY\(roles\)/);
});
