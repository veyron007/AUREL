import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchlistSource } from './source.js';
const bounds = { west: 78, south: 30.2, east: 78.1, north: 30.4 },
  now = Date.parse('2026-11-07T12:00:00Z');
test('watch source is lazy, same origin and preserves rate cooldown without a key fallback', async () => {
  const calls = [];
  const source = createWatchlistSource({
    now: () => now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', {
        status: 429,
        headers: { 'retry-after': '7200' },
      });
    },
  });
  assert.equal(calls.length, 0);
  const result = await source.check(bounds);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('/api/firms/area?'));
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(result.context.status, 'unavailable');
  assert.equal(result.retryAt, now + 7200000);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(source.check(bounds, { signal: abort.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls.length, 1);
});
test('provider cooldown dates and invalid headers stay inside local limits', async () => {
  for (const [header, delay] of [
    [new Date(now + 3600000).toUTCString(), 3600000],
    ['bad', 1800000],
    ['99999999', 86400000],
    [null, 1800000],
  ]) {
    const source = createWatchlistSource({
      now: () => now,
      fetchImpl: async () =>
        new Response('{}', {
          status: 429,
          headers: header === null ? {} : { 'retry-after': header },
        }),
    });
    assert.equal((await source.check(bounds)).retryAt, now + delay);
  }
  const source = createWatchlistSource({
    now: () => now,
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  assert.equal((await source.check(bounds)).retryAt, null);
});
