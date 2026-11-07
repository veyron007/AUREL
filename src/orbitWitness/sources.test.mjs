import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCatalogueSource, createCloudForecastSource } from './sources.js';
import { createOrbitElementSource } from './tle.js';
import { validateCataloguePayload, validateSceneQuery } from './catalogueModel.js';
import { FIXTURE_TLE } from './testFixtures.mjs';

const now = () => Date.parse('2026-11-07T06:00:00Z');
const json = (value, init) => new Response(JSON.stringify(value), init);

test('the catalogue client is same-origin and turns failures into unknown, not empty', async () => {
  const urls = [];
  const ok = createSceneCatalogueSource({
    now,
    fetchImpl: async (url, init) => {
      urls.push([url, init.credentials, init.redirect]);
      return json({ version: 1, retrievedAt: '2026-11-07T06:00:00Z', sources: [{ id: 'earth-search', status: 'ok', count: 0 }], scenes: [] });
    },
  });
  const result = await ok.search({ bbox: [78, 30, 78.1, 30.1], from: '2026-11-01', to: '2026-11-07' });
  assert.match(urls[0][0], /^\/api\/orbit-witness\/scenes\?bbox=78\.0000%2C30\.0000/);
  assert.deepEqual(urls[0].slice(1), ['same-origin', 'error']);
  assert.equal(result.status, 'partial', 'one catalogue missing is partial');
  const down = createSceneCatalogueSource({ now, fetchImpl: async () => json({}, { status: 429, headers: { 'retry-after': '120' } }) });
  const unknown = await down.search({ bbox: [78, 30, 78.1, 30.1], from: '2026-11-01', to: '2026-11-07' });
  assert.equal(unknown.status, 'unavailable');
  assert.equal(unknown.reason, 'rate-limited');
  assert.equal(unknown.retryAfter, '120');
  await assert.rejects(() => ok.search({ bbox: [0, 0, 5, 5], from: '2026-11-01', to: '2026-11-07' }), TypeError);
});

test('catalogue payloads are re-validated in the browser', () => {
  assert.throws(() => validateCataloguePayload({ version: 1, retrievedAt: 'x', sources: [], scenes: [] }));
  assert.throws(() =>
    validateCataloguePayload({
      version: 1,
      retrievedAt: '2026-11-07T06:00:00Z',
      sources: [{ id: 'evil', status: 'ok', count: 0 }],
      scenes: [],
    }),
  );
  assert.throws(() => validateSceneQuery({ bbox: [78, 30, 78.1, 30.1], from: '2026-10-01', to: '2026-11-07' }, { now: now() }));
});

test('the cloud client validates hours and degrades to unavailable', async () => {
  const source = createCloudForecastSource({
    fetchImpl: async () =>
      json({ version: 1, status: 'ok', retrievedAt: '2026-11-07T06:00:00Z', hours: [{ time: '2026-11-07T06:00:00.000Z', cloudCoverPct: 40 }] }),
  });
  const forecast = await source.forecast({ lat: 30.46, lon: 78.06 });
  assert.equal(forecast.hours[0].cloudCoverPct, 40);
  const broken = createCloudForecastSource({ fetchImpl: async () => json({ version: 1, status: 'ok', hours: [{ time: 'x', cloudCoverPct: 900 }] }) });
  assert.equal((await broken.forecast({ lat: 30.46, lon: 78.06 })).status, 'unavailable');
  await assert.rejects(() => source.forecast({ lat: 200, lon: 0 }), TypeError);
});

test('element sets come from the existing CelesTrak active cache', async () => {
  const urls = [];
  const source = createOrbitElementSource({
    fetchImpl: async (url) => (urls.push(url), new Response(FIXTURE_TLE, { headers: { 'x-tle-cache': 'STALE-ERROR' } })),
  });
  const result = await source.read();
  assert.deepEqual(urls, ['/api/celestrak/active']);
  assert.equal(result.sets.length, 6);
  assert.equal(result.stale, true);
  const failing = createOrbitElementSource({ fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(() => failing.read());
});
