// The Free-only status list says what the server does: every provider it
// calls blocked is stopped, and a provider whose optional token is only
// ignored (Launch Library 2) is reported as paused, not blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FREE_ONLY_STATUS } from './free-only-status.js';
import { freeOnlyBrowserKeys, freeOnlyCapability } from './free-only.js';
import { KEY_SETUP_KEYS } from '../../src/keySetupCore.mjs';

/** How Free-only stops each provider it lists as blocked. */
const BLOCKING_EVIDENCE = Object.freeze({
  'google-maps': () =>
    freeOnlyCapability('/api/google/text-search') === 'google-maps' &&
    freeOnlyBrowserKeys({ GOOGLE_MAPS_API_KEY: 'saved' }).googleApiKey ===
      undefined,
  // The server key is only spent behind /api/google, which is denied.
  'google-maps-server': () =>
    freeOnlyCapability('/api/google/nearby-places') === 'google-maps',
  'cesium-ion': () =>
    freeOnlyBrowserKeys({ CESIUM_ION_TOKEN: 'saved' }).cesiumToken ===
    undefined,
  openai: () => freeOnlyCapability('/api/openai/chat') === 'openai',
  gemini: () => freeOnlyCapability('/api/gemini/chat') === 'gemini',
  tomtom: () => freeOnlyCapability('/api/tomtom/flow') === 'tomtom',
  opensky: () => freeOnlyCapability('/api/flights/track') === 'opensky',
});

test('every blocked provider is actually stopped', () => {
  assert.deepEqual(
    [...FREE_ONLY_STATUS.blockedProviders].sort(),
    Object.keys(BLOCKING_EVIDENCE).sort(),
  );
  for (const id of FREE_ONLY_STATUS.blockedProviders)
    assert.equal(BLOCKING_EVIDENCE[id](), true, `${id} is not enforced`);
});

test('Launch Library is a paused credential, not a blocked provider', () => {
  assert.ok(!FREE_ONLY_STATUS.blockedProviders.includes('launch-library'));
  assert.deepEqual([...FREE_ONLY_STATUS.pausedCredentials], ['launch-library']);
  assert.equal(freeOnlyCapability('/api/launches'), null);
});

test('every listed id names a Provider Settings key row', () => {
  const ids = new Set(KEY_SETUP_KEYS.map(({ id }) => id));
  for (const id of [
    ...FREE_ONLY_STATUS.blockedProviders,
    ...FREE_ONLY_STATUS.pausedCredentials,
  ])
    assert.ok(ids.has(id), id);
});

/** Run /api/launches once in the given mode; returns the upstream headers. */
async function launchesRequest(t, { freeOnly }) {
  const { localProviderPlugins } = await import('../providers/local.js');
  const plugin = localProviderPlugins({ freeOnly }).find(
    ({ name }) => name === 'rocket-launches-proxy',
  );
  assert.ok(plugin, 'the launches proxy is mounted');
  let handler;
  plugin.configureServer({
    middlewares: {
      use(route, fn) {
        if (route === '/api/launches') handler = fn;
      },
    },
  });
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    seen.push(init?.headers ?? {});
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  const res = {
    statusCode: 0,
    writeHead(status) {
      this.statusCode = status;
    },
    end() {},
  };
  await handler({ method: 'GET', url: '/' }, res);
  return { status: res.statusCode, headers: seen };
}

test('under Free-only, launches still load and the saved token is not sent', async (t) => {
  // The proxy keeps a disk cache under the working directory.
  const previousCwd = process.cwd();
  const previousToken = process.env.LL2_API_TOKEN;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-free-only-ll2-'));
  process.chdir(dir);
  process.env.LL2_API_TOKEN = 'fixture-saved-ll2-token';
  t.after(async () => {
    process.chdir(previousCwd);
    if (previousToken === undefined) delete process.env.LL2_API_TOKEN;
    else process.env.LL2_API_TOKEN = previousToken;
    await rm(dir, { recursive: true, force: true });
  });

  const free = await launchesRequest(t, { freeOnly: true });
  assert.equal(free.status, 200);
  assert.equal(free.headers.length, 1);
  assert.equal(free.headers[0].Authorization, undefined);

  // Outside Free-only the same saved token is used: the difference is policy.
  t.mock.restoreAll();
  const full = await launchesRequest(t, { freeOnly: false });
  assert.equal(full.status, 200);
  assert.equal(full.headers[0].Authorization, 'Token fixture-saved-ll2-token');
});
