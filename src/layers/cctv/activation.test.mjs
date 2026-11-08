import assert from 'node:assert/strict';
import test from 'node:test';

import { awaitPriorsBriefly, startActivationRequests } from './activation.js';
import { GROUND_PRIOR_INIT_WAIT_MS } from './policy.js';

test('ground priors and the health check start together, before either answers', () => {
  const started = [];
  const never = new Promise(() => {});
  const requests = startActivationRequests({
    catalog: [{ id: 'a' }],
    resolveGroundPriors: () => {
      started.push('priors');
      return never;
    },
    syncHealth: () => {
      started.push('health');
      return never;
    },
  });
  assert.deepEqual(started, ['priors', 'health']);
  assert.equal(requests.priors, never);
});

test('a failed health check never fails activation', async () => {
  const requests = startActivationRequests({
    catalog: [],
    resolveGroundPriors: async () => [],
    syncHealth: async () => {
      throw new Error('health down');
    },
  });
  await assert.doesNotReject(requests.health);
});

test('cameras wait for priors only briefly, then appear and take the priors late', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.ok(GROUND_PRIOR_INIT_WAIT_MS <= 1_000);
  const slow = new Promise(() => {});
  const waiting = awaitPriorsBriefly(slow, GROUND_PRIOR_INIT_WAIT_MS);
  t.mock.timers.tick(GROUND_PRIOR_INIT_WAIT_MS);
  assert.equal(await waiting, null);
  const warm = awaitPriorsBriefly(Promise.resolve(['prior']), 10_000);
  assert.deepEqual(await warm, ['prior']);
});
