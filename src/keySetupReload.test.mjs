import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadWhenRestarted } from './keySetupReload.js';

/** A fetch that answers from a script: an id, null for a refused request. */
function scripted(answers) {
  const calls = [];
  const doFetch = async (url) => {
    calls.push(url);
    const next = answers.shift();
    if (next === null) throw new TypeError('connection refused');
    return { ok: true, json: async () => ({ bootId: next }) };
  };
  return { doFetch, calls };
}

test('reloads once a new server configuration answers', async () => {
  // Old server, then down while it rebuilds, then the new one.
  const { doFetch, calls } = scripted(['old', null, null, 'new']);
  let reloads = 0;
  const reloaded = await reloadWhenRestarted({
    doFetch,
    bootId: 'old',
    reload: () => reloads++,
    pollMs: 1,
  });
  assert.equal(reloaded, true);
  assert.equal(reloads, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url === '/api/setup/status'));
});

test('gives up at the deadline and stops when the page goes away', async () => {
  let clock = 0;
  const stuck = await reloadWhenRestarted({
    doFetch: async () => {
      clock += 1000;
      throw new TypeError('down');
    },
    bootId: 'old',
    reload: () => assert.fail('must not reload'),
    pollMs: 1,
    now: () => clock,
    deadlineMs: 5000,
  });
  assert.equal(stuck, false);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await reloadWhenRestarted({
      doFetch: () => assert.fail('must not poll'),
      bootId: 'old',
      signal: controller.signal,
      reload: () => assert.fail('must not reload'),
    }),
    false,
  );
});
