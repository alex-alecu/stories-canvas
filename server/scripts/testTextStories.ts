import { existsSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseTextModelSettings } from '../../shared/textModels.js';
import type { TextUsageEvent } from '../services/openrouter.js';

const { values } = parseArgs({ options: {
  case: { type: 'string' }, budget: { type: 'string', default: '2' }, minutes: { type: 'string', default: '12' },
} });
const budgetUsd = Number(values.budget);
const minutes = Number(values.minutes);
if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || !Number.isFinite(minutes) || minutes <= 0) {
  throw new Error('The test budget and time limit must be positive numbers.');
}

if (!process.env.OPENROUTER_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is required for live text tests.');
// These tests do not use production storage, account balances, images, audio, or alerts.
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SLACK_WEBHOOK_URL']) delete process.env[key];
const { generateStoryScriptWithAgents } = await import('../services/storyAgent.js');
const { withTextModelSettings } = await import('../services/textGenerationContext.js');
const outputDir = path.resolve('artifacts/text-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });

const cases = [
  { name: 'romanian-bedtime', model: 'google/gemini-3.8-flash', language: 'ro', age: 4,
    prompt: 'Mara se teme de întuneric. Bunica o ascultă și o ajută să aleagă o lumină de veghe. Mara poate încă să simtă teamă. Ultima propoziție trebuie să fie exact: Sunt în siguranță și pot cere ajutor.' },
  { name: 'english-cause-and-effect', model: 'openai/gpt-6-astra', language: 'en', age: 6,
    prompt: 'Ollie the otter loses a borrowed red cup beside a stream. His first plan fails. He tells the truth, asks his friend Pip for help, and repairs his mistake. Use a clear chain of causes. No magic.' },
  { name: 'romanian-retelling', model: 'anthropic/claude-fable-5.1', language: 'ro', age: 7,
    prompt: 'Creează povestea lui Greuceanu cât mai aproape de original. Păstrează cauza plecării, personajele, ordinea evenimentelor și finalul. Adaptează pericolul pentru un copil de 7 ani.' },
  { name: 'romanian-cooperation', model: 'anthropic/claude-fable-5.1', language: 'ro', age: 7,
    prompt: 'Iris și Luca construiesc o căsuță pentru păsări în grădină. Primul lor plan nu merge. Iris recunoaște o greșeală, îi cere ajutorul lui Luca, iar cei doi repară căsuța împreună. Fără magie. Arată clar cauza și rezultatul fiecărei alegeri.' },
];
const summary: Record<string, unknown>[] = [];
const selectedCases = cases.filter(entry => !values.case || entry.name === values.case);
if (!selectedCases.length) throw new Error('Unknown story test case.');
const originalFetch = globalThis.fetch;
for (const entry of selectedCases) {
  let costUsdMicros = 0;
  let requests = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Live story test exceeded ${minutes} minutes.`)), minutes * 60_000);
  const started = Date.now();
  let calls = 0;
  // Save only text request/response bodies. Never save authorization headers.
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, init);
    const call = ++calls;
    if (typeof init?.body === 'string') {
      await writeFile(path.join(outputDir, `${entry.name}-${call}-request.json`), init.body);
    }
    const response = await originalFetch(url, init);
    await writeFile(path.join(outputDir, `${entry.name}-${call}-response.json`), await response.clone().text());
    return response;
  };
  const record = async (usage: TextUsageEvent | Omit<TextUsageEvent, 'usageAvailable'>) => {
    requests++;
    await appendFile(path.join(outputDir, `${entry.name}-usage.jsonl`), JSON.stringify(usage) + '\n');
    const cost = usage.usageDetails.providerCostUsd;
    if (typeof cost !== 'number') throw new Error(typeof usage.usageDetails.error === 'string'
      ? usage.usageDetails.error : 'A live request has no confirmed cost.');
    costUsdMicros += Math.round(cost * 1_000_000);
    if (costUsdMicros >= budgetUsd * 1_000_000) {
      controller.abort(new Error(`Live story test reached its $${budgetUsd} request-cost limit.`));
      controller.signal.throwIfAborted();
    }
  };
  console.log(`Running ${entry.name} with ${entry.model}`);
  try {
    const result = await withTextModelSettings(parseTextModelSettings(entry.model, 'medium'), () => generateStoryScriptWithAgents(
      entry.prompt, entry.language, entry.age, 'storybook',
      update => console.log(`${entry.name}: ${update.message}`),
      { onSourceAnalysisUsage: record, onDraftUsage: record, onReviewUsage: record, onRewriteUsage: record },
      {}, controller.signal,
    ));
    await writeFile(path.join(outputDir, `${entry.name}.json`), JSON.stringify(result, null, 2));
    summary.push({ name: entry.name, model: entry.model, status: 'passed', pages: result.scenario.pages.length,
      requests, costUsd: costUsdMicros / 1_000_000, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    summary.push({ name: entry.name, model: entry.model, status: 'failed', requests, costUsd: costUsdMicros / 1_000_000,
      error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally { clearTimeout(timer); globalThis.fetch = originalFetch; }
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.at(-1)));
}
console.log(`Text test results: ${outputDir}`);
