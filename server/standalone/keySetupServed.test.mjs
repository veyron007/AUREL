import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// As scripts/serve-built.mjs leaves it before Vite first loads the config.
globalThis.__GEV_SERVED_BUILD_AT_BOOT = true;
const { keySetupEndpoint } = await import('./key-setup.js');

function install(plugin, restart) {
  const routes = new Map();
  plugin.configurePreviewServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
    restart,
  });
  return routes;
}

function call(handler, { method = 'GET', body = '' } = {}) {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), {
      method,
      url: '/',
      headers: {
        host: 'localhost:4173',
        origin: 'http://localhost:4173',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const res = {
      statusCode: 200,
      setHeader() {},
      end(text = '') {
        resolve({ status: this.statusCode, json: JSON.parse(String(text)) });
      },
    };
    handler(req, res);
  });
}

test('the served build runs Provider Settings and reloads the page after its restart', async (t) => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), 'gev-served-keys-'));
  const previous = process.env.AISSTREAM_API_KEY;
  t.after(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AISSTREAM_API_KEY;
    else process.env.AISSTREAM_API_KEY = previous;
  });
  delete process.env.AISSTREAM_API_KEY;
  const plugin = keySetupEndpoint({ sourceRoot, freeOnly: true });
  assert.equal(plugin.apply({}, { command: 'serve', isPreview: true }), true);
  assert.equal(plugin.apply({}, { command: 'build', isPreview: false }), false);
  let restarts = 0;
  const routes = install(plugin, async () => {
    restarts += 1;
  });
  const status = await call(routes.get('/api/setup/status'));
  assert.equal(status.status, 200);
  assert.match(status.json.bootId, /^[0-9a-f-]{36}$/);
  assert.equal(status.json.freeOnly, true);

  const saved = await call(routes.get('/api/setup/keys'), {
    method: 'POST',
    body: JSON.stringify({ AISSTREAM_API_KEY: 'fixture-only-key-0000' }),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.reload, 'poll');
  assert.equal(saved.json.status.bootId, status.json.bootId);
  assert.match(
    readFileSync(path.join(sourceRoot, '.env'), 'utf8'),
    /AISSTREAM_API_KEY=fixture-only-key-0000/,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(restarts, 1);
});
