import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import storiesRouter from './routes/stories.js';
import userRouter from './routes/user.js';
import { runRecoveryPass } from './services/recoveryRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json());
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && !/^\/stories\/[^/]+\/(images|audio)\//.test(req.path)) {
    res.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
    res.vary('Authorization');
  }
  next();
});

// API routes
app.use('/api/stories', storiesRouter);
app.use('/api/user', userRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In production, serve static files from Vite build
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`Stories Canvas server running on http://localhost:${config.port}`);
  console.log(`  Scenario model: ${config.scenarioModel}`);
  console.log(`  Image model: ${config.imageModel}`);
  console.log(`  Image model (pro): ${config.imageModelPro}`);
  console.log(`  Image concurrency: ${config.imageConcurrency}`);

  // Recover stories stuck in generating states from a previous crash/restart
  if (config.useSupabase) {
    void runRecoveryPass('startup');

    // Periodic watchdog: recover stories that get stuck during normal operation
    setInterval(() => {
      void runRecoveryPass('watchdog');
    }, 5 * 60 * 1000);
  }
});
