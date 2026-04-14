import type { AdminOverview, AdminUserDetail, AdminUserSummary } from '../../shared/types.js';
import { getSupabase } from './supabase.js';
import {
  getBillingHistory,
  getUserCreditBalance,
  listStoryPackOffers,
  listWebhookEvents,
} from './billingStorage.js';

interface AuthUserLike {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}

function getDisplayName(user: AuthUserLike): string | undefined {
  return user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email
    || undefined;
}

export async function searchUsers(query: string, limit = 20): Promise<AdminUserSummary[]> {
  const supabase = getSupabase();
  const normalizedQuery = query.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  const filtered = (data.users as AuthUserLike[])
    .filter((user) => {
      if (!normalizedQuery) return true;

      const haystacks = [
        user.id,
        user.email,
        user.user_metadata?.full_name,
        user.user_metadata?.name,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.toLowerCase());

      return haystacks.some(value => value.includes(normalizedQuery));
    })
    .slice(0, limit);

  const userIds = filtered.map(user => user.id);
  if (userIds.length === 0) {
    return [];
  }

  const [{ data: balances, error: balancesError }, { data: roles, error: rolesError }] = await Promise.all([
    supabase
      .from('user_credit_balances')
      .select('user_id, available_credits')
      .in('user_id', userIds),
    supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('role', 'admin')
      .in('user_id', userIds),
  ]);

  if (balancesError) {
    throw new Error(`Failed to load user balances: ${balancesError.message}`);
  }

  if (rolesError) {
    throw new Error(`Failed to load user roles: ${rolesError.message}`);
  }

  const balanceMap = new Map((balances ?? []).map((row) => [row.user_id, row.available_credits]));
  const adminSet = new Set((roles ?? []).map(row => row.user_id));

  return filtered.map((user) => ({
    id: user.id,
    email: user.email ?? 'Unknown email',
    displayName: getDisplayName(user),
    availableCredits: balanceMap.get(user.id) ?? 0,
    isAdmin: adminSet.has(user.id),
    createdAt: user.created_at,
  }));
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const supabase = getSupabase();
  const [{ data: authUserData, error: authUserError }, balance, history, { data: adminRoleData, error: adminRoleError }] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    getUserCreditBalance(userId),
    getBillingHistory(userId),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle(),
  ]);

  if (authUserError) {
    if (authUserError.message.toLowerCase().includes('user not found')) {
      return null;
    }

    throw new Error(`Failed to load user details: ${authUserError.message}`);
  }

  if (adminRoleError) {
    throw new Error(`Failed to load admin role: ${adminRoleError.message}`);
  }

  const user = authUserData.user as AuthUserLike | null;
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? 'Unknown email',
    displayName: getDisplayName(user),
    availableCredits: balance.availableCredits,
    isAdmin: !!adminRoleData,
    createdAt: user.created_at,
    purchases: history.purchases,
    ledger: history.ledger,
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [offers, webhookEvents] = await Promise.all([
    listStoryPackOffers({ includeInactive: true }),
    listWebhookEvents(),
  ]);

  return {
    offers,
    webhookEvents,
  };
}
