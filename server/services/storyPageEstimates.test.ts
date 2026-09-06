import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateInitialStoryPageCount,
  estimateOriginalStoryPageCount,
  estimateStoryPageLimit,
} from '../../shared/types.js';

test('story page estimates use a 10-page limit or 20-page limit', () => {
  assert.equal(estimateOriginalStoryPageCount('A sleepy moon helps a child rest.'), 10);
  assert.equal(estimateStoryPageLimit('A sleepy moon helps a child rest.'), 10);
  assert.equal(estimateStoryPageLimit('A dragon adventure across a magic kingdom with a difficult quest.'), 20);
  assert.equal(estimateInitialStoryPageCount('Creează povestea Povestea porcului, urmează originalul exact.'), 20);
});
