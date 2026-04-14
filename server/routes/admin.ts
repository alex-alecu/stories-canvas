import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { grantCredits, updateStoryPackOffer } from '../services/billingStorage.js';
import { getAdminOverview, getAdminUserDetail, searchUsers } from '../services/adminStorage.js';
import type { StoryPackOffer } from '../../shared/types.js';

const router = Router();

const OFFER_SLUGS = new Set<StoryPackOffer['slug']>(['pack_5', 'pack_12', 'pack_20']);

router.get('/overview', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const overview = await getAdminOverview();
    res.json(overview);
  } catch (error) {
    console.error('Failed to load admin overview:', error);
    res.status(500).json({ error: 'Failed to load admin overview' });
  }
});

router.get('/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const users = await searchUsers(query);
    res.json(users);
  } catch (error) {
    console.error('Failed to search users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/users/:userId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const detail = await getAdminUserDetail(req.params.userId);
    if (!detail) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(detail);
  } catch (error) {
    console.error('Failed to load admin user detail:', error);
    res.status(500).json({ error: 'Failed to load admin user detail' });
  }
});

router.patch('/offers/:slug', requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as StoryPackOffer['slug'];
    if (!OFFER_SLUGS.has(slug)) {
      res.status(400).json({ error: 'Unknown offer slug' });
      return;
    }

    const { name, description, priceMinor, isActive } = req.body as {
      name?: string;
      description?: string;
      priceMinor?: number;
      isActive?: boolean;
    };

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedDescription = typeof description === 'string' ? description.trim() : '';

    if (!trimmedName) {
      res.status(400).json({ error: 'Offer name is required' });
      return;
    }

    if (!trimmedDescription) {
      res.status(400).json({ error: 'Offer description is required' });
      return;
    }

    if (!Number.isInteger(priceMinor) || (priceMinor ?? -1) < 0) {
      res.status(400).json({ error: 'priceMinor must be a non-negative integer' });
      return;
    }

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive must be a boolean' });
      return;
    }

    const offer = await updateStoryPackOffer(slug, {
      name: trimmedName,
      description: trimmedDescription,
      priceMinor,
      isActive,
    });

    res.json(offer);
  } catch (error) {
    console.error('Failed to update story pack offer:', error);
    res.status(500).json({ error: 'Failed to update story pack offer' });
  }
});

router.post('/users/:userId/credits', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { amount, note } = req.body as {
      amount?: number;
      note?: string;
    };

    if (!Number.isInteger(amount) || (amount ?? 0) <= 0) {
      res.status(400).json({ error: 'amount must be a positive integer' });
      return;
    }

    const result = await grantCredits(req.params.userId, amount, {
      reason: 'admin_grant',
      adminUserId: req.authUser?.id,
      note: typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined,
    });

    res.json({
      ledgerId: result.ledger_id,
      availableCredits: result.available_credits,
    });
  } catch (error) {
    console.error('Failed to grant credits:', error);
    res.status(500).json({ error: 'Failed to grant credits' });
  }
});

export default router;
