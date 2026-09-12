import assert from 'node:assert/strict';
import test from 'node:test';
import { storyRequiresAudio, withoutDisabledAudioFailure } from '../../shared/storyAudio.js';
import type { Page } from '../../shared/types.js';

test('the saved audio choice has priority over an old narrator and mode', () => {
  assert.equal(storyRequiresAudio({
    voice: 'jora', storyMode: 'pro_audio',
    generationInputs: { audioEnabled: false, storyMode: 'pro_audio', voice: 'jora' },
  }), false);
  assert.equal(storyRequiresAudio({
    generationInputs: { audioEnabled: true, storyMode: 'fast' },
  }), true);
});

test('stories without saved audio choices keep legacy narration and partial audio', () => {
  assert.equal(storyRequiresAudio({}), false);
  assert.equal(storyRequiresAudio({ storyMode: 'fast' }), false);
  assert.equal(storyRequiresAudio({ voice: 'whisper' }), true);
  assert.equal(storyRequiresAudio({ storyMode: 'pro_audio' }), true);
  assert.equal(storyRequiresAudio({
    scenario: { pages: [{ audioUrl: '/audio/page-01.mp3' }, {}] as Page[] },
  }), true);
});

test('disabled audio removes its old warning and keeps image failures', () => {
  const audioFailure = 'Some narration pages could not be generated';
  const imageFailure = '2 illustrations could not be generated because the image provider blocked or rejected them. Open Story Tools to retry those pages.';
  assert.equal(withoutDisabledAudioFailure(audioFailure, false), undefined);
  assert.equal(withoutDisabledAudioFailure(`${imageFailure} ${audioFailure}`, false), imageFailure);
  assert.equal(withoutDisabledAudioFailure(imageFailure, false), imageFailure);
  assert.equal(withoutDisabledAudioFailure('Generation failed', false), 'Generation failed');
  assert.equal(withoutDisabledAudioFailure(audioFailure, true), audioFailure);
  assert.equal(withoutDisabledAudioFailure(`${imageFailure} ${audioFailure}`, true), `${imageFailure} ${audioFailure}`);
});
