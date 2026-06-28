import assert from 'node:assert/strict';
import test from 'node:test';

import type { Page, Scenario, StoryMeta } from '../../shared/types.js';

process.env.GEMINI_API_KEY ??= 'test-key';

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    title: 'Povestea Lunii',
    targetAge: 5,
    characters: [],
    pages: [
      {
        pageNumber: 1,
        text: 'Luna lumina încet peste pădure.',
        imagePrompt: 'Moon over forest',
        characters: [],
        status: 'completed',
      },
    ],
    ...overrides,
  };
}

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  return {
    id: 'story-one',
    prompt: 'O poveste de seară.',
    status: 'completed',
    createdAt: '2026-06-01T12:00:00.000Z',
    scenario: makeScenario(),
    isPublic: true,
    language: 'ro',
    coverImageSources: {
      full: '/api/stories/story-one/images/cover-full.webp',
    },
    ...overrides,
  };
}

async function loadSeoModules() {
  const { config } = await import('../config.js');
  const seo = await import('./seo.js');
  const legal = await import('../../src/legal/legalConfig.js');
  const originalConfig = { ...config };

  Object.assign(config, {
    appBaseUrl: 'https://basmul.ro',
    appSiteName: 'Povești Magice',
    appSiteShortName: 'Povești Magice',
    appSiteDescription: 'Creează povești ilustrate personalizate pentru copii.',
    seoSiteName: 'Povești Magice',
    seoDefaultLang: 'ro',
    seoDefaultLocale: 'ro_RO',
    seoDefaultTitle: 'Povești Magice | Povești ilustrate pentru copii',
    seoDefaultDescription: 'Creează povești ilustrate personalizate pentru copii.',
    seoFallbackImage: '/logo-big-512.png',
  });

  return {
    config,
    seo,
    legal,
    restore: () => Object.assign(config, originalConfig),
  };
}

test('homepage uses basmul.ro canonical origin and Romanian default metadata', async (t) => {
  const { seo, restore } = await loadSeoModules();
  t.after(restore);

  const route = await seo.resolveSeoRoute('/', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });

  assert.equal(route.canonicalUrl, 'https://basmul.ro/');
  assert.equal(route.robots, 'index,follow');
  assert.equal(route.lang, 'ro');
  assert.equal(route.locale, 'ro_RO');
  assert.match(route.title, /Povești Magice/);
  assert.ok(route.structuredData.some(item => item['@type'] === 'WebSite'));
  assert.ok(route.structuredData.some(item => item['@type'] === 'Organization'));
});

test('English default language uses English SEO, legal copy, blog slugs, and manifest metadata', async (t) => {
  const { config, seo, restore } = await loadSeoModules();
  t.after(restore);

  Object.assign(config, {
    appBaseUrl: 'https://magicstories.com',
    appSiteName: 'Magic Stories',
    appSiteShortName: 'Magic Stories',
    appSiteDescription: 'Create personalized illustrated stories for children.',
    seoSiteName: 'Magic Stories',
    seoDefaultLang: 'en',
    seoDefaultLocale: 'en_US',
    seoDefaultTitle: 'Magic Stories | Illustrated stories for children',
    seoDefaultDescription: 'Create personalized illustrated stories for children.',
  });

  const homepage = await seo.resolveSeoRoute('/', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });
  assert.equal(homepage.canonicalUrl, 'https://magicstories.com/');
  assert.equal(homepage.lang, 'en');
  assert.equal(homepage.locale, 'en_US');
  assert.equal(homepage.title, 'Magic Stories | Illustrated stories for children');

  const legalRoute = await seo.resolveSeoRoute('/legal/terms', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });
  assert.equal(legalRoute.robots, 'index,follow');
  assert.match(legalRoute.title, /Terms and conditions/);
  assert.match(legalRoute.description, /rules for using Magic Stories/i);

  const blogRoute = await seo.resolveSeoRoute('/blog/how-to-use-childrens-stories', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });
  assert.equal(blogRoute.robots, 'index,follow');
  assert.equal(blogRoute.canonicalUrl, 'https://magicstories.com/blog/how-to-use-childrens-stories');
  assert.equal(blogRoute.lang, 'en');
  assert.match(blogRoute.title, /How to use children's stories/);

  const wrongLanguageBlogRoute = await seo.resolveSeoRoute('/blog/cum-folosesti-povestile-pentru-copii', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });
  assert.equal(wrongLanguageBlogRoute.robots, 'noindex,nofollow');

  const sitemap = await seo.buildSitemapXml({
    getStory: async () => null,
    listPublicStories: async () => [makeStory({ id: 'english-story', language: 'en' })],
  });
  assert.match(sitemap, /<loc>https:\/\/magicstories\.com\/blog\/how-to-use-childrens-stories<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/magicstories\.com\/blog\/stories-vs-videos-for-children-under-5<\/loc>/);
  assert.doesNotMatch(sitemap, /cum-folosesti-povestile/);

  const manifest = JSON.parse(seo.buildWebManifest());
  assert.equal(manifest.name, 'Magic Stories');
  assert.equal(manifest.short_name, 'Magic Stories');
  assert.equal(manifest.description, 'Create personalized illustrated stories for children.');
});

test('legal routes use their legal document metadata and are indexable', async (t) => {
  const { seo, legal, restore } = await loadSeoModules();
  t.after(restore);

  const profile = legal.getLegalProfileForHostname('basmul.ro');

  for (const document of Object.values(profile.documents)) {
    const route = await seo.resolveSeoRoute(document.route, {
      getStory: async () => null,
      listPublicStories: async () => [],
    });

    assert.equal(route.robots, 'index,follow');
    assert.equal(route.canonicalUrl, `https://basmul.ro${document.route}`);
    assert.match(route.title, new RegExp(document.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(route.description, document.description);
    assert.ok(route.structuredData.some(item => (
      item['@type'] === 'WebPage'
      && item.dateModified === document.updatedAtIso
    )));
  }
});

test('blog routes use article metadata and are indexable', async (t) => {
  const { seo, restore } = await loadSeoModules();
  t.after(restore);

  const route = await seo.resolveSeoRoute('/blog/cum-folosesti-povestile-pentru-copii', {
    getStory: async () => null,
    listPublicStories: async () => [],
  });

  assert.equal(route.robots, 'index,follow');
  assert.equal(route.canonicalUrl, 'https://basmul.ro/blog/cum-folosesti-povestile-pentru-copii');
  assert.equal(route.lang, 'ro');
  assert.equal(route.type, 'article');
  assert.match(route.title, /Cum să folosești poveștile pentru copii/);
  assert.match(route.description, /Poveștile pentru copii devin mai valoroase/);
  assert.ok(route.structuredData.some(item => (
    item['@type'] === 'BlogPosting'
    && item.url === 'https://basmul.ro/blog/cum-folosesti-povestile-pentru-copii'
    && item.dateModified === '2026-06-05'
  )));
});

test('account, admin, auth, and unknown SPA routes remain noindex', async (t) => {
  const { seo, restore } = await loadSeoModules();
  t.after(restore);

  for (const path of ['/login', '/auth/callback', '/profile', '/billing', '/admin', '/blog/nu-exista', '/not-a-route']) {
    const route = await seo.resolveSeoRoute(path, {
      getStory: async () => null,
      listPublicStories: async () => [],
    });

    assert.equal(route.robots, 'noindex,nofollow');
  }
});

test('public completed stories get escaped story metadata while private and incomplete stories stay noindex', async (t) => {
  const { seo, restore } = await loadSeoModules();
  t.after(restore);

  const unsafePage: Page = {
    pageNumber: 1,
    text: 'Un <script>secret</script> prieten merge prin pădure & cântă.',
    imagePrompt: 'Forest',
    characters: [],
    status: 'completed',
  };
  const publicStory = makeStory({
    id: 'unsafe-story',
    scenario: makeScenario({
      title: 'Luna <Curajoasă> & Prietenii',
      pages: [unsafePage],
    }),
  });

  const html = await seo.renderHtmlWithSeo(
    '<html lang="ro"><head><meta name="description" content="old" /><title>Old</title></head><body><div id="root"></div></body></html>',
    '/story/unsafe-story',
    {
      getStory: async () => publicStory,
      listPublicStories: async () => [],
    },
  );

  assert.match(html, /<title>Luna &lt;Curajoasă&gt; &amp; Prietenii \| Povești Magice<\/title>/);
  assert.match(html, /content="Un &lt;script&gt;secret&lt;\/script&gt; prieten merge prin pădure &amp; cântă\."/);
  assert.doesNotMatch(html, /<title>Old<\/title>/);
  assert.doesNotMatch(html, /<script>secret<\/script>/);

  const privateRoute = await seo.resolveSeoRoute('/story/private-story', {
    getStory: async () => makeStory({ isPublic: false }),
    listPublicStories: async () => [],
  });
  assert.equal(privateRoute.robots, 'noindex,nofollow');

  const incompleteRoute = await seo.resolveSeoRoute('/story/incomplete-story', {
    getStory: async () => makeStory({ status: 'generating_images' }),
    listPublicStories: async () => [],
  });
  assert.equal(incompleteRoute.robots, 'noindex,nofollow');
});

test('sitemap includes public static, legal, and public completed story URLs only', async (t) => {
  const { seo, legal, restore } = await loadSeoModules();
  t.after(restore);

  const sitemap = await seo.buildSitemapXml({
    getStory: async () => null,
    listPublicStories: async () => [
      makeStory({ id: 'public-story' }),
      makeStory({ id: 'private-story', isPublic: false }),
      makeStory({ id: 'draft-story', status: 'generating_images' }),
    ],
  });

  assert.match(sitemap, /<loc>https:\/\/basmul\.ro\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/basmul\.ro\/explore<\/loc>/);
  for (const route of Object.values(legal.LEGAL_ROUTES)) {
    assert.match(sitemap, new RegExp(`<loc>https://basmul\\.ro${route}</loc>`));
  }
  assert.match(sitemap, /<loc>https:\/\/basmul\.ro\/blog\/cum-folosesti-povestile-pentru-copii<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/basmul\.ro\/blog\/povesti-vs-videoclipuri-copii-sub-5-ani<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/basmul\.ro\/story\/public-story<\/loc>/);
  assert.doesNotMatch(sitemap, /private-story/);
  assert.doesNotMatch(sitemap, /draft-story/);
});
