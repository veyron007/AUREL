import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentinelResearchSource } from './sentinelResearch.js';
import { resultFixture } from '../research/testFixtures.mjs';
const expected = {
  lat: 30,
  lon: 78,
  fromDay: '2026-10-01',
  toDay: '2026-10-31',
};
test('source is lazy, same-origin only, strictly bounded and returns detached immutable data', async () => {
  const calls = [];
  const raw = resultFixture();
  const source = createSentinelResearchSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(raw);
    },
  });
  assert.equal(calls.length, 0);
  const result = await source.analyze({
    sceneId: raw.sceneId,
    ...raw.requested,
  });
  assert.equal(calls[0].url, '/api/research/sentinel-ndvi');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.ok(Object.isFrozen(result.values));
});
test('invalid input never dispatches; huge, mismatched and unexpected response bodies reject', async () => {
  let calls = 0;
  const source = createSentinelResearchSource({
    fetchImpl: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(
    source.search({ ...expected, url: 'https://localhost' }),
  );
  assert.equal(calls, 0);
  await assert.rejects(source.search(expected));
  const oversized = createSentinelResearchSource({
    fetchImpl: async () =>
      new Response('{}', { headers: { 'content-length': '3000000' } }),
  });
  await assert.rejects(oversized.search(expected));
});
test('cancellation and deadline prevent late responses from being admitted', async () => {
  let signal;
  const controller = new AbortController();
  const source = createSentinelResearchSource({
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
    timeoutMs: 20,
  });
  const pending = source.search(expected, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  assert.equal(signal.aborted, true);
  await assert.rejects(source.search(expected));
});
test('search preserves typed service rejections without inventing an empty successful catalog', async () => {
  const source = createSentinelResearchSource({
    fetchImpl: async () =>
      Response.json({
        version: 1,
        status: 'rejected',
        reason: 'daily-limit',
        scenes: [],
      }),
  });
  assert.equal((await source.search(expected)).status, 'rejected');
});
