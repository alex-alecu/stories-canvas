import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl, isSupabaseConfigured } from './supabaseConfig';

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
export { isSupabaseConfigured };
