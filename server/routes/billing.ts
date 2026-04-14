import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getBillingHistory,
  getBillingOverview,
  listStoryPackOffers,
} from '../services/billingStorage.js';

const router = Router();

router.get('/offers', async (_req: Request, res: Response) => {
  try {
    if (!config.useSupabase) {
      res.json([]);
      return;
    }

    const offers = await listStoryPackOffers();
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

    const overview = await getBillingOverview(req.authUser.id, !!req.authUser.isAdmin);
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

    const history = await getBillingHistory(req.authUser.id);
    res.json(history);
  } catch (error) {
    console.error('Failed to load billing history:', error);
    res.status(500).json({ error: 'Failed to load billing history' });
  }
});

export default router;
