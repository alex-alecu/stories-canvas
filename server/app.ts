import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import adminRouter from './routes/admin.js';
import { config } from './config.js';
import billingRouter, { billingWebhookRouter } from './routes/billing.js';
import storiesRouter from './routes/stories.js';
import userRouter from './routes/user.js';
import * as fsStorage from './utils/storage.js';
import * as sbStorage from './services/supabaseStorage.js';
import {
  buildRobotsTxt,
  buildSitemapXml,
  renderHtmlWithSeo,
  type SeoStorage,
} from './services/seo.js';

const LONG_LIVED_STATIC_ASSET = /^logo-(?:big|text)-\d+\.(?:avif|webp|png)$/;

export interface CreateAppOptions {
  distPath?: string;
  serveStatic?: boolean;
}

export const seoStorageOps: SeoStorage = {
  getStory: async (storyId: string) => (
    config.useSupabase ? sbStorage.getStory(storyId) : fsStorage.getStory(storyId)
  ),
  listPublicStories: async (limit: number) => {
    if (config.useSupabase) {
      return sbStorage.listPublicStories(undefined, limit);
    }

    const stories = await fsStorage.listStories(limit);
    return stories.filter(story => story.isPublic === true && story.status === 'completed');
  },
};

export function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  const fileName = path.basename(filePath);

  if (fileName.endsWith('.avif')) {
    res.setHeader('Content-Type', 'image/avif');
  }

  if (fileName === 'service-worker.js' || fileName === 'index.html') {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }

  if (
    filePath.includes(`${path.sep}assets${path.sep}`)
    || filePath.includes(`${path.sep}fonts${path.sep}`)
    || LONG_LIVED_STATIC_ASSET.test(fileName)
  ) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookRouter);
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' && !/^\/stories\/[^/]+\/(images|audio)\//.test(req.path)) {
      res.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
      res.vary('Authorization');
    }
    next();
  });

  app.use('/api/admin', adminRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/stories', storiesRouter);
  app.use('/api/user', userRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
    res.send(buildRobotsTxt());
  });

  app.get('/sitemap.xml', async (_req, res) => {
    try {
      res.type('application/xml').setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
      res.send(await buildSitemapXml(seoStorageOps));
    } catch (error) {
      console.error('Failed to build sitemap:', error);
      res.status(500).type('text/plain').send('Failed to build sitemap');
    }
  });

  const shouldServeStatic = options.serveStatic ?? process.env.NODE_ENV === 'production';
  if (shouldServeStatic) {
    const distPath = options.distPath ?? path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: setStaticCacheHeaders,
    }));
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }

      try {
        const indexHtml = await fs.readFile(path.join(distPath, 'index.html'), 'utf8');
        res.setHeader('Cache-Control', 'no-cache');
        res.type('html').send(await renderHtmlWithSeo(indexHtml, req.path, seoStorageOps));
      } catch (error) {
        next(error);
      }
    });
  }

  return app;
}
