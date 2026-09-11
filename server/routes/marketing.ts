import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { disconnectInstagram, finishInstagramConnection, getMarketingOverview, saveInstagramSetup,
  MarketingBusyError, runInstagramMarketing, saveMarketingSettings, startInstagramConnection } from '../services/marketing.js';
import { MarketingError, marketingStep, reportMarketingFailure, type MarketingTrace } from '../services/marketingDiagnostics.js';

const router = Router();
router.use(requireAdmin);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

async function failure(res: Response, error: unknown, trace: MarketingTrace, stage: string) {
  const detail = await reportMarketingFailure(trace, error, stage);
  res.status(error instanceof MarketingBusyError ? 409 : stage === 'Publish today' || detail.details.httpStatus ? 502 : 400)
    .json({ error: `${detail.stage}: ${detail.message}`,
      diagnostic: { runId: trace.runId, logId: detail.logId, stage: detail.stage, ...detail.details } });
}

function action(stage: string, work: (req: Request, trace: MarketingTrace) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const trace = { runId: randomUUID() };
    try {
      const result = await marketingStep(trace, stage, () => work(req, trace));
      res.json(result ?? await getMarketingOverview());
    } catch (error) { await failure(res, error, trace, stage); }
  };
}

router.get('/', async (_req, res) => {
  try { res.json(await getMarketingOverview()); }
  catch (error) { await failure(res, error, { runId: randomUUID() }, 'Load Marketing'); }
});

const setupSchema = z.object({
  appId: z.string().trim().regex(/^\d{3,30}$/),
  appSecret: z.string().trim().min(8).max(512).optional(),
  websiteUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  }).transform(value => new URL(value).origin),
}).strict();
router.put('/setup', action('Save Instagram setup', async req => {
  const value = setupSchema.safeParse(req.body);
  if (!value.success) throw new MarketingError('Save Instagram setup', 'Enter a numeric app ID, an app secret, and the public HTTPS website address without a path.');
  await saveInstagramSetup(value.data);
}));

const scheduleSchema = z.object({ enabled: z.boolean(), hourUtc: z.number().int().min(0).max(23) }).strict();
router.patch('/', action('Save schedule', async req => {
  const value = scheduleSchema.safeParse(req.body);
  if (!value.success) throw new MarketingError('Save schedule', 'Set a daily hour from 0 to 23 UTC and an enabled value.');
  await saveMarketingSettings(value.data.enabled, value.data.hourUtc);
}));

router.post('/connect', action('Start Instagram connection', async req => ({ url: await startInstagramConnection(req.authUser!.id) })));

const callbackSchema = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
router.post('/callback', action('Connect Instagram', async req => {
  if (req.body?.error === 'access_denied') throw new MarketingError('Instagram authorization', 'Instagram access was not granted. Connect again and allow the requested permissions.');
  const value = callbackSchema.safeParse(req.body);
  if (!value.success) throw new MarketingError('Check connection request', 'Invalid Instagram connection response. Connect again.');
  await finishInstagramConnection(req.authUser!.id, value.data.code, value.data.state);
}));

router.post('/disconnect', action('Disconnect Instagram', async () => { await disconnectInstagram(); }));
router.post('/run', action('Publish today', async (_req, trace) => { await runInstagramMarketing(true, trace); }));

export default router;
