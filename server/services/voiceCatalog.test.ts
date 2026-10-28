import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VOICE_KEY, VOICE_OPTIONS, getVoiceName, normalizeVoiceKey } from '../../shared/types.js';
import { config } from '../config.js';
import { getVoiceSettings } from './elevenlabs.js';

test('the voice list uses four family roles and excludes the removed speaker', () => {
  assert.equal(DEFAULT_VOICE_KEY, 'grandpa');
  assert.deepEqual(VOICE_OPTIONS.map(option => option.key), ['grandpa', 'grandma', 'mom', 'dad']);
  assert.deepEqual(VOICE_OPTIONS.map(option => getVoiceName(option.key)), ['Grandpa', 'Grandma', 'Mom', 'Dad']);
  const ids = VOICE_OPTIONS.map(option => getVoiceSettings(option.key).voiceId);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids.includes('8nBBDfYxYXmDNaqTCxPH'), false);
});

test('saved voice keys use the current family role and replacement speaker', () => {
  for (const [oldKey, role] of Object.entries({ jora: 'grandpa', bunica: 'grandma', corina: 'mom', serban: 'dad', whisper: 'grandpa' })) {
    assert.equal(normalizeVoiceKey(oldKey), role);
    assert.equal(normalizeVoiceKey(role), role);
  }
  assert.equal(normalizeVoiceKey('toString'), undefined);
  assert.equal(normalizeVoiceKey('unknown'), undefined);
  assert.equal(normalizeVoiceKey(''), undefined);
});

test('Eleven v4 is the default and uses its supported narration settings', () => {
  assert.equal(config.elevenLabsModel, 'eleven_v4');
  for (const role of VOICE_OPTIONS) {
    assert.deepEqual(getVoiceSettings(role.key), {
      voiceId: config.voiceIds[role.key], stability: 0.5, similarityBoost: 0.8,
    });
  }
});
