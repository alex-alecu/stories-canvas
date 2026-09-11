import { randomUUID } from 'node:crypto';
import { getSupabase } from './supabase.js';
import type { MarketingLog } from '../../shared/marketing.js';

export class MarketingError extends Error {
  logId?: string;
  constructor(public stage: string, message: string, public details: MarketingLog['details'] = {}) { super(message); }
}

export function marketingFailure(error: unknown, stage: string): MarketingError {
  if (error instanceof MarketingError) {
    if (error.stage === 'Database access' && !error.logId) error.stage = stage;
    return error;
  }
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return new MarketingError(stage, status === 402 ? 'The AI account has insufficient credit. Add credit to the AI account.'
    : status === 401 ? 'The provider rejected access. Check the account connection.'
    : status === 429 ? 'The provider limit was reached. Try again later.'
    : 'The operation failed. Check the provider connection and try again.', { httpStatus: status });
}

export const marketingLogOps = { db: getSupabase };
export interface MarketingTrace { runId: string; postId?: string }

export async function logMarketing(trace: MarketingTrace, stage: string, status: MarketingLog['status'], message: string,
  details: MarketingLog['details'] = {}): Promise<MarketingLog> {
  const entry: MarketingLog = { id: randomUUID(), run_id: trace.runId, post_id: trace.postId ?? null,
    created_at: new Date().toISOString(), stage, status, message, details };
  const output = `[marketing] ${JSON.stringify(entry)}`;
  if (status === 'failed') console.error(output); else console.info(output);
  try {
    const { error } = await marketingLogOps.db().from('instagram_marketing_logs').insert(entry);
    if (error) throw error;
  } catch {
    console.error(`[marketing] ${JSON.stringify({ run_id: trace.runId, stage: 'Save activity log', status: 'failed',
      message: 'Cannot save the activity log. Check database access and release migrations.' })}`);
  }
  return entry;
}

export async function marketingStep<T>(trace: MarketingTrace, stage: string, work: () => Promise<T>): Promise<T> {
  await logMarketing(trace, stage, 'started', 'Step started.');
  try {
    const result = await work();
    await logMarketing(trace, stage, 'succeeded', 'Step completed.');
    return result;
  } catch (error) {
    throw await reportMarketingFailure(trace, error, stage);
  }
}

export async function reportMarketingFailure(trace: MarketingTrace, error: unknown, stage: string) {
  const failure = marketingFailure(error, stage);
  if (!failure.logId) failure.logId = (await logMarketing(trace, failure.stage, 'failed', failure.message, failure.details)).id;
  return failure;
}
