import test from 'node:test';
import assert from 'node:assert/strict';
import { createRangeSource, createRangeBudget } from './rangeSource.js';
const url =
  'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/R/GP/2026/10/S2B_43RGP_20261025_0_L2A/B04.tif';
const response = (body = new Uint8Array([1, 2, 3, 4]), headers = {}) =>
  new Response(body, {
    status: 206,
    headers: {
      'content-range': 'bytes 0-3/1000',
      'content-length': '4',
      etag: '"v1"',
      ...headers,
    },
  });
test('range source sends only bounded ranges and returns exact bytes', async () => {
  const calls = [];
  const source = createRangeSource(url, {
    fetchImpl: async (_url, opts) => {
      calls.push(opts);
      return response();
    },
  });
  assert.deepEqual(
    new Uint8Array((await source.fetch([{ offset: 0, length: 4 }]))[0]),
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.equal(calls[0].headers.Range, 'bytes=0-3');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(source.fileSize, 1000);
});
test('full downloads, wrong ranges, truncated/oversized bodies and changing objects are rejected', async () => {
  for (const bad of [
    () => new Response(new Uint8Array(4)),
    () => response(undefined, { 'content-range': 'bytes 1-4/1000' }),
    () => response(new Uint8Array(3)),
    () => response(new Uint8Array(5)),
  ]) {
    const source = createRangeSource(url, { fetchImpl: async () => bad() });
    await assert.rejects(source.fetch([{ offset: 0, length: 4 }]));
  }
  let calls = 0;
  const source = createRangeSource(url, {
    fetchImpl: async () =>
      response(undefined, { etag: ++calls === 1 ? '"v1"' : '"v2"' }),
  });
  await source.fetch([{ offset: 0, length: 4 }]);
  await assert.rejects(source.fetch([{ offset: 0, length: 4 }]));
});
test('shared cumulative budget and invalid ranges block before dispatch; arbitrary URLs never fetch', async () => {
  let calls = 0;
  const budget = createRangeBudget({ maxBytes: 4, maxRequests: 1 });
  const source = createRangeSource(url, {
    budget,
    fetchImpl: async () => {
      calls++;
      return response();
    },
  });
  await source.fetch([{ offset: 0, length: 4 }]);
  await assert.rejects(source.fetch([{ offset: 0, length: 4 }]));
  assert.equal(calls, 1);
  await assert.rejects(source.fetch([{ offset: -1, length: 4 }]));
  for (const bad of [
    'https://localhost/B04.tif',
    url + '?key=secret',
    url.replace('B04', 'B02'),
    url.replace('https:', 'http:'),
  ])
    assert.throws(() => createRangeSource(bad));
});
test('COG rate limiting is reported explicitly so the service can cool down', async () => {
  const source = createRangeSource(url, {
    fetchImpl: async () => new Response('', { status: 429 }),
  });
  await assert.rejects(
    source.fetch([{ offset: 0, length: 4 }]),
    /rate-limited/,
  );
});

test('range assembly requires a strong ETag on the first and every response', async () => {
  for (const etag of [null, 'W/"v1"', '']) {
    const source = createRangeSource(url, {
      fetchImpl: async () => {
        const r = response();
        if (etag === null) r.headers.delete('etag');
        else r.headers.set('etag', etag);
        return r;
      },
    });
    await assert.rejects(source.fetch([{ offset: 0, length: 4 }]));
  }
});
