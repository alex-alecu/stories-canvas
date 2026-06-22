import {
  getBlogArticleLocaleBySlug,
  listBlogArticleLocales,
  resolveBlogLanguage,
  type BlogLanguage,
} from '../../../shared/blogArticles';
import { parseBlogMarkdown, type BlogArticle } from '../../../shared/blogMarkdown';
import roReadingTogetherMarkdown from './ro/cum-folosesti-povestile-pentru-copii.md?raw';
import roStoriesVsVideosMarkdown from './ro/povesti-vs-videoclipuri-copii-sub-5-ani.md?raw';
import enReadingTogetherMarkdown from './en/how-to-use-childrens-stories.md?raw';
import enStoriesVsVideosMarkdown from './en/stories-vs-videos-for-children-under-5.md?raw';

const articleMarkdownByLanguageAndSlug: Record<BlogLanguage, Record<string, string>> = {
  ro: {
    'cum-folosesti-povestile-pentru-copii': roReadingTogetherMarkdown,
    'povesti-vs-videoclipuri-copii-sub-5-ani': roStoriesVsVideosMarkdown,
  },
  en: {
    'how-to-use-childrens-stories': enReadingTogetherMarkdown,
    'stories-vs-videos-for-children-under-5': enStoriesVsVideosMarkdown,
  },
};

function loadBlogArticle(slug: string, language: BlogLanguage): BlogArticle {
  const markdown = articleMarkdownByLanguageAndSlug[language][slug];
  if (!markdown) {
    throw new Error(`Missing blog markdown for ${language}/${slug}`);
  }

  const article = parseBlogMarkdown(markdown);
  if (article.meta.slug !== slug) {
    throw new Error(`Blog article slug mismatch: ${article.meta.slug} !== ${slug}`);
  }
  if (article.meta.language !== language) {
    throw new Error(`Blog article language mismatch: ${article.meta.language} !== ${language}`);
  }
  return article;
}

export function listBlogArticles(language?: string): BlogArticle[] {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return [];
  return listBlogArticleLocales(resolvedLanguage).map(({ slug }) => (
    loadBlogArticle(slug, resolvedLanguage)
  ));
}

export function getBlogArticleBySlug(
  slug: string | undefined,
  language?: string,
): BlogArticle | undefined {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return undefined;
  const entry = getBlogArticleLocaleBySlug(slug, resolvedLanguage);
  if (!entry) return undefined;
  return loadBlogArticle(entry.slug, resolvedLanguage);
}
