import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateInitialStoryPageCount,
  estimateOriginalStoryPageCount,
  estimateStoryPageLimit,
  getStoryAudioCreditCost,
  getStoryCreditCost,
  getStoryImageCreditCost,
  getStoryImagePageCreditCost,
  roundCreditAmount,
} from '../../shared/types.js';

test('story credit pricing uses fixed mode costs', () => {
  assert.equal(getStoryCreditCost('fast'), 1);
  assert.equal(getStoryCreditCost('pro'), 2);
  assert.equal(getStoryCreditCost('pro_audio'), 3);
});

test('story credit pricing stays fixed regardless of page budget', () => {
  assert.equal(getStoryCreditCost('fast', 14), 1);
  assert.equal(getStoryCreditCost('pro', 16), 2);
  assert.equal(getStoryCreditCost('pro_audio', 20), 3);
});

test('story page estimates use a 10-page limit or 20-page limit', () => {
  assert.equal(estimateOriginalStoryPageCount('A sleepy moon helps a child rest.'), 10);
  assert.equal(estimateStoryPageLimit('A sleepy moon helps a child rest.'), 10);
  assert.equal(estimateStoryPageLimit('A dragon adventure across a magic kingdom with a difficult quest.'), 20);
  assert.equal(estimateInitialStoryPageCount('Creează povestea Povestea porcului, urmează originalul exact.'), 20);
});

test('page-level credit pricing is prorated to one decimal', () => {
  assert.equal(getStoryImagePageCreditCost('fast'), 0.1);
  assert.equal(getStoryImagePageCreditCost('pro'), 0.2);
  assert.equal(getStoryImagePageCreditCost('pro_audio'), 0.2);
  assert.equal(getStoryImageCreditCost('fast', 3), 0.3);
  assert.equal(getStoryImageCreditCost('pro', 3), 0.6);
  assert.equal(getStoryAudioCreditCost(3), 0.3);
  assert.equal(roundCreditAmount(0.30000000000000004), 0.3);
});
