import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

interface GenerateContentCall {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
}

test('generateImage keeps text controls out of image requests', async () => {
  const gemini = await import('./gemini.js');
  const { config } = await import('../config.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return { data: 'image-data' } as never;
  }) as typeof original;

  try {
    const image = await gemini.generateImage('draw a forest');

    assert.equal(image, 'image-data');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, config.imageModel);
    assert.equal(calls[0].config.temperature, undefined);
    assert.equal(calls[0].config.thinkingConfig, undefined);
    assert.deepEqual(calls[0].config.responseModalities, ['IMAGE']);
    assert.deepEqual(calls[0].config.safetySettings, [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
    ]);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateImage falls back to the pro image model after an empty flash response', async () => {
  const gemini = await import('./gemini.js');
  const { config } = await import('../config.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;
  let attempt = 0;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    attempt++;
    if (attempt === 1) return { candidates: [{ finishReason: 'STOP' }] } as never;
    return { data: 'fallback-image-data' } as never;
  }) as typeof original;

  try {
    const image = await gemini.generateImage('draw a castle');

    assert.equal(image, 'fallback-image-data');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, config.imageModel);
    assert.equal(calls[1].model, config.imageModelPro);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateImage surfaces safety blocks without a pro-model retry', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return {
      promptFeedback: {
        blockReason: 'SAFETY',
        blockReasonMessage: 'image prompt was blocked',
      },
    } as never;
  }) as typeof original;

  try {
    await assert.rejects(
      () => gemini.generateImage('draw something unsafe'),
      error => {
        assert.ok(error instanceof gemini.ImageSafetyBlockedError);
        assert.match(String(error.message), /SAFETY|safety/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateImage surfaces policy blocks without a pro-model retry', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] } as never;
  }) as typeof original;

  try {
    await assert.rejects(
      () => gemini.generateImage('draw cinderella'),
      error => {
        assert.ok(error instanceof gemini.ImagePolicyBlockedError);
        assert.match(String(error.message), /PROHIBITED_CONTENT/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});
