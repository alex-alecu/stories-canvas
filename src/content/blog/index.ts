import { BLOG_ARTICLE_FILES } from '../../../shared/blogArticles';
import { parseBlogMarkdown, type BlogArticle } from '../../../shared/blogMarkdown';
import readingTogetherMarkdown from './cum-folosesti-povestile-pentru-copii.md?raw';
import storiesVsVideosMarkdown from './povesti-vs-videoclipuri-copii-sub-5-ani.md?raw';

const articleMarkdownBySlug = {
  'cum-folosesti-povestile-pentru-copii': readingTogetherMarkdown,
  'povesti-vs-videoclipuri-copii-sub-5-ani': storiesVsVideosMarkdown,
} satisfies Record<string, string>;

export const blogArticles: BlogArticle[] = BLOG_ARTICLE_FILES.map(({ slug }) => {
  const article = parseBlogMarkdown(articleMarkdownBySlug[slug]);
  if (article.meta.slug !== slug) {
    throw new Error(`Blog article slug mismatch: ${article.meta.slug} !== ${slug}`);
  }
  return article;
});

export function getBlogArticleBySlug(slug: string | undefined): BlogArticle | undefined {
  if (!slug) return undefined;
  return blogArticles.find(article => article.meta.slug === slug);
}

