export interface BlogArticleMeta {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  dateModified: string;
  language: string;
  excerpt?: string;
}

export type BlogMarkdownBlock =
  | { type: 'heading'; depth: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unorderedList'; items: string[] }
  | { type: 'orderedList'; items: string[] };

export interface BlogArticle {
  meta: BlogArticleMeta;
  body: string;
  blocks: BlogMarkdownBlock[];
}

const REQUIRED_META_KEYS = [
  'title',
  'description',
  'slug',
  'datePublished',
  'dateModified',
  'language',
] as const;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(markdown: string): { meta: BlogArticleMeta; body: string } {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Blog article markdown must start with front matter.');
  }

  const rawMeta = Object.fromEntries(
    match[1]
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          throw new Error(`Invalid front matter line: ${line}`);
        }
        return [
          line.slice(0, separatorIndex).trim(),
          stripWrappingQuotes(line.slice(separatorIndex + 1)),
        ];
      }),
  );

  for (const key of REQUIRED_META_KEYS) {
    if (!rawMeta[key]) {
      throw new Error(`Missing blog article front matter key: ${key}`);
    }
  }

  return {
    meta: rawMeta as unknown as BlogArticleMeta,
    body: match[2].trim(),
  };
}

function parseMarkdownBlocks(body: string): BlogMarkdownBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlogMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        depth: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, '').trim());
        index += 1;
      }
      blocks.push({ type: 'unorderedList', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, '').trim());
        index += 1;
      }
      blocks.push({ type: 'orderedList', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index].trim();
      if (
        !paragraphLine ||
        /^(#{1,3})\s+/.test(paragraphLine) ||
        /^[-*]\s+/.test(paragraphLine) ||
        /^\d+\.\s+/.test(paragraphLine)
      ) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }

    blocks.push({
      type: 'paragraph',
      text: paragraphLines.join(' '),
    });
  }

  return blocks;
}

export function parseBlogMarkdown(markdown: string): BlogArticle {
  const { meta, body } = parseFrontMatter(markdown);
  return {
    meta,
    body,
    blocks: parseMarkdownBlocks(body),
  };
}

