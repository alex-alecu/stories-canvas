import type { Request } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import type { StoryPackOffer } from '../../shared/types.js';
import { getBillingCustomer, upsertBillingCustomer } from './billingStorage.js';

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!config.stripeSecretKey;
}

export function getStripe(): Stripe {
  if (!config.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey);
  }

  return stripeClient;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export function resolveAppBaseUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

  if (origin) {
    return normalizeBaseUrl(origin) ?? config.appBaseUrl;
  }

  if (typeof host === 'string' && host) {
    const protocol = typeof forwardedProto === 'string' && forwardedProto
      ? forwardedProto.split(',')[0]
      : req.protocol;

    return `${protocol}://${host}`;
  }

  return config.appBaseUrl;
}

export async function getOrCreateStripeCustomer(userId: string, email: string | undefined): Promise<string> {
  const existing = await getBillingCustomer(userId);
  if (existing) {
    return existing.stripeCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });

  await upsertBillingCustomer(userId, customer.id);
  return customer.id;
}

export async function createStoryPackCheckoutSession(params: {
  req: Request;
  userId: string;
  email?: string;
  offer: StoryPackOffer;
}): Promise<{ checkoutUrl: string; checkoutSessionId: string }> {
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(params.userId, params.email);
  const baseUrl = resolveAppBaseUrl(params.req);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: params.userId,
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/billing?checkout=cancelled`,
    metadata: {
      userId: params.userId,
      offerSlug: params.offer.slug,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.offer.currency,
          unit_amount: params.offer.priceMinor,
          product_data: {
            name: params.offer.name,
            description: params.offer.description,
          },
        },
      },
    ],
  });

  if (!session.url) {
    throw new Error('Stripe checkout session did not return a URL');
  }

  return {
    checkoutUrl: session.url,
    checkoutSessionId: session.id,
  };
}

export function verifyStripeWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
  if (!config.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  return getStripe().webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
}
