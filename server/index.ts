import { createApp } from './app.js';
import { config } from './config.js';
import { isGenerationActive } from './services/generationRegistry.js';
import { runRecoveryPass } from './services/recoveryRunner.js';
import { recoverStuckStories } from './services/supabaseStorage.js';
import { syncStoryPackPricingFromEnvironment } from './services/billingStorage.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Stories Canvas server running on http://localhost:${config.port}`);
  console.log(`  Scenario model: ${config.scenarioModel}`);
  console.log(`  Image model: ${config.imageModel}`);
  console.log(`  Image model (pro): ${config.imageModelPro}`);
  console.log(`  Image concurrency: ${config.imageConcurrency}`);

  // Recover stories stuck in generating states from a previous crash/restart
  if (config.useSupabase) {
    void syncStoryPackPricingFromEnvironment(config.storyPackPricing)
      .then(applied => {
        if (applied) console.log('  Applied environment story pack pricing');
      })
      .catch(error => console.error('Failed to sync environment story pack pricing:', error));

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
