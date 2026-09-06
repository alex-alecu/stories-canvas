import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

let client: OpenAI | undefined;
let clientKey: string | undefined;

export function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || config.openrouterApiKey;
  if (!apiKey) throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0,
      defaultHeaders: { 'HTTP-Referer': config.appBaseUrl, 'X-OpenRouter-Title': config.appSiteName } });
    clientKey = apiKey;
  }
  return client;
}

function validCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1_000_000));
}

export async function resolveOpenRouterCost(cost: unknown, responseId: string | undefined, api: Pick<OpenAI, 'get'>): Promise<number | null> {
  if (!validCost(cost) && responseId) {
    try {
      const result = await api.get<{ data: { total_cost?: number } }>('/generation', {
        query: { id: responseId }, timeout: 15_000, maxRetries: 2,
      });
      cost = result.data.total_cost;
    } catch { /* Save an incomplete event for account support. Do not infer a zero charge. */ }
  }
  return validCost(cost) ? cost : null;
}

// Repeating the database write for one provider response cannot charge twice.
export function requestUsageId(storyId: string, responseId: string): string {
  const hex = createHash('sha256').update(`openrouter:${storyId}:${responseId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
