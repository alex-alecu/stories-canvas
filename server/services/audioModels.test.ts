import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_MODELS,
  DEFAULT_AUDIO_MODEL,
  getAudioVoices,
  getSelectableAudioModel,
  isAudioModelAvailable,
  parseAudioModelSettings,
} from '../../shared/audioModels.js';

test('audio catalog has the default and five current OpenRouter selections and language-specific voices', () => {
  assert.equal(DEFAULT_AUDIO_MODEL, 'elevenlabs');
  assert.deepEqual(AUDIO_MODELS.map(model => model.id), [
    'elevenlabs',
    'google/gemini-3.8-flash-tts',
    'microsoft/mai-voice-2.1',
    'minimax/speech-2.8-hd',
    'fish-audio/s2.1-pro',
    'mistralai/voxtral-mini-tts-3-0',
  ]);
  assert.equal(isAudioModelAvailable('microsoft/mai-voice-2.1', 'ro'), true);
  assert.equal(getAudioVoices('mistralai/voxtral-mini-tts-3-0', 'ro')[0]?.id, 'voice_3155');
  assert.equal(isAudioModelAvailable('microsoft/mai-voice-2.1', 'fr'), true);
  assert.deepEqual(getAudioVoices('hexgrad/kokoro-82m', 'fr'), [{ id: 'ff_siwis', name: 'Siwis' }]);
  assert.equal(getAudioVoices('minimax/speech-2.8-hd', 'ro')[0]?.id, 'Romanian_male_1_sample2');
});

test('audio settings reject unknown values and choose a valid default voice', () => {
  assert.deepEqual(parseAudioModelSettings('google/gemini-3.8-flash-tts', undefined, 'ro'), {
    audioModel: 'google/gemini-3.8-flash-tts',
    audioVoice: 'Rasalgethi',
  });
  assert.deepEqual(parseAudioModelSettings('eleven_multilingual_v2', undefined, 'ro', true), {
    audioModel: 'elevenlabs',
  });
  assert.throws(() => parseAudioModelSettings(42, undefined, 'en'), /audio model/);
  assert.throws(() => parseAudioModelSettings('fish-audio/s2.1-pro', 'bad_voice', 'en'), /voice list/);
  assert.throws(() => parseAudioModelSettings('microsoft/mai-voice-2.1', undefined, 'sk'), /does not support/);
  assert.throws(() => parseAudioModelSettings('hexgrad/kokoro-82m', undefined, 'en'), /audio model/);
  assert.equal(parseAudioModelSettings('hexgrad/kokoro-82m', 'bm_george', 'en', true).audioVoice, 'bm_george');
});

test('manual model choices start with the current default for removed saved models', () => {
  assert.equal(getSelectableAudioModel('hexgrad/kokoro-82m'), DEFAULT_AUDIO_MODEL);
  assert.equal(getSelectableAudioModel('eleven_multilingual_v2'), DEFAULT_AUDIO_MODEL);
  assert.equal(getSelectableAudioModel('microsoft/mai-voice-2.1'), 'microsoft/mai-voice-2.1');
});
