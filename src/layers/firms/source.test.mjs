import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirmsSource } from './source.js';

test('a malformed successful response is never accepted as an empty fire snapshot', async () => {
  for (const payload of [{}, { fires: null }, { fires: {} }]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({ ok: true, json: async () => payload }),
    });
    await assert.rejects(source.getSnapshot(), /Malformed fire snapshot/);
  }
});
test('optional-key guidance is distinct from denial or upstream failure', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({ error: 'no_key' }),
      }),
    });
    if (status === 503)
      assert.deepEqual(await source.getSnapshot(), { keyRequired: true });
    else
      await assert.rejects(
        source.getSnapshot(),
        new RegExp(`FIRMS HTTP ${status}`),
      );
  }
});
test('response-body completion honors cancellation without replacing records', async () => {
  const abort = new AbortController();
  const source = createFirmsSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return { fires: [] };
      },
    }),
  });
  await assert.rejects(source.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});
test('a repeat poll sends the held validator and returns notModified on 304', async () => {
  const seen = [];
  const source = createFirmsSource({
    fetchImpl: async (_url, init) => {
      seen.push(init.headers?.['If-None-Match'] ?? null);
      if (seen.length === 2)
        return {
          ok: false,
          status: 304,
          headers: new Headers(),
          json: async () => {
            throw new Error('a 304 has no body');
          },
        };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ ETag: 'W/"firms-1-f-1"' }),
        json: async () => ({ fetchedAt: 1, fires: [] }),
      };
    },
  });
  const first = await source.getSnapshot();
  assert.equal(first.etag, 'W/"firms-1-f-1"');
  const second = await source.getSnapshot({ etag: first.etag });
  assert.deepEqual(second, { notModified: true });
  assert.deepEqual(seen, [null, 'W/"firms-1-f-1"']);
});
