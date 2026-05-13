import { getSupabase } from './supabase.js';
import { config } from '../config.js';
import {
  normalizeVoiceKey,
  type ArtStyleKey,
  type PageStatus,
  type StoryGenerationInputs,
  type StoryImageSources,
  type StoryMeta,
  type StoryMode,
  type StoryReaction,
  type StoryReactionResponse,
  type StoryStatus,
  type StoryUsageEvent,
  type StoryUsageTotals,
  type Scenario,
  type VoiceKey,
} from '../../shared/types.js';
import { isStoryReaction } from '../../shared/types.js';
import {
  MEDIA_CACHE_MAX_AGE_SECONDS,
  isCoverImageSourceFilename,
} from '../utils/storyMedia.js';
import { generateCoverImageVariantSources, STORY_IMAGES_BUCKET } from './coverImageVariants.js';
import { parseArtStyle } from './storyStyle.js';
import { EMPTY_STORY_USAGE_TOTALS, normalizeStoryUsageTotals } from './storyUsage.js';

const BUCKET = STORY_IMAGES_BUCKET;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

interface SupabaseErrorLike {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

export class TransientDependencyError extends Error {
  readonly dependency: string;
  readonly operation: string;
  readonly status?: number;
  readonly detail: string;

  constructor(
    dependency: string,
    operation: string,
    detail: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    const parts = [
      typeof options.status === 'number' ? `HTTP ${options.status}` : undefined,
      detail,
    ].filter(Boolean);

    super(
      `${dependency} temporarily unavailable during ${operation}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`,
    );
    this.name = 'TransientDependencyError';
    this.dependency = dependency;
    this.operation = operation;
    this.status = options.status;
    this.detail = detail;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isTransientDependencyError(error: unknown): error is TransientDependencyError {
  return error instanceof TransientDependencyError;
}

function parseStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function collectErrorText(error: SupabaseErrorLike): string {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function looksLikeHtmlErrorBody(text: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|cloudflare ray id/i.test(text);
}

function isTransientUpstreamSupabaseFailure(status: number | undefined, text: string): boolean {
  if (status !== undefined && TRANSIENT_HTTP_STATUSES.has(status)) {
    return true;
  }

  return /\bbad gateway\b|\bgateway timeout\b|\bservice unavailable\b|\bcloudflare\b|\btimed out\b|\btimeout\b/i.test(text)
    || looksLikeHtmlErrorBody(text);
}

function describeTransientSupabaseFailure(status: number | undefined, text: string): string {
  const normalized = text.toLowerCase();
  const htmlResponse = looksLikeHtmlErrorBody(text);

  if (status === 502 || normalized.includes('bad gateway')) {
    return htmlResponse ? 'upstream returned an HTML bad gateway response' : 'upstream bad gateway';
  }

  if (status === 503 || normalized.includes('service unavailable')) {
    return htmlResponse ? 'upstream returned an HTML service unavailable response' : 'upstream service unavailable';
  }

  if (status === 504 || normalized.includes('gateway timeout')) {
    return htmlResponse ? 'upstream returned an HTML gateway timeout response' : 'upstream gateway timeout';
  }

  if (normalized.includes('cloudflare')) {
    return htmlResponse ? 'upstream returned an HTML Cloudflare error response' : 'upstream Cloudflare error';
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'upstream timeout';
  }

  if (htmlResponse) {
    return 'upstream returned an HTML error response';
  }

  return 'temporary upstream failure';
}

function classifySupabaseOperationError(operation: string, error: unknown): Error {
  if (isTransientDependencyError(error)) {
    return error;
  }

  if (error instanceof Error && error.message.startsWith(`Failed during ${operation}:`)) {
    return error;
  }

  if (error && typeof error === 'object') {
    const supabaseError = error as SupabaseErrorLike;
    const status = parseStatusCode(supabaseError.status ?? supabaseError.statusCode);
    const text = collectErrorText(supabaseError);

    if (isTransientUpstreamSupabaseFailure(status, text)) {
      return new TransientDependencyError(
        'Supabase',
        operation,
        describeTransientSupabaseFailure(status, text),
        { cause: error, status },
      );
    }

    if (text) {
      return new Error(`Failed during ${operation}: ${text}`);
    }
  }

  if (error instanceof Error) {
    return new Error(`Failed during ${operation}: ${error.message}`);
  }

  return new Error(`Failed during ${operation}: ${String(error)}`);
}

// ---------- Story CRUD ----------

export async function createStory(
  id: string,
  prompt: string,
  status: StoryStatus,
  userId?: string,
  language?: string,
  voice?: VoiceKey,
  artStyle?: ArtStyleKey,
  storyMode?: StoryMode,
  creditCost = 0,
  generationInputs?: StoryGenerationInputs,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').insert({
    id,
    prompt,
    status,
    user_id: userId ?? null,
    language: language ?? 'ro',
    voice: voice ?? null,
    art_style: artStyle ?? null,
    story_mode: storyMode ?? null,
    credit_cost: creditCost,
    generation_inputs: generationInputs ?? {},
    usage_input_tokens: 0,
    usage_output_tokens: 0,
    usage_total_tokens: 0,
    usage_cost_usd_micros: 0,
    usage_text_cost_usd_micros: 0,
    usage_image_cost_usd_micros: 0,
    usage_audio_cost_usd_micros: 0,
    view_count: 0,
    like_count: 0,
    dislike_count: 0,
    scenario_revision: 0,
    rendered_scenario_revision: 0,
    current_phase: 'Generating story scenario...',
    progress_message: 'Creating your story...',
  });
  if (error) throw new Error(`Failed to create story: ${error.message}`);
}

export async function updateStoryCreditCharge(id: string, creditChargeLedgerId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stories')
    .update({ credit_charge_ledger_id: creditChargeLedgerId })
    .eq('id', id);
  if (error) throw new Error(`Failed to update story credit charge: ${error.message}`);
}

export async function updateStoryStatus(id: string, status: StoryStatus): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').update({ status }).eq('id', id);
  if (error) throw new Error(`Failed to update story status: ${error.message}`);
}

export interface StoryProgressUpdate {
  completed_pages?: number;
  failed_pages?: number[];
  current_phase?: string;
  progress_message?: string;
  status?: StoryStatus;
}

export async function updateStoryProgress(id: string, progress: StoryProgressUpdate): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').update(progress).eq('id', id);
  if (error) throw new Error(`Failed to update story progress: ${error.message}`);
}

export async function updateStoryScenario(
  id: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
  options: {
    artStyle?: ArtStyleKey;
    language?: string;
    scenarioRevision?: number;
    renderedScenarioRevision?: number;
    storyMode?: StoryMode;
    creditCost?: number;
    generationInputs?: StoryGenerationInputs;
  } = {},
): Promise<void> {
  const supabase = getSupabase();
  const updatePayload: Record<string, unknown> = {
    scenario,
    title: scenario.title,
    target_age: scenario.targetAge,
    total_pages: scenario.pages.length,
    status,
    prompt,
    art_style: options.artStyle ?? null,
    language: options.language ?? 'ro',
    scenario_revision: options.scenarioRevision,
    rendered_scenario_revision: options.renderedScenarioRevision,
  };

  if (options.storyMode !== undefined) {
    updatePayload.story_mode = options.storyMode;
  }

  if (options.creditCost !== undefined) {
    updatePayload.credit_cost = options.creditCost;
  }

  if (options.generationInputs !== undefined) {
    updatePayload.generation_inputs = options.generationInputs;
  }

  const { error } = await supabase
    .from('stories')
    .update(updatePayload)
    .eq('id', id);
  if (error) throw new Error(`Failed to update story scenario: ${error.message}`);
}

export async function updateStoryRenderedScenarioRevision(
  id: string,
  renderedScenarioRevision: number,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stories')
    .update({ rendered_scenario_revision: renderedScenarioRevision })
    .eq('id', id);
  if (error) throw new Error(`Failed to update story rendered scenario revision: ${error.message}`);
}

export async function updatePageStatus(id: string, pageNumber: number, status: PageStatus): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('update_page_status', {
    story_id: id,
    page_number: pageNumber,
    new_status: status,
  });
  if (error) throw new Error(`Failed to update page status: ${error.message}`);
}

interface StoryRow {
  id: string;
  prompt: string;
  status: StoryStatus;
  created_at: string;
  title: string | null;
  target_age: number | null;
  scenario: Scenario | null;
  cover_image_url: string | null;
  cover_image_sources?: unknown;
  total_pages: number;
  completed_pages: number;
  failed_pages: number[];
  current_phase: string | null;
  progress_message: string | null;
  user_id: string | null;
  is_public: boolean;
  language: string | null;
  art_style: string | null;
  voice: string | null;
  scenario_revision: number | null;
  rendered_scenario_revision: number | null;
  story_mode: StoryMode | null;
  credit_cost: number | string | null;
  credit_refunded_at: string | null;
  generation_inputs: StoryGenerationInputs | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  usage_total_tokens: number | null;
  usage_cost_usd_micros: number | null;
  usage_text_cost_usd_micros: number | null;
  usage_image_cost_usd_micros: number | null;
  usage_audio_cost_usd_micros: number | null;
  view_count: number | string | null;
  like_count: number | string | null;
  dislike_count: number | string | null;
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function normalizeCreditAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 10) / 10;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
  }

  return 0;
}

function normalizeStoryImageSources(value: unknown): StoryImageSources | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const sources: StoryImageSources = {};
  if (typeof raw.thumb === 'string' && raw.thumb) sources.thumb = raw.thumb;
  if (typeof raw.card === 'string' && raw.card) sources.card = raw.card;
  if (typeof raw.full === 'string' && raw.full) sources.full = raw.full;

  return sources.thumb || sources.card || sources.full ? sources : undefined;
}

function rowToStoryMeta(row: StoryRow): StoryMeta {
  const scenarioRevision = Number.isInteger(row.scenario_revision)
    ? Math.max(0, row.scenario_revision ?? 0)
    : row.scenario
      ? 1
      : 0;
  const renderedScenarioRevision = Number.isInteger(row.rendered_scenario_revision)
    ? Math.max(0, row.rendered_scenario_revision ?? 0)
    : scenarioRevision;

  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status as StoryStatus,
    createdAt: row.created_at,
    scenario: row.scenario ?? undefined,
    coverImage: row.cover_image_url ?? undefined,
    coverImageSources: normalizeStoryImageSources(row.cover_image_sources),
    userId: row.user_id ?? undefined,
    isPublic: row.is_public ?? false,
    language: row.language ?? 'ro',
    artStyle: parseArtStyle(row.art_style),
    voice: normalizeVoiceKey(row.voice),
    currentPhase: row.current_phase ?? undefined,
    progressMessage: row.progress_message ?? undefined,
    scenarioRevision,
    renderedScenarioRevision,
    assetsStale: scenarioRevision > renderedScenarioRevision,
    storyMode: row.story_mode ?? undefined,
    creditCost: row.credit_cost === null ? undefined : normalizeCreditAmount(row.credit_cost),
    creditRefundedAt: row.credit_refunded_at ?? undefined,
    generationInputs: row.generation_inputs ?? undefined,
    usageTotals: normalizeStoryUsageTotals({
      inputTokens: row.usage_input_tokens ?? 0,
      outputTokens: row.usage_output_tokens ?? 0,
      totalTokens: row.usage_total_tokens ?? 0,
      costUsdMicros: row.usage_cost_usd_micros ?? 0,
      textCostUsdMicros: row.usage_text_cost_usd_micros ?? 0,
      imageCostUsdMicros: row.usage_image_cost_usd_micros ?? 0,
      audioCostUsdMicros: row.usage_audio_cost_usd_micros ?? 0,
    }),
    viewCount: normalizeCount(row.view_count),
    likeCount: normalizeCount(row.like_count),
    dislikeCount: normalizeCount(row.dislike_count),
    myReaction: null,
  };
}

export async function getStory(id: string): Promise<StoryMeta | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`Failed to get story: ${error.message}`);
  }
  return rowToStoryMeta(data as StoryRow);
}

export async function listStories(limit = 27): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

export async function listStoriesByUser(userId: string, limit?: number): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('stories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (typeof limit === 'number') {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list user stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

export async function incrementStoryViewCount(id: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('increment_story_view_count', {
    story_id: id,
  });

  if (error) throw new Error(`Failed to increment story view count: ${error.message}`);
  return normalizeCount(data);
}

export async function getStoryReaction(storyId: string, userId: string): Promise<StoryReaction | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('story_reactions')
    .select('reaction')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get story reaction: ${error.message}`);
  }

  const reaction = (data as { reaction?: unknown } | null)?.reaction;
  return isStoryReaction(reaction) ? reaction : null;
}

export async function setStoryReaction(
  storyId: string,
  userId: string,
  reaction: StoryReaction | null,
  feedback?: string | null,
): Promise<StoryReactionResponse> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('set_story_reaction', {
    p_story_id: storyId,
    p_user_id: userId,
    p_reaction: reaction,
    p_feedback: reaction === 'dislike' ? feedback ?? null : null,
  });

  if (error) throw new Error(`Failed to update story reaction: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const reactionRow = row as {
    like_count?: unknown;
    dislike_count?: unknown;
    latest_dislike_feedback?: unknown;
  } | null;
  return {
    id: storyId,
    likeCount: normalizeCount(reactionRow?.like_count),
    dislikeCount: normalizeCount(reactionRow?.dislike_count),
    myReaction: reaction,
    feedback: typeof reactionRow?.latest_dislike_feedback === 'string'
      ? reactionRow.latest_dislike_feedback
      : null,
  };
}

function mergeStoryUsageTotals(
  current: StoryUsageTotals | undefined,
  delta: StoryUsageTotals,
): StoryUsageTotals {
  const existing = normalizeStoryUsageTotals(current);
  return {
    inputTokens: existing.inputTokens + delta.inputTokens,
    outputTokens: existing.outputTokens + delta.outputTokens,
    totalTokens: existing.totalTokens + delta.totalTokens,
    costUsdMicros: existing.costUsdMicros + delta.costUsdMicros,
    textCostUsdMicros: existing.textCostUsdMicros + delta.textCostUsdMicros,
    imageCostUsdMicros: existing.imageCostUsdMicros + delta.imageCostUsdMicros,
    audioCostUsdMicros: existing.audioCostUsdMicros + delta.audioCostUsdMicros,
  };
}

export async function appendStoryUsageEvent(
  storyId: string,
  event: StoryUsageEvent,
  totalsDelta: StoryUsageTotals,
): Promise<void> {
  const supabase = getSupabase();
  const story = await getStory(storyId);
  if (!story) {
    throw new Error(`Failed to append story usage event: story ${storyId} not found`);
  }

  const mergedTotals = mergeStoryUsageTotals(story.usageTotals ?? EMPTY_STORY_USAGE_TOTALS, totalsDelta);
  const { error: insertError } = await supabase.from('story_usage_events').insert({
    id: event.id,
    story_id: event.storyId,
    user_id: event.userId ?? null,
    provider: event.provider,
    operation: event.operation,
    source: event.source,
    status: event.status,
    model: event.model,
    page_number: event.pageNumber ?? null,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    total_tokens: event.totalTokens,
    cost_usd_micros: event.costUsdMicros,
    usage_details: event.usageDetails,
    created_at: event.createdAt,
  });
  if (insertError) {
    throw new Error(`Failed to insert story usage event: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from('stories')
    .update({
      usage_input_tokens: mergedTotals.inputTokens,
      usage_output_tokens: mergedTotals.outputTokens,
      usage_total_tokens: mergedTotals.totalTokens,
      usage_cost_usd_micros: mergedTotals.costUsdMicros,
      usage_text_cost_usd_micros: mergedTotals.textCostUsdMicros,
      usage_image_cost_usd_micros: mergedTotals.imageCostUsdMicros,
      usage_audio_cost_usd_micros: mergedTotals.audioCostUsdMicros,
    })
    .eq('id', storyId);
  if (updateError) {
    throw new Error(`Failed to update story usage totals: ${updateError.message}`);
  }
}

export async function deleteStory(id: string, userId?: string): Promise<boolean> {
  const supabase = getSupabase();

  // Delete images from storage - try user-scoped path first, then legacy path
  if (userId) {
    const storagePath = `${userId}/${id}`;
    const { data: files } = await supabase.storage.from(BUCKET).list(storagePath);
    if (files && files.length > 0) {
      const paths = files.map(f => `${storagePath}/${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }
  // Also clean up legacy path (images stored without userId prefix)
  const { data: legacyFiles } = await supabase.storage.from(BUCKET).list(id);
  if (legacyFiles && legacyFiles.length > 0) {
    const legacyPaths = legacyFiles.map(f => `${id}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(legacyPaths);
  }

  // Delete from DB
  const { error } = await supabase.from('stories').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete story: ${error.message}`);
  return true;
}

export async function getActiveGenerations(
  supabase = getSupabase(),
): Promise<StoryMeta[]> {
  try {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .not('status', 'in', '("completed","failed","cancelled")')
      .order('created_at', { ascending: false });

    if (error) {
      throw classifySupabaseOperationError('active generation lookup', error);
    }

    return (data as StoryRow[]).map(rowToStoryMeta);
  } catch (error) {
    throw classifySupabaseOperationError('active generation lookup', error);
  }
}

// ---------- Update Voice ----------

export async function updateStoryVoice(id: string, voice: VoiceKey): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').update({ voice }).eq('id', id);
  if (error) throw new Error(`Failed to update story voice: ${error.message}`);
}

// ---------- Public Stories ----------

export async function updateStoryVisibility(id: string, isPublic: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stories')
    .update({ is_public: isPublic })
    .eq('id', id);
  if (error) throw new Error(`Failed to update story visibility: ${error.message}`);
}

export async function listPublicStories(search?: string, limit = 50): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('stories')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search && search.trim()) {
    // Sanitize: strip double quotes to prevent PostgREST filter injection
    const sanitized = search.trim().replace(/"/g, '');
    if (sanitized) {
      const term = `%${sanitized}%`;
      query = query.or(`title.ilike."${term}",prompt.ilike."${term}"`);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list public stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

// ---------- Image Storage ----------

function getStoryStoragePath(userId: string | undefined, storyId: string, filename: string): string {
  return userId ? `${userId}/${storyId}/${filename}` : `${storyId}/${filename}`;
}

async function uploadStorageObject(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      cacheControl: String(MEDIA_CACHE_MAX_AGE_SECONDS),
      contentType,
      upsert: true,
    });

  if (error) throw new Error(`Failed to upload ${storagePath}: ${error.message}`);
}

async function generateCoverImageSources(
  userId: string | undefined,
  storyId: string,
  sourceFilename: string,
  sourceBuffer: Buffer,
): Promise<void> {
  const sources = await generateCoverImageVariantSources({
    sourceBuffer,
    fullUrl: getImageUrl(userId, storyId, sourceFilename),
    uploadVariant: async ({ filename, buffer, contentType }) => {
      await uploadStorageObject(getStoryStoragePath(userId, storyId, filename), buffer, contentType);
      return getImageUrl(userId, storyId, filename);
    },
  });

  const { error } = await getSupabase()
    .from('stories')
    .update({
      cover_image_url: sources.full,
      cover_image_sources: sources,
    })
    .eq('id', storyId);

  if (error) {
    throw new Error(`Failed to update cover image sources: ${error.message}`);
  }
}

export async function uploadImage(userId: string | undefined, storyId: string, filename: string, base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const storagePath = getStoryStoragePath(userId, storyId, filename);

  await uploadStorageObject(storagePath, buffer, 'image/png');

  if (isCoverImageSourceFilename(filename)) {
    try {
      await generateCoverImageSources(userId, storyId, filename, buffer);
    } catch (error) {
      console.warn(
        `[story:${storyId}] Failed to generate cover image variants:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return getImageUrl(userId, storyId, filename);
}

export function getImageUrl(userId: string | undefined, storyId: string, filename: string): string {
  if (userId) {
    return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${userId}/${storyId}/${filename}`;
  }
  return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${storyId}/${filename}`;
}

// ---------- Audio Storage ----------

export async function uploadAudio(userId: string | undefined, storyId: string, filename: string, audioBuffer: Buffer): Promise<string> {
  const supabase = getSupabase();
  const storagePath = userId ? `${userId}/${storyId}/${filename}` : `${storyId}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, audioBuffer, {
      cacheControl: String(MEDIA_CACHE_MAX_AGE_SECONDS),
      contentType: 'audio/mpeg',
      upsert: true,
    });
  if (error) throw new Error(`Failed to upload audio: ${error.message}`);

  return getImageUrl(userId, storyId, filename);
}

export function getAudioUrl(userId: string | undefined, storyId: string, filename: string): string {
  // Uses same bucket and URL pattern as images
  return getImageUrl(userId, storyId, filename);
}

export async function updatePageAudioUrl(id: string, pageNumber: number, audioUrl: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('update_page_audio_url', {
    story_id: id,
    page_number: pageNumber,
    audio_url: audioUrl,
  });
  if (error) throw new Error(`Failed to update page audio URL: ${error.message}`);
}

// ---------- Storage Listing & Download ----------

export async function listStoryFiles(storyId: string, userId?: string): Promise<string[]> {
  const supabase = getSupabase();

  // Try user-scoped path first
  if (userId) {
    const storagePath = `${userId}/${storyId}`;
    const { data } = await supabase.storage.from(BUCKET).list(storagePath);
    if (data && data.length > 0) {
      return data.map(f => f.name);
    }
  }

  // Fallback to legacy path
  const { data: legacyData } = await supabase.storage.from(BUCKET).list(storyId);
  if (legacyData && legacyData.length > 0) {
    return legacyData.map(f => f.name);
  }

  return [];
}

export async function downloadImage(storyId: string, filename: string, userId?: string): Promise<string> {
  const supabase = getSupabase();
  const storagePath = userId ? `${userId}/${storyId}/${filename}` : `${storyId}/${filename}`;

  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Failed to download image ${filename}: ${error.message}`);

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

// ---------- Startup Recovery ----------

/**
 * Recover stories stuck in generating states after a server crash or restart.
 * Determines the correct status based on actual page data and updates accordingly.
 */
export interface RecoveryDeps {
  isGenerationActive?: (storyId: string) => boolean;
  loadActiveGenerations?: () => Promise<StoryMeta[]>;
  log?: Pick<Console, 'log'>;
  now?: () => number;
  updateStatus?: (id: string, status: StoryStatus) => Promise<void>;
}

export async function recoverStuckStories(deps: RecoveryDeps = {}): Promise<number> {
  const checkIsGenerationActive = deps.isGenerationActive ?? (() => false);
  const loadActiveGenerations = deps.loadActiveGenerations ?? (() => getActiveGenerations());
  const logger = deps.log ?? console;
  const persistStatus = deps.updateStatus ?? updateStoryStatus;

  const stuck = await loadActiveGenerations();
  if (stuck.length === 0) return 0;

  // Only recover stories older than 5 minutes to avoid interfering with
  // genuinely in-progress generations (e.g. during rolling deploys).
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
  const now = deps.now?.() ?? Date.now();

  let recovered = 0;
  for (const story of stuck) {
    if (checkIsGenerationActive(story.id)) {
      logger.log(`  [recovery] ${story.id}: active on this server, skipping`);
      continue;
    }

    const age = now - new Date(story.createdAt).getTime();
    if (age < STUCK_THRESHOLD_MS) {
      logger.log(`  [recovery] ${story.id}: still fresh (${Math.round(age / 1000)}s old), skipping`);
      continue;
    }

    const pages = story.scenario?.pages ?? [];

    // No scenario data yet — story was in very early generation, mark failed
    if (pages.length === 0) {
      await persistStatus(story.id, 'failed');
      logger.log(`  [recovery] ${story.id}: no pages → failed`);
      recovered++;
      continue;
    }

    const hasFailedImages = pages.some(p => p.status === 'failed');
    const allImagesComplete = pages.every(p => p.status === 'completed');
    const shouldHaveAudio = !!story.voice;
    const allAudioPresent = !shouldHaveAudio || pages.every(p => !!p.audioUrl);

    if (allImagesComplete && allAudioPresent) {
      // Everything is done — mark completed
      await persistStatus(story.id, 'completed');
      logger.log(`  [recovery] ${story.id}: all content present → completed`);
    } else if (hasFailedImages || (shouldHaveAudio && pages.some(p => !p.audioUrl))) {
      // Has failures or missing audio — mark completed (retry can fix the rest)
      // We use 'completed' rather than 'failed' so the story is viewable,
      // and the retry button will appear for the missing content.
      await persistStatus(story.id, 'completed');
      logger.log(`  [recovery] ${story.id}: partial content (failed images: ${hasFailedImages}, missing audio: ${shouldHaveAudio && pages.some(p => !p.audioUrl)}) → completed`);
    } else {
      // Images still pending/generating — mark failed since pipeline is dead
      await persistStatus(story.id, 'failed');
      logger.log(`  [recovery] ${story.id}: images incomplete → failed`);
    }
    recovered++;
  }

  return recovered;
}
