export interface BlogArticleFile {
  slug: string;
  filename: string;
}

export const BLOG_ARTICLE_FILES = [
  {
    slug: 'cum-folosesti-povestile-pentru-copii',
    filename: 'cum-folosesti-povestile-pentru-copii.md',
  },
  {
    slug: 'povesti-vs-videoclipuri-copii-sub-5-ani',
    filename: 'povesti-vs-videoclipuri-copii-sub-5-ani.md',
  },
] as const satisfies readonly BlogArticleFile[];

export type BlogArticleSlug = typeof BLOG_ARTICLE_FILES[number]['slug'];

