import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('environment pack pricing migration accepts currencies and preserves admin overrides per fingerprint', async () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260724102053_environment_pack_pricing.sql',
  );
  const sql = await fs.readFile(migrationPath, 'utf-8');

  assert.match(sql, /CHECK \(currency ~ '\^\[a-z\]\{3\}\$'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.app_environment_config/);
  assert.match(sql, /IF previous_fingerprint = p_fingerprint THEN\s+RETURN FALSE;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_story_pack_environment_defaults[\s\S]+TO service_role;/);
});
