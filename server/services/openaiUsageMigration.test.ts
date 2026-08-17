import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('OpenAI usage migration adds price units and keeps usage functions private', async () => {
  const sql = await fs.readFile(path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260817043817_add_openai_usage_provider.sql',
  ), 'utf-8');

  assert.match(sql, /story_usage_events_provider_check[\s\S]+provider IN \('openai', 'gemini', 'elevenlabs'\)/);
  assert.match(sql, /model_price_catalog_provider_check[\s\S]+provider IN \('openai', 'gemini', 'elevenlabs'\)/);
  assert.match(sql, /cached_input_usd_per_token NUMERIC\(30,18\)/);
  assert.match(sql, /cache_write_usd_per_token NUMERIC\(30,18\)/);
  assert.match(sql, /web_search_usd_per_call NUMERIC\(30,18\)/);
  assert.match(sql, /'gpt-5\.6-sol'[\s\S]+0\.000005,[\s\S]+0\.0000005,[\s\S]+0\.00000625,[\s\S]+0\.00003,[\s\S]+0\.01/);
  assert.match(sql, /provider IN \('openai', 'gemini'\)[\s\S]+operation NOT IN \('character_sheet', 'page_image'\)/);
  assert.match(sql, /cached_input_tokens \* event_record\.cached_input_usd_per_token/);
  assert.match(sql, /cache_write_input_tokens \* event_record\.cache_write_usd_per_token/);
  assert.match(sql, /web_search_calls \* event_record\.web_search_usd_per_call/);
  assert.match(sql, /event_record\.event_model = 'gpt-5\.6-sol'[\s\S]+event_record\.input_tokens > 272000/);
  assert.match(sql, /input_price_multiplier := 2/);
  assert.match(sql, /output_price_multiplier := 1\.5/);
  assert.match(sql, /'openai-standard-tiered-context'/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.record_story_usage_event[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_story_usage_event[\s\S]+TO service_role/);
});
