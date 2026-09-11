import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStoryFailureMessage, formatStoryStatusMessage } from '../../src/i18n/storyStatusCopy.js';

const translations = {
  retryingFailedIllustrations: '',
  generatingImageForPage: '',
  blockedIllustrationsDescription: '',
  generationFailed: 'Generarea a eșuat',
};

const failedStory = {
  status: 'failed' as const,
  currentPhase: 'Failed',
  userId: 'owner',
  progressMessage: 'Generation failed',
};

for (const [message, expected] of [
  ['Checking the story before illustration...', 'Verificarea poveștii înainte de ilustrare...'],
  ['Correcting the story after review...', 'Corectarea poveștii după verificare...'],
  ['Correcting the story format...', 'Corectarea formatului poveștii...'],
  ['The story script is ready for illustration.', 'Textul poveștii este pregătit pentru ilustrare.'],
]) {
  test(`Romanian progress identifies this step: ${message}`, () => {
    assert.equal(formatStoryStatusMessage(message, translations, 'ro'), expected);
  });
}

test('other languages keep the English workflow message', () => {
  const message = 'Correcting the story after review...';
  assert.equal(formatStoryStatusMessage(message, translations, 'en'), message);
  assert.equal(formatStoryStatusMessage(message, translations, 'de'), message);
});

test('the owner can still read an existing Romanian failure message', () => {
  const message = 'Verificarea poveștii a eșuat.\nPersonajele paginii nu corespund scenei. Pagini: 8, 9.';
  assert.equal(formatStoryFailureMessage({ ...failedStory, progressMessage: message },
    'owner', translations, 'ro'), message);
});

test('generic failure explains that the saved error has no cause', () => {
  const story = { ...failedStory, progressMessage: 'Generation failed' };
  assert.equal(formatStoryFailureMessage(story, 'owner', translations, 'en'),
    'The story could not be completed. The saved error does not include the cause. Try again.');
  assert.equal(formatStoryFailureMessage(story, 'owner', translations, 'ro'),
    'Povestea nu a putut fi finalizată. Eroarea salvată nu include cauza. Încearcă din nou.');
});

test('failure details remain limited to the owner and a saved terminal error', () => {
  assert.equal(formatStoryFailureMessage(failedStory, 'visitor', translations, 'ro'), undefined);
  assert.equal(formatStoryFailureMessage(failedStory, undefined, translations, 'ro'), undefined);
  assert.equal(formatStoryFailureMessage({ ...failedStory, currentPhase: 'Reviewing story...' },
    'owner', translations, 'ro'), undefined);
});
