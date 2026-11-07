import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import {
  airQualityProxy,
  createAirQualityMiddleware,
  parseNearQuery,
} from './index.js';
import { createOpenAqAdapter } from './openaq.js';
import { createSensorCommunityAdapter } from './sensor-community.js';
import { airQualityFixtureFetch } from '../../../src/testSupport/airQualityFixtures.mjs';

const NOW = Date.parse('2026-11-07T06:20:00Z');

async function serve(t, { key = 'fixture-key-not-real', empty = false } = {}) {
  const calls = [];
  const fetchImpl = airQualityFixtureFetch({ now: NOW, calls, empty });
  const handler = createAirQualityMiddleware({
    openaq: createOpenAqAdapter({
      fetchImpl,
      resolveKey: () => key,
      budget: { reserve: async () => ({ ok: true }) },
      now: () => NOW,
    }),
    citizen: createSensorCommunityAdapter({ fetchImpl, now: () => NOW }),
  });
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  return { root, calls, get: (p, init) => fetch(root + p, init) };
}

test('near returns separate station and citizen tiers', async (t) => {
  const { get } = await serve(t);
  const response = await get('/api/air-quality/near?lat=30.3165&lon=78.0322');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.version, 1);
  assert.equal(body.stations.tier, 'station');
  assert.equal(body.stations.state, 'ok');
  assert.equal(body.stations.stations.length, 2);
  assert.equal(body.stations.detail, null);
  assert.equal(body.citizen.tier, 'citizen');
  assert.equal(body.citizen.sensors.length, 2);
  assert.ok(!JSON.stringify(body).includes('fixture-key-not-real'));
});

test('detail adds hourly series for the nearest reporting station', async (t) => {
  const { get } = await serve(t);
  const body = await (
    await get(
      '/api/air-quality/near?lat=30.3165&lon=78.0322&detail=1&citizen=0',
    )
  ).json();
  assert.equal(body.stations.detail.stationId, 'openaq:9001');
  assert.equal(body.stations.detail.state, 'ok');
  assert.equal(body.stations.detail.series.pm25.length, 24);
  assert.equal(body.citizen.state, 'disabled');
  const chosen = await (
    await get(
      '/api/air-quality/near?lat=30.3165&lon=78.0322&station=openaq:9002',
    )
  ).json();
  assert.equal(chosen.stations.detail.stationId, 'openaq:9002');
});

test('no saved key keeps citizen sensors and says needs-key', async (t) => {
  const { get, calls } = await serve(t, { key: '' });
  const body = await (
    await get('/api/air-quality/near?lat=30.3165&lon=78.0322&detail=1')
  ).json();
  assert.equal(body.stations.state, 'needs-key');
  assert.equal(body.stations.detail.state, 'no-monitor');
  assert.equal(body.citizen.state, 'ok');
  assert.ok(calls.every((call) => !call.url.includes('openaq')));
});

test('an empty radius is no-monitor and no-sensor', async (t) => {
  const { get } = await serve(t, { empty: true });
  const body = await (
    await get('/api/air-quality/near?lat=30.3165&lon=78.0322')
  ).json();
  assert.equal(body.stations.state, 'no-monitor');
  assert.equal(body.citizen.state, 'no-sensor');
});

test('sensor route serves one watch series', async (t) => {
  const { get } = await serve(t);
  const body = await (await get('/api/air-quality/sensor?id=9101')).json();
  assert.equal(body.provider, 'openaq');
  assert.equal(body.sensorId, 9101);
  assert.equal(body.state, 'ok');
  assert.equal(body.hours.length, 24);
});

test('queries are bounded and methods restricted', async (t) => {
  const { get } = await serve(t);
  for (const query of [
    '/api/air-quality/near?lat=91&lon=0',
    '/api/air-quality/near?lat=30&lon=78&url=http://x',
    '/api/air-quality/near?lat=30&lon=78&lat=31',
    '/api/air-quality/near?lat=30&lon=78&detail=yes',
    '/api/air-quality/near?lat=30&lon=78&station=../../x',
    '/api/air-quality/sensor?id=0',
    '/api/air-quality/sensor?id=abc',
  ])
    assert.equal((await get(query)).status, 400, query);
  const post = await get('/api/air-quality/near?lat=30&lon=78', {
    method: 'POST',
  });
  assert.equal(post.status, 405);
  assert.equal((await get('/api/other')).status, 404);
  const cross = await get('/api/air-quality/near?lat=30&lon=78', {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(cross.status, 403);
});

test('parsing keeps five decimals and both Vite hooks install', () => {
  const query = parseNearQuery(
    new URL('http://x/api/air-quality/near?lat=30.316512345&lon=78.0322'),
  );
  assert.deepEqual(query.requested, { lat: 30.31651, lon: 78.0322 });
  assert.equal(query.citizen, true);
  const plugin = airQualityProxy({ openaq: {}, citizen: {} });
  const used = [];
  const server = { middlewares: { use: (fn) => used.push(fn) } };
  plugin.configureServer(server);
  plugin.configurePreviewServer(server);
  assert.equal(used.length, 2);
});
