import { createClient } from '@supabase/supabase-js';
import {
  backfillCoverImageSources,
  createSupabaseCoverImageBackfillStore,
} from '../services/coverImageBackfill.js';

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  limit?: number;
  concurrency?: number;
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInteger('--limit', argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('--limit', arg.slice('--limit='.length));
    } else if (arg === '--concurrency') {
      options.concurrency = parsePositiveInteger('--concurrency', argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parsePositiveInteger('--concurrency', arg.slice('--concurrency='.length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const stats = await backfillCoverImageSources(
    createSupabaseCoverImageBackfillStore(supabase),
    {
      supabaseUrl,
      dryRun: options.dryRun,
      force: options.force,
      limit: options.limit,
      concurrency: options.concurrency,
    },
  );

  console.log('[cover-backfill] Complete');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(`[cover-backfill] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
