import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_MODELS,
  DEFAULT_AUDIO_MODEL,
  getAudioVoices,
  isAudioModelAvailable,
  parseAudioModelSettings,
} from '../../shared/audioModels.js';

test('audio catalog has the five supported selections and language-specific voices', () => {
  assert.equal(DEFAULT_AUDIO_MODEL, 'elevenlabs');
  assert.deepEqual(AUDIO_MODELS.map(model => model.id), [
    'elevenlabs',
    'google/gemini-3.1-flash-tts-preview',
    'microsoft/mai-voice-2',
    'minimax/speech-2.8-hd',
    'hexgrad/kokoro-82m',
  ]);
  assert.equal(isAudioModelAvailable('microsoft/mai-voice-2', 'ro'), false);
  assert.equal(isAudioModelAvailable('microsoft/mai-voice-2', 'fr'), true);
  assert.deepEqual(getAudioVoices('hexgrad/kokoro-82m', 'fr'), [{ id: 'ff_siwis', name: 'Siwis' }]);
  assert.equal(getAudioVoices('minimax/speech-2.8-hd', 'ro')[0]?.id, 'Romanian_male_1_sample2');
});

test('audio settings reject unknown values and choose a valid default voice', () => {
  assert.deepEqual(parseAudioModelSettings('google/gemini-3.1-flash-tts-preview', undefined, 'ro'), {
    audioModel: 'google/gemini-3.1-flash-tts-preview',
    audioVoice: 'Rasalgethi',
  });
  assert.deepEqual(parseAudioModelSettings('eleven_multilingual_v2', undefined, 'ro', true), {
    audioModel: 'elevenlabs',
  });
  assert.throws(() => parseAudioModelSettings(42, undefined, 'en'), /audio model/);
  assert.throws(() => parseAudioModelSettings('hexgrad/kokoro-82m', 'bad_voice', 'en'), /voice list/);
  assert.throws(() => parseAudioModelSettings('microsoft/mai-voice-2', undefined, 'ro'), /does not support/);
});
