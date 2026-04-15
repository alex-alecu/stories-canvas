import { config } from '../config.js';
import { getSupabase } from './supabase.js';

export type AppRole = 'admin';

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function isBootstrapAdminEmail(email: string | undefined): boolean {
  const normalized = normalizeEmail(email);
  return !!normalized && config.adminBootstrapEmails.includes(normalized);
}

export async function ensureBootstrapAdminRole(userId: string, email: string | undefined): Promise<void> {
  if (!config.useSupabase || !isBootstrapAdminEmail(email)) {
    return;
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('user_roles')
    .upsert({
      user_id: userId,
      role: 'admin',
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,role',
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`Failed to ensure bootstrap admin role: ${error.message}`);
  }
}

export async function hasRole(userId: string, role: AppRole): Promise<boolean> {
  if (!config.useSupabase) {
    return false;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', role)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load role: ${error.message}`);
  }

  return !!data;
}

export async function resolveUserAccess(userId: string, email: string | undefined): Promise<{ isAdmin: boolean }> {
  await ensureBootstrapAdminRole(userId, email);
  return {
    isAdmin: await hasRole(userId, 'admin'),
  };
}
