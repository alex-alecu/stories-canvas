import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

const { resolveDefaultAppLanguage } = await import('../config.js');

test('resolveDefaultAppLanguage only accepts site-localized deployment languages', () => {
  assert.equal(resolveDefaultAppLanguage('en'), 'en');
  assert.equal(resolveDefaultAppLanguage(' EN '), 'en');
  assert.equal(resolveDefaultAppLanguage('ro'), 'ro');
  assert.equal(resolveDefaultAppLanguage('de'), 'ro');
  assert.equal(resolveDefaultAppLanguage(undefined), 'ro');
});
