import assert from 'node:assert/strict';
import test from 'node:test';
import { getMissingAudioCount, getStoryLanguageKey, getStoryLanguagePlaceholder, getStoryPageTextMaxChars, matchesStoryLanguage, resolveStoryLanguage } from './storyLanguage';
import type { StoryMeta } from '../types';

test('the Romanian site uses Romanian when a stored preference is another language', () => {
  assert.equal(resolveStoryLanguage('de', 'ro'), 'ro');
  assert.equal(resolveStoryLanguage('de', 'en'), 'de');
});

test('saved versions of one story cannot overwrite another language', () => {
  const records = new Map<string, string>();
  records.set(getStoryLanguageKey('story-1', 'en'), 'English');
  records.set(getStoryLanguageKey('story-1', 'ro'), 'Romanian');
  assert.equal(records.size, 2);
  assert.equal(records.get('story-1:en'), 'English');
});

test('legacy offline stories match only their stored subtitle language', () => {
  assert.equal(matchesStoryLanguage({ language: 'ro' }, 'ro'), true);
  assert.equal(matchesStoryLanguage({ language: 'ro' }, 'en'), false);
  assert.equal(matchesStoryLanguage({ generationInputs: { language: 'fr' } }, 'fr'), true);
});

test('a saved source fallback belongs to the language that was requested', () => {
  assert.equal(matchesStoryLanguage({ language: 'en', requestedLanguage: 'de' }, 'de'), true);
  assert.equal(matchesStoryLanguage({ language: 'en', requestedLanguage: 'de' }, 'en'), false);
});

test('missing narration is counted even when some pages already have audio', () => {
  assert.equal(getMissingAudioCount([{ audioUrl: '/en/page-01.mp3' }, {}, {}]), 2);
  assert.equal(getMissingAudioCount([{ audioUrl: '/en/page-01.mp3' }]), 0);
});

const previousStory: StoryMeta = {
  id: 'story-1', prompt: 'A fox', status: 'completed', createdAt: '2026-10-30T00:00:00Z',
  language: 'en', requestedLanguage: 'en', sourceLanguage: 'en',
  scenario: {
    title: 'A fox', targetAge: 3, characters: [],
    pages: [{ pageNumber: 1, text: 'A fox runs.', imagePrompt: 'A fox', characters: [], status: 'completed', imageUrl: '/shared.png', audioUrl: '/en.mp3' }],
  },
};

test('a language change keeps the same story images and removes old narration', () => {
  const placeholder = getStoryLanguagePlaceholder(previousStory, 'story-1', 'ro');
  assert.equal(placeholder?.id, 'story-1');
  assert.equal(placeholder?.requestedLanguage, 'ro');
  assert.equal(placeholder?.scenario?.pages[0].imageUrl, '/shared.png');
  assert.equal(placeholder?.scenario?.pages[0].text, 'A fox runs.');
  assert.equal(placeholder?.scenario?.pages[0].audioUrl, undefined);
  assert.equal(previousStory.scenario?.pages[0].audioUrl, '/en.mp3');
});

test('a different story never uses the previous story while loading', () => {
  assert.equal(getStoryLanguagePlaceholder(previousStory, 'story-2', 'ro'), undefined);
  assert.equal(getStoryLanguagePlaceholder(undefined, 'story-1', 'ro'), undefined);
});

test('translated page edits accept the translation limit', () => {
  assert.equal(getStoryPageTextMaxChars(3, 'ro', 'en'), 640);
  assert.equal(getStoryPageTextMaxChars(3, 'en', 'en'), 160);
  assert.equal(getStoryPageTextMaxChars(6, 'en', 'en'), 200);
  assert.equal(getStoryPageTextMaxChars(9, 'en', 'en'), 280);
  assert.equal(getStoryPageTextMaxChars(10, 'en', 'en'), 320);
});
