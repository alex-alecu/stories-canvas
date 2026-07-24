import crypto from 'node:crypto';
import { config } from '../config.js';
import type { ModelPriceCatalogEntry, ModelPricingSnapshot, PriceCatalogStatus } from '../../shared/types.js';
import { getSupabase } from './supabase.js';

export const OPENROUTER_MODEL_SOURCES = [
  {
    model: 'gemini-3.1-pro-preview',
    roles: ['draft', 'rewrite'],
    unit: 'input/output tokens',
    url: 'https://openrouter.ai/api/v1/models/google/gemini-3.1-pro-preview/endpoints',
  },
  {
    model: 'gemini-3.1-flash-lite',
    roles: ['review', 'page text review', 'source analysis'],
    unit: 'input/output tokens',
    url: 'https://openrouter.ai/api/v1/models/google/gemini-3.1-flash-lite-preview/endpoints',
  },
  {
    model: 'gemini-3.1-flash-image-preview',
    roles: ['fast image'],
    unit: 'input/image-output tokens',
    url: 'https://openrouter.ai/api/v1/models/google/gemini-3.1-flash-image-preview/endpoints',
  },
  {
    model: 'gemini-3-pro-image-preview',
    roles: ['pro image'],
    unit: 'input/image-output tokens',
    url: 'https://openrouter.ai/api/v1/models/google/gemini-3-pro-image-preview/endpoints',
  },
] as const;

interface OpenRouterEndpoint {
  provider_name?: unknown;
  tag?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    image_output?: unknown;
  };
}

interface OpenRouterResponse {
  data?: {
    endpoints?: unknown;
  };
}

const cache = new Map<string, ModelPriceCatalogEntry>();
let cachedStatus: PriceCatalogStatus | null = null;

function decimal(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`OpenRouter ${field} price is missing or malformed`);
  }
  return value;
}

export function selectGoogleAiStudioEndpoint(payload: unknown): OpenRouterEndpoint {
  const endpoints = (payload as OpenRouterResponse)?.data?.endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error('OpenRouter response is missing endpoints');
  }

  const matches = (endpoints as OpenRouterEndpoint[]).filter(endpoint => {
    const tag = typeof endpoint.tag === 'string' ? endpoint.tag : '';
    return endpoint.provider_name === 'Google AI Studio'
      && !tag.split('/').some(part => part === 'flex' || part === 'priority');
  });
  if (matches.length !== 1) {
    throw new Error(`Expected one standard Google AI Studio endpoint, found ${matches.length}`);
  }
  return matches[0];
}

export async function fetchModelPriceCatalog(
  fetchFn: typeof fetch = fetch,
  fetchedAt = new Date(),
): Promise<ModelPriceCatalogEntry[]> {
  const geminiEntries: ModelPriceCatalogEntry[] = await Promise.all(OPENROUTER_MODEL_SOURCES.map(async source => {
    const response = await fetchFn(source.url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter price request failed for ${source.model}: HTTP ${response.status}`);
    }
    const endpoint = selectGoogleAiStudioEndpoint(await response.json());
    const pricing = endpoint.pricing ?? {};
    const isImage = source.roles.some(role => role.includes('image'));
    return {
      model: source.model,
      provider: 'gemini' as const,
      roles: [...source.roles],
      unit: source.unit,
      inputUsdPerToken: decimal(pricing.prompt, 'prompt'),
      outputUsdPerToken: decimal(pricing.completion, 'completion'),
      imageOutputUsdPerToken: isImage ? decimal(pricing.image_output, 'image_output') : '0',
      audioUsdPerCharacter: '0',
      sourceUrl: source.url,
      endpointTag: String(endpoint.tag),
      fetchedAt: fetchedAt.toISOString(),
    } satisfies ModelPriceCatalogEntry;
  }));

  const audioRate = config.elevenLabsPriceUsdPer1kCharacters / 1000;
  if (!Number.isFinite(audioRate) || audioRate < 0) {
    throw new Error('ELEVENLABS_PRICE_USD_PER_1K_CHARACTERS must be non-negative');
  }
  geminiEntries.push({
    model: config.elevenLabsModel,
    provider: 'elevenlabs',
    roles: ['audio'],
    unit: 'billed characters',
    inputUsdPerToken: '0',
    outputUsdPerToken: '0',
    imageOutputUsdPerToken: '0',
    audioUsdPerCharacter: audioRate.toFixed(12).replace(/0+$/, '').replace(/\.$/, ''),
    sourceUrl: 'environment:ELEVENLABS_PRICE_USD_PER_1K_CHARACTERS',
    endpointTag: 'environment',
    fetchedAt: fetchedAt.toISOString(),
  });
  return geminiEntries;
}

function rowToEntry(row: Record<string, unknown>): ModelPriceCatalogEntry {
  return {
    model: String(row.model),
    provider: row.provider === 'elevenlabs' ? 'elevenlabs' : 'gemini',
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    unit: String(row.unit),
    inputUsdPerToken: String(row.input_usd_per_token),
    outputUsdPerToken: String(row.output_usd_per_token),
    imageOutputUsdPerToken: String(row.image_output_usd_per_token),
    audioUsdPerCharacter: String(row.audio_usd_per_character),
    sourceUrl: String(row.source_url),
    endpointTag: String(row.endpoint_tag),
    fetchedAt: String(row.fetched_at),
  };
}

function remember(entries: ModelPriceCatalogEntry[]): void {
  cache.clear();
  for (const entry of entries) cache.set(entry.model, entry);
}

export async function loadModelPriceCatalog(): Promise<{
  entries: ModelPriceCatalogEntry[];
  status: PriceCatalogStatus;
}> {
  const supabase = getSupabase();
  const [{ data: rows, error: catalogError }, { data: state, error: stateError }] = await Promise.all([
    supabase.from('model_price_catalog').select('*').order('model'),
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
    stale: !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() >= 24 * 60 * 60 * 1000,
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
    const entries = await fetchModelPriceCatalog();
    const { error: upsertError } = await supabase.from('model_price_catalog').upsert(
      entries.map(entry => ({
        model: entry.model,
        provider: entry.provider,
        roles: entry.roles,
        unit: entry.unit,
        input_usd_per_token: entry.inputUsdPerToken,
        output_usd_per_token: entry.outputUsdPerToken,
        image_output_usd_per_token: entry.imageOutputUsdPerToken,
        audio_usd_per_character: entry.audioUsdPerCharacter,
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
    cachedStatus = { lastAttemptAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), stale: false };
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
