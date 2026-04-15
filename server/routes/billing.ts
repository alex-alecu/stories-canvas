import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
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
        await billingStorageOps.fulfillStoryPackPurchase({
          userId,
          offerSlug: offerSlug as 'pack_5' | 'pack_12' | 'pack_20',
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
          amountMinor: session.amount_total ?? 0,
          currency: 'ron',
          metadata: session.metadata ?? {},
        });
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
