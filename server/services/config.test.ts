import assert from 'node:assert/strict';
import test from 'node:test';


const {
  config,
  resolveDefaultAppLanguage,
  resolveNonNegativeNumberEnv,
  resolveStoryPackPricingConfig,
  resolveImageModelId,
} = await import('../config.js');

test('text roles have a default OpenRouter model', () => {
  assert.equal(config.scenarioModel, 'google/gemini-3.8-flash');
  assert.equal(config.reviewModel, 'google/gemini-3.8-flash');
  assert.equal(config.sourceAnalysisModel, 'google/gemini-3.8-flash');
  assert.equal(config.pageTextReviewModel, 'google/gemini-3.8-flash');
});

test('image models use OpenRouter IDs and no direct Google credential', () => {
  assert.equal(config.imageModel, 'google/gemini-3.1-flash-image-preview');
  assert.equal(config.imageModelPro, 'google/gemini-3-pro-image-preview');
  assert.equal('geminiApiKey' in config, false);
  assert.equal(resolveImageModelId('gemini-3.1-flash-image-preview', ''), 'google/gemini-3.1-flash-image-preview');
  assert.equal(resolveImageModelId('gemini-3-pro-image-preview', ''), 'google/gemini-3-pro-image-preview');
  assert.equal(resolveImageModelId('openai/gpt-image-2', ''), 'openai/gpt-image-2');
});

test('resolveDefaultAppLanguage only accepts site-localized deployment languages', () => {
  assert.equal(resolveDefaultAppLanguage('en'), 'en');
  assert.equal(resolveDefaultAppLanguage(' EN '), 'en');
  assert.equal(resolveDefaultAppLanguage('ro'), 'ro');
  assert.equal(resolveDefaultAppLanguage('de'), 'ro');
  assert.equal(resolveDefaultAppLanguage(undefined), 'ro');
});

test('resolveNonNegativeNumberEnv validates provider rates', () => {
  assert.equal(resolveNonNegativeNumberEnv('RATE', 0.1, {}), 0.1);
  assert.equal(resolveNonNegativeNumberEnv('RATE', 0.1, { RATE: '0.25' }), 0.25);
  assert.throws(() => resolveNonNegativeNumberEnv('RATE', 0.1, { RATE: '-1' }), /non-negative number/);
  assert.throws(() => resolveNonNegativeNumberEnv('RATE', 0.1, { RATE: 'nope' }), /non-negative number/);
});

test('resolveStoryPackPricingConfig validates and fingerprints complete pricing', () => {
  const pricing = resolveStoryPackPricingConfig({
    STORY_PACK_CURRENCY: ' USD ',
    STORY_PACK_5_PRICE_MINOR: '1299',
    STORY_PACK_12_PRICE_MINOR: '2799',
    STORY_PACK_20_PRICE_MINOR: '4299',
  });

  assert.equal(pricing?.currency, 'usd');
  assert.deepEqual(pricing?.pricesMinor, { pack_5: 1299, pack_12: 2799, pack_20: 4299 });
  assert.match(pricing?.fingerprint ?? '', /^[a-f0-9]{64}$/);
  assert.equal(resolveStoryPackPricingConfig({}), undefined);
});

test('resolveStoryPackPricingConfig rejects partial and malformed pricing', () => {
  assert.throws(
    () => resolveStoryPackPricingConfig({ STORY_PACK_CURRENCY: 'usd' }),
    /requires all of/,
  );
  assert.throws(
    () => resolveStoryPackPricingConfig({
      STORY_PACK_CURRENCY: 'US',
      STORY_PACK_5_PRICE_MINOR: '1299',
      STORY_PACK_12_PRICE_MINOR: '2799',
      STORY_PACK_20_PRICE_MINOR: '4299',
    }),
    /three-letter currency/,
  );
  assert.throws(
    () => resolveStoryPackPricingConfig({
      STORY_PACK_CURRENCY: 'usd',
      STORY_PACK_5_PRICE_MINOR: '12.99',
      STORY_PACK_12_PRICE_MINOR: '2799',
      STORY_PACK_20_PRICE_MINOR: '4299',
    }),
    /non-negative integer/,
  );
});
