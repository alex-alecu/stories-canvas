import type {
  AdminOverview,
  AdminStorySummary,
  AdminUserDetail,
  AdminUserStoryCostSummary,
  AdminUserSummary,
  BillingPurchase,
  PaginatedResponse,
  StoryMode,
} from '../../shared/types.js';
import { config } from '../config.js';
import { getSupabase } from './supabase.js';
import {
  getBillingHistory,
  getUserCreditBalance,
  listBillingPurchases,
  listStoryPackOffers,
  listWebhookEvents,
} from './billingStorage.js';
import { listStoriesByUser } from './supabaseStorage.js';
import { loadModelPriceCatalog } from './modelPriceCatalog.js';

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

async function listAllAuthUsers(): Promise<AuthUserLike[]> {
  const supabase = getSupabase();
  const users: AuthUserLike[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const pageUsers = (data.users as AuthUserLike[]) ?? [];
    if (pageUsers.length === 0) {
      break;
    }
    users.push(...pageUsers);
    if (pageUsers.length < AUTH_USERS_PAGE_SIZE) {
      break;
    }
    page += 1;
  }
  return users;
}

function matchesAuthUser(user: AuthUserLike, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [user.id, user.email, user.user_metadata?.full_name, user.user_metadata?.name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some(value => value.toLowerCase().includes(normalizedQuery));
}

export function computeAverageCreditValueMinor(
  purchases: Array<Pick<BillingPurchase, 'status' | 'amountMinor' | 'currency' | 'creditsGranted'>>,
  deploymentCurrency: string,
): number | null {
  const completed = purchases.filter(purchase => (
    purchase.status === 'completed'
    && purchase.currency.toLowerCase() === deploymentCurrency.toLowerCase()
    && purchase.creditsGranted > 0
  ));
  const credits = completed.reduce((sum, purchase) => sum + purchase.creditsGranted, 0);
  if (credits <= 0) return null;
  return completed.reduce((sum, purchase) => sum + purchase.amountMinor, 0) / credits;
}

export function computeStoryProfitUsdMicros(params: {
  deploymentCurrency: string;
  averageCreditValueMinor: number | null;
  creditsConsumed: number;
  costUsdMicros: number;
}): number | null {
  if (params.deploymentCurrency.toLowerCase() !== 'usd' || params.averageCreditValueMinor === null) {
    return null;
  }
  return Math.round(params.averageCreditValueMinor * params.creditsConsumed * 10_000) - params.costUsdMicros;
}

async function getDeploymentCurrency(): Promise<string> {
  if (config.storyPackPricing?.currency) return config.storyPackPricing.currency;
  const offers = await listStoryPackOffers({ includeInactive: true });
  return offers[0]?.currency ?? 'usd';
}

async function getPurchasesByUser(userIds: string[]): Promise<Map<string, BillingPurchase[]>> {
  const result = new Map<string, BillingPurchase[]>();
  if (userIds.length === 0) return result;
  const { data, error } = await getSupabase()
    .from('billing_purchases')
    .select('id, user_id, offer_slug, stripe_checkout_session_id, amount_minor, currency, credits_granted, status, created_at, updated_at, fulfilled_at')
    .in('user_id', userIds)
    .eq('status', 'completed');
  if (error) throw new Error(`Failed to load completed purchases: ${error.message}`);
  for (const row of data ?? []) {
    const purchase: BillingPurchase = {
      id: row.id,
      offerSlug: row.offer_slug,
      stripeCheckoutSessionId: row.stripe_checkout_session_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      creditsGranted: normalizeCreditAmount(row.credits_granted),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fulfilledAt: row.fulfilled_at ?? undefined,
    };
    result.set(row.user_id, [...(result.get(row.user_id) ?? []), purchase]);
  }
  return result;
}

export async function searchUsersPage(params: {
  query: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResponse<AdminUserSummary>> {
  const supabase = getSupabase();
  const allUsers = await listAllAuthUsers();
  const filtered = allUsers
    .filter(user => matchesAuthUser(user, params.query))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const start = (params.page - 1) * params.pageSize;
  const pageUsers = filtered.slice(start, start + params.pageSize);

  const userIds = pageUsers.map(user => user.id);
  if (userIds.length === 0) {
    return { items: [], page: params.page, pageSize: params.pageSize, totalCount: filtered.length };
  }

  const [{ data: balances, error: balancesError }, { data: roles, error: rolesError }, purchasesByUser, deploymentCurrency] = await Promise.all([
    supabase
      .from('user_credit_balances')
      .select('user_id, available_credits')
      .in('user_id', userIds),
    supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('role', 'admin')
      .in('user_id', userIds),
    getPurchasesByUser(userIds),
    getDeploymentCurrency(),
  ]);

  if (balancesError) {
    throw new Error(`Failed to load user balances: ${balancesError.message}`);
  }

  if (rolesError) {
    throw new Error(`Failed to load user roles: ${rolesError.message}`);
  }

  const balanceMap = new Map((balances ?? []).map((row) => [row.user_id, normalizeCreditAmount(row.available_credits)]));
  const adminSet = new Set((roles ?? []).map(row => row.user_id));

  return {
    items: pageUsers.map((user) => ({
      id: user.id,
      email: user.email ?? 'Unknown email',
      displayName: getDisplayName(user),
      availableCredits: balanceMap.get(user.id) ?? 0,
      isAdmin: adminSet.has(user.id),
      createdAt: user.created_at,
      averageCreditValueMinor: computeAverageCreditValueMinor(purchasesByUser.get(user.id) ?? [], deploymentCurrency),
      revenueCurrency: deploymentCurrency,
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalCount: filtered.length,
  };
}

export async function searchUsers(query: string, limit = 20): Promise<AdminUserSummary[]> {
  const result = await searchUsersPage({ query, page: 1, pageSize: limit });
  return result.items;
}

export async function listAdminStories(params: {
  query: string;
  type: 'all' | StoryMode;
  page: number;
  pageSize: number;
}): Promise<PaginatedResponse<AdminStorySummary>> {
  const supabase = getSupabase();
  const allUsers = await listAllAuthUsers();
  const userById = new Map(allUsers.map(user => [user.id, user]));
  const matchingUserIds = params.query.trim()
    ? allUsers.filter(user => (user.email ?? '').toLowerCase().includes(params.query.trim().toLowerCase())).map(user => user.id)
    : [];
  if (params.query.trim() && matchingUserIds.length === 0) {
    return { items: [], page: params.page, pageSize: params.pageSize, totalCount: 0 };
  }

  let query = supabase
    .from('stories')
    .select('id, user_id, title, created_at, total_pages, story_mode, usage_cost_usd_micros, usage_text_cost_usd_micros, usage_image_cost_usd_micros, usage_audio_cost_usd_micros', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (matchingUserIds.length > 0) query = query.in('user_id', matchingUserIds);
  if (params.type !== 'all') query = query.eq('story_mode', params.type);
  const start = (params.page - 1) * params.pageSize;
  const { data: stories, error, count } = await query.range(start, start + params.pageSize - 1);
  if (error) throw new Error(`Failed to list admin stories: ${error.message}`);

  const storyIds = (stories ?? []).map(row => row.id);
  const userIds = [...new Set((stories ?? []).map(row => row.user_id).filter(Boolean))];
  const [{ data: ledgerRows, error: ledgerError }, purchasesByUser, deploymentCurrency] = await Promise.all([
    storyIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('credit_ledger').select('story_id, delta').in('story_id', storyIds).lt('delta', 0),
    getPurchasesByUser(userIds),
    getDeploymentCurrency(),
  ]);
  if (ledgerError) throw new Error(`Failed to load story credit consumption: ${ledgerError.message}`);
  const creditsByStory = new Map<string, number>();
  for (const row of ledgerRows ?? []) {
    creditsByStory.set(row.story_id, (creditsByStory.get(row.story_id) ?? 0) + Math.abs(normalizeCreditAmount(row.delta)));
  }

  return {
    items: (stories ?? []).map(row => {
      const creditsConsumed = creditsByStory.get(row.id) ?? 0;
      const averageCreditValueMinor = computeAverageCreditValueMinor(purchasesByUser.get(row.user_id) ?? [], deploymentCurrency);
      const totalCostUsdMicros = Number(row.usage_cost_usd_micros ?? 0);
      return {
        id: row.id,
        userId: row.user_id ?? undefined,
        email: userById.get(row.user_id)?.email ?? 'Unknown email',
        title: row.title || 'Untitled story',
        createdAt: row.created_at,
        pages: Number(row.total_pages ?? 0),
        storyMode: (row.story_mode || 'fast') as StoryMode,
        textCostUsdMicros: Number(row.usage_text_cost_usd_micros ?? 0),
        imageCostUsdMicros: Number(row.usage_image_cost_usd_micros ?? 0),
        audioCostUsdMicros: Number(row.usage_audio_cost_usd_micros ?? 0),
        totalCostUsdMicros,
        creditsConsumed,
        profitUsdMicros: computeStoryProfitUsdMicros({
          deploymentCurrency,
          averageCreditValueMinor,
          creditsConsumed,
          costUsdMicros: totalCostUsdMicros,
        }),
      };
    }),
    page: params.page,
    pageSize: params.pageSize,
    totalCount: count ?? 0,
  };
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
  const deploymentCurrency = config.storyPackPricing?.currency ?? purchases[0]?.currency ?? 'usd';

  const metrics = storySummaries.reduce((acc, story) => {
    acc.costUsdMicros += story.usageTotals.costUsdMicros;
    acc.inputTokens += story.usageTotals.inputTokens;
    acc.outputTokens += story.usageTotals.outputTokens;
    acc.totalTokens += story.usageTotals.totalTokens;
    return acc;
  }, {
    revenueMinor: purchases
      .filter(purchase => purchase.status === 'completed' && purchase.currency === deploymentCurrency)
      .reduce((sum, purchase) => sum + purchase.amountMinor, 0),
    revenueCurrency: deploymentCurrency,
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
    averageCreditValueMinor: computeAverageCreditValueMinor(purchases, deploymentCurrency),
    revenueCurrency: deploymentCurrency,
    purchases: history.purchases,
    ledger: history.ledger,
    stories: storySummaries,
    metrics,
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [offers, webhookEvents, priceCatalog] = await Promise.all([
    listStoryPackOffers({ includeInactive: true }),
    listWebhookEvents(),
    loadModelPriceCatalog(),
  ]);

  return {
    offers,
    webhookEvents,
    modelPrices: priceCatalog.entries,
    priceCatalogStatus: priceCatalog.status,
  };
}
