import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_MODEL_PRO,
  IMAGE_MODELS,
  getSelectableImageModelId,
  getStoredImageModel,
  parseImageModel,
} from '../../shared/imageModels.js';

test('image model choices use Nano Banana 2.1 and offer the requested alternatives', () => {
  assert.equal(parseImageModel(undefined).id, DEFAULT_IMAGE_MODEL);
  assert.equal(DEFAULT_IMAGE_MODEL, 'google/gemini-nano-banana-2.1');
  assert.equal(DEFAULT_IMAGE_MODEL_PRO, DEFAULT_IMAGE_MODEL);
  assert.deepEqual(IMAGE_MODELS.map(model => model.id), [
    'google/gemini-nano-banana-2.1', 'openai/gpt-image-2.5-sunburst',
    'openai/gpt-image-2.5-flare', 'microsoft/mai-image-2.6',
  ]);
  assert.equal(parseImageModel('microsoft/mai-image-2.6').maxReferences, 5);
  assert.throws(() => parseImageModel('openai/gpt-image-2'), /Select an image model/);
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
  for (const id of ['google/gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview',
    'google/gemini-3.1-flash-image', 'google/gemini-3-pro-image', 'black-forest-labs/flux.2-pro',
    'bytedance-seed/seedream-5-0-lite']) {
    assert.equal(getStoredImageModel({ imageModel: id }).id, id.startsWith('gemini-') ? `google/${id}` : id);
    assert.equal(getSelectableImageModelId(id), DEFAULT_IMAGE_MODEL);
    assert.throws(() => parseImageModel(id), /Select an image model/);
  }
  assert.equal(getSelectableImageModelId('openai/gpt-image-2.5-sunburst'), 'openai/gpt-image-2.5-sunburst');
});
