import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentinelNdviService } from './service.js';
import { itemFixture } from './testFixtures.mjs';
const input = {
  sceneId: 'S2B_43RGP_20261025_0_L2A',
  lat: 30.3258,
  lon: 78.0438,
  sizePixels: 128,
};
const budget = { reserve: async () => ({ ok: true }) };
test('service fetches fixed catalog ID and workers receive only admitted metadata', async () => {
  const calls = [];
  const s = createSentinelNdviService({
    budget,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(itemFixture());
    },
    runJob: async (item, query) => ({
      status: 'available',
      sceneId: item.id,
      requested: query,
    }),
  });
  assert.equal((await s.analyze(input)).status, 'available');
  assert.ok(calls[0].url.endsWith('/items/' + input.sceneId));
  assert.equal(calls[0].options.redirect, 'error');
});
test('concurrent heavy jobs and cooldown block additional catalog or worker dispatch', async () => {
  let release,
    calls = 0,
    clock = 100000;
  const s = createSentinelNdviService({
    budget,
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return Response.json(itemFixture());
    },
    runJob: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = s.analyze(input);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await s.analyze(input)).reason, 'busy');
  assert.equal(calls, 1);
  release({ status: 'available' });
  await first;
  assert.equal((await s.analyze(input)).reason, 'cooldown');
  assert.equal(calls, 1);
});
test('durable budget denial or corrupt upstream never dispatches a worker or leaks upstream text', async () => {
  let calls = 0;
  const s = createSentinelNdviService({
    budget: { reserve: async () => ({ ok: false, reason: 'budget-storage' }) },
    fetchImpl: () => {
      calls++;
    },
  });
  assert.equal((await s.analyze(input)).reason, 'budget-storage');
  assert.equal(calls, 0);
  const broken = createSentinelNdviService({
    budget,
    fetchImpl: async () => new Response('private token here', { status: 500 }),
    runJob: () => {
      calls++;
    },
  });
  assert.equal((await broken.analyze(input)).reason, 'upstream-unavailable');
  assert.equal(calls, 0);
});
test('scene search is bounded to fixed collection/date window and emits metadata without asset URLs', async () => {
  let request;
  const s = createSentinelNdviService({
    budget,
    fetchImpl: async (url, opts) => {
      request = { url, ...JSON.parse(opts.body) };
      return Response.json({ features: [itemFixture()] });
    },
  });
  const found = await s.search({
    lat: 30,
    lon: 78,
    fromDay: '2026-10-01',
    toDay: '2026-10-31',
  });
  assert.equal(found.scenes.length, 1);
  assert.equal(request.limit, 10);
  assert.deepEqual(request.collections, ['sentinel-2-l2a']);
  assert.ok(!JSON.stringify(found).includes('.tif'));
});
test('COG rate limits cool down later catalog calls across scenes and search', async () => {
  let calls = 0,
    clock = 100000;
  const s = createSentinelNdviService({
    budget,
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return Response.json(itemFixture());
    },
    runJob: async () => {
      throw new Error('rate-limited');
    },
  });
  assert.equal((await s.analyze(input)).reason, 'rate-limited');
  clock += 16000;
  assert.equal((await s.analyze(input)).reason, 'rate-limited');
  assert.equal(calls, 1);
  assert.equal(
    (
      await s.search({
        lat: 30,
        lon: 78,
        fromDay: '2026-10-01',
        toDay: '2026-10-31',
      })
    ).reason,
    'rate-limited',
  );
  assert.equal(calls, 1);
});

test('catalog HTTP-date Retry-After remains enforced across search and scene IDs', async () => {
  let calls = 0,
    clock = Date.parse('2026-11-07T12:00:00Z');
  const s = createSentinelNdviService({
    budget,
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return new Response('', {
        status: 429,
        headers: { 'Retry-After': 'Sat, 07 Nov 2026 13:00:00 GMT' },
      });
    },
  });
  assert.equal((await s.analyze(input)).reason, 'rate-limited');
  clock += 11 * 60000;
  assert.equal((await s.analyze(input)).reason, 'rate-limited');
  assert.equal(calls, 1);
});
