import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

test('voice catalog exposes only the curated Romanian shortlist', async () => {
  const { DEFAULT_VOICE_KEY, VOICE_OPTIONS, getVoiceName } = await import('../../shared/types.js');

  assert.equal(DEFAULT_VOICE_KEY, 'bunica');
  assert.deepEqual(VOICE_OPTIONS.map(option => option.key), ['bunica', 'corina', 'serban', 'jora']);
  assert.deepEqual(VOICE_OPTIONS.map(option => getVoiceName(option.key)), [
    'Grandma',
    'Mom',
    'Dad',
    'Grandpa',
  ]);
});

test('normalizeVoiceKey maps legacy and canonical selections to canonical voice keys', async () => {
  const { normalizeVoiceKey } = await import('../../shared/types.js');

  assert.equal(normalizeVoiceKey('jora'), 'jora');
  assert.equal(normalizeVoiceKey('serban'), 'serban');
  assert.equal(normalizeVoiceKey('corina'), 'corina');
  assert.equal(normalizeVoiceKey('bunica'), 'bunica');
  assert.equal(normalizeVoiceKey('grandma'), 'bunica');
  assert.equal(normalizeVoiceKey('mom'), 'corina');
  assert.equal(normalizeVoiceKey('grandpa'), 'jora');
  assert.equal(normalizeVoiceKey('whisper'), 'jora');
  assert.equal(normalizeVoiceKey('dad'), 'serban');
  assert.equal(normalizeVoiceKey('unknown'), undefined);
  assert.equal(normalizeVoiceKey(''), undefined);
});

test('ElevenLabs voice settings use the configured Romanian voice IDs and shared narration tuning', async () => {
  const { config } = await import('../config.js');
  const { getVoiceSettings } = await import('./elevenlabs.js');

  assert.deepEqual(getVoiceSettings('bunica'), {
    voiceId: config.voiceIds.corina,
    stability: 0.82,
    similarityBoost: 0.8,
    style: 0.18,
    speed: 0.82,
  });
  assert.deepEqual(getVoiceSettings('jora'), {
    voiceId: config.voiceIds.jora,
    stability: 0.8,
    similarityBoost: 0.8,
    style: 0.2,
    speed: 0.84,
  });
  assert.deepEqual(getVoiceSettings('serban'), {
    voiceId: config.voiceIds.serban,
    stability: 0.74,
    similarityBoost: 0.8,
    style: 0.38,
    speed: 0.88,
  });
  assert.deepEqual(getVoiceSettings('corina'), {
    voiceId: config.voiceIds.corina,
    stability: 0.74,
    similarityBoost: 0.8,
    style: 0.42,
    speed: 0.88,
  });
});
