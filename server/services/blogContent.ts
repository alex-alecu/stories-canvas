import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getBlogArticleLocaleBySlug,
  listBlogArticleLocales,
  resolveBlogLanguage,
  type BlogLanguage,
} from '../../shared/blogArticles.js';
import { parseBlogMarkdown, type BlogArticle } from '../../shared/blogMarkdown.js';

const BLOG_CONTENT_DIR = join(process.cwd(), 'src', 'content', 'blog');

function loadBlogArticle(entry: { language: BlogLanguage; slug: string; filename: string }): BlogArticle {
  const article = parseBlogMarkdown(
    readFileSync(join(BLOG_CONTENT_DIR, entry.language, entry.filename), 'utf8'),
  );
  if (article.meta.slug !== entry.slug) {
    throw new Error(`Blog article slug mismatch: ${article.meta.slug} !== ${entry.slug}`);
  }
  if (article.meta.language !== entry.language) {
    throw new Error(`Blog article language mismatch: ${article.meta.language} !== ${entry.language}`);
  }
  return article;
}

export function listBlogArticles(language?: string): BlogArticle[] {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return [];
  return listBlogArticleLocales(resolvedLanguage).map(loadBlogArticle);
}

export function getBlogArticleBySlug(slug: string, language?: string): BlogArticle | undefined {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return undefined;
  const entry = getBlogArticleLocaleBySlug(slug, resolvedLanguage);
  return entry ? loadBlogArticle(entry) : undefined;
}
