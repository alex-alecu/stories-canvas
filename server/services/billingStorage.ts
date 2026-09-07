import { fromMicrodollars, toMicrodollars } from '../utils/money.js';
import { getSupabase } from './supabase.js';
import type { StoryPackPricingConfig } from '../config.js';
import type {
  BillingHistoryResponse,
  BillingOverview,
  BillingPurchase,
  CreditBalance,
  CreditLedgerEntry,
  StoryPackOffer,
} from '../../shared/types.js';

interface StoryPackOfferRow {
  slug: StoryPackOffer['slug'];
  name: string;
  description: string;
  amount_usd_micros: number | string;
  price_minor: number;
  currency: string;
  is_active: boolean;
}

interface CreditBalanceRow {
  balance_usd_micros: number | string;
}

interface CreditLedgerRow {
  id: string;
  amount_usd_micros: number | string;
  balance_after_usd_micros: number | string;
  reason: string;
  note: string | null;
  story_id: string | null;
  purchase_id: string | null;
  admin_user_id: string | null;
  created_at: string;
}

interface BillingPurchaseRow {
  id: string;
  offer_slug: StoryPackOffer['slug'];
  stripe_checkout_session_id: string;
  amount_minor: number;
  currency: string;
  credited_usd_micros: number | string;
  status: BillingPurchase['status'];
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
}

interface CreditRpcRow {
  ledger_id: string;
  available_credits: number;
}

interface RefundStoryCreditsRow {
  refunded: boolean;
  ledger_id: string | null;
  available_credits: number | null;
}

interface FulfillStoryPackPurchaseRow {
  purchase_id: string;
  ledger_id: string | null;
  already_fulfilled: boolean;
  available_credits: number | null;
}

type StoredWalletResult<T> = Omit<T, 'available_credits'> & { balance_usd_micros: number | string | null };

export class InsufficientCreditsError extends Error {
  constructor() {
    super('INSUFFICIENT_CREDITS');
    this.name = 'InsufficientCreditsError';
  }
}

export async function syncStoryPackPricingFromEnvironment(
  pricing: StoryPackPricingConfig | undefined,
): Promise<boolean> {
  if (!pricing) return false;

  const { data, error } = await getSupabase().rpc('apply_story_pack_environment_defaults', {
    p_fingerprint: pricing.fingerprint,
    p_currency: pricing.currency,
    p_pack_5_price_minor: pricing.pricesMinor.pack_5,
    p_pack_12_price_minor: pricing.pricesMinor.pack_12,
    p_pack_20_price_minor: pricing.pricesMinor.pack_20,
  });
  if (error) {
    throw new Error(`Failed to apply environment story pack pricing: ${error.message}`);
  }

  return data === true;
}

function rowToOffer(row: StoryPackOfferRow): StoryPackOffer {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    credits: fromMicrodollars(row.amount_usd_micros),
    priceMinor: row.price_minor,
    currency: row.currency,
    isActive: row.is_active,
  };
}

function rowToLedgerEntry(row: CreditLedgerRow): CreditLedgerEntry {
  return {
    id: row.id,
    delta: fromMicrodollars(row.amount_usd_micros),
    balanceAfter: fromMicrodollars(row.balance_after_usd_micros),
    reason: row.reason,
    note: row.note ?? undefined,
    storyId: row.story_id ?? undefined,
    purchaseId: row.purchase_id ?? undefined,
    adminUserId: row.admin_user_id ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToPurchase(row: BillingPurchaseRow): BillingPurchase {
  return {
    id: row.id,
    offerSlug: row.offer_slug,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    creditsGranted: fromMicrodollars(row.credited_usd_micros),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fulfilledAt: row.fulfilled_at ?? undefined,
  };
}


export async function listStoryPackOffers(options: { includeInactive?: boolean } = {}): Promise<StoryPackOffer[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('story_pack_offers')
    .select('slug, name, description, amount_usd_micros, price_minor, currency, is_active')
    .order('display_order', { ascending: true });

  if (!options.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list story pack offers: ${error.message}`);
  }

  return (data as StoryPackOfferRow[]).map(rowToOffer);
}

export async function getStoryPackOffer(
  slug: StoryPackOffer['slug'],
  options: { includeInactive?: boolean } = {},
): Promise<StoryPackOffer | null> {
  const supabase = getSupabase();
  let query = supabase
    .from('story_pack_offers')
    .select('slug, name, description, amount_usd_micros, price_minor, currency, is_active')
    .eq('slug', slug);

  if (!options.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to load story pack offer: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return rowToOffer(data as StoryPackOfferRow);
}

export async function getUserCreditBalance(userId: string): Promise<CreditBalance> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_credit_balances')
    .select('balance_usd_micros')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load credit balance: ${error.message}`);
  }

  return {
    availableCredits: fromMicrodollars(data?.balance_usd_micros ?? 0),
  };
}

export async function listCreditLedger(userId: string, limit = 25): Promise<CreditLedgerEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('id, amount_usd_micros, balance_after_usd_micros, reason, note, story_id, purchase_id, admin_user_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list credit ledger: ${error.message}`);
  }

  return (data as CreditLedgerRow[]).map(rowToLedgerEntry);
}

export async function listBillingPurchases(userId: string, limit?: number): Promise<BillingPurchase[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('billing_purchases')
    .select('id, offer_slug, stripe_checkout_session_id, amount_minor, currency, credited_usd_micros, status, created_at, updated_at, fulfilled_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (typeof limit === 'number') {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list billing purchases: ${error.message}`);
  }

  return (data as BillingPurchaseRow[]).map(rowToPurchase);
}

export async function createPendingStoryPackPurchase(params: {
  userId: string;
  offerSlug: StoryPackOffer['slug'];
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('billing_purchases')
    .upsert({
      user_id: params.userId,
      offer_slug: params.offerSlug,
      stripe_checkout_session_id: params.stripeCheckoutSessionId,
      stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
      stripe_customer_id: params.stripeCustomerId ?? null,
      amount_minor: params.amountMinor,
      currency: params.currency,
      credited_usd_micros: 0,
      status: 'pending',
      metadata: params.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'stripe_checkout_session_id',
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(`Failed to create pending purchase: ${error.message}`);
  }
}

async function markStoryPackPurchaseTerminal(params: {
  status: 'failed' | 'expired';
  userId: string;
  offerSlug: StoryPackOffer['slug'];
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const insertPayload = {
    user_id: params.userId,
    offer_slug: params.offerSlug,
    stripe_checkout_session_id: params.stripeCheckoutSessionId,
    stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
    stripe_customer_id: params.stripeCustomerId ?? null,
    amount_minor: params.amountMinor,
    currency: params.currency,
    credited_usd_micros: 0,
    status: params.status,
    metadata: params.metadata ?? {},
    updated_at: now,
  };

  const { error: insertError } = await supabase
    .from('billing_purchases')
    .upsert(insertPayload, {
      onConflict: 'stripe_checkout_session_id',
      ignoreDuplicates: true,
    });

  if (insertError) {
    throw new Error(`Failed to create ${params.status} purchase: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from('billing_purchases')
    .update({
      user_id: params.userId,
      offer_slug: params.offerSlug,
      stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
      stripe_customer_id: params.stripeCustomerId ?? null,
      amount_minor: params.amountMinor,
      currency: params.currency,
      credited_usd_micros: 0,
      status: params.status,
      metadata: params.metadata ?? {},
      updated_at: now,
    })
    .eq('stripe_checkout_session_id', params.stripeCheckoutSessionId)
    .neq('status', 'completed');

  if (updateError) {
    throw new Error(`Failed to mark purchase ${params.status}: ${updateError.message}`);
  }
}

export async function markStoryPackPurchaseFailed(params: Omit<Parameters<typeof markStoryPackPurchaseTerminal>[0], 'status'>): Promise<void> {
  await markStoryPackPurchaseTerminal({ ...params, status: 'failed' });
}

export async function markStoryPackPurchaseExpired(params: Omit<Parameters<typeof markStoryPackPurchaseTerminal>[0], 'status'>): Promise<void> {
  await markStoryPackPurchaseTerminal({ ...params, status: 'expired' });
}

export async function getBillingOverview(userId: string, isAdmin: boolean): Promise<BillingOverview> {
  const [balance, offers] = await Promise.all([
    getUserCreditBalance(userId),
    listStoryPackOffers(),
  ]);

  return {
    balance,
    offers,
    isAdmin,
  };
}

export async function getBillingHistory(userId: string): Promise<BillingHistoryResponse> {
  const [purchases, ledger] = await Promise.all([
    listBillingPurchases(userId, 25),
    listCreditLedger(userId),
  ]);

  return {
    purchases,
    ledger,
  };
}

export async function grantCredits(
  userId: string,
  amount: number,
  params: {
    reason: string;
    storyId?: string;
    purchaseId?: string;
    adminUserId?: string;
    note?: string;
  },
): Promise<CreditRpcRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('grant_credits', {
    p_user_id: userId,
    p_amount_usd_micros: toMicrodollars(amount),
    p_reason: params.reason,
    p_story_id: params.storyId ?? null,
    p_purchase_id: params.purchaseId ?? null,
    p_admin_user_id: params.adminUserId ?? null,
    p_note: params.note ?? null,
  });

  if (error) {
    throw new Error(`Failed to grant credits: ${error.message}`);
  }

  const [row] = (data ?? []) as StoredWalletResult<CreditRpcRow>[];
  if (!row) {
    throw new Error('Credit grant did not return a result');
  }

  return { ledger_id: row.ledger_id, available_credits: fromMicrodollars(row.balance_usd_micros) };
}

export async function consumeCredits(
  userId: string,
  amount: number,
  params: {
    reason: string;
    storyId?: string;
    note?: string;
  },
): Promise<CreditRpcRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('consume_credits', {
    p_user_id: userId,
    p_amount_usd_micros: toMicrodollars(amount),
    p_reason: params.reason,
    p_story_id: params.storyId ?? null,
    p_note: params.note ?? null,
  });

  if (error) {
    if (error.message.includes('INSUFFICIENT_CREDITS')) {
      throw new InsufficientCreditsError();
    }

    throw new Error(`Failed to consume credits: ${error.message}`);
  }

  const [row] = (data ?? []) as StoredWalletResult<CreditRpcRow>[];
  if (!row) {
    throw new Error('Credit consumption did not return a result');
  }

  return { ledger_id: row.ledger_id, available_credits: fromMicrodollars(row.balance_usd_micros) };
}

export async function refundStoryCredits(storyId: string, note?: string): Promise<RefundStoryCreditsRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('refund_story_credits', {
    p_story_id: storyId,
    p_note: note ?? null,
  });

  if (error) {
    throw new Error(`Failed to refund story credits: ${error.message}`);
  }

  const [row] = (data ?? []) as StoredWalletResult<RefundStoryCreditsRow>[];
  return row
    ? { refunded: row.refunded, ledger_id: row.ledger_id, available_credits: row.balance_usd_micros === null ? null : fromMicrodollars(row.balance_usd_micros) }
    : { refunded: false, ledger_id: null, available_credits: null };
}

export async function getBillingCustomer(userId: string): Promise<{ stripeCustomerId: string } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load billing customer: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    stripeCustomerId: data.stripe_customer_id,
  };
}

export async function upsertBillingCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('billing_customers')
    .upsert({
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    throw new Error(`Failed to upsert billing customer: ${error.message}`);
  }
}

export async function createWebhookEvent(eventId: string, eventType: string, payload: unknown): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('billing_webhook_events')
    .upsert({
      stripe_event_id: eventId,
      event_type: eventType,
      status: 'processing',
      payload: payload ?? {},
      error_message: null,
      processed_at: null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'stripe_event_id',
    });

  if (error) {
    throw new Error(`Failed to create webhook event: ${error.message}`);
  }
}

export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('billing_webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_event_id', eventId);

  if (error) {
    throw new Error(`Failed to mark webhook event processed: ${error.message}`);
  }
}

export async function markWebhookEventFailed(eventId: string, errorMessage: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('billing_webhook_events')
    .update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_event_id', eventId);

  if (error) {
    throw new Error(`Failed to mark webhook event failed: ${error.message}`);
  }
}

export async function fulfillStoryPackPurchase(params: {
  userId: string;
  offerSlug: StoryPackOffer['slug'];
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<FulfillStoryPackPurchaseRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fulfill_story_pack_purchase', {
    p_user_id: params.userId,
    p_offer_slug: params.offerSlug,
    p_stripe_checkout_session_id: params.stripeCheckoutSessionId,
    p_stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
    p_stripe_customer_id: params.stripeCustomerId ?? null,
    p_amount_minor: params.amountMinor,
    p_currency: params.currency,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    throw new Error(`Failed to fulfill story pack purchase: ${error.message}`);
  }

  const [row] = (data ?? []) as StoredWalletResult<FulfillStoryPackPurchaseRow>[];
  if (!row) {
    throw new Error('Purchase fulfillment did not return a result');
  }

  return {
    purchase_id: row.purchase_id, ledger_id: row.ledger_id, already_fulfilled: row.already_fulfilled,
    available_credits: row.balance_usd_micros === null ? null : fromMicrodollars(row.balance_usd_micros),
  };
}

export async function updateStoryPackOffer(
  slug: StoryPackOffer['slug'],
  updates: {
    name: string;
    description: string;
    priceMinor: number;
    isActive: boolean;
  },
): Promise<StoryPackOffer> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('story_pack_offers')
    .update({
      name: updates.name,
      description: updates.description,
      price_minor: updates.priceMinor,
      amount_usd_micros: toMicrodollars(updates.priceMinor / 100),
      is_active: updates.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('slug', slug)
    .select('slug, name, description, amount_usd_micros, price_minor, currency, is_active')
    .single();

  if (error) {
    throw new Error(`Failed to update story pack offer: ${error.message}`);
  }

  return rowToOffer(data as StoryPackOfferRow);
}

export async function listWebhookEvents(limit = 25): Promise<Array<{
  stripeEventId: string;
  eventType: string;
  status: 'processing' | 'processed' | 'failed';
  errorMessage?: string;
  createdAt: string;
  processedAt?: string;
}>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('billing_webhook_events')
    .select('stripe_event_id, event_type, status, error_message, created_at, processed_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list webhook events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    stripeEventId: row.stripe_event_id,
    eventType: row.event_type,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    processedAt: row.processed_at ?? undefined,
  }));
}
