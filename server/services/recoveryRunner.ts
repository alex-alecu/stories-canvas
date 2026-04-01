import { recoverStuckStories, isTransientDependencyError } from './supabaseStorage.js';

export interface RecoveryLogger {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export async function runRecoveryPass(
  source: 'startup' | 'watchdog',
  recover: () => Promise<number> = recoverStuckStories,
  logger: RecoveryLogger = console,
): Promise<number> {
  try {
    const recoveredCount = await recover();
    if (recoveredCount > 0) {
      logger.log(`Recovered ${recoveredCount} stuck story(ies)`);
    }
    return recoveredCount;
  } catch (error) {
    if (isTransientDependencyError(error)) {
      logger.warn(`[recovery:${source}] ${error.message}. Skipping this recovery cycle.`);
      return 0;
    }

    if (source === 'startup') {
      logger.error('Failed to recover stuck stories:', error);
    } else {
      logger.error('Watchdog recovery failed:', error);
    }

    return 0;
  }
}
