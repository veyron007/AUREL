import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createImageryHistoryMiddleware,
  imageryHistoryProxy,
} from './imagery-history.js';
const clock = Date.parse('2026-11-07T12:00:00Z');
const bbox = '77.98,30.26,78.09,30.37';
const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.write('IHDR', 12);
png.writeUInt32BE(256, 16);
png.writeUInt32BE(256, 20);
async function serve(t, options = {}) {
  const calls = [];
  let reservations = 0;
  const middleware = createImageryHistoryMiddleware({
    now: () => clock,
    budget: {
      reserve: async () => {
        reservations++;
        return { ok: true };
      },
    },
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ hits: 0, items: [] }));
    },
    ...options,
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    reservations: () => reservations,
    get: (path, init) => fetch(root + path, init),
  };
}
test('bounded fixed product catalogue is coalesced/cached with durable reservations', async (t) => {
  const h = await serve(t);
  const path = `/api/imagery-history/catalog?bbox=${bbox}&from=2026-10-01&to=2026-10-31&products=S30,L30`;
  const [a, b] = await Promise.all([h.get(path), h.get(path)]);
  assert.equal(a.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(h.calls.length, 2);
  assert.equal(h.reservations(), 2);
  assert.ok(
    h.calls.every((x) => new URL(x).hostname === 'cmr.earthdata.nasa.gov'),
  );
  await h.get(path);
  assert.equal(h.calls.length, 2);
});
test('refuses foreign requests, unknown routes/queries, future/oversized windows and malformed boxes before upstream', async (t) => {
  const h = await serve(t),
    base = `/api/imagery-history/catalog?bbox=${bbox}&from=2026-10-01&to=2026-11-01&products=S30`;
  assert.equal((await h.get(base)).status, 400);
  assert.equal(
    (await h.get(base.replace('2026-11-01', '2026-12-01'))).status,
    400,
  );
  assert.equal(
    (
      await h.get(
        base.replace('2026-11-01', '2026-10-01') + '&url=https://evil.test',
      )
    ).status,
    400,
  );
  assert.equal(
    (await h.get(base, { headers: { origin: 'https://evil.test' } })).status,
    403,
  );
  assert.equal((await h.get(base, { method: 'POST' })).status, 405);
  assert.equal((await h.get('/other')).status, 404);
  assert.equal(h.calls.length, 0);
});
test('WVS preserves only proven matching acquisition metadata and bounds image bytes', async (t) => {
  let seen;
  const h = await serve(t, {
    fetchImpl: async (url) => {
      seen = url;
      return new Response(png, {
        headers: {
          'content-type': 'image/png',
          'data-present': 'true',
          'acquisition-time': '2026-10-22',
        },
      });
    },
  });
  const response = await h.get(
    `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('data-present'), 'true');
  assert.equal(
    response.headers.get('x-aurel-probed-at'),
    new Date(clock).toISOString(),
  );
  assert.equal(new URL(seen).hostname, 'wvs.earthdata.nasa.gov');
  assert.equal(new URL(seen).searchParams.get('WIDTH'), '256');
  const huge = await serve(t, {
    fetchImpl: async () =>
      new Response('x', {
        headers: {
          'content-length': '1048577',
          'data-present': 'true',
          'content-type': 'image/png',
        },
      }),
  });
  assert.equal(
    (
      await huge.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
      )
    ).status,
    502,
  );
});
test('budget denial and deadlines never dispatch paid fallback and plugin supports dev/preview', async (t) => {
  const h = await serve(t, {
    budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) },
  });
  assert.equal(
    (
      await h.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
      )
    ).status,
    429,
  );
  assert.equal(h.calls.length, 0);
  const slow = await serve(t, {
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(
    (
      await slow.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
      )
    ).status,
    502,
  );
  let n = 0;
  const plugin = imageryHistoryProxy();
  plugin.configureServer({ middlewares: { use: () => n++ } });
  plugin.configurePreviewServer({ middlewares: { use: () => n++ } });
  assert.equal(n, 2);
});

test('429 cools down provider and invalid imagery metadata is never cached as present', async (t) => {
  let calls = 0;
  const limited = await serve(t, {
    fetchImpl: async () => {
      calls++;
      return new Response('rate', {
        status: 429,
        headers: { 'retry-after': '120' },
      });
    },
  });
  assert.equal(
    (
      await limited.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
      )
    ).status,
    502,
  );
  assert.equal(
    (
      await limited.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-23`,
      )
    ).status,
    429,
  );
  assert.equal(calls, 1);
  for (const headers of [
    { 'data-present': 'true', 'content-type': 'text/html' },
    {
      'data-present': 'true',
      'content-type': 'image/png',
      'acquisition-time': '2026-10-23',
    },
    { 'content-type': 'image/png' },
  ]) {
    const h = await serve(t, {
      fetchImpl: async () => new Response('not image', { headers }),
    });
    assert.equal(
      (
        await h.get(
          `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
        )
      ).status,
      502,
    );
  }
  const empty = await serve(t, {
    fetchImpl: async () =>
      new Response(null, { headers: { 'data-present': 'false' } }),
  });
  const response = await empty.get(
    `/api/imagery-history/preview?bbox=${bbox}&product=VIIRS&day=2026-10-22`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('data-present'), 'false');
});

test('compressed previews cannot exceed the requested decode dimensions', async (t) => {
  const enormous = Buffer.from(png);
  enormous.writeUInt32BE(100000, 16);
  const h = await serve(t, {
    fetchImpl: async () =>
      new Response(enormous, {
        headers: { 'content-type': 'image/png', 'data-present': 'true' },
      }),
  });
  assert.equal(
    (
      await h.get(
        `/api/imagery-history/preview?bbox=${bbox}&product=S30&day=2026-10-22`,
      )
    ).status,
    502,
  );
});

test('Vite hooks do not return Connect as a post-install callback', () => {
  const plugin = imageryHistoryProxy();
  const server = {
    middlewares: {
      use: () => () => {
        throw new Error('No request');
      },
    },
  };
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
});
