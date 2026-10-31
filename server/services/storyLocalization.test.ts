import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryGenerationInputs, StoryMeta } from '../../shared/types.js';
import { applyStoryLocalization, getSourceLanguage, type StoryLocalization } from '../../shared/storyLocalization.js';
import { getStorySourceHash, translateStory } from './storyLocalization.js';
import { withTextModelSettings } from './textGenerationContext.js';

function story(): StoryMeta {
  return {
    id: 'story-1', prompt: 'A fox finds a friend.', language: 'en', status: 'completed', createdAt: '2026-10-30',
    scenario: { title: 'A New Friend', targetAge: 4, characters: [{ name: 'Pip', role: 'fox', appearance: 'red fur', clothing: '', personality: 'kind', characterSheetPrompt: 'A red fox' }],
      pages: [{ pageNumber: 1, text: 'Pip finds a friend.', imagePrompt: 'A red fox meets a rabbit.', characters: ['Pip'], status: 'completed', imageUrl: '/fox.png', audioUrl: '/en.mp3', audioRevision: 3 },
        { pageNumber: 2, text: 'They walk home.', imagePrompt: 'The friends walk home.', characters: ['Pip'], status: 'completed', imageUrl: '/home.png' }] },
  };
}
function localization(): StoryLocalization {
  return { language: 'ro', sourceHash: 'hash', title: 'Un prieten nou', voice: 'mom', audioModel: 'tts', audioVoice: 'Kore',
    pages: [{ pageNumber: 1, text: 'Pip găsește un prieten.', audioUrl: '/ro.mp3', audioRevision: 1 }, { pageNumber: 2, text: 'Ei merg acasă.' }] };
}

test('source language retains the actual language of legacy stories', () => {
  assert.equal(getSourceLanguage(story()), 'en');
  assert.equal(getSourceLanguage({ ...story(), language: 'ro' }), 'ro');
  assert.equal(getSourceLanguage({ ...story(), language: undefined }), 'en');
  assert.equal(getSourceLanguage({ ...story(), language: 'ro', generationInputs: { sourceLanguage: 'en' } as never }), 'en');
});

test('translated pages keep source images and use only matching language audio', () => {
  const original = story();
  const result = applyStoryLocalization(original, localization(), 'ro');
  assert.equal(result.language, 'ro');
  assert.equal(result.scenario?.title, 'Un prieten nou');
  assert.equal(result.scenario?.pages[0].imagePrompt, 'A red fox meets a rabbit.');
  assert.equal(result.scenario?.pages[0].imageUrl, '/fox.png');
  assert.equal(result.scenario?.pages[0].audioUrl, '/ro.mp3');
  assert.equal(result.scenario?.pages[0].audioRevision, 1);
  assert.equal(result.scenario?.pages[1].audioUrl, undefined);
  assert.equal(result.voice, 'mom');
  assert.equal(original.scenario?.pages[0].text, 'Pip finds a friend.');
});

test('missing or incomplete translations show source text without source audio', () => {
  for (const value of [null, { ...localization(), pages: localization().pages.slice(0, 1) }, { ...localization(), language: 'de' }]) {
    const result = applyStoryLocalization(story(), value, 'ro');
    assert.equal(result.language, 'en');
    assert.equal(result.requestedLanguage, 'ro');
    assert.equal(result.localizationMissing, true);
    assert.equal(result.scenario?.pages[0].text, 'Pip finds a friend.');
    assert.equal(result.scenario?.pages[0].audioUrl, undefined);
    assert.equal(result.scenario?.pages[0].audioRevision, undefined);
  }
  assert.equal(applyStoryLocalization(story(), null, 'en').scenario?.pages[0].audioUrl, '/en.mp3');
});

test('source hash changes with source text but ignores audio and generation status', () => {
  const original = story();
  const hash = getStorySourceHash(original);
  const audioChange = structuredClone(original);
  audioChange.status = 'generating_audio';
  audioChange.scenario!.pages[0].audioUrl = '/updated.mp3';
  audioChange.scenario!.pages[0].audioRevision = 4;
  assert.equal(getStorySourceHash(audioChange), hash);
  for (const change of [
    (value: StoryMeta) => { value.scenario!.title = 'Another title'; },
    (value: StoryMeta) => { value.scenario!.pages[0].text += ' Again.'; },
    (value: StoryMeta) => { value.scenario!.pages[0].pageNumber = 3; },
    (value: StoryMeta) => { value.language = 'ro'; },
  ]) {
    const changed = structuredClone(original); change(changed);
    assert.notEqual(getStorySourceHash(changed), hash);
  }
});

test('source language translation keeps legacy audio without a provider call', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected provider request'); };
  try {
    const value = await translateStory(story(), 'en', {});
    assert.equal(value.title, 'A New Friend');
    assert.equal(value.pages[0].audioUrl, '/en.mp3');
    assert.equal(value.pages[0].audioRevision, 3);
    assert.equal(value.sourceHash, getStorySourceHash(story()));
  } finally { globalThis.fetch = previous; }
});

async function providerResult(value: unknown, run: (requests: Array<Record<string, unknown>>) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const requests: Array<Record<string, unknown>> = [];
  process.env.OPENROUTER_API_KEY = `translation-test-${Math.random()}`;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: 'translation-1', object: 'chat.completion', created: 0, model: 'openai/gpt-6.1-terra',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50, cost: 0.00001 } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(requests); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey; }
}

test('translation uses Terra with low reasoning, full scene context, and usage reporting', async () => {
  await providerResult(localization(), async requests => {
    const usage: unknown[] = [];
    const result = await withTextModelSettings({ textModel: 'anthropic/claude-opus-5.5', thinkingLevel: 'xhigh' },
      () => translateStory(story(), 'ro', { onUsage: async value => { usage.push(value); } }));
    assert.equal(result.title, 'Un prieten nou');
    assert.deepEqual(result.pages, [{ pageNumber: 1, text: 'Pip găsește un prieten.' }, { pageNumber: 2, text: 'Ei merg acasă.' }]);
    assert.equal(result.sourceHash, getStorySourceHash(story()));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'openai/gpt-6.1-terra');
    assert.deepEqual(requests[0].reasoning, { effort: 'low' });
    assert.equal(requests[0].tools, undefined);
    assert.equal(requests[0].plugins, undefined);
    const contents = JSON.stringify(requests[0].messages);
    assert.match(contents, /A red fox meets a rabbit/);
    assert.match(contents, /They walk home/);
    assert.match(contents, /red fur/);
    assert.equal(usage.length, 1);
  });
});

test('translation rejects missing, duplicate, reordered, empty, long, and wrong-language output', async () => {
  const base = localization();
  for (const output of [
    { ...base, pages: base.pages.slice(0, 1) },
    { ...base, pages: [base.pages[0], base.pages[0]] },
    { ...base, pages: [...base.pages].reverse() },
    { ...base, title: '' },
    { ...base, language: 'en' },
    { ...base, pages: [{ pageNumber: 1, text: '' }, base.pages[1]] },
    { ...base, pages: [{ pageNumber: 1, text: 'x'.repeat(641) }, base.pages[1]] },
    { ...base, pages: [{ pageNumber: 1, text: {} }, base.pages[1]] },
  ]) await providerResult(output, async () => { await assert.rejects(translateStory(story(), 'ro', {}), /translation/i); });
});

test('translation rejects unsupported language and aborted requests before provider access', async () => {
  await assert.rejects(translateStory(story(), '../ro', {}), /language/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translateStory(story(), 'en', { signal: controller.signal }), /abort/i);
});


test('source language records can provide new audio and saved voice settings', () => {
  const original = story();
  original.generationInputs = { sourceLanguage: 'en', audioModel: 'source-tts', audioVoice: 'source-voice' } as StoryGenerationInputs;
  const result = applyStoryLocalization(original, { ...localization(), language: 'en', title: 'A New Friend', pages: [
    { pageNumber: 1, text: 'Pip finds a friend.', audioUrl: '/new-en.mp3' },
    { pageNumber: 2, text: 'They walk home.' },
  ] }, 'en');
  assert.equal(result.scenario?.pages[0].audioUrl, '/new-en.mp3');
  assert.equal(result.voice, 'mom');
  assert.equal(result.generationInputs?.audioModel, 'tts');
  assert.equal(result.generationInputs?.audioVoice, 'Kore');
  assert.equal(original.generationInputs?.audioModel, 'source-tts');
});


test('audio choice follows the selected language record and stays off for missing translations', () => {
  const original = story();
  original.generationInputs = { sourceLanguage: 'en', audioEnabled: false } as StoryGenerationInputs;
  assert.equal(applyStoryLocalization(original, localization(), 'ro').generationInputs?.audioEnabled, true);
  original.generationInputs.audioEnabled = true;
  assert.equal(applyStoryLocalization(original, null, 'ro').generationInputs?.audioEnabled, false);
  assert.equal(applyStoryLocalization(original, null, 'en').generationInputs?.audioEnabled, true);
  const subtitles = { ...localization(), voice: undefined, pages: localization().pages.map(({ pageNumber, text }) => ({ pageNumber, text })) };
  assert.equal(applyStoryLocalization(original, subtitles, 'ro').generationInputs?.audioEnabled, false);
  assert.equal(applyStoryLocalization(original, { ...subtitles, voice: 'mom' }, 'ro').generationInputs?.audioEnabled, true);
  assert.equal(applyStoryLocalization(original, { ...subtitles, pages: [{ pageNumber: 1, text: 'Pip găsește un prieten.', audioUrl: '/ro.mp3' }, subtitles.pages[1]] }, 'ro').generationInputs?.audioEnabled, true);
});
