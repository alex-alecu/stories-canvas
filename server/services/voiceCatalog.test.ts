import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

test('voice catalog exposes only the curated Romanian shortlist', async () => {
  const { DEFAULT_VOICE_KEY, VOICE_OPTIONS, getVoiceName } = await import('../../shared/types.js');

  assert.equal(DEFAULT_VOICE_KEY, 'jora');
  assert.deepEqual(VOICE_OPTIONS.map(option => option.key), ['jora', 'serban', 'corina']);
  assert.deepEqual(VOICE_OPTIONS.map(option => getVoiceName(option.key)), [
    'Grandpa',
    'Dad',
    'Mom',
  ]);
});

test('normalizeVoiceKey maps legacy and canonical selections to canonical voice keys', async () => {
  const { normalizeVoiceKey } = await import('../../shared/types.js');

  assert.equal(normalizeVoiceKey('jora'), 'jora');
  assert.equal(normalizeVoiceKey('serban'), 'serban');
  assert.equal(normalizeVoiceKey('corina'), 'corina');
  assert.equal(normalizeVoiceKey('grandma'), 'corina');
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

  assert.deepEqual(getVoiceSettings('jora'), {
    voiceId: config.voiceIds.jora,
    stability: 0.7,
    similarityBoost: 0.8,
    style: 0.4,
  });
  assert.deepEqual(getVoiceSettings('serban'), {
    voiceId: config.voiceIds.serban,
    stability: 0.7,
    similarityBoost: 0.8,
    style: 0.4,
  });
  assert.deepEqual(getVoiceSettings('corina'), {
    voiceId: config.voiceIds.corina,
    stability: 0.7,
    similarityBoost: 0.8,
    style: 0.4,
  });
});
