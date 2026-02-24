import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { optionalAuth } from '../middleware/auth.js';
import { getSupabase } from '../services/supabase.js';

const router = Router();

const VALID_LANGUAGES = new Set([
  'ro', 'de', 'es', 'en', 'fr', 'it', 'pt', 'nl', 'hu', 'pl', 'cs', 'sk', 'sv', 'no', 'da', 'fi', 'ja', 'zh', 'ko',
]);

// GET /api/user/preferences - Get user preferences
router.get('/preferences', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.useSupabase) {
      res.json({ language: 'ro' });
      return;
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_preferences')
      .select('language')
      .eq('user_id', req.authUser.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      throw error;
    }

    res.json({ language: data?.language ?? 'ro' });
  } catch (error) {
    console.error('Failed to get user preferences:', error);
    res.status(500).json({ error: 'Failed to get user preferences' });
  }
});

// PUT /api/user/preferences - Set user preferences
router.put('/preferences', optionalAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { language } = req.body as { language?: string };

    if (!language || !VALID_LANGUAGES.has(language)) {
      res.status(400).json({ error: 'Invalid language' });
      return;
    }

    if (!config.useSupabase) {
      res.json({ language });
      return;
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: req.authUser.id,
        language,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) throw error;

    res.json({ language });
  } catch (error) {
    console.error('Failed to update user preferences:', error);
    res.status(500).json({ error: 'Failed to update user preferences' });
  }
});

export default router;
