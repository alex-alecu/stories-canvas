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
        model: 'gemini-3.1-flash-lite',
        temperature: 0.6,
        thinkingConfig: { thinkingBudget: 512 },
        tools: [{ googleSearch: {} }],
        maxRetries: 1,
      },
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'gemini-3.1-flash-lite');
    assert.equal(calls[0].config.temperature, 0.6);
    assert.deepEqual(calls[0].config.thinkingConfig, { thinkingBudget: 512 });
    assert.deepEqual(calls[0].config.tools, [{ googleSearch: {} }]);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('generateJSONFromContents passes multi-turn contents and max Gemini 3 thinking', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;
  const contents = [
    { role: 'user', parts: [{ text: 'Review this story.' }] },
    { role: 'model', parts: [{ text: '{"needsRewrite":false}' }] },
    { role: 'user', parts: [{ text: 'Apply the review.' }] },
  ];

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return { text: '{"ok":true}' } as never;
  }) as typeof original;

  try {
    const result = await gemini.generateJSONFromContents<{ ok: boolean }>(
      contents,
      'system prompt',
      {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
        },
        required: ['ok'],
      },
      {
        thinkingConfig: gemini.getMaxThinkingConfig('gemini-3.1-pro-preview'),
        maxRetries: 1,
      },
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].contents, contents);
    assert.deepEqual(calls[0].config.thinkingConfig, { thinkingLevel: 'HIGH' });
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('createGeminiAgentModel preserves tool calls and can force terminal tools', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ functionCall: { id: 'call-1', name: 'finish', args: { ok: true } } }],
        },
      }],
      functionCalls: [{ id: 'call-1', name: 'finish', args: { ok: true } }],
    } as never;
  }) as typeof original;

  try {
    const model = gemini.createGeminiAgentModel({ model: 'gemini-3.1-pro-preview' });
    const response = await model({
      systemInstruction: 'Use tools.',
      contents: [{ role: 'user', parts: [{ text: 'Begin.' }] }],
      tools: [{
        name: 'finish',
        description: 'Finish the task.',
        parameters: { type: 'OBJECT', properties: {} },
      }],
      forceToolNames: ['finish'],
    });

    assert.deepEqual(response.functionCalls, [{ id: 'call-1', name: 'finish', args: { ok: true } }]);
    assert.deepEqual(
      (calls[0].config.toolConfig as { functionCallingConfig: unknown }).functionCallingConfig,
      { mode: 'ANY', allowedFunctionNames: ['finish'] },
    );
    assert.deepEqual(calls[0].config.tools, [{
      functionDeclarations: [{
        name: 'finish',
        description: 'Finish the task.',
        parameters: { type: 'OBJECT', properties: {} },
      }],
    }]);
  } finally {
    (gemini.ai.models as { generateContent: typeof original }).generateContent = original;
  }
});

test('getMaxThinkingConfig selects model-specific max thinking controls', async () => {
  const gemini = await import('./gemini.js');

  assert.deepEqual(gemini.getMaxThinkingConfig('gemini-3.1-pro-preview'), { thinkingLevel: 'HIGH' });
  assert.deepEqual(gemini.getMaxThinkingConfig('gemini-2.5-pro'), { thinkingBudget: 32768 });
  assert.deepEqual(gemini.getMaxThinkingConfig('gemini-2.5-flash'), { thinkingBudget: 24576 });
  assert.deepEqual(gemini.getMaxThinkingConfig('gemini-2.5-flash-lite'), { thinkingBudget: 24576 });
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

test('generateImage surfaces prohibited-content policy blocks without falling back to the pro model', async () => {
  const gemini = await import('./gemini.js');
  const calls: GenerateContentCall[] = [];
  const original = gemini.ai.models.generateContent;

  (gemini.ai.models as { generateContent: typeof original }).generateContent = (async (request) => {
    calls.push(request as GenerateContentCall);
    return {
      candidates: [
        {
          finishReason: 'PROHIBITED_CONTENT',
        },
      ],
    } as never;
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
