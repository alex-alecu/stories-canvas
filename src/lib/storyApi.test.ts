import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicStories } from './storyApi';

test('public story requests include the selected language', async t => {
  let requestedUrl = '';
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url;
    return Response.json([]);
  });
  await fetchPublicStories({ language: 'ro' });
  assert.equal(requestedUrl, '/api/stories/public?language=ro');
});

test('public story requests keep the language with search and limit', async t => {
  let requestedUrl = '';
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url;
    return Response.json([]);
  });
  await fetchPublicStories({ language: 'de', search: 'fox & bird', limit: 4 });
  const url = new URL(requestedUrl, 'https://example.test');
  assert.equal(url.pathname, '/api/stories/public');
  assert.equal(url.searchParams.get('language'), 'de');
  assert.equal(url.searchParams.get('search'), 'fox & bird');
  assert.equal(url.searchParams.get('limit'), '4');
});
