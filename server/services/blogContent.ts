import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BLOG_ARTICLE_FILES } from '../../shared/blogArticles.js';
import { parseBlogMarkdown, type BlogArticle } from '../../shared/blogMarkdown.js';

const BLOG_CONTENT_DIR = join(process.cwd(), 'src', 'content', 'blog');

function loadBlogArticle(filename: string): BlogArticle {
  return parseBlogMarkdown(readFileSync(join(BLOG_CONTENT_DIR, filename), 'utf8'));
}

export function listBlogArticles(): BlogArticle[] {
  return BLOG_ARTICLE_FILES.map(({ filename, slug }) => {
    const article = loadBlogArticle(filename);
    if (article.meta.slug !== slug) {
      throw new Error(`Blog article slug mismatch: ${article.meta.slug} !== ${slug}`);
    }
    return article;
  });
}

export function getBlogArticleBySlug(slug: string): BlogArticle | undefined {
  return listBlogArticles().find(article => article.meta.slug === slug);
}

