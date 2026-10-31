import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReaderLanguage } from './storyLanguagePolicy.js';

test('Romanian site uses Romanian output regardless of selected language', () => {
  assert.equal(resolveReaderLanguage('de', 'en', 'ro'), 'ro');
  assert.equal(resolveReaderLanguage(undefined, 'en', 'ro'), 'ro');
});

test('English site keeps the selected supported reader language', () => {
  assert.equal(resolveReaderLanguage('ro', 'en', 'en'), 'ro');
  assert.equal(resolveReaderLanguage('ja', 'en', 'en'), 'ja');
  assert.equal(resolveReaderLanguage(undefined, 'fr', 'en'), 'fr');
});

test('unsupported or malformed reader languages fail before a provider request', () => {
  for (const value of ['../../ro', 'xx', ['ro'], 12, '']) {
    assert.throws(() => resolveReaderLanguage(value, 'en', 'en'), /language/i);
  }
});
