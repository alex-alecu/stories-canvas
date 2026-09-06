import crypto from 'node:crypto';
import { config } from '../config.js';
import type { ModelPriceCatalogEntry, ModelPricingSnapshot, PriceCatalogStatus } from '../../shared/types.js';
import { getSupabase } from './supabase.js';

const PRICE_CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, ModelPriceCatalogEntry>();
let cachedStatus: PriceCatalogStatus | null = null;

// Text and image requests use OpenRouter response costs. Only narration needs a configured rate.
export function buildAudioPriceCatalog(fetchedAt = new Date()): ModelPriceCatalogEntry[] {
  const audioRate = config.elevenLabsPriceUsdPer1kCharacters / 1000;
  if (!Number.isFinite(audioRate) || audioRate < 0) {
    throw new Error('ELEVENLABS_PRICE_USD_PER_1K_CHARACTERS must be non-negative');
  }
  return [{
    model: config.elevenLabsModel,
    provider: 'elevenlabs',
    roles: ['audio'],
    unit: 'billed characters',
    inputUsdPerToken: '0',
    cachedInputUsdPerToken: '0',
    cacheWriteUsdPerToken: '0',
    outputUsdPerToken: '0',
    imageOutputUsdPerToken: '0',
    audioUsdPerCharacter: audioRate.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''),
    webSearchUsdPerCall: '0',
    sourceUrl: 'environment:ELEVENLABS_PRICE_USD_PER_1K_CHARACTERS',
    endpointTag: 'environment',
    fetchedAt: fetchedAt.toISOString(),
  }];
}

function rowToEntry(row: Record<string, unknown>): ModelPriceCatalogEntry {
  return {
    model: String(row.model),
    provider: 'elevenlabs',
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    unit: String(row.unit),
    inputUsdPerToken: String(row.input_usd_per_token),
    cachedInputUsdPerToken: String(row.cached_input_usd_per_token ?? '0'),
    cacheWriteUsdPerToken: String(row.cache_write_usd_per_token ?? '0'),
    outputUsdPerToken: String(row.output_usd_per_token),
    imageOutputUsdPerToken: String(row.image_output_usd_per_token),
    audioUsdPerCharacter: String(row.audio_usd_per_character),
    webSearchUsdPerCall: String(row.web_search_usd_per_call ?? '0'),
    sourceUrl: String(row.source_url),
    endpointTag: String(row.endpoint_tag),
    fetchedAt: String(row.fetched_at),
  };
}

function remember(entries: ModelPriceCatalogEntry[]): void {
  cache.clear();
  for (const entry of entries) cache.set(entry.model, entry);
}

function timestampIsStale(timestamp: string | undefined, nowMs: number): boolean {
  if (!timestamp) return true;
  const timestampMs = new Date(timestamp).getTime();
  return !Number.isFinite(timestampMs) || nowMs - timestampMs >= PRICE_CATALOG_STALE_AFTER_MS;
}

export function isModelPriceCatalogStale(
  entries: ModelPriceCatalogEntry[],
  lastSuccessAt: string | undefined,
  now = new Date(),
): boolean {
  const nowMs = now.getTime();
  return timestampIsStale(lastSuccessAt, nowMs)
    || entries.some(entry => timestampIsStale(entry.fetchedAt, nowMs));
}

export async function loadModelPriceCatalog(): Promise<{
  entries: ModelPriceCatalogEntry[];
  status: PriceCatalogStatus;
}> {
  const supabase = getSupabase();
  const [{ data: rows, error: catalogError }, { data: state, error: stateError }] = await Promise.all([
    supabase.from('model_price_catalog').select('*').eq('model', config.elevenLabsModel).eq('provider', 'elevenlabs'),
    supabase.from('price_catalog_refresh_state').select('*').eq('singleton', true).single(),
  ]);
  if (catalogError) throw new Error(`Failed to load model price catalog: ${catalogError.message}`);
  if (stateError) throw new Error(`Failed to load model price status: ${stateError.message}`);

  const entries = (rows ?? []).map(row => rowToEntry(row as Record<string, unknown>));
  remember(entries);
  const lastSuccessAt = state.last_success_at ?? undefined;
  cachedStatus = {
    lastAttemptAt: state.last_attempt_at ?? undefined,
    lastSuccessAt,
    lastError: state.last_error ?? undefined,
    stale: isModelPriceCatalogStale(entries, lastSuccessAt),
  };
  return { entries, status: cachedStatus };
}

export async function resolveModelPricingSnapshot(model: string): Promise<ModelPricingSnapshot | undefined> {
  if (!cache.has(model) && config.useSupabase) {
    await loadModelPriceCatalog().catch(() => undefined);
  }
  const entry = cache.get(model);
  if (!entry) return undefined;
  return { ...entry };
}

export async function refreshModelPriceCatalog(options: { force?: boolean } = {}): Promise<boolean> {
  if (!config.useSupabase) return false;
  const supabase = getSupabase();
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await supabase.rpc('claim_price_catalog_refresh', {
    p_owner: owner,
    p_force: options.force ?? false,
  });
  if (claimError) throw new Error(`Failed to claim price catalog refresh: ${claimError.message}`);
  if (claimed !== true) return false;

  try {
    const entries = buildAudioPriceCatalog();
    const { error: upsertError } = await supabase.from('model_price_catalog').upsert(
      entries.map(entry => ({
        model: entry.model,
        provider: entry.provider,
        roles: entry.roles,
        unit: entry.unit,
        input_usd_per_token: entry.inputUsdPerToken,
        cached_input_usd_per_token: entry.cachedInputUsdPerToken,
        cache_write_usd_per_token: entry.cacheWriteUsdPerToken,
        output_usd_per_token: entry.outputUsdPerToken,
        image_output_usd_per_token: entry.imageOutputUsdPerToken,
        audio_usd_per_character: entry.audioUsdPerCharacter,
        web_search_usd_per_call: entry.webSearchUsdPerCall,
        source_url: entry.sourceUrl,
        endpoint_tag: entry.endpointTag,
        fetched_at: entry.fetchedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'model' },
    );
    if (upsertError) throw new Error(`Failed to store model prices: ${upsertError.message}`);
    const { error: finishError } = await supabase.rpc('finish_price_catalog_refresh', {
      p_owner: owner,
      p_error: null,
    });
    if (finishError) throw new Error(`Failed to finish model price refresh: ${finishError.message}`);
    remember(entries);
    const completedAt = new Date();
    const lastSuccessAt = completedAt.toISOString();
    cachedStatus = {
      lastAttemptAt: lastSuccessAt,
      lastSuccessAt,
      stale: isModelPriceCatalogStale(entries, lastSuccessAt, completedAt),
    };
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await supabase.rpc('finish_price_catalog_refresh', { p_owner: owner, p_error: message });
    } catch {
      // Preserve the original refresh error.
    }
    if (cachedStatus) cachedStatus = { ...cachedStatus, lastError: message, stale: true };
    throw error;
  }
}

/** Stop before a paid media request when its rate cannot be recorded. */
export async function requireAudioPricing(model: string): Promise<void> {
  if (!config.useSupabase) return;
  const pricing = await resolveModelPricingSnapshot(model);
  const rate = Number(pricing?.audioUsdPerCharacter);
  if (!pricing || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Generation pricing is unavailable. Please try again later.');
  }
}
