import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createResearchMiddleware } from './index.js';
async function server(run) {
  let calls = 0;
  const middleware = createResearchMiddleware({
    service: {
      analyze: async () => {
        calls++;
        return { status: 'available' };
      },
      search: async () => {
        calls++;
        return { scenes: [] };
      },
    },
  });
  const app = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  try {
    await run('http://127.0.0.1:' + app.address().port, () => calls);
  } finally {
    await new Promise((r) => app.close(r));
  }
}
test('research middleware exposes only bounded same-site scene search and explicit analysis', () =>
  server(async (base, calls) => {
    const query =
      '/api/research/sentinel-scenes?lat=30&lon=78&fromDay=2026-10-01&toDay=2026-10-31';
    assert.equal((await fetch(base + query)).status, 200);
    assert.equal(
      (
        await fetch(base + query, {
          headers: {
            origin: 'https://evil.example',
            'sec-fetch-site': 'cross-site',
          },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + query + '&lat=31')).status, 400);
    assert.equal(
      (await fetch(base + '/api/research/sentinel-ndvi')).status,
      405,
    );
    assert.equal(
      (
        await fetch(base + '/api/research/sentinel-ndvi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId: 'S2B_43RGP_20261025_0_L2A',
            lat: 30,
            lon: 78,
            sizePixels: 128,
          }),
        })
      ).status,
      200,
    );
    assert.equal(calls(), 2);
  }));
test('oversized bodies and arbitrary URL inputs do not reach research service', () =>
  server(async (base, calls) => {
    const post = (body) =>
      fetch(base + '/api/research/sentinel-ndvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    assert.equal((await post('x'.repeat(2000))).status, 413);
    assert.equal(
      (
        await post(
          JSON.stringify({
            sceneId: 'S2B_43RGP_20261025_0_L2A',
            lat: 30,
            lon: 78,
            sizePixels: 128,
            url: 'https://localhost',
          }),
        )
      ).status,
      400,
    );
    assert.equal(calls(), 0);
  }));

test('Vite installation does not accidentally return Connect as a post hook', async () => {
  const { researchProxy } = await import('./index.js');
  const plugin = researchProxy({ service: {} });
  let count = 0;
  const server = {
    middlewares: {
      use: () => {
        count++;
        return () => {
          throw new Error('invalid post hook');
        };
      },
    },
  };
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
  assert.equal(count, 2);
});
