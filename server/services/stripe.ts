import type { Request } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import type { BillingCheckoutMarketingPayload, StoryPackOffer } from '../../shared/types.js';
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

type CheckoutMarketingContext = BillingCheckoutMarketingPayload & {
  clientIp?: string;
  userAgent?: string;
};

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

function compactMetadataValue(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function buildMarketingMetadata(marketing: CheckoutMarketingContext | undefined): Record<string, string> {
  if (!marketing) return {};

  const attribution = marketing.attribution ?? {};
  const entries: Record<string, string | undefined> = {
    marketingConsent: marketing.consent?.marketing ? 'granted' : 'denied',
    marketingConsentAt: compactMetadataValue(marketing.consent?.decidedAt, 100),
    marketingEventId: compactMetadataValue(marketing.eventId, 120),
    utmSource: compactMetadataValue(attribution.utmSource, 255),
    utmMedium: compactMetadataValue(attribution.utmMedium, 255),
    utmCampaign: compactMetadataValue(attribution.utmCampaign, 255),
    utmTerm: compactMetadataValue(attribution.utmTerm, 255),
    utmContent: compactMetadataValue(attribution.utmContent, 255),
    gclid: compactMetadataValue(attribution.gclid, 255),
    gbraid: compactMetadataValue(attribution.gbraid, 255),
    wbraid: compactMetadataValue(attribution.wbraid, 255),
    fbclid: compactMetadataValue(attribution.fbclid, 255),
    ttclid: compactMetadataValue(attribution.ttclid, 255),
    landingPage: compactMetadataValue(attribution.landingPage, 500),
    referrer: compactMetadataValue(attribution.referrer, 500),
    clientIp: compactMetadataValue(marketing.clientIp, 120),
    userAgent: compactMetadataValue(marketing.userAgent, 500),
  };

  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function createStoryPackCheckoutSession(params: {
  req: Request;
  userId: string;
  email?: string;
  offer: StoryPackOffer;
  marketing?: CheckoutMarketingContext;
}): Promise<{ checkoutUrl: string; checkoutSessionId: string }> {
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(params.userId, params.email);
  const baseUrl = resolveAppBaseUrl(params.req);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: params.userId,
    success_url: `${baseUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing?checkout=cancelled`,
    metadata: {
      userId: params.userId,
      offerSlug: params.offer.slug,
      ...buildMarketingMetadata(params.marketing),
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
