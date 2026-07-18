import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getSupabase } from './supabase.js';
import type { JSONGenerationOptions } from './gemini.js';
import { loadPromptMarkdown } from './promptFiles.js';
import type {
  CanonicalBeatSheet,
  RetellingSourcePromptContext,
  SupportedStoryLanguage,
  StoryPromptContext,
} from './storyPrompt.js';
import type { StoryUsageStatus } from '../../shared/types.js';

const MANIFEST_PATH = join(process.cwd(), 'story-sources', 'manifest.json');
const SOURCE_TEXT_CHUNK_CHARS = 30_000;
const SOURCE_TEXT_CHUNK_OVERLAP_CHARS = 800;
export const SOURCE_ANALYSIS_VERSION = 2;
const SOURCE_GROUNDING_SYSTEM_INSTRUCTION = loadPromptMarkdown('en/system/source-grounding-system.md');
const SOURCE_SEARCH_SYSTEM_INSTRUCTION = loadPromptMarkdown('en/system/source-search-system.md');

export type RetellingMode = 'original' | 'faithful_retelling';

interface StorySourceManifest {
  version: number;
  sources: ManifestStorySource[];
}

interface ManifestStorySource {
  id: string;
  language: SupportedStoryLanguage;
  title: string;
  author?: string;
  aliases?: string[];
  provider: StorySourceProvider;
  sourceUrl: string;
  licenseNote: string;
  canonicalBeatSheet?: CanonicalBeatSheet;
}

type StorySourceProvider = 'wikisource' | 'project_gutenberg' | 'gemini_search';

export interface ResolvedRetellingSource extends RetellingSourcePromptContext {
  sourceTextHash: string;
  sourceCacheHit: boolean;
}

interface SourceCacheRow {
  title: string;
  author: string | null;
  language: SupportedStoryLanguage;
  provider: StorySourceProvider;
  source_url: string;
  license_note: string;
  source_text_hash: string;
  canonical_beat_sheet: CanonicalBeatSheet;
}

type GenerateJSONFn = <T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options?: JSONGenerationOptions,
) => Promise<T>;

export interface SourceResolverOptions {
  generateJSON: GenerateJSONFn;
  onUsage?: (usage: {
    model: string;
    status: StoryUsageStatus;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>;
  fetchFn?: typeof fetch;
}

interface RetellingClassification {
  shouldResolve: boolean;
  titleQuery?: string;
  manifestSource?: ManifestStorySource;
}

interface RawSourceAnalysis {
  title?: unknown;
  author?: unknown;
  sourceAnalysisVersion?: unknown;
  requiredCharacters?: unknown;
  requiredLocations?: unknown;
  magicalObjects?: unknown;
  identityConstraints?: unknown;
  eventOrder?: unknown;
  canonicalEnding?: unknown;
  forbiddenSubstitutions?: unknown;
  softenableBeats?: unknown;
  fidelityWarnings?: unknown;
}

interface RawSearchSourceResult extends RawSourceAnalysis {
  provider?: unknown;
  sourceUrl?: unknown;
  licenseNote?: unknown;
  isPublicDomain?: unknown;
  confidence?: unknown;
}

let manifestCache: StorySourceManifest | undefined;

function loadManifest(): StorySourceManifest {
  if (!manifestCache) {
    manifestCache = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as StorySourceManifest;
  }
  return manifestCache;
}

export function normalizeStorySourceLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['"„”’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLookupTerms(source: ManifestStorySource): string[] {
  return [source.title, ...(source.aliases ?? [])].map(normalizeStorySourceLookup).filter(Boolean);
}

function hasMeaningfulTitleOverlap(query: string, title: string): boolean {
  const queryTerms = new Set(
    normalizeStorySourceLookup(query)
      .split(' ')
      .filter(term => term.length >= 3),
  );
  const titleTerms = normalizeStorySourceLookup(title)
    .split(' ')
    .filter(term => term.length >= 3);

  return titleTerms.some(term => queryTerms.has(term));
}

function findManifestSource(prompt: string, language: SupportedStoryLanguage): ManifestStorySource | undefined {
  const normalizedPrompt = normalizeStorySourceLookup(prompt);
  return loadManifest().sources.find(source => {
    if (source.language !== language) return false;
    return sourceLookupTerms(source).some(term => normalizedPrompt.includes(term));
  });
}

function hasFaithfulRetellingCue(prompt: string): boolean {
  const normalizedPrompt = normalizeStorySourceLookup(prompt);
  return [
    'aproape de original',
    'cat mai aproape de original',
    'cât mai aproape de original',
    'povestea originala',
    'basmul original',
    'retell',
    'faithful retelling',
    'original version',
    'versiunea originala',
    'adaptare fidela',
    'adapteaza fidel',
    'adaptează fidel',
  ].some(cue => normalizedPrompt.includes(normalizeStorySourceLookup(cue)))
    || /\b(?:povestea|basmul)\s+(?:lui\s+)?[a-z0-9]/.test(normalizedPrompt);
}

function extractTitleQuery(prompt: string): string | undefined {
  const normalizedPrompt = normalizeStorySourceLookup(prompt);
  const patterns = [
    /\b(?:povestea|basmul)\s+(?:lui\s+)?(.+?)(?:\s+(?:cat|cât|aproape|original|pentru|cu)|$)/,
    /\bretell\s+(.+?)(?:\s+(?:faithfully|for|as)|$)/,
    /\badapteaza\s+fidel\s+(.+?)(?:\s+(?:pentru|ca)|$)/,
  ];

  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length >= 3) {
      return candidate;
    }
  }

  return undefined;
}

export function classifyRetellingRequest(
  prompt: string,
  language: SupportedStoryLanguage,
): RetellingClassification {
  const manifestSource = findManifestSource(prompt, language);
  const titleQuery = manifestSource?.title ?? extractTitleQuery(prompt);

  return {
    shouldResolve: Boolean(manifestSource) || hasFaithfulRetellingCue(prompt),
    titleQuery,
    manifestSource,
  };
}

function hashSourceText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizeSourceAnalysisVersion(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return fallback;
}

function normalizeBeatSheet(
  raw: RawSourceAnalysis,
  options: { sourceAnalysisVersion?: number } = { sourceAnalysisVersion: SOURCE_ANALYSIS_VERSION },
): CanonicalBeatSheet {
  return {
    sourceAnalysisVersion: normalizeSourceAnalysisVersion(raw.sourceAnalysisVersion, options.sourceAnalysisVersion),
    requiredCharacters: normalizeStringArray(raw.requiredCharacters),
    requiredLocations: normalizeStringArray(raw.requiredLocations),
    magicalObjects: normalizeStringArray(raw.magicalObjects),
    identityConstraints: normalizeStringArray(raw.identityConstraints),
    eventOrder: normalizeStringArray(raw.eventOrder),
    canonicalEnding: normalizeStringArray(raw.canonicalEnding),
    forbiddenSubstitutions: normalizeStringArray(raw.forbiddenSubstitutions),
    softenableBeats: normalizeStringArray(raw.softenableBeats),
    fidelityWarnings: normalizeStringArray(raw.fidelityWarnings),
  };
}

export function isUsableCanonicalBeatSheet(beatSheet: CanonicalBeatSheet): boolean {
  return beatSheet.sourceAnalysisVersion === SOURCE_ANALYSIS_VERSION
    && beatSheet.requiredCharacters.length > 0
    && beatSheet.eventOrder.length >= 3
    && (beatSheet.canonicalEnding?.length ?? 0) > 0
    && !hasCollapsedQuestEnding(beatSheet);
}

function hasCollapsedQuestEnding(beatSheet: CanonicalBeatSheet): boolean {
  if (beatSheet.eventOrder.length > 8) return false;

  const normalizedEvents = beatSheet.eventOrder.map(normalizeStorySourceLookup);
  const questStartIndex = normalizedEvents.findIndex(event => (
    /\b(?:caut|cautar|porn|pleac|search|seek)/u.test(event)
  ));
  if (questStartIndex < 0) return false;

  const endingIndex = normalizedEvents.findIndex((event, index) => (
    index > questStartIndex
    && /\b(?:ajunge|gaseste|gasit|reuneste|reunit|finds|reunites|arrives)\b/u.test(event)
  ));
  if (endingIndex < 0) return false;

  const bridgeEvents = normalizedEvents.slice(questStartIndex + 1, endingIndex);
  return !bridgeEvents.some(event => (
    /\b(?:proba|incerc|obstacol|primejd|pericol|sfant|helper|ajutor|dar|vraj|vrajitoare|witch|trial|failed|attempt|night|noapte|gift|fountain|fantana|ciocarlan|talpa)/u.test(event)
  ));
}

function sourceFromCacheRow(row: SourceCacheRow): ResolvedRetellingSource | undefined {
  const canonicalBeatSheet = normalizeBeatSheet(row.canonical_beat_sheet as RawSourceAnalysis, {
    sourceAnalysisVersion: undefined,
  });
  if (!isUsableCanonicalBeatSheet(canonicalBeatSheet)) return undefined;

  return {
    title: row.title,
    author: row.author ?? undefined,
    provider: row.provider,
    sourceUrl: row.source_url,
    licenseNote: row.license_note,
    sourceTextHash: row.source_text_hash,
    sourceCacheHit: true,
    canonicalBeatSheet,
  };
}

async function readCachedSource(
  title: string,
  language: SupportedStoryLanguage,
): Promise<ResolvedRetellingSource | undefined> {
  if (!config.useSupabase) return undefined;

  const normalizedTitle = normalizeStorySourceLookup(title);
  const { data, error } = await getSupabase()
    .from('story_source_cache')
    .select('*')
    .eq('language', language)
    .eq('normalized_title', normalizedTitle)
    .maybeSingle();

  if (error) {
    console.warn(`Failed to read story source cache for ${title}: ${error.message}`);
    return undefined;
  }

  return data ? sourceFromCacheRow(data as SourceCacheRow) : undefined;
}

async function writeCachedSource(source: ResolvedRetellingSource, language: SupportedStoryLanguage): Promise<void> {
  if (!config.useSupabase) return;

  const { error } = await getSupabase()
    .from('story_source_cache')
    .upsert({
      title: source.title,
      normalized_title: normalizeStorySourceLookup(source.title),
      author: source.author ?? null,
      language,
      provider: source.provider,
      source_url: source.sourceUrl,
      license_note: source.licenseNote,
      source_text_hash: source.sourceTextHash,
      canonical_beat_sheet: source.canonicalBeatSheet,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'language,normalized_title' });

  if (error) {
    console.warn(`Failed to write story source cache for ${source.title}: ${error.message}`);
  }
}

function sourceFromManifestBeatSheet(source: ManifestStorySource): ResolvedRetellingSource | undefined {
  if (!source.canonicalBeatSheet) return undefined;
  if (!isUsableCanonicalBeatSheet(source.canonicalBeatSheet)) return undefined;

  return {
    title: source.title,
    author: source.author,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    licenseNote: source.licenseNote,
    canonicalBeatSheet: source.canonicalBeatSheet,
    sourceTextHash: hashSourceText(`${source.sourceUrl}\n${JSON.stringify(source.canonicalBeatSheet)}`),
    sourceCacheHit: true,
  };
}

async function fetchTextUrl(url: string, fetchFn: typeof fetch): Promise<string | undefined> {
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': 'Basmul/1.0 faithful-retelling-source-resolver',
      Accept: 'text/plain, text/*, application/json',
    },
  });

  if (!response.ok) return undefined;
  const text = await response.text();
  return text.trim() || undefined;
}

function wikisourceOrigin(language: SupportedStoryLanguage): string {
  return `https://${language}.wikisource.org`;
}

function wikisourceApiUrl(source: ManifestStorySource): string {
  const url = new URL(source.sourceUrl);
  const title = decodeURIComponent(url.pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
  const apiUrl = new URL('/w/api.php', url.origin);
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('prop', 'extracts');
  apiUrl.searchParams.set('explaintext', '1');
  apiUrl.searchParams.set('redirects', '1');
  apiUrl.searchParams.set('format', 'json');
  apiUrl.searchParams.set('formatversion', '2');
  apiUrl.searchParams.set('titles', title);
  return apiUrl.toString();
}

function wikisourceOpenSearchUrl(titleQuery: string, language: SupportedStoryLanguage): string {
  const apiUrl = new URL('/w/api.php', wikisourceOrigin(language));
  apiUrl.searchParams.set('action', 'opensearch');
  apiUrl.searchParams.set('namespace', '0');
  apiUrl.searchParams.set('limit', '1');
  apiUrl.searchParams.set('format', 'json');
  apiUrl.searchParams.set('search', titleQuery);
  return apiUrl.toString();
}

async function findWikisourceSource(
  titleQuery: string,
  language: SupportedStoryLanguage,
  fetchFn: typeof fetch,
): Promise<ManifestStorySource | undefined> {
  const response = await fetchFn(wikisourceOpenSearchUrl(titleQuery, language), {
    headers: {
      'User-Agent': 'Basmul/1.0 faithful-retelling-source-resolver',
      Accept: 'application/json',
    },
  });

  if (!response.ok) return undefined;
  const data = await response.json() as unknown;
  if (!Array.isArray(data)) return undefined;

  const titles = Array.isArray(data[1]) ? data[1].filter((value): value is string => typeof value === 'string') : [];
  const urls = Array.isArray(data[3]) ? data[3].filter((value): value is string => typeof value === 'string') : [];
  const title = titles[0]?.trim();
  const sourceUrl = urls[0]?.trim();

  if (!title || !sourceUrl || !hasMeaningfulTitleOverlap(titleQuery, title)) {
    return undefined;
  }

  return {
    id: `${language}-wikisource-${normalizeStorySourceLookup(title).replace(/\s+/g, '-')}`,
    language,
    title,
    provider: 'wikisource',
    sourceUrl,
    licenseNote: `Public-domain or compatible text hosted on ${language}.wikisource.org Wikisource.`,
  };
}

async function fetchWikisourceText(source: ManifestStorySource, fetchFn: typeof fetch): Promise<string | undefined> {
  const response = await fetchFn(wikisourceApiUrl(source), {
    headers: {
      'User-Agent': 'Basmul/1.0 faithful-retelling-source-resolver',
      Accept: 'application/json',
    },
  });

  if (!response.ok) return undefined;
  const data = await response.json() as { query?: { pages?: Array<{ extract?: string }> } };
  return data.query?.pages?.[0]?.extract?.trim() || undefined;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function projectGutenbergSearchUrl(titleQuery: string): string {
  const url = new URL('/ebooks/search/', 'https://www.gutenberg.org');
  url.searchParams.set('query', titleQuery);
  return url.toString();
}

async function findProjectGutenbergSource(
  titleQuery: string,
  language: SupportedStoryLanguage,
  fetchFn: typeof fetch,
): Promise<ManifestStorySource | undefined> {
  if (language !== 'en') return undefined;

  const html = await fetchTextUrl(projectGutenbergSearchUrl(titleQuery), fetchFn);
  if (!html) return undefined;

  const match = html.match(/href="\/ebooks\/(\d+)"[\s\S]{0,600}?<span class="title">([^<]+)<\/span>/);
  if (!match) return undefined;

  const id = match[1];
  const title = decodeHtmlText(match[2] ?? '');
  if (!id || !title || !hasMeaningfulTitleOverlap(titleQuery, title)) return undefined;

  return {
    id: `gutenberg-${id}`,
    language,
    title,
    provider: 'project_gutenberg',
    sourceUrl: `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    licenseNote: 'Public-domain Project Gutenberg text in the United States.',
  };
}

async function fetchProjectGutenbergText(source: ManifestStorySource, fetchFn: typeof fetch): Promise<string | undefined> {
  const primaryText = await fetchTextUrl(source.sourceUrl, fetchFn);
  if (primaryText) return primaryText;

  const id = source.sourceUrl.match(/\/files\/(\d+)\//)?.[1];
  if (!id) return undefined;
  return fetchTextUrl(`https://www.gutenberg.org/files/${id}/${id}.txt`, fetchFn);
}

async function fetchSourceText(source: ManifestStorySource, fetchFn: typeof fetch): Promise<string | undefined> {
  if (source.provider === 'wikisource') {
    return fetchWikisourceText(source, fetchFn);
  }

  if (source.provider === 'project_gutenberg') {
    return fetchProjectGutenbergText(source, fetchFn);
  }

  return undefined;
}

async function findTrustedProviderSource(
  titleQuery: string,
  language: SupportedStoryLanguage,
  fetchFn: typeof fetch,
): Promise<ManifestStorySource | undefined> {
  return (await findWikisourceSource(titleQuery, language, fetchFn).catch(() => undefined))
    ?? (await findProjectGutenbergSource(titleQuery, language, fetchFn).catch(() => undefined));
}

function splitSourceTextIntoChunks(sourceText: string): string[] {
  if (sourceText.length <= SOURCE_TEXT_CHUNK_CHARS) return [sourceText];

  const chunks: string[] = [];
  let start = 0;
  while (start < sourceText.length) {
    const hardEnd = Math.min(sourceText.length, start + SOURCE_TEXT_CHUNK_CHARS);
    const nextBreak = sourceText.lastIndexOf('\n\n', hardEnd);
    const end = nextBreak > start + SOURCE_TEXT_CHUNK_CHARS * 0.65 ? nextBreak : hardEnd;
    chunks.push(sourceText.slice(start, end).trim());
    if (end >= sourceText.length) break;
    start = Math.max(0, end - SOURCE_TEXT_CHUNK_OVERLAP_CHARS);
  }

  return chunks.filter(Boolean);
}

function appendUnique(target: string[], values: string[]): void {
  const seen = new Set(target.map(value => value.toLocaleLowerCase()));
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    target.push(value);
    seen.add(key);
  }
}

function mergeBeatSheets(beatSheets: CanonicalBeatSheet[]): CanonicalBeatSheet {
  const merged: CanonicalBeatSheet = {
    sourceAnalysisVersion: SOURCE_ANALYSIS_VERSION,
    requiredCharacters: [],
    requiredLocations: [],
    magicalObjects: [],
    identityConstraints: [],
    eventOrder: [],
    canonicalEnding: [],
    forbiddenSubstitutions: [],
    softenableBeats: [],
    fidelityWarnings: [],
  };

  for (const beatSheet of beatSheets) {
    appendUnique(merged.requiredCharacters, beatSheet.requiredCharacters);
    appendUnique(merged.requiredLocations, beatSheet.requiredLocations);
    appendUnique(merged.magicalObjects, beatSheet.magicalObjects);
    appendUnique(merged.identityConstraints!, beatSheet.identityConstraints ?? []);
    appendUnique(merged.eventOrder, beatSheet.eventOrder);
    appendUnique(merged.canonicalEnding!, beatSheet.canonicalEnding ?? []);
    appendUnique(merged.forbiddenSubstitutions, beatSheet.forbiddenSubstitutions);
    appendUnique(merged.softenableBeats, beatSheet.softenableBeats);
    appendUnique(merged.fidelityWarnings, beatSheet.fidelityWarnings);
  }

  return merged;
}

const sourceAnalysisSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    author: { type: 'STRING' },
    sourceAnalysisVersion: { type: 'INTEGER' },
    requiredCharacters: { type: 'ARRAY', items: { type: 'STRING' } },
    requiredLocations: { type: 'ARRAY', items: { type: 'STRING' } },
    magicalObjects: { type: 'ARRAY', items: { type: 'STRING' } },
    identityConstraints: { type: 'ARRAY', items: { type: 'STRING' } },
    eventOrder: { type: 'ARRAY', items: { type: 'STRING' } },
    canonicalEnding: { type: 'ARRAY', items: { type: 'STRING' } },
    forbiddenSubstitutions: { type: 'ARRAY', items: { type: 'STRING' } },
    softenableBeats: { type: 'ARRAY', items: { type: 'STRING' } },
    fidelityWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'title',
    'author',
    'sourceAnalysisVersion',
    'requiredCharacters',
    'requiredLocations',
    'magicalObjects',
    'identityConstraints',
    'eventOrder',
    'canonicalEnding',
    'forbiddenSubstitutions',
    'softenableBeats',
    'fidelityWarnings',
  ],
};

async function analyzeSourceText(
  source: ManifestStorySource,
  sourceText: string,
  options: SourceResolverOptions,
): Promise<ResolvedRetellingSource | undefined> {
  const chunks = splitSourceTextIntoChunks(sourceText);
  const rawAnalyses: RawSourceAnalysis[] = [];

  for (let index = 0; index < chunks.length; index++) {
    rawAnalyses.push(await options.generateJSON<RawSourceAnalysis>(
      [
        'Extract a canonical beat sheet fragment for a faithful children\'s retelling of this public-domain story.',
        'Preserve named roles, event order, magical object mechanics, antagonist count/roles, character identities, relationships, social roles, and ending.',
        'For quests or searches, keep every distinct helper, failed attempt, trial, traded object, antagonist trick, and curse-breaking mechanism as its own source beat.',
        'List only source-grounded facts found in this chunk. Do not invent new helpers or shortcuts.',
        'If this chunk contains the story ending, include it in canonicalEnding. If it does not, leave canonicalEnding empty.',
        `Set sourceAnalysisVersion to ${SOURCE_ANALYSIS_VERSION}.`,
        '',
        `Title: ${source.title}`,
        `Author/collector: ${source.author ?? 'unknown'}`,
        `Source URL: ${source.sourceUrl}`,
        `Source chunk: ${index + 1} of ${chunks.length}`,
        '',
        'Source text chunk:',
        chunks[index],
      ].join('\n'),
      SOURCE_GROUNDING_SYSTEM_INSTRUCTION,
      sourceAnalysisSchema,
      {
        model: config.sourceAnalysisModel,
        temperature: 0.1,
        onUsage: options.onUsage,
      },
    ));
  }

  const beatSheet = mergeBeatSheets(rawAnalyses.map(raw => normalizeBeatSheet(raw)));
  if (!isUsableCanonicalBeatSheet(beatSheet)) {
    return undefined;
  }

  const firstRaw = rawAnalyses[0] ?? {};
  return {
    title: typeof firstRaw.title === 'string' && firstRaw.title.trim() ? firstRaw.title.trim() : source.title,
    author: typeof firstRaw.author === 'string' && firstRaw.author.trim() ? firstRaw.author.trim() : source.author,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    licenseNote: source.licenseNote,
    sourceTextHash: hashSourceText(sourceText),
    sourceCacheHit: false,
    canonicalBeatSheet: beatSheet,
  };
}

const searchSourceSchema = {
  type: 'OBJECT',
  properties: {
    isPublicDomain: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    title: { type: 'STRING' },
    author: { type: 'STRING' },
    provider: { type: 'STRING' },
    sourceUrl: { type: 'STRING' },
    licenseNote: { type: 'STRING' },
    sourceAnalysisVersion: { type: 'INTEGER' },
    requiredCharacters: { type: 'ARRAY', items: { type: 'STRING' } },
    requiredLocations: { type: 'ARRAY', items: { type: 'STRING' } },
    magicalObjects: { type: 'ARRAY', items: { type: 'STRING' } },
    identityConstraints: { type: 'ARRAY', items: { type: 'STRING' } },
    eventOrder: { type: 'ARRAY', items: { type: 'STRING' } },
    canonicalEnding: { type: 'ARRAY', items: { type: 'STRING' } },
    forbiddenSubstitutions: { type: 'ARRAY', items: { type: 'STRING' } },
    softenableBeats: { type: 'ARRAY', items: { type: 'STRING' } },
    fidelityWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'isPublicDomain',
    'confidence',
    'title',
    'author',
    'provider',
    'sourceUrl',
    'licenseNote',
    'sourceAnalysisVersion',
    'requiredCharacters',
    'requiredLocations',
    'magicalObjects',
    'identityConstraints',
    'eventOrder',
    'canonicalEnding',
    'forbiddenSubstitutions',
    'softenableBeats',
    'fidelityWarnings',
  ],
};

async function searchPublicDomainSource(
  titleQuery: string,
  language: SupportedStoryLanguage,
  options: SourceResolverOptions,
): Promise<ResolvedRetellingSource | undefined> {
  const raw = await options.generateJSON<RawSearchSourceResult>(
    [
      `Find a trusted public-domain source for the classic story "${titleQuery}" in language ${language}.`,
      'Prefer Wikisource or Project Gutenberg. Return a faithful canonical beat sheet from the public-domain source.',
      'Preserve character identities, relationships, social roles, event order, mechanics, and canonical ending.',
      'For quests or searches, do not collapse the path into "the hero travels and finds the person"; include helpers, failed attempts, traded objects, antagonist tricks, and the exact curse-breaking mechanism.',
      `Set sourceAnalysisVersion to ${SOURCE_ANALYSIS_VERSION}.`,
      'If you cannot verify a public-domain or compatible source, set isPublicDomain=false and confidence below 0.7.',
    ].join('\n'),
    SOURCE_SEARCH_SYSTEM_INSTRUCTION,
    searchSourceSchema,
    {
      model: config.sourceAnalysisModel,
      temperature: 0.1,
      tools: [{ googleSearch: {} }],
      onUsage: options.onUsage,
    },
  );

  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
  if (raw.isPublicDomain !== true || confidence < 0.7) return undefined;
  if (typeof raw.title !== 'string' || typeof raw.sourceUrl !== 'string' || typeof raw.licenseNote !== 'string') {
    return undefined;
  }

  const rawProvider = typeof raw.provider === 'string' ? raw.provider.toLowerCase() : '';
  const provider = rawProvider.includes('gutenberg')
    ? 'project_gutenberg'
    : rawProvider.includes('wikisource')
      ? 'wikisource'
      : 'gemini_search';

  const beatSheet = normalizeBeatSheet(raw);
  if (!isUsableCanonicalBeatSheet(beatSheet)) {
    return undefined;
  }

  return {
    title: raw.title.trim(),
    author: typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : undefined,
    provider,
    sourceUrl: raw.sourceUrl.trim(),
    licenseNote: raw.licenseNote.trim(),
    sourceTextHash: hashSourceText(`${raw.sourceUrl}\n${JSON.stringify(beatSheet)}`),
    sourceCacheHit: false,
    canonicalBeatSheet: beatSheet,
  };
}

export async function resolveRetellingSource(
  context: Pick<StoryPromptContext, 'userPrompt' | 'language'>,
  options: SourceResolverOptions,
): Promise<ResolvedRetellingSource | undefined> {
  const classification = classifyRetellingRequest(context.userPrompt, context.language);
  if (!classification.shouldResolve || !classification.titleQuery) return undefined;

  const manifestSource = classification.manifestSource;
  if (manifestSource) {
    const manifestBeatSheet = sourceFromManifestBeatSheet(manifestSource);
    if (manifestBeatSheet) return manifestBeatSheet;
  }

  const titleQuery = manifestSource?.title ?? classification.titleQuery;
  const cached = await readCachedSource(titleQuery, context.language);
  if (cached) return cached;

  const fetchFn = options.fetchFn ?? fetch;
  const trustedSource = manifestSource
    ?? (await findTrustedProviderSource(titleQuery, context.language, fetchFn));

  if (trustedSource) {
    const sourceText = await fetchSourceText(trustedSource, fetchFn).catch(() => undefined);
    if (sourceText) {
      const analyzed = await analyzeSourceText(trustedSource, sourceText, options);
      if (analyzed) {
        await writeCachedSource(analyzed, context.language);
        return analyzed;
      }
    }
  }

  const searched = await searchPublicDomainSource(titleQuery, context.language, options);
  if (searched) {
    await writeCachedSource(searched, context.language);
  }
  return searched;
}
