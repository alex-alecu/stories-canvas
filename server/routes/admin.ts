import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { grantCredits, updateStoryPackOffer } from '../services/billingStorage.js';
import { getAdminOverview, getAdminUserDetail, listAdminStories, searchUsersPage } from '../services/adminStorage.js';
import { refreshModelPriceCatalog } from '../services/modelPriceCatalog.js';
import type { StoryPackOffer } from '../../shared/types.js';

const router = Router();

const OFFER_SLUGS = new Set<StoryPackOffer['slug']>(['pack_5', 'pack_12', 'pack_20']);
const PAGE_SIZES = new Set([10, 25, 50]);
const STORY_TYPES = new Set(['all', 'fast', 'pro', 'pro_audio']);

export function parseAdminPagination(
  pageRaw: unknown,
  sizeRaw: unknown,
): { page: number; pageSize: number } | null {
  const page = typeof pageRaw === 'string' ? Number(pageRaw) : 1;
  const pageSize = typeof sizeRaw === 'string' ? Number(sizeRaw) : 25;
  if (!Number.isInteger(page) || page < 1 || !PAGE_SIZES.has(pageSize)) return null;
  return { page, pageSize };
}

function parsePageParams(req: Request): { page: number; pageSize: number } | null {
  return parseAdminPagination(req.query.page, req.query.size);
}

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
    const pagination = parsePageParams(req);
    if (!pagination) {
      res.status(400).json({ error: 'page must be positive and size must be 10, 25, or 50' });
      return;
    }
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const users = await searchUsersPage({ query, ...pagination });
    res.json(users);
  } catch (error) {
    console.error('Failed to search users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/stories', requireAdmin, async (req: Request, res: Response) => {
  try {
    const pagination = parsePageParams(req);
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    if (!pagination || !STORY_TYPES.has(type)) {
      res.status(400).json({ error: 'Invalid page, size, or story type' });
      return;
    }
    const result = await listAdminStories({
      query: typeof req.query.q === 'string' ? req.query.q : '',
      type: type as 'all' | 'fast' | 'pro' | 'pro_audio',
      ...pagination,
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to list admin stories:', error);
    res.status(500).json({ error: 'Failed to list admin stories' });
  }
});

router.post('/prices/refresh', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await refreshModelPriceCatalog({ force: true });
    res.json(await getAdminOverview());
  } catch (error) {
    console.error('Failed to refresh model prices:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to refresh model prices' });
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

    if (typeof priceMinor !== 'number' || !Number.isSafeInteger(priceMinor) || priceMinor <= 0) {
      res.status(400).json({ error: 'priceMinor must be a positive integer' });
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

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) {
      res.status(400).json({ error: 'Enter a positive USD amount with at most two decimal places.' });
      return;
    }

    const result = await grantCredits(String(req.params.userId), amount, {
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
