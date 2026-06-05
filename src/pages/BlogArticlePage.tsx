import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { blogArticles, getBlogArticleBySlug } from '../content/blog';
import type { BlogArticle, BlogMarkdownBlock } from '../../shared/blogMarkdown';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(<strong key={`${match.index}-strong`}>{match[2]}</strong>);
    } else if (match[4] && match[5]) {
      nodes.push(
        <a
          key={`${match.index}-link`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary-600 underline decoration-primary-200 underline-offset-4 transition-colors hover:text-primary-700 dark:text-primary-300 dark:decoration-primary-700 dark:hover:text-primary-200"
        >
          {match[4]}
        </a>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function blockKey(block: BlogMarkdownBlock, index: number): string {
  if (block.type === 'heading' || block.type === 'paragraph') {
    return `${block.type}-${index}-${block.text.slice(0, 24)}`;
  }
  return `${block.type}-${index}-${block.items[0]?.slice(0, 24)}`;
}

function BlogBlock({ block }: { block: BlogMarkdownBlock }) {
  if (block.type === 'heading') {
    if (block.depth === 1) {
      return (
        <h2 className="mt-12 text-2xl font-extrabold leading-tight text-gray-900 dark:text-gray-100 md:text-3xl">
          {renderInline(block.text)}
        </h2>
      );
    }

    if (block.depth === 2) {
      return (
        <h2 className="mt-10 text-2xl font-extrabold leading-tight text-gray-900 dark:text-gray-100">
          {renderInline(block.text)}
        </h2>
      );
    }

    return (
      <h3 className="mt-8 text-xl font-extrabold leading-tight text-gray-900 dark:text-gray-100">
        {renderInline(block.text)}
      </h3>
    );
  }

  if (block.type === 'unorderedList') {
    return (
      <ul className="my-5 list-disc space-y-2 pl-6 text-lg leading-8 text-gray-700 dark:text-gray-300">
        {block.items.map(item => (
          <li key={item}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  if (block.type === 'orderedList') {
    return (
      <ol className="my-5 list-decimal space-y-2 pl-6 text-lg leading-8 text-gray-700 dark:text-gray-300">
        {block.items.map(item => (
          <li key={item}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }

  return (
    <p className="my-5 text-lg leading-8 text-gray-700 dark:text-gray-300">
      {renderInline(block.text)}
    </p>
  );
}

function RelatedArticles({ article }: { article: BlogArticle }) {
  const relatedArticles = blogArticles.filter(item => item.meta.slug !== article.meta.slug);

  if (relatedArticles.length === 0) {
    return null;
  }

  return (
    <aside className="mt-12 border-t border-primary-100 pt-8 dark:border-primary-900/50">
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
        Citește și
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {relatedArticles.map(relatedArticle => (
          <Link
            key={relatedArticle.meta.slug}
            to={`/blog/${relatedArticle.meta.slug}`}
            className="group block transition-colors"
          >
            <p className="text-base font-extrabold leading-6 text-gray-900 transition-colors group-hover:text-primary-700 dark:text-gray-100 dark:group-hover:text-primary-200">
              {relatedArticle.meta.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {relatedArticle.meta.excerpt ?? relatedArticle.meta.description}
            </p>
          </Link>
        ))}
      </div>
    </aside>
  );
}

export default function BlogArticlePage() {
  const { slug } = useParams();
  const article = getBlogArticleBySlug(slug);

  if (!article) {
    return (
      <main className="min-h-screen px-4 py-12 md:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary-500">
            Blog
          </p>
          <h1 className="mt-3 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            Articol indisponibil
          </h1>
          <p className="mt-3 text-base leading-7 text-gray-600 dark:text-gray-300">
            Articolul căutat nu este disponibil.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex text-sm font-bold text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
          >
            Înapoi la Povești Magice
          </Link>
        </div>
      </main>
    );
  }

  const firstHeading = article.blocks.find(block => block.type === 'heading' && block.depth === 1);
  const displayTitle = firstHeading?.text ?? article.meta.title;
  const visibleBlocks = firstHeading
    ? article.blocks.filter(block => block !== firstHeading)
    : article.blocks;

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 md:py-12">
      <article className="mx-auto max-w-5xl">
        <header className="border-b border-primary-100 pb-8 dark:border-primary-900/50">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary-500">
            Articol
          </p>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight text-gray-900 dark:text-gray-100 md:text-5xl">
            {displayTitle}
          </h1>
          <p className="mt-5 text-lg leading-8 text-gray-600 dark:text-gray-300">
            {article.meta.description}
          </p>
          <p className="mt-5 text-sm font-semibold text-gray-500 dark:text-gray-400">
            Publicat: {formatDate(article.meta.datePublished)}
            {' · '}
            Actualizat: {formatDate(article.meta.dateModified)}
          </p>
        </header>

        <div className="pt-4">
          {visibleBlocks.map((block, index) => (
            <BlogBlock key={blockKey(block, index)} block={block} />
          ))}
        </div>

        <RelatedArticles article={article} />
      </article>
    </main>
  );
}
