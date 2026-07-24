import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GEMINI_API_KEY ??= 'test-key';

const { computeAverageCreditValueMinor, computeStoryProfitUsdMicros } = await import('./adminStorage.js');
const { parseAdminPagination } = await import('../routes/admin.js');

test('admin pagination defaults to 25 and accepts only supported sizes', () => {
  assert.deepEqual(parseAdminPagination(undefined, undefined), { page: 1, pageSize: 25 });
  assert.deepEqual(parseAdminPagination('2', '10'), { page: 2, pageSize: 10 });
  assert.deepEqual(parseAdminPagination('3', '50'), { page: 3, pageSize: 50 });
  assert.equal(parseAdminPagination('0', '25'), null);
  assert.equal(parseAdminPagination('1', '20'), null);
});

test('average credit value includes completed deployment-currency purchases only', () => {
  const value = computeAverageCreditValueMinor([
    { status: 'completed', amountMinor: 1299, currency: 'usd', creditsGranted: 5 },
    { status: 'completed', amountMinor: 2799, currency: 'usd', creditsGranted: 12 },
    { status: 'failed', amountMinor: 4299, currency: 'usd', creditsGranted: 20 },
    { status: 'completed', amountMinor: 3900, currency: 'ron', creditsGranted: 5 },
  ], 'usd');
  assert.equal(value, 4098 / 17);
  assert.equal(computeAverageCreditValueMinor([], 'usd'), null);
});

test('story profit uses gross consumed credits and is unavailable without USD purchase value', () => {
  assert.equal(computeStoryProfitUsdMicros({
    deploymentCurrency: 'usd',
    averageCreditValueMinor: 250,
    creditsConsumed: 3,
    costUsdMicros: 500_000,
  }), 7_000_000);
  assert.equal(computeStoryProfitUsdMicros({
    deploymentCurrency: 'ron',
    averageCreditValueMinor: 250,
    creditsConsumed: 3,
    costUsdMicros: 500_000,
  }), null);
  assert.equal(computeStoryProfitUsdMicros({
    deploymentCurrency: 'usd',
    averageCreditValueMinor: null,
    creditsConsumed: 3,
    costUsdMicros: 500_000,
  }), null);
});
