import assert from 'node:assert/strict';
import test from 'node:test';

const { resolveOpenRouterCost } = await import('./openrouterClient.js');

test('resolveOpenRouterCost retries a generation that is not ready', async () => {
  let calls = 0;
  const api = {
    get: async () => {
      calls++;
      if (calls === 1) throw { status: 404 };
      return { data: { total_cost: 0.00000186 } };
    },
  };

  assert.equal(await resolveOpenRouterCost(undefined, 'gen-delayed-cost', api as never), 0.00000186);
  assert.equal(calls, 2);
});

test('resolveOpenRouterCost does not retry an authentication failure', async () => {
  let calls = 0;
  const api = {
    get: async () => {
      calls++;
      throw { status: 401 };
    },
  };

  assert.equal(await resolveOpenRouterCost(undefined, 'gen-auth-failure', api as never), null);
  assert.equal(calls, 1);
});
