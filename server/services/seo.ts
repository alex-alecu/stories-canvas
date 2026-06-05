import type { StoryMeta } from '../../shared/types.js';
import {
  LEGAL_ROUTES,
  getLegalProfileForHostname,
  interpolateLegalText,
  type LegalDocument,
  type LegalRouteKey,
} from '../../src/legal/legalConfig.js';
import { config } from '../config.js';

const INDEX_ROBOTS = 'index,follow';
const NOINDEX_ROBOTS = 'noindex,nofollow';
const SITEMAP_STORY_LIMIT = 5_000;

export interface SeoStorage {
  getStory(id: string): Promise<StoryMeta | null>;
  listPublicStories(limit: number): Promise<StoryMeta[]>;
}

export interface SeoRouteData {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  lang: string;
  locale: string;
  type: 'website' | 'article';
  imageUrl: string;
  structuredData: Record<string, unknown>[];
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

function normalizeOrigin(rawOrigin: string): string {
  try {
    return new URL(rawOrigin).origin;
  } catch {
    return 'http://localhost:3001';
  }
}

function getCanonicalOrigin(): string {
  return normalizeOrigin(config.appBaseUrl);
}

function getCanonicalHostname(): string {
  return new URL(getCanonicalOrigin()).hostname;
}

function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  return `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function absoluteUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, getCanonicalOrigin()).toString();
  }
}

function canonicalUrl(path: string): string {
  return absoluteUrl(normalizePath(path));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function siteTitle(title: string): string {
  if (title === config.seoSiteName || title.endsWith(`| ${config.seoSiteName}`)) {
    return title;
  }
  return `${title} | ${config.seoSiteName}`;
}

function getLegalDocumentForPath(path: string): LegalDocument | undefined {
  const normalizedPath = normalizePath(path);
  const profile = getLegalProfileForHostname(getCanonicalHostname());
  return Object.values(profile.documents).find(document => document.route === normalizedPath);
}

function getLegalRouteEntries(): Array<{ key: LegalRouteKey; document: LegalDocument }> {
  const profile = getLegalProfileForHostname(getCanonicalHostname());
  return (Object.entries(LEGAL_ROUTES) as Array<[LegalRouteKey, string]>).map(([key]) => ({
    key,
    document: profile.documents[key],
  }));
}

function legalDateModified(document: LegalDocument): string | undefined {
  return document.updatedAtIso;
}

function buildOrganizationData() {
  const profile = getLegalProfileForHostname(getCanonicalHostname());
  const operator = profile.operator;

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: `${operator.name} ${operator.legalForm}`,
    legalName: `${operator.name} ${operator.legalForm}`,
    taxID: operator.taxId,
    address: operator.address,
    url: getCanonicalOrigin(),
  };
}

function buildWebsiteData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: config.seoSiteName,
    url: getCanonicalOrigin(),
    inLanguage: config.seoDefaultLang,
  };
}

function defaultSeo(path: string, robots = NOINDEX_ROBOTS): SeoRouteData {
  return {
    title: config.seoDefaultTitle,
    description: config.seoDefaultDescription,
    canonicalUrl: canonicalUrl(path),
    robots,
    lang: config.seoDefaultLang,
    locale: config.seoDefaultLocale,
    type: 'website',
    imageUrl: absoluteUrl(config.seoFallbackImage),
    structuredData: [],
  };
}

function storyDescription(story: StoryMeta): string {
  const pageText = story.scenario?.pages
    ?.filter(page => page.status === 'completed' && page.text.trim())
    .map(page => page.text)
    .join(' ');

  return truncateText(pageText || story.prompt || config.seoDefaultDescription, 160);
}

function storyImage(story: StoryMeta): string {
  return absoluteUrl(
    story.coverImageSources?.full
      ?? story.coverImageSources?.card
      ?? story.coverImage
      ?? config.seoFallbackImage,
  );
}

function isPublicCompletedStory(story: StoryMeta | null): story is StoryMeta {
  return !!story && story.isPublic === true && story.status === 'completed' && !!story.scenario;
}

export async function resolveSeoRoute(path: string, storage: SeoStorage): Promise<SeoRouteData> {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/') {
    return {
      ...defaultSeo('/', INDEX_ROBOTS),
      structuredData: [buildWebsiteData(), buildOrganizationData()],
    };
  }

  if (normalizedPath === '/explore') {
    return {
      ...defaultSeo('/explore', INDEX_ROBOTS),
      title: siteTitle('Explorează povești pentru copii'),
      description: 'Descoperă povești ilustrate pentru copii create de comunitatea Povești Magice.',
      structuredData: [buildWebsiteData()],
    };
  }

  const legalDocument = getLegalDocumentForPath(normalizedPath);
  if (legalDocument) {
    const structuredData: Record<string, unknown>[] = [{
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: legalDocument.title,
      description: legalDocument.description,
      url: canonicalUrl(legalDocument.route),
      inLanguage: config.seoDefaultLang,
      dateModified: legalDateModified(legalDocument),
    }];

    if (normalizedPath === LEGAL_ROUTES.contact) {
      structuredData.push(buildOrganizationData());
    }

    return {
      ...defaultSeo(legalDocument.route, INDEX_ROBOTS),
      title: siteTitle(legalDocument.title),
      description: legalDocument.description,
      structuredData,
    };
  }

  const storyMatch = normalizedPath.match(/^\/story\/([^/]+)$/);
  if (storyMatch) {
    const story = await storage.getStory(decodeURIComponent(storyMatch[1] ?? ''));
    if (!isPublicCompletedStory(story)) {
      return defaultSeo(normalizedPath, NOINDEX_ROBOTS);
    }

    const title = story.scenario.title || 'Poveste ilustrată pentru copii';
    const description = storyDescription(story);
    const imageUrl = storyImage(story);

    return {
      title: siteTitle(title),
      description,
      canonicalUrl: canonicalUrl(normalizedPath),
      robots: INDEX_ROBOTS,
      lang: story.language || config.seoDefaultLang,
      locale: config.seoDefaultLocale,
      type: 'article',
      imageUrl,
      structuredData: [{
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        headline: title,
        name: title,
        description,
        image: imageUrl,
        url: canonicalUrl(normalizedPath),
        inLanguage: story.language || config.seoDefaultLang,
        datePublished: story.createdAt,
      }],
    };
  }

  return defaultSeo(normalizedPath, NOINDEX_ROBOTS);
}

function metaTag(name: string, content: string): string {
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}" />`;
}

function propertyTag(property: string, content: string): string {
  return `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}" />`;
}

function linkTag(rel: string, href: string): string {
  return `<link rel="${escapeHtml(rel)}" href="${escapeHtml(href)}" />`;
}

function buildHeadMarkup(seo: SeoRouteData): string {
  const structuredData = seo.structuredData
    .filter(Boolean)
    .map(data => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);

  return [
    `<title>${escapeHtml(seo.title)}</title>`,
    metaTag('description', seo.description),
    metaTag('robots', seo.robots),
    linkTag('canonical', seo.canonicalUrl),
    propertyTag('og:site_name', config.seoSiteName),
    propertyTag('og:title', seo.title),
    propertyTag('og:description', seo.description),
    propertyTag('og:type', seo.type),
    propertyTag('og:url', seo.canonicalUrl),
    propertyTag('og:image', seo.imageUrl),
    propertyTag('og:locale', seo.locale),
    metaTag('twitter:card', 'summary_large_image'),
    metaTag('twitter:title', seo.title),
    metaTag('twitter:description', seo.description),
    metaTag('twitter:image', seo.imageUrl),
    ...structuredData,
  ].join('\n    ');
}

export async function renderHtmlWithSeo(indexHtml: string, path: string, storage: SeoStorage): Promise<string> {
  const seo = await resolveSeoRoute(path, storage);
  const cleanedHtml = indexHtml
    .replace(/<html\b([^>]*)\blang=(["']).*?\2([^>]*)>/i, `<html$1lang="${escapeHtml(seo.lang)}"$3>`)
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name=(["'])description\1\s+content=(["'])[\s\S]*?\2\s*\/?>\s*/i, '')
    .replace(/<meta\s+name=(["'])robots\1\s+content=(["'])[\s\S]*?\2\s*\/?>\s*/i, '')
    .replace(/<link\s+rel=(["'])canonical\1\s+href=(["'])[\s\S]*?\2\s*\/?>\s*/i, '');

  return cleanedHtml.replace('</head>', `    ${buildHeadMarkup(seo)}\n  </head>`);
}

function sitemapEntry(url: SitemapUrl): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(url.loc)}</loc>`,
    url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : undefined,
    '  </url>',
  ].filter(Boolean).join('\n');
}

export async function buildSitemapXml(storage: SeoStorage): Promise<string> {
  const staticUrls: SitemapUrl[] = [
    { loc: canonicalUrl('/') },
    { loc: canonicalUrl('/explore') },
    ...getLegalRouteEntries().map(({ document }) => ({
      loc: canonicalUrl(document.route),
      lastmod: legalDateModified(document),
    })),
  ];

  const stories = await storage.listPublicStories(SITEMAP_STORY_LIMIT);
  const storyUrls = stories
    .filter(isPublicCompletedStory)
    .map(story => ({
      loc: canonicalUrl(`/story/${encodeURIComponent(story.id)}`),
      lastmod: story.createdAt.slice(0, 10),
    }));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...staticUrls, ...storyUrls].map(sitemapEntry),
    '</urlset>',
  ].join('\n');
}

export function buildRobotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${canonicalUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

export const seoLimits = {
  sitemapStoryLimit: SITEMAP_STORY_LIMIT,
} as const;
