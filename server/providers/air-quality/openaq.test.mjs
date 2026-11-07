import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  createOpenAqAdapter,
  createOpenAqBudget,
  openAqQueryPoint,
} from './openaq.js';
import { normalizeHours, normalizeLocations } from './openaq-model.js';
import {
  FIXTURE_POINT,
  airQualityFixtureFetch,
  openAqHours,
  openAqLocations,
} from '../../../src/testSupport/airQualityFixtures.mjs';

const NOW = Date.parse('2026-11-07T06:20:00Z');
const HOUR = 3_600_000;
const KEY = 'fixture-key-not-real';
const open = { reserve: async () => ({ ok: true }) };

function adapter({ fetchImpl, budget = open, clock, resolveKey } = {}) {
  const calls = [];
  const time = clock ?? { now: NOW };
  const instance = createOpenAqAdapter({
    fetchImpl: fetchImpl ?? airQualityFixtureFetch({ now: NOW, calls }),
    resolveKey: resolveKey ?? (() => KEY),
    budget,
    now: () => time.now,
    sleep: async () => {},
  });
  return { instance, calls, time };
}

test('no saved key is a typed needs-key state with no request', async () => {
  let fetched = 0;
  const { instance } = adapter({
    resolveKey: () => '  ',
    fetchImpl: async () => {
      fetched += 1;
      return new Response('{}');
    },
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'needs-key');
  assert.equal(result.reason, 'no-key');
  assert.deepEqual(result.stations, []);
  assert.equal(fetched, 0);
});

test('a refused ledger reservation never dispatches', async () => {
  let fetched = 0;
  const { instance } = adapter({
    budget: { reserve: async () => ({ ok: false, reason: 'daily-limit' }) },
    fetchImpl: async () => {
      fetched += 1;
      return new Response('{}');
    },
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'daily-limit');
  assert.equal(fetched, 0);
});

test('the durable ledger refuses before dispatch once its day is spent', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openaq-ledger-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const budget = createOpenAqBudget({
    file: path.join(dir, 'ledger.json'),
    dailyLimit: 2,
    now: () => NOW,
  });
  assert.deepEqual(await budget.reserve(), { ok: true });
  assert.deepEqual(await budget.reserve(), { ok: true });
  assert.deepEqual(await budget.reserve(), {
    ok: false,
    reason: 'daily-limit',
  });
});

test('stations: monitors only, nearest first, key in a header, cached', async () => {
  const { instance, calls } = adapter();
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'ok');
  assert.deepEqual(
    result.stations.map((s) => s.name),
    ['Fixture monitor A', 'Fixture monitor B'],
  );
  const first = result.stations[0];
  assert.equal(first.id, 'openaq:9001');
  assert.equal(first.distanceM, 821);
  assert.deepEqual(first.licenses, ['CC BY 4.0']);
  assert.deepEqual(
    first.latest.map((row) => [row.pollutant, row.value, row.unit]),
    [
      ['co', 900, 'µg/m³'],
      ['no2', 35, 'µg/m³'],
      ['pm10', 110, 'µg/m³'],
      ['pm25', 62, 'µg/m³'],
    ],
  );
  // Temperature is not a pollutant this tier carries.
  assert.equal(first.sensors.length, 4);
  for (const call of calls) {
    assert.equal(call.headers['X-API-Key'], KEY);
    assert.ok(!call.url.includes(KEY));
  }
  const locations = calls.find((call) => call.url.includes('/locations?'));
  const query = new URL(locations.url).searchParams;
  assert.equal(query.get('radius'), '25000');
  assert.equal(query.get('monitor'), 'true');
  assert.equal(query.get('coordinates'), '30.32,78.03');
  const count = calls.length;
  await instance.nearby(FIXTURE_POINT);
  assert.equal(calls.length, count, 'a second lookup is served from cache');
});

test('no monitor within the radius reads no-monitor, never clean', async () => {
  const calls = [];
  const { instance } = adapter({
    fetchImpl: airQualityFixtureFetch({ now: NOW, calls, empty: true }),
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'no-monitor');
  assert.deepEqual(result.stations, []);
  assert.equal(calls.length, 1);
});

test('old readings are stale after 3 h and no-data after 24 h', async () => {
  const stale = adapter({
    fetchImpl: airQualityFixtureFetch({ now: NOW, latestAgeMs: 5 * HOUR }),
  });
  assert.equal((await stale.instance.nearby(FIXTURE_POINT)).state, 'stale');
  const silent = adapter({
    fetchImpl: airQualityFixtureFetch({ now: NOW, latestAgeMs: 30 * HOUR }),
  });
  const result = await silent.instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'no-data');
  assert.equal(result.stations.length, 2, 'monitors are still listed');
});

test('one station failing makes the lookup partial', async () => {
  const base = airQualityFixtureFetch({ now: NOW });
  const { instance } = adapter({
    fetchImpl: async (url, init) =>
      String(url).includes('/locations/9002/latest')
        ? new Response('down', { status: 500 })
        : base(url, init),
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'partial');
  assert.equal(result.reason, 'unavailable');
  assert.deepEqual(result.stations[1].latest, []);
});

test('a transient 503 is retried once, each attempt reserved', async () => {
  const base = airQualityFixtureFetch({ now: NOW });
  let reservations = 0;
  let failed = false;
  const { instance } = adapter({
    budget: {
      reserve: async () => {
        reservations += 1;
        return { ok: true };
      },
    },
    fetchImpl: async (url, init) => {
      if (!failed && String(url).includes('/locations?')) {
        failed = true;
        return new Response('busy', { status: 503 });
      }
      return base(url, init);
    },
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'ok');
  assert.equal(reservations, 4, 'retry + locations + two latest');
});

test('429 starts a cooldown that suppresses further requests', async () => {
  let fetched = 0;
  const { instance } = adapter({
    fetchImpl: async () => {
      fetched += 1;
      return new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '120' },
      });
    },
  });
  assert.equal((await instance.nearby(FIXTURE_POINT)).state, 'rate-limited');
  const elsewhere = await instance.nearby({ lat: 28.6, lon: 77.2 });
  assert.equal(elsewhere.state, 'rate-limited');
  assert.equal(fetched, 1);
});

test('a rejected key is needs-key, not an outage', async () => {
  const { instance } = adapter({
    fetchImpl: async () => new Response('{}', { status: 401 }),
  });
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'needs-key');
  assert.equal(result.reason, 'key-rejected');
});

test('malformed payloads are a typed invalid-response', async () => {
  const { instance } = adapter({
    fetchImpl: async () => new Response(JSON.stringify({ results: 'nope' })),
  });
  assert.equal(
    (await instance.nearby(FIXTURE_POINT)).state,
    'invalid-response',
  );
  assert.throws(() => normalizeLocations({ results: [null] }), /Invalid/);
});

test('a failed refresh serves the cached lookup as stale', async () => {
  const base = airQualityFixtureFetch({ now: NOW });
  let down = false;
  const { instance, time } = adapter({
    fetchImpl: async (url, init) =>
      down ? new Response('down', { status: 502 }) : base(url, init),
  });
  assert.equal((await instance.nearby(FIXTURE_POINT)).state, 'ok');
  down = true;
  time.now = NOW + 90 * 60_000;
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'stale');
  assert.equal(result.stations[0].latest.length, 4);
});

test('station series fetch each NAQI pollutant once, in order', async () => {
  const { instance, calls } = adapter();
  const { stations } = await instance.nearby(FIXTURE_POINT);
  const before = calls.length;
  const detail = await instance.stationSeries(stations[0]);
  assert.equal(detail.state, 'ok');
  assert.deepEqual(Object.keys(detail.series), ['pm25', 'pm10', 'no2', 'co']);
  assert.equal(detail.series.pm25.length, 24);
  const hourCalls = calls.slice(before).map((call) => new URL(call.url));
  assert.equal(hourCalls.length, 4);
  assert.equal(hourCalls[0].pathname, '/v3/sensors/9101/hours');
  assert.equal(
    hourCalls[0].searchParams.get('datetime_to'),
    '2026-11-07T07:00:00.000Z',
  );
});

test('a budget refusal mid-series stops dispatch and reports partial', async () => {
  let allowed = 4;
  const calls = [];
  const { instance } = adapter({
    fetchImpl: airQualityFixtureFetch({ now: NOW, calls }),
    budget: {
      reserve: async () =>
        allowed-- > 0 ? { ok: true } : { ok: false, reason: 'daily-limit' },
    },
  });
  const { stations } = await instance.nearby(FIXTURE_POINT);
  const detail = await instance.stationSeries(stations[0]);
  assert.equal(detail.state, 'partial');
  assert.equal(detail.reason, 'blocked');
  assert.deepEqual(Object.keys(detail.series), ['pm25']);
  assert.equal(calls.length, 4);
});

test('sensor series is typed for the watch and rejects bad ids', async () => {
  const { instance } = adapter();
  const ok = await instance.sensorSeries(9101);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.hours.length, 24);
  assert.equal((await instance.sensorSeries(-1)).state, 'invalid-request');
});

test('hours keep flags and drop rows that are not one clock hour', () => {
  const payload = openAqHours({ now: NOW, count: 4, flaggedEvery: 2 });
  payload.results.push({
    ...payload.results[0],
    period: {
      datetimeFrom: { utc: '2026-11-07T00:00:00Z' },
      datetimeTo: { utc: '2026-11-07T02:00:00Z' },
    },
  });
  const hours = normalizeHours(payload);
  assert.equal(hours.length, 4);
  assert.deepEqual(
    hours.map((hour) => hour.flagged),
    [false, true, false, true],
  );
  assert.equal(openAqLocations().results.length, 3);
  assert.deepEqual(openAqQueryPoint(FIXTURE_POINT), { lat: 30.32, lon: 78.03 });
});
