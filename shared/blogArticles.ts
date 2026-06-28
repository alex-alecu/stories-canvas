export type BlogLanguage = 'ro' | 'en';

export interface BlogArticleLocale {
  language: BlogLanguage;
  slug: string;
  filename: string;
}

export interface BlogArticleDefinition {
  id: string;
  locales: Partial<Record<BlogLanguage, BlogArticleLocale>>;
}

export const BLOG_ARTICLES = [
  {
    id: 'reading-together',
    locales: {
      ro: {
        language: 'ro',
        slug: 'cum-folosesti-povestile-pentru-copii',
        filename: 'cum-folosesti-povestile-pentru-copii.md',
      },
      en: {
        language: 'en',
        slug: 'how-to-use-childrens-stories',
        filename: 'how-to-use-childrens-stories.md',
      },
    },
  },
  {
    id: 'stories-vs-videos',
    locales: {
      ro: {
        language: 'ro',
        slug: 'povesti-vs-videoclipuri-copii-sub-5-ani',
        filename: 'povesti-vs-videoclipuri-copii-sub-5-ani.md',
      },
      en: {
        language: 'en',
        slug: 'stories-vs-videos-for-children-under-5',
        filename: 'stories-vs-videos-for-children-under-5.md',
      },
    },
  },
] as const satisfies readonly BlogArticleDefinition[];

export type BlogArticleId = typeof BLOG_ARTICLES[number]['id'];

export function resolveBlogLanguage(language?: string): BlogLanguage | undefined {
  return language === 'en' || language === 'ro' ? language : undefined;
}

export function listBlogArticleLocales(language?: string): BlogArticleLocale[] {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return [];
  return BLOG_ARTICLES
    .map(article => article.locales[resolvedLanguage])
    .filter((entry): entry is BlogArticleLocale => !!entry);
}

export function getBlogArticleLocaleBySlug(
  slug: string | undefined,
  language?: string,
): BlogArticleLocale | undefined {
  if (!slug) return undefined;
  return listBlogArticleLocales(language).find(entry => entry.slug === slug);
}

export function getBlogArticleLocaleById(
  id: BlogArticleId,
  language?: string,
): BlogArticleLocale | undefined {
  const resolvedLanguage = resolveBlogLanguage(language);
  if (!resolvedLanguage) return undefined;
  return BLOG_ARTICLES.find(article => article.id === id)?.locales[resolvedLanguage];
}
