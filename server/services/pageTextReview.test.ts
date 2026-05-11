import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

async function loadReviewPageText() {
  return (await import('./pageTextReview.js')).reviewPageText;
}

test('reviewPageText allows safe page text', async () => {
  const reviewPageText = await loadReviewPageText();
  const result = await reviewPageText(
    {
      text: 'Mara gives her little boat a blue flag and smiles at the pond.',
      targetAge: 4,
      language: 'en',
      purpose: 'page_text',
    },
    async (_prompt, _system, _schema, options) => {
      assert.equal(options?.model, 'gemini-3.1-flash-lite');
      assert.equal(options?.temperature, 0);
      assert.equal('thinkingConfig' in (options ?? {}), false);
      return { allowed: true, reasonCode: '', explanation: '' };
    },
  );

  assert.deepEqual(result, { allowed: true });
});

test('reviewPageText blocks profanity with a normalized reason', async () => {
  const reviewPageText = await loadReviewPageText();
  const result = await reviewPageText(
    {
      text: 'A mean page with profanity.',
      targetAge: 5,
      language: 'en',
      purpose: 'page_text',
    },
    async () => ({
      allowed: false,
      reasonCode: 'profanity',
      explanation: 'Please keep the page child-friendly.',
    }),
  );

  assert.deepEqual(result, {
    allowed: false,
    reasonCode: 'profanity',
    explanation: 'Please keep the page child-friendly.',
  });
});

test('reviewPageText blocks harmful age-inappropriate content', async () => {
  const reviewPageText = await loadReviewPageText();
  const result = await reviewPageText(
    {
      text: 'A frightening scene that is too intense for a young child.',
      targetAge: 3,
      language: 'en',
      purpose: 'image_feedback',
    },
    async () => ({
      allowed: false,
      reasonCode: 'age_inappropriate',
      explanation: 'This is too intense for the selected age.',
    }),
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'age_inappropriate');
});

test('reviewPageText fails closed when the model call fails', async () => {
  const reviewPageText = await loadReviewPageText();
  const result = await reviewPageText(
    {
      text: 'A normal sentence.',
      targetAge: 6,
      language: 'en',
    },
    async () => {
      throw new Error('model unavailable');
    },
  );

  assert.deepEqual(result, {
    allowed: false,
    reasonCode: 'other',
    explanation: 'We could not verify this text. Please try again.',
  });
});
