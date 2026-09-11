import { createApp } from './app.js';
import { config } from './config.js';
import { isGenerationActive } from './services/generationRegistry.js';
import { runRecoveryPass } from './services/recoveryRunner.js';
import { recoverStuckStories } from './services/supabaseStorage.js';
import { refreshModelPriceCatalog } from './services/modelPriceCatalog.js';
import { runInstagramMarketing } from './services/marketing.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Stories Canvas server running on http://localhost:${config.port}`);
  console.log(`  OpenRouter default text model: ${config.scenarioModel}`);
  console.log(`  Image concurrency: ${config.imageConcurrency}`);

  // Recover stories stuck in generating states from a previous crash/restart
  if (config.useSupabase) {
    const runMarketing = () => runInstagramMarketing()
      .catch(() => { /* The runner records the stage and failure in the server and activity logs. */ });
    void runMarketing();
    setInterval(() => void runMarketing(), 60_000);
    const refreshPrices = () => refreshModelPriceCatalog()
      .catch(error => console.error('Failed to refresh model price catalog:', error));
    void refreshPrices();
    setInterval(() => void refreshPrices(), 60 * 60 * 1000);

    void runRecoveryPass(
      'startup',
      () => recoverStuckStories({ isGenerationActive }),
    );

    // Periodic watchdog: recover stories that get stuck during normal operation
    setInterval(() => {
      void runRecoveryPass(
        'watchdog',
        () => recoverStuckStories({ isGenerationActive }),
      );
    }, 5 * 60 * 1000);
  }
});
