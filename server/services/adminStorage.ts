import type { AdminOverview, AdminUserDetail, AdminUserStoryCostSummary, AdminUserSummary } from '../../shared/types.js';
import { getSupabase } from './supabase.js';
import {
  getBillingHistory,
  getUserCreditBalance,
  listBillingPurchases,
  listStoryPackOffers,
  listWebhookEvents,
} from './billingStorage.js';
import { listStoriesByUser } from './supabaseStorage.js';

interface AuthUserLike {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}

const AUTH_USERS_PAGE_SIZE = 200;

interface AdminStorageDeps {
  getSupabase: typeof getSupabase;
  getUserCreditBalance: typeof getUserCreditBalance;
  getBillingHistory: typeof getBillingHistory;
  listBillingPurchases: typeof listBillingPurchases;
  listStoriesByUser: typeof listStoriesByUser;
}

const defaultDeps: AdminStorageDeps = {
  getSupabase,
  getUserCreditBalance,
  getBillingHistory,
  listBillingPurchases,
  listStoriesByUser,
};

function getDisplayName(user: AuthUserLike): string | undefined {
  return user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email
    || undefined;
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

async function listMatchingAuthUsers(query: string, limit: number): Promise<AuthUserLike[]> {
  const supabase = getSupabase();
  const normalizedQuery = query.trim().toLowerCase();
  const matches: AuthUserLike[] = [];
  let page = 1;

  while (matches.length < limit) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const users = (data.users as AuthUserLike[]) ?? [];
    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      if (!normalizedQuery) {
        matches.push(user);
      } else {
        const haystacks = [
          user.id,
          user.email,
          user.user_metadata?.full_name,
          user.user_metadata?.name,
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map(value => value.toLowerCase());

        if (haystacks.some(value => value.includes(normalizedQuery))) {
          matches.push(user);
        }
      }

      if (matches.length >= limit) {
        break;
      }
    }

    if (users.length < AUTH_USERS_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return matches.slice(0, limit);
}

export async function searchUsers(query: string, limit = 20): Promise<AdminUserSummary[]> {
  const supabase = getSupabase();
  const filtered = await listMatchingAuthUsers(query, limit);

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

  const balanceMap = new Map((balances ?? []).map((row) => [row.user_id, normalizeCreditAmount(row.available_credits)]));
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

export async function getAdminUserDetail(userId: string, deps: AdminStorageDeps = defaultDeps): Promise<AdminUserDetail | null> {
  const supabase = deps.getSupabase();
  const [{ data: authUserData, error: authUserError }, balance, history, stories, purchases, { data: adminRoleData, error: adminRoleError }] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    deps.getUserCreditBalance(userId),
    deps.getBillingHistory(userId),
    deps.listStoriesByUser(userId),
    deps.listBillingPurchases(userId),
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

  const storySummaries: AdminUserStoryCostSummary[] = stories.map(story => ({
    id: story.id,
    createdAt: story.createdAt,
    title: story.scenario?.title,
    status: story.status,
    creditCost: story.creditCost,
    generationInputs: story.generationInputs,
    usageTotals: story.usageTotals ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsdMicros: 0,
      textCostUsdMicros: 0,
      imageCostUsdMicros: 0,
      audioCostUsdMicros: 0,
    },
  }));

  const metrics = storySummaries.reduce((acc, story) => {
    acc.costUsdMicros += story.usageTotals.costUsdMicros;
    acc.inputTokens += story.usageTotals.inputTokens;
    acc.outputTokens += story.usageTotals.outputTokens;
    acc.totalTokens += story.usageTotals.totalTokens;
    return acc;
  }, {
    revenueMinor: purchases
      .filter(purchase => purchase.status === 'completed')
      .reduce((sum, purchase) => sum + purchase.amountMinor, 0),
    revenueCurrency: 'ron' as const,
    costUsdMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });

  return {
    id: user.id,
    email: user.email ?? 'Unknown email',
    displayName: getDisplayName(user),
    availableCredits: balance.availableCredits,
    isAdmin: !!adminRoleData,
    createdAt: user.created_at,
    purchases: history.purchases,
    ledger: history.ledger,
    stories: storySummaries,
    metrics,
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
