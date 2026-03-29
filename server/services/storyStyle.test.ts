import assert from 'node:assert/strict';
import test from 'node:test';

import { ART_STYLES, type StoryMeta } from '../../shared/types.js';
import { getArtStyleDescription, getStoryArtStyleDescription, resolveArtStyle } from './storyStyle.js';

test('getArtStyleDescription returns the stored non-default style description', () => {
  assert.equal(resolveArtStyle('watercolor'), 'watercolor');
  assert.equal(getArtStyleDescription('watercolor'), ART_STYLES.watercolor);
});

test('getArtStyleDescription falls back to the default style when none is stored', () => {
  assert.equal(resolveArtStyle(undefined), 'disney-pixar');
  assert.equal(getArtStyleDescription(undefined), ART_STYLES['disney-pixar']);
});

test('retry image style selection uses the persisted story artStyle', () => {
  const story: StoryMeta = {
    id: 'story-1',
    prompt: 'A fox paints in the rain',
    status: 'completed',
    createdAt: '2026-03-29T00:00:00.000Z',
    artStyle: 'watercolor',
  };

  assert.equal(getStoryArtStyleDescription(story), ART_STYLES.watercolor);
});
