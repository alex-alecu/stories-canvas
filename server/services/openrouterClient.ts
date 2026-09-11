import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

let client: OpenAI | undefined;
let clientKey: string | undefined;

// A full story with high thinking can take more than five minutes.
export const TEXT_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const COST_LOOKUP_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

export function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || config.openrouterApiKey;
  if (!apiKey) throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  if (!client || clientKey !== apiKey) {
    // HTTP headers cannot contain the Unicode characters used in translated site names.
    const title = config.appSiteName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '').trim() || 'Stories Canvas';
    client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0,
      defaultHeaders: { 'HTTP-Referer': config.appBaseUrl, 'X-OpenRouter-Title': title } });
    clientKey = apiKey;
  }
  return client;
}

function validCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1_000_000));
}

function isNotReadyCostLookupError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

function waitForCostLookupRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function resolveOpenRouterCost(cost: unknown, responseId: string | undefined, api: Pick<OpenAI, 'get'>): Promise<number | null> {
  if (validCost(cost) || !responseId) return validCost(cost) ? cost : null;

  for (let attempt = 0; attempt <= COST_LOOKUP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await api.get<{ data: { total_cost?: number } }>('/generation', {
        query: { id: responseId }, timeout: 15_000, maxRetries: 2,
      });
      cost = result.data.total_cost;
      if (validCost(cost)) return cost;
    } catch (error) {
      if (!isNotReadyCostLookupError(error)) return null;
    }

    const delayMs = COST_LOOKUP_RETRY_DELAYS_MS[attempt];
    if (delayMs !== undefined) await waitForCostLookupRetry(delayMs);
  }

  return null;
}

// Repeating the database write for one provider response cannot charge twice.
export function requestUsageId(storyId: string, responseId: string): string {
  const hex = createHash('sha256').update(`openrouter:${storyId}:${responseId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
