import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStoryAudioCreditCost,
  getStoryCreditCost,
  getStoryImageCreditCost,
  getStoryImagePageCreditCost,
  roundCreditAmount,
} from '../../shared/types.js';

test('story credit pricing uses exact 10-page mode costs', () => {
  assert.equal(getStoryCreditCost('fast'), 1);
  assert.equal(getStoryCreditCost('pro'), 2);
  assert.equal(getStoryCreditCost('pro_audio'), 3);
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
