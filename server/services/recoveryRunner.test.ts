import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

function createLogger() {
  const entries = {
    error: [] as string[],
    log: [] as string[],
    warn: [] as string[],
  };

  return {
    entries,
    logger: {
      error: (...args: unknown[]) => {
        entries.error.push(args.map(String).join(' '));
      },
      log: (...args: unknown[]) => {
        entries.log.push(args.map(String).join(' '));
      },
      warn: (...args: unknown[]) => {
        entries.warn.push(args.map(String).join(' '));
      },
    },
  };
}

test('runRecoveryPass warns and skips transient dependency failures', async () => {
  const { runRecoveryPass } = await import('./recoveryRunner.js');
  const { TransientDependencyError } = await import('./supabaseStorage.js');
  const { entries, logger } = createLogger();

  const recoveredCount = await runRecoveryPass(
    'watchdog',
    async () => {
      throw new TransientDependencyError(
        'Supabase',
        'active generation lookup',
        'upstream bad gateway',
        { status: 502 },
      );
    },
    logger,
  );

  assert.equal(recoveredCount, 0);
  assert.equal(entries.error.length, 0);
  assert.equal(entries.warn.length, 1);
  assert.match(entries.warn[0], /\[recovery:watchdog\]/);
  assert.match(entries.warn[0], /Skipping this recovery cycle/);
});

test('runRecoveryPass keeps non-transient recovery failures logged as errors', async () => {
  const { runRecoveryPass } = await import('./recoveryRunner.js');
  const { entries, logger } = createLogger();

  const recoveredCount = await runRecoveryPass(
    'startup',
    async () => {
      throw new Error('invalid recovery state');
    },
    logger,
  );

  assert.equal(recoveredCount, 0);
  assert.equal(entries.warn.length, 0);
  assert.equal(entries.error.length, 1);
  assert.match(entries.error[0], /Failed to recover stuck stories:/);
  assert.match(entries.error[0], /invalid recovery state/);
});
