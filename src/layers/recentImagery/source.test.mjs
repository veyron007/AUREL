import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentImagerySource } from './source.js';

test('imagery source routes catalog, thumbnails and tiles through supplied adapters', async () => {
  const controller = new AbortController();
  const query = {
    box: { west: 0, east: 1, south: 0, north: 1 },
    signal: controller.signal,
  };
  const candidate = { product: 'S30', day: '2026-10-01' };
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return new Response('image');
  };
  const source = createRecentImagerySource({
    fetchImpl,
    search: async (request) => {
      assert.equal(request.fetchImpl, fetchImpl);
      assert.equal(request.signal, controller.signal);
      assert.equal(request.box, query.box);
      return [candidate];
    },
    thumbnailUrl: ({ product, day, width }) =>
      `https://imagery.example/${product}/${day}/${width}`,
    tileTemplate: (product, day) =>
      `https://tiles.example/${product}/${day}/{z}/{x}/{y}`,
    credit: 'Example imagery',
  });
  assert.deepEqual(await source.searchHls(query), [candidate]);
  assert.equal(
    await (
      await source.getThumbnail(candidate, query.box, {
        signal: controller.signal,
      })
    ).text(),
    'image',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://imagery.example/S30/2026-10-01/256');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(
    source.getTileTemplate(candidate.product, candidate.day),
    'https://tiles.example/S30/2026-10-01/{z}/{x}/{y}',
  );
  assert.equal(source.credit, 'Example imagery');
});

test('cancelled thumbnail acquisition does not return stale responses or retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const source = createRecentImagerySource({
    thumbnailUrl: () => 'https://imagery.example/thumbnail',
    fetchImpl: async () => {
      calls++;
      controller.abort();
      return new Response('image');
    },
  });
  await assert.rejects(
    source.getThumbnail({}, {}, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    source.getThumbnail({}, {}, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});

test('historical source uses bounded same-origin catalogue and preview without direct fallback', async () => {
  const calls = [];
  const box = { west: 77.98, south: 30.26, east: 78.09, north: 30.37 };
  const source = createRecentImagerySource({
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return url.includes('/catalog?')
        ? new Response(JSON.stringify({ candidates: [], errors: [] }))
        : new Response('png', {
            headers: {
              'data-present': 'true',
              'acquisition-time': '2026-10-22',
            },
          });
    },
  });
  assert.deepEqual(
    (
      await source.searchWindow({
        box,
        fromDay: '2026-10-22',
        toDay: '2026-10-25',
      })
    ).candidates,
    [],
  );
  assert.equal(
    await (
      await source.getThumbnail(
        { product: 'S30', day: '2026-10-22', historical: true },
        box,
      )
    ).text(),
    'png',
  );
  assert.ok(calls.every(([url]) => url.startsWith('/api/imagery-history/')));
  assert.ok(calls.every(([, init]) => init.redirect === 'error'));
  const fail = createRecentImagerySource({
    fetchImpl: async () => new Response('denied', { status: 429 }),
  });
  await assert.rejects(
    fail.searchWindow({ box, fromDay: '2026-10-22', toDay: '2026-10-22' }),
  );
  assert.equal(
    (
      await fail.getThumbnail(
        { product: 'S30', day: '2026-10-22', historical: true },
        box,
      )
    ).status,
    429,
  );
  const huge = createRecentImagerySource({
    fetchImpl: async () =>
      new Response('x', { headers: { 'content-length': '3000000' } }),
  });
  await assert.rejects(
    huge.searchWindow({ box, fromDay: '2026-10-22', toDay: '2026-10-22' }),
    /too large/,
  );
  await assert.rejects(
    huge.getThumbnail(
      { product: 'S30', day: '2026-10-22', historical: true },
      box,
    ),
    /too large/,
  );
  const invalid = createRecentImagerySource({
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(
    invalid.searchWindow({ box, fromDay: '2026-10-22', toDay: '2026-10-22' }),
    /Invalid/,
  );
});
