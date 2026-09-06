import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAudioPriceCatalog, isModelPriceCatalogStale } from './modelPriceCatalog.js';

test('the active price catalog contains only the configured narration rate', () => {
  const entries = buildAudioPriceCatalog(new Date('2026-09-06T10:00:00Z'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].provider, 'elevenlabs');
  assert.equal(entries[0].audioUsdPerCharacter, '0.0001');
  assert.equal(entries[0].fetchedAt, '2026-09-06T10:00:00.000Z');
});

test('audio catalog rates expire after 24 hours', () => {
  const verifiedAt = '2026-09-06T10:00:00.000Z';
  const entries = buildAudioPriceCatalog(new Date(verifiedAt));
  assert.equal(isModelPriceCatalogStale(entries, verifiedAt, new Date('2026-09-07T09:59:59Z')), false);
  assert.equal(isModelPriceCatalogStale(entries, verifiedAt, new Date('2026-09-07T10:00:00Z')), true);
});
