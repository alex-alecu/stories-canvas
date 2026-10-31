import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEXT_MODEL, DEFAULT_THINKING_LEVEL, TEXT_MODELS, getTextCompletionTokenLimit, parseTextModelSettings } from '../../shared/textModels.js';
import { getWalletCopy } from '../../src/i18n/walletCopy.js';

test('new stories use Opus 5.5 with extra high thinking', () => {
  assert.equal(DEFAULT_TEXT_MODEL, 'anthropic/claude-opus-5.5');
  assert.equal(DEFAULT_THINKING_LEVEL, 'xhigh');
  assert.deepEqual(parseTextModelSettings(undefined, undefined), {
    textModel: 'anthropic/claude-opus-5.5', thinkingLevel: 'xhigh',
  });
  assert.deepEqual(TEXT_MODELS.map(model => model.id), [
    'anthropic/claude-opus-5.5', 'openai/gpt-6-astra', 'openai/gpt-6.1-sol',
  ]);
  for (const model of TEXT_MODELS) {
    assert.equal(parseTextModelSettings(model.id, undefined).thinkingLevel, 'xhigh');
    assert.equal(parseTextModelSettings(model.id, 'xhigh').thinkingLevel, 'xhigh');
  }
});

test('saved story models retain supported thinking when the default changes', () => {
  for (const model of ['google/gemini-3.8-flash', 'anthropic/claude-fable-5.1',
    'anthropic/claude-opus-5', 'qwen/qwen3.8-max-0902', 'x-ai/grok-4.6', 'openai/gpt-5.6-sol']) {
    assert.throws(() => parseTextModelSettings(model, 'high'));
    assert.deepEqual(parseTextModelSettings(model, undefined, true), { textModel: model, thinkingLevel: 'medium' });
    assert.equal(parseTextModelSettings(model, 'high', true).thinkingLevel, 'high');
    assert.throws(() => parseTextModelSettings(model, 'xhigh', true));
  }
});

test('the translation model has an output limit without entering the story model picker', () => {
  assert.equal(getTextCompletionTokenLimit('openai/gpt-6.1-terra'), 128_000);
  assert.throws(() => parseTextModelSettings('openai/gpt-6.1-terra', 'low'));
});

test('extra high thinking has a visible label in each supported wallet language', () => {
  for (const language of ['en', 'ro']) {
    assert.equal(typeof (getWalletCopy(language) as Record<string, string>).xhigh, 'string');
    assert.ok((getWalletCopy(language) as Record<string, string>).xhigh.length > 0);
  }
});
