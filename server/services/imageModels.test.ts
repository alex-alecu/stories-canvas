import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_IMAGE_MODEL,
  getSelectableImageModelId,
  getStoredImageModel,
  parseImageModel,
} from '../../shared/imageModels.js';

test('image model choices default to the stable Gemini fast model and reject unknown request values', () => {
  assert.equal(parseImageModel(undefined).id, DEFAULT_IMAGE_MODEL);
  assert.equal(parseImageModel('black-forest-labs/flux.2-pro').id, 'black-forest-labs/flux.2-pro');
  assert.throws(() => parseImageModel('unknown/image-model'), /Select an image model/);
});

test('stored image choices preserve legacy bare and Pro Gemini snapshots', () => {
  assert.equal(getStoredImageModel({
    imageModel: 'gemini-3.1-flash-image-preview',
    imageModelPro: 'gemini-3-pro-image-preview',
    proModel: false,
  }).id, 'google/gemini-3.1-flash-image-preview');
  assert.equal(getStoredImageModel({
    imageModel: 'gemini-3.1-flash-image-preview',
    imageModelPro: 'gemini-3-pro-image-preview',
    proModel: true,
  }).id, 'google/gemini-3-pro-image-preview');
  assert.equal(getSelectableImageModelId('google/gemini-3.1-flash-image-preview'), 'google/gemini-3.1-flash-image');
  assert.equal(getSelectableImageModelId('gemini-3-pro-image-preview'), 'google/gemini-3-pro-image');
});
