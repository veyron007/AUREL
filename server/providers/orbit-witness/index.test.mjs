import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import {
  createSceneCatalogueMiddleware,
  createCloudForecastMiddleware,
  cloudForecastUrl,
  normalizeCloudForecast,
  stacSearchUrl,
  orbitWitnessProxy,
} from './index.js';
import { localProviderPlugins } from '../local.js';

const now = Date.parse('2026-11-07T06:00:00Z');
const QUERY = 'bbox=78.0144,30.4098,78.1144,30.5098&from=2026-10-29&to=2026-11-07';
const item = (id, collection, datetime, extra = {}) => ({
  type: 'Feature',
  id,
  collection,
  properties: { datetime, 'eo:cloud_cover': 3.25, ...extra },
  geometry: { type: 'Polygon', coordinates: [[[77, 30], [78.3, 30], [78.3, 31], [77, 31], [77, 30]]] },
});
const earthSearch = (extra = {}) => ({
  type: 'FeatureCollection',
  numberMatched: 1,
  numberReturned: 1,
  features: [item('S2B_43RGP_20261104_0_L2A', 'sentinel-2-l2a', '2026-11-04T05:40:35.189Z', { platform: 'sentinel-2b' })],
  links: [],
  ...extra,
});
const cmr = () => ({
  type: 'FeatureCollection',
  features: [item('HLS.S30.T43RGP.2026308T052841.v2.0', 'HLSS30_2.0', '2026-11-04T05:40:35.189Z')],
  links: [],
});

async function serve(t, handler) {
  const s = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => s.close(resolve)));
  const root = `http://127.0.0.1:${s.address().port}`;
  return (route, query) => fetch(`${root}/api/orbit-witness/${route}?${query}`);
}

function scenes(t, { respond, budget = { reserve: async () => ({ ok: true }) } } = {}) {
  const calls = [];
  const handler = createSceneCatalogueMiddleware({
    now: () => now,
    budget,
    fetchImpl: async (url) => {
      calls.push(url);
      return respond
        ? respond(url)
        : new Response(JSON.stringify(url.includes('earth-search') ? earthSearch() : cmr()));
    },
  });
  return serve(t, handler).then((request) => ({ request, calls }));
}

test('the scene route queries both fixed STAC catalogues once, bounded', async (t) => {
  const { request, calls } = await scenes(t);
  const body = await (await request('scenes', QUERY)).json();
  assert.equal(calls.length, 2);
  assert.ok(calls.some((url) => url.startsWith('https://earth-search.aws.element84.com/v1/search?')));
  assert.ok(calls.some((url) => url.startsWith('https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search?')));
  for (const url of calls) assert.match(url, /limit=100/);
  assert.deepEqual(body.sources.map((row) => row.status), ['ok', 'ok']);
  assert.deepEqual(body.scenes.map((row) => row.productId).sort(), ['S30', null].sort());
  assert.equal(body.scenes.find((row) => row.source === 'earth-search').platform, 'sentinel-2b');
  // A repeat within ten minutes is served from cache.
  await request('scenes', QUERY);
  assert.equal(calls.length, 2);
});

test('an exhausted ledger refuses before any upstream request', async (t) => {
  const { request, calls } = await scenes(t, { budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) } });
  const body = await (await request('scenes', QUERY)).json();
  assert.equal(calls.length, 0);
  assert.deepEqual(body.sources.map((row) => row.status), ['blocked', 'blocked']);
  assert.deepEqual(body.scenes, []);
});

test('outage, truncation and 429 are reported per catalogue, with cooldown', async (t) => {
  const { request, calls } = await scenes(t, {
    respond: (url) =>
      url.includes('earth-search')
        ? new Response(JSON.stringify(earthSearch({ numberMatched: 300 })))
        : new Response('{}', { status: 429, headers: { 'retry-after': '600' } }),
  });
  const body = await (await request('scenes', QUERY)).json();
  assert.deepEqual(body.sources.map((row) => [row.id, row.status]), [
    ['earth-search', 'partial'],
    ['cmr-stac-lpcloud', 'rate-limited'],
  ]);
  const before = calls.length;
  // Another window: the rate-limited catalogue stays cooled down without a request.
  await request('scenes', QUERY.replace('2026-10-29', '2026-10-30'));
  assert.equal(calls.length - before, 1);
});

test('malformed upstream bodies read as invalid, network errors as unavailable', async (t) => {
  const { request } = await scenes(t, {
    respond: (url) => {
      if (url.includes('earth-search')) return new Response('{"nope":1}');
      throw new Error('ECONNRESET');
    },
  });
  const body = await (await request('scenes', QUERY)).json();
  assert.deepEqual(body.sources.map((row) => row.status), ['invalid-response', 'unavailable']);
});

test('the scene route rejects unbounded or future queries', async (t) => {
  const { request, calls } = await scenes(t);
  for (const query of [
    'bbox=70,20,80,30&from=2026-11-01&to=2026-11-07',
    'bbox=78,30,78.1,30.1&from=2026-10-01&to=2026-11-07',
    'bbox=78,30,78.1,30.1&from=2026-11-07&to=2026-11-09',
    'bbox=78,30,78.1,30.1&from=2026-11-07&to=2026-11-07&url=https://x',
  ])
    assert.equal((await request('scenes', query)).status, 400, query);
  assert.equal(calls.length, 0);
  assert.match(stacSearchUrl({ url: 'https://example.test/search', collections: 'a' }, { bbox: [1, 2, 3, 4], from: '2026-11-01', to: '2026-11-02' }), /datetime=2026-11-01T00%3A00%3A00Z%2F2026-11-02T23%3A59%3A59Z/);
});

test('the cloud route asks Open-Meteo for one variable over fourteen days and caches by kilometre', async (t) => {
  const calls = [];
  const reserved = [];
  const time = Array.from({ length: 336 }, (_, i) => new Date(now + i * 3600000).toISOString().slice(0, 16));
  const handler = createCloudForecastMiddleware({
    now: () => now,
    budget: { reserve: async () => (reserved.push(1), { ok: true }) },
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ hourly: { time, cloud_cover: time.map((_, i) => i % 101) } }));
    },
  });
  const request = await serve(t, handler);
  const body = await (await request('cloud', 'lat=30.4598&lon=78.0644')).json();
  assert.equal(body.status, 'ok');
  assert.equal(body.hours.length, 336);
  assert.equal(body.hours[0].time, '2026-11-07T06:00:00.000Z');
  await request('cloud', 'lat=30.4601&lon=78.0649');
  assert.equal(calls.length, 1);
  assert.equal(reserved.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('hourly'), 'cloud_cover');
  assert.equal(url.searchParams.get('forecast_days'), '14');
  assert.equal((await request('cloud', 'lat=91&lon=0')).status, 400);
  assert.equal(cloudForecastUrl({ lat: 30.46, lon: 78.06 }).startsWith('https://api.open-meteo.com/v1/forecast?'), true);
  assert.throws(() => normalizeCloudForecast({ hourly: { time: ['x'], cloud_cover: [1] } }, now));
});

test('the cloud route refuses before dispatch when the shared ledger is exhausted', async (t) => {
  let calls = 0;
  const handler = createCloudForecastMiddleware({
    now: () => now,
    budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) },
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}');
    },
  });
  const request = await serve(t, handler);
  const body = await (await request('cloud', 'lat=30.4598&lon=78.0644')).json();
  assert.equal(calls, 0);
  assert.equal(body.status, 'blocked');
});

test('by default the cloud route charges the existing field-context ledger file', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./index.js', import.meta.url), 'utf8'),
  );
  assert.match(source, /budget = createFieldContextBudget\(\{ now \}\)/);
  assert.match(source, /orbit-witness-stac-budget\.json/);
  assert.equal(path.basename('orbit-witness-stac-budget.json'), 'orbit-witness-stac-budget.json');
});

test('the provider is registered among the local plugins, free-only included', () => {
  assert.equal(orbitWitnessProxy().name, 'orbit-witness');
  for (const freeOnly of [false, true])
    assert.ok(localProviderPlugins({ freeOnly }).some((plugin) => plugin.name === 'orbit-witness'));
});
