import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

interface GenerateContentCall {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
}

test('generateJSON passes story controls through to Gemini', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return { text: '{"ok":true}' } as never;
  }) as typeof original;

  try {
    const result = await gemini.generateJSON<{ ok: boolean }>(
      'user prompt',
      'system prompt',
      {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
        },
        required: ['ok'],
      },
      {
        temperature: 0.6,
        thinkingConfig: { thinkingBudget: 512 },
        maxRetries: 1,
      },
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].config.temperature, 0.6);
    assert.deepEqual(calls[0].config.thinkingConfig, { thinkingBudget: 512 });
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateJSON retries once without thinkingConfig when the model rejects it', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;
  let attempt = 0;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    attempt++;

    if (attempt === 1) {
      throw new Error('Unknown field "thinkingConfig" at "config": Cannot find field.');
    }

    return { text: '{"ok":true}' } as never;
  }) as typeof original;

  try {
    const result = await gemini.generateJSON<{ ok: boolean }>(
      'user prompt',
      'system prompt',
      {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
        },
        required: ['ok'],
      },
      {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 256 },
        maxRetries: 1,
      },
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].config.thinkingConfig, { thinkingBudget: 256 });
    assert.equal(calls[1].config.thinkingConfig, undefined);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateImage keeps story-specific controls out of image requests', async () => {
  const gemini = await import('./gemini.js');
  const { config } = await import('../config.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return {
      data: 'image-data',
    } as never;
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

    if (attempt === 1) {
      return {
        candidates: [
          {
            finishReason: 'STOP',
          },
        ],
      } as never;
    }

    return {
      data: 'fallback-image-data',
    } as never;
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

test('generateImage surfaces safety blocks without falling back to the pro model', async () => {
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
