import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import type { BillingCheckoutMarketingPayload, MarketingAttribution, MarketingConsentState } from '../../shared/types.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createWebhookEvent,
  fulfillStoryPackPurchase,
  getBillingHistory,
  getBillingOverview,
  getStoryPackOffer,
  listStoryPackOffers,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '../services/billingStorage.js';
import {
  createStoryPackCheckoutSession,
  isStripeConfigured,
  verifyStripeWebhookEvent,
} from '../services/stripe.js';
import { sendPurchaseConversions } from '../services/marketingConversions.js';

const router = Router();
export const billingWebhookRouter = Router();
const FULFILLABLE_CHECKOUT_EVENTS = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

export const billingStorageOps = {
  createWebhookEvent,
  fulfillStoryPackPurchase,
  getBillingHistory,
  getBillingOverview,
  getStoryPackOffer,
  listStoryPackOffers,
  markWebhookEventFailed,
  markWebhookEventProcessed,
};

export const billingStripeOps = {
  createStoryPackCheckoutSession,
  isStripeConfigured,
  verifyStripeWebhookEvent,
};

export const billingMarketingOps = {
  sendPurchaseConversions,
};

const MARKETING_ATTRIBUTION_KEYS = [
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'ttclid',
  'landingPage',
  'referrer',
] as const satisfies ReadonlyArray<keyof MarketingAttribution>;

function compactString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function parseMarketingConsent(value: unknown): MarketingConsentState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.marketing !== 'boolean') return undefined;

  return {
    marketing: source.marketing,
    decidedAt: compactString(source.decidedAt, 100),
  };
}

function parseMarketingAttribution(value: unknown): MarketingAttribution | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const source = value as Record<string, unknown>;
  const attribution: MarketingAttribution = {};
  for (const key of MARKETING_ATTRIBUTION_KEYS) {
    const maxLength = key === 'landingPage' || key === 'referrer' ? 500 : 255;
    const compacted = compactString(source[key], maxLength);
    if (compacted) {
      attribution[key] = compacted;
    }
  }

  return Object.keys(attribution).length > 0 ? attribution : undefined;
}

function getClientIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim().slice(0, 120) || undefined;
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0]?.trim().slice(0, 120) || undefined;
  }

  return req.ip?.slice(0, 120);
}

function parseCheckoutMarketingPayload(req: Request): BillingCheckoutMarketingPayload & { clientIp?: string; userAgent?: string } {
  const source = req.body as Record<string, unknown>;

  return {
    consent: parseMarketingConsent(source.consent),
    attribution: parseMarketingAttribution(source.attribution),
    eventId: compactString(source.eventId, 120),
    clientIp: getClientIp(req),
    userAgent: compactString(req.get('user-agent'), 500),
  };
}

function getSessionEmail(session: Stripe.Checkout.Session): string | undefined {
  return session.customer_details?.email ?? undefined;
}

router.get('/offers', async (_req: Request, res: Response) => {
  try {
    if (!config.useSupabase) {
      res.json([]);
      return;
    }

    const offers = await billingStorageOps.listStoryPackOffers();
    res.json(offers);
  } catch (error) {
    console.error('Failed to load billing offers:', error);
    res.status(500).json({ error: 'Failed to load billing offers' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.useSupabase || !req.authUser) {
      res.json({
        balance: { availableCredits: 0 },
        offers: [],
        isAdmin: false,
      });
      return;
    }

    const overview = await billingStorageOps.getBillingOverview(req.authUser.id, !!req.authUser.isAdmin);
    res.json(overview);
  } catch (error) {
    console.error('Failed to load billing overview:', error);
    res.status(500).json({ error: 'Failed to load billing overview' });
  }
});

router.get('/history', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.useSupabase || !req.authUser) {
      res.json({ purchases: [], ledger: [] });
      return;
    }

    const history = await billingStorageOps.getBillingHistory(req.authUser.id);
    res.json(history);
  } catch (error) {
    console.error('Failed to load billing history:', error);
    res.status(500).json({ error: 'Failed to load billing history' });
  }
});

router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.useSupabase || !req.authUser) {
      res.status(503).json({ error: 'Billing requires Supabase storage' });
      return;
    }

    if (!billingStripeOps.isStripeConfigured()) {
      res.status(503).json({ error: 'Stripe checkout is not configured' });
      return;
    }

    const { offerSlug } = req.body as { offerSlug?: 'pack_5' | 'pack_12' | 'pack_20' };
    if (!offerSlug) {
      res.status(400).json({ error: 'offerSlug is required' });
      return;
    }

    const offer = await billingStorageOps.getStoryPackOffer(offerSlug);
    if (!offer) {
      res.status(404).json({ error: 'Offer not found or inactive' });
      return;
    }

    const session = await billingStripeOps.createStoryPackCheckoutSession({
      req,
      userId: req.authUser.id,
      email: req.authUser.email,
      offer,
      marketing: parseCheckoutMarketingPayload(req),
    });

    res.json({
      checkoutUrl: session.checkoutUrl,
      checkoutSessionId: session.checkoutSessionId,
    });
  } catch (error) {
    console.error('Failed to create checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

billingWebhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    if (!billingStripeOps.isStripeConfigured()) {
      res.status(503).json({ error: 'Stripe checkout is not configured' });
      return;
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Invalid Stripe webhook payload' });
      return;
    }

    const event = billingStripeOps.verifyStripeWebhookEvent(req.body, signature);
    await billingStorageOps.createWebhookEvent(event.id, event.type, event.data.object);

    if (FULFILLABLE_CHECKOUT_EVENTS.has(event.type)) {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const offerSlug = session.metadata?.offerSlug;

      if (!userId || !offerSlug) {
        throw new Error('Checkout session metadata is missing userId or offerSlug');
      }

      if (session.payment_status === 'paid') {
        const purchaseParams = {
          userId,
          offerSlug: offerSlug as 'pack_5' | 'pack_12' | 'pack_20',
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
          amountMinor: session.amount_total ?? 0,
          currency: typeof session.currency === 'string' ? session.currency : 'ron',
          metadata: session.metadata ?? {},
        };

        const fulfillment = await billingStorageOps.fulfillStoryPackPurchase(purchaseParams);

        if (!fulfillment.already_fulfilled) {
          try {
            await billingMarketingOps.sendPurchaseConversions({
              ...purchaseParams,
              email: getSessionEmail(session),
            });
          } catch (conversionError) {
            console.error('Failed to send marketing purchase conversions:', conversionError);
          }
        }
      }
    }

    await billingStorageOps.markWebhookEventProcessed(event.id);
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed:', error);

    if (error instanceof Error && 'type' in error && (error as { type?: string }).type === 'StripeSignatureVerificationError') {
      res.status(400).json({ error: error.message });
      return;
    }

    const eventId = (() => {
      try {
        const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) as { id?: string } : null;
        return body?.id;
      } catch {
        return undefined;
      }
    })();

    if (eventId) {
      try {
        await billingStorageOps.markWebhookEventFailed(eventId, error instanceof Error ? error.message : String(error));
      } catch (markError) {
        console.error('Failed to mark webhook event failed:', markError);
      }
    }

    res.status(500).json({ error: 'Stripe webhook processing failed' });
  }
});

export default router;
