import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.');
    }
    supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }
  return supabaseClient;
}
