import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSensorCommunityAdapter,
  normalizeSensorCommunity,
} from './sensor-community.js';
import {
  FIXTURE_POINT,
  sensorCommunityArea,
} from '../../../src/testSupport/airQualityFixtures.mjs';

const NOW = Date.parse('2026-11-07T06:20:00Z');

function adapter(respond, clock = { now: NOW }) {
  const calls = [];
  const instance = createSensorCommunityAdapter({
    now: () => clock.now,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return respond(String(url));
    },
  });
  return { instance, calls, clock };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test('outdoor sensors only, nearest first, PM2.5 and PM10 kept', async () => {
  const { instance, calls } = adapter(() =>
    json(sensorCommunityArea({ now: NOW })),
  );
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'ok');
  assert.deepEqual(
    result.sensors.map((s) => s.id),
    ['sensor-community:501', 'sensor-community:502'],
  );
  assert.equal(result.sensors[0].pm25, 48.2);
  assert.equal(result.sensors[0].pm10, 70.1);
  assert.equal(result.sensors[0].sensorType, 'SDS011');
  assert.equal(
    calls[0],
    'https://data.sensor.community/airrohr/v1/filter/area=30.317,78.032,25',
  );
  await instance.nearby(FIXTURE_POINT);
  assert.equal(calls.length, 1, 'five-minute cache');
});

test('no citizen sensor in range is its own state', async () => {
  const { instance } = adapter(() => json([]));
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'no-sensor');
  assert.deepEqual(result.sensors, []);
});

test('readings older than an hour are stale', async () => {
  const { instance } = adapter(() =>
    json(sensorCommunityArea({ now: NOW, ageMs: 2 * 3_600_000 })),
  );
  assert.equal((await instance.nearby(FIXTURE_POINT)).state, 'stale');
});

test('upstream failure, 429 cooldown and malformed payloads are typed', async () => {
  const down = adapter(() => new Response('x', { status: 500 }));
  assert.equal(
    (await down.instance.nearby(FIXTURE_POINT)).state,
    'unavailable',
  );
  const limited = adapter(
    () => new Response('x', { status: 429, headers: { 'retry-after': '90' } }),
  );
  assert.equal(
    (await limited.instance.nearby(FIXTURE_POINT)).state,
    'rate-limited',
  );
  assert.equal(
    (await limited.instance.nearby({ lat: 10, lon: 10 })).state,
    'rate-limited',
  );
  assert.equal(limited.calls.length, 1);
  const broken = adapter(() => json({ not: 'an array' }));
  assert.equal(
    (await broken.instance.nearby(FIXTURE_POINT)).state,
    'invalid-response',
  );
});

test('a failed refresh serves cached sensors as stale', async () => {
  let fail = false;
  const { instance, clock } = adapter(() =>
    fail
      ? new Response('x', { status: 503 })
      : json(sensorCommunityArea({ now: NOW })),
  );
  await instance.nearby(FIXTURE_POINT);
  fail = true;
  clock.now = NOW + 10 * 60_000;
  const result = await instance.nearby(FIXTURE_POINT);
  assert.equal(result.state, 'stale');
  assert.equal(result.sensors.length, 2);
});

test('normalizer drops bad rows and sensors beyond the radius', () => {
  const rows = [
    ...sensorCommunityArea({ now: NOW }),
    { location: { id: 9, latitude: 'x', longitude: '78' }, timestamp: 'bad' },
    {
      ...sensorCommunityArea({ now: NOW })[0],
      location: { id: 777, indoor: 0, latitude: '31.5', longitude: '78.0' },
    },
  ];
  const sensors = normalizeSensorCommunity(rows, FIXTURE_POINT);
  assert.equal(sensors.length, 2);
  assert.ok(sensors.every((s) => s.distanceM <= 25_000));
  assert.match(sensors[0].observedAt, /Z$/);
});
