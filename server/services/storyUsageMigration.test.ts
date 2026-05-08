import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('story usage migration adds story totals columns and usage events table constraints', async () => {
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '010_story_usage_tracking.sql');
  const addAudioMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '012_allow_add_audio_usage_source.sql');
  const sourceCacheMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '016_story_source_cache.sql');
  const sql = await fs.readFile(migrationPath, 'utf-8');
  const addAudioSql = await fs.readFile(addAudioMigrationPath, 'utf-8');
  const sourceCacheSql = await fs.readFile(sourceCacheMigrationPath, 'utf-8');

  assert.match(sql, /ALTER TABLE stories ADD COLUMN IF NOT EXISTS generation_inputs JSONB NOT NULL DEFAULT '\{\}'::JSONB;/);
  assert.match(sql, /ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_input_tokens BIGINT NOT NULL DEFAULT 0;/);
  assert.match(sql, /ALTER TABLE stories ADD COLUMN IF NOT EXISTS usage_audio_cost_usd_micros BIGINT NOT NULL DEFAULT 0;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS story_usage_events \(/);
  assert.match(sql, /provider TEXT NOT NULL CHECK \(provider IN \('gemini', 'elevenlabs'\)\)/);
  assert.match(sql, /source TEXT NOT NULL CHECK \(source IN \('initial_generation', 'retry', 'regenerate_assets'\)\)/);
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('succeeded', 'failed'\)\)/);
  assert.match(sql, /usage_details JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
  assert.match(addAudioSql, /DROP CONSTRAINT IF EXISTS story_usage_events_source_check/);
  assert.match(addAudioSql, /CHECK \(source IN \('initial_generation', 'retry', 'regenerate_assets', 'add_audio'\)\)/);
  assert.match(sourceCacheSql, /DROP CONSTRAINT IF EXISTS story_usage_events_operation_check/);
  assert.match(sourceCacheSql, /'source_analysis'/);
  assert.match(sourceCacheSql, /CREATE TABLE IF NOT EXISTS story_source_cache \(/);
  assert.match(sourceCacheSql, /canonical_beat_sheet JSONB NOT NULL/);
  assert.match(sourceCacheSql, /UNIQUE \(language, normalized_title\)/);
});
