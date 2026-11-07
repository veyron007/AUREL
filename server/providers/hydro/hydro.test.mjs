import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createHydroMiddleware } from './index.js';
import { createHydroUpstreams, GLOFAS_UNITS } from './upstreams.js';

const now = Date.parse('2026-09-15T13:10:00Z');
const fixture = (name) =>
  new URL(`../../../src/hydro/fixtures/${name}`, import.meta.url);
const png = fs.readFileSync(fixture('imerg-30min-2026-09-15T1200Z-5-6-28.png'));
const colormap = fs.readFileSync(
  fixture('GPM_Precipitation_Rate-v1.3.xml'),
  'utf8',
);
const flood = fs.readFileSync(
  fixture('glofas-flood-30.05N-78.20E.json'),
  'utf8',
);

function forecastBody(url) {
  const lats = new URL(url).searchParams.get('latitude').split(',');
  const time = Array.from({ length: 48 }, (_, i) =>
    new Date(Date.parse('2026-09-15T13:00:00Z') + i * 3600_000)
      .toISOString()
      .slice(0, 16),
  );
  const one = (lat) => ({
    latitude: Number(lat),
    longitude: 78,
    elevation: 700,
    hourly: { time, precipitation: time.map(() => 0.5) },
    hourly_units: { precipitation: 'mm' },
  });
  return JSON.stringify(lats.length === 1 ? one(lats[0]) : lats.map(one));
}

function fakeFetch({ missing = [], status = {} } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const host = new URL(url).hostname;
    for (const [pattern, code] of Object.entries(status))
      if (url.includes(pattern)) return new Response('', { status: code });
    if (url.endsWith('GPM_Precipitation_Rate.xml'))
      return new Response(colormap);
    if (url.includes('/all/'))
      return new Response(
        '<Domains><Domain>2026-09-13/2026-09-15T12:00:00Z/PT30M</Domain></Domains>',
      );
    if (url.endsWith('.png'))
      return missing.some((time) => url.includes(time))
        ? new Response('', { status: 404 })
        : new Response(png);
    if (host === 'flood-api.open-meteo.com') return new Response(flood);
    if (host === 'api.open-meteo.com') return new Response(forecastBody(url));
    return new Response('', { status: 599 });
  };
  return { impl, calls };
}

async function serve(t, { fetchOptions, budget } = {}) {
  const fetched = fakeFetch(fetchOptions);
  const reservations = [];
  const handler = createHydroMiddleware({
    now: () => now,
    upstreams: createHydroUpstreams({
      fetchImpl: fetched.impl,
      now: () => now,
    }),
    budget: budget || {
      reserve: async () => {
        reservations.push(1);
        return { ok: true };
      },
    },
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
  return {
    get: async (path, init) => {
      const response = await fetch(root + path, init);
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    calls: fetched.calls,
    reservations,
  };
}

test('IMERG ready: fixed GIBS host, colormap intervals, no ledger units', async (t) => {
  const { get, calls, reservations } = await serve(t);
  const { status, body } = await get(
    '/api/hydro/imerg?cells=2580:1203&window=1h',
  );
  assert.equal(status, 200);
  assert.equal(body.state, 'ready');
  assert.equal(body.latest, '2026-09-15T12:00:00Z');
  assert.equal(body.steps.length, 2);
  const value = body.steps[0].values['2580:1203'];
  assert.ok(value.lo > 1.4 && value.hi < 1.5);
  assert.equal(reservations.length, 0);
  for (const url of calls)
    assert.equal(new URL(url).hostname, 'gibs.earthdata.nasa.gov');
});

test('IMERG partial and unavailable states are explicit', async (t) => {
  const partial = await serve(t, {
    fetchOptions: { missing: ['2026-09-15T11:30:00Z'] },
  });
  const p = (await partial.get('/api/hydro/imerg?cells=2580:1203&window=1h'))
    .body;
  assert.equal(p.state, 'partial');
  assert.equal(p.steps[1].published, false);
  assert.equal(p.steps[1].values['2580:1203'], null);
  const down = await serve(t, { fetchOptions: { status: { '/all/': 503 } } });
  const d = (await down.get('/api/hydro/imerg?cells=2580:1203&window=3h'))
    .body;
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'upstream-unavailable');
});

test('forecast reserves one unit per point before dispatch and caches', async (t) => {
  const { get, calls, reservations } = await serve(t);
  const path = '/api/hydro/forecast?pts=30.36,78.08;30.3,78.05';
  const first = (await get(path)).body;
  assert.equal(first.state, 'ready');
  assert.equal(first.unitsReserved, 2);
  assert.equal(first.points.length, 2);
  assert.equal(first.points[0].time[0], '2026-09-15T13:00:00Z');
  assert.equal(reservations.length, 2);
  const again = (await get(path)).body;
  assert.equal(again.cached, true);
  assert.equal(reservations.length, 2);
  const url = new URL(calls.find((c) => c.includes('api.open-meteo.com')));
  assert.equal(url.searchParams.get('hourly'), 'precipitation');
  assert.ok(!url.searchParams.has('apikey'));
});

test('GloFAS reserves its weighted units and returns the series for local ranking', async (t) => {
  const { get, reservations } = await serve(t);
  const body = (await get('/api/hydro/glofas?lat=30.05&lon=78.2')).body;
  assert.equal(body.state, 'ready');
  assert.equal(body.unitsReserved, GLOFAS_UNITS);
  assert.equal(reservations.length, GLOFAS_UNITS);
  assert.deepEqual(body.cell, { lat: 30.025002, lon: 78.17502 });
  assert.equal(body.time.length, body.values.length);
});

test('a refused ledger never dispatches and reports the reason', async (t) => {
  let count = 0;
  const { get, calls } = await serve(t, {
    budget: {
      reserve: async () =>
        ++count <= 3 ? { ok: true } : { ok: false, reason: 'minute-limit' },
    },
  });
  const body = (await get('/api/hydro/glofas?lat=30.05&lon=78.2')).body;
  assert.equal(body.state, 'blocked');
  assert.equal(body.reason, 'minute-limit');
  assert.equal(body.unitsReserved, 3);
  assert.equal(calls.length, 0);
});

test('upstream errors and rate limits become typed unavailable states', async (t) => {
  const limited = await serve(t, {
    fetchOptions: { status: { 'flood-api': 429, 'api.open-meteo.com': 500 } },
  });
  const g = (await limited.get('/api/hydro/glofas?lat=30.05&lon=78.2')).body;
  assert.equal(g.state, 'unavailable');
  assert.equal(g.reason, 'rate-limited');
  const f = (await limited.get('/api/hydro/forecast?pts=30.3,78.0')).body;
  assert.equal(f.state, 'unavailable');
  assert.equal(f.reason, 'upstream-unavailable');
});

test('bad queries, other methods and cross-site requests are refused before work', async (t) => {
  const { get, calls } = await serve(t);
  for (const path of [
    '/api/hydro/imerg?cells=2580:1203&window=6h',
    '/api/hydro/imerg?cells=9999:1&window=1h',
    '/api/hydro/imerg?cells=2580:1203,2610:1203&window=1h',
    '/api/hydro/imerg?cells=2580:1203&window=1h&url=https://example.com',
    '/api/hydro/forecast?pts=1,2;3,4;5,6;7,8',
    '/api/hydro/forecast?pts=91,2',
    '/api/hydro/glofas?lat=30&lon=78&daily=x',
  ])
    assert.equal((await get(path)).status, 400, path);
  assert.equal(
    (await get('/api/hydro/glofas?lat=30&lon=78', { method: 'POST' })).status,
    405,
  );
  assert.equal(
    (
      await get('/api/hydro/glofas?lat=30&lon=78', {
        headers: { Origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  assert.equal(calls.length, 0);
});
