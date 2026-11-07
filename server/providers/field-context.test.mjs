import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createFieldContextMiddleware,
  fieldContextProxy,
} from './field-context.js';
const now = Date.parse('2026-11-07T12:00:00Z');
function fixture(aq = false) {
  const time = Array.from({ length: 48 }, (_, i) =>
    new Date(now + i * 3600000).toISOString().slice(0, 16),
  );
  const values = aq
    ? { pm2_5: ['μg/m³', 12], pm10: ['μg/m³', 20], us_aqi: ['USAQI', 42] }
    : {
        temperature_2m: ['°C', 20],
        precipitation: ['mm', 0],
        precipitation_probability: ['%', 5],
        wind_speed_10m: ['m/s', 2],
        wind_gusts_10m: ['m/s', 3],
        weather_code: ['wmo code', 0],
      };
  return {
    latitude: 30.3,
    longitude: 78,
    utc_offset_seconds: 0,
    hourly: {
      time,
      ...Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, time.map(() => v[1])]),
      ),
    },
    hourly_units: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v[0]]),
    ),
  };
}
async function server(t, options = {}) {
  let calls = [];
  const handler = createFieldContextMiddleware({
    now: () => now,
    budget: { reserve: async () => ({ ok: true }) },
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(fixture(url.includes('air-quality'))));
    },
    ...options,
  });
  const s = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  const root = `http://127.0.0.1:${s.address().port}`;
  return {
    request: (query = 'lat=30.3165&lon=78.0322', init) =>
      fetch(root + '/api/field-context?' + query, init),
    calls,
    root,
  };
}
test('fixed free hosts, bounded model projection and cache coalescing', async (t) => {
  const { request, calls } = await server(t);
  const results = await Promise.all([request(), request()]);
  const data = await results[0].json();
  assert.equal(data.weather.state, 'ready');
  assert.equal(data.airQuality.resolutionM, 45000);
  assert.equal(calls.length, 2);
  for (const address of calls) {
    const u = new URL(address);
    assert.ok(
      ['api.open-meteo.com', 'air-quality-api.open-meteo.com'].includes(
        u.hostname,
      ),
    );
    assert.equal(u.searchParams.get('forecast_hours'), '48');
    assert.ok(!u.searchParams.has('apikey'));
  }
  assert.equal(
    (await (await request('lat=30.316501&lon=78.032201')).json()).requested.lat,
    30.316501,
  );
  assert.equal(calls.length, 2);
});
test('reject bad coordinates, cross-site requests, unsupported methods and user URL/variables before dispatch', async (t) => {
  const { request, calls, root } = await server(t);
  for (const q of [
    'lat=&lon=78',
    'lat=91&lon=78',
    'lat=30&lon=78&url=https://example.com',
    'lat=30&lat=31&lon=78',
    'lat=30&lon=78&aq=other',
  ])
    assert.equal((await request(q)).status, 400);
  assert.equal((await request(undefined, { method: 'POST' })).status, 405);
  assert.equal(
    (await request(undefined, { headers: { Origin: 'https://example.com' } }))
      .status,
    403,
  );
  assert.equal((await fetch(root + '/unrelated')).status, 404);
  assert.equal(calls.length, 0);
});
test('budget blocks never dispatch and AQ can be explicitly excluded', async (t) => {
  const blocked = await server(t, {
    budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) },
  });
  const data = await (await blocked.request()).json();
  assert.equal(data.weather.state, 'blocked');
  assert.equal(data.airQuality.reason, 'daily-limit');
  assert.equal(blocked.calls.length, 0);
  const simple = await server(t);
  const value = await (await simple.request('lat=30&lon=78&aq=0')).json();
  assert.equal(simple.calls.length, 1);
  assert.equal(value.airQuality.reason, 'disabled');
});
test('upstream failures retain stale provenance, isolated partial source, cooldown and deadline', async (t) => {
  let clock = now,
    fail = false,
    calls = 0;
  const { request } = await server(t, {
    now: () => clock,
    timeoutMs: 25,
    fetchImpl: async (url) => {
      calls++;
      if (fail)
        return new Response('', {
          status: 429,
          headers: { 'Retry-After': '600' },
        });
      return new Response(JSON.stringify(fixture(url.includes('air-quality'))));
    },
  });
  const first = await (await request()).json();
  clock += 2 * 3600000;
  fail = true;
  const stale = await (await request()).json();
  assert.equal(stale.weather.state, 'stale');
  assert.equal(stale.weather.retrievedAt, first.weather.retrievedAt);
  assert.equal(stale.weather.reason, 'rate-limited');
  const count = calls;
  clock += 6 * 60000;
  await request();
  assert.equal(calls, count);
  clock += 8 * 3600000;
  const old = await (await request()).json();
  assert.equal(old.weather.state, 'unavailable');
  const timeout = await server(t, {
    timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(
    (await (await timeout.request()).json()).weather.state,
    'unavailable',
  );
  const partial = await server(t, {
    fetchImpl: async (url) =>
      new Response(
        url.includes('air-quality') ? 'invalid' : JSON.stringify(fixture()),
      ),
  });
  const p = await (await partial.request()).json();
  assert.equal(p.weather.state, 'ready');
  assert.equal(p.airQuality.state, 'unavailable');
});
test('large bodies and excessive traffic are bounded without upstream retries', async (t) => {
  const big = await server(t, {
    fetchImpl: async () => new Response('x'.repeat(300000)),
  });
  assert.equal(
    (await (await big.request()).json()).weather.state,
    'unavailable',
  );
  const capped = await server(t);
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await capped.request()).status);
  assert.ok(statuses.includes(429));
  assert.equal(capped.calls.length, 2);
});

test('Vite plugin installs the full-path middleware in dev and preview', async () => {
  const { fieldContextProxy } = await import('./field-context.js');
  const plugin = fieldContextProxy({
    budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) },
  });
  const installed = [];
  const server = { middlewares: { use: (handler) => installed.push(handler) } };
  plugin.configureServer(server);
  plugin.configurePreviewServer(server);
  assert.equal(installed.length, 2);
  assert.equal(typeof installed[0], 'function');
});

test('Vite hooks install middleware without returning Connect as a post-hook', () => {
  const plugin = fieldContextProxy();
  const handlers = [];
  const server = {
    middlewares: {
      use(handler) {
        handlers.push(handler);
        return () => {
          throw new Error('Connect must not run without a request');
        };
      },
    },
  };
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
  assert.equal(handlers.length, 2);
});
