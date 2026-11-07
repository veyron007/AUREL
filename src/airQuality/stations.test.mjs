import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stationIndices,
  stationReadings,
  validateBreathPayload,
  validateSensorPayload,
} from './stations.js';
import {
  createCompositeAirQualitySource,
  createIndiaStationLayerSource,
  indiaQueryPoint,
  stationLayerReading,
} from './indiaLayerSource.js';
import { createAirQualityStationsSource } from '../sources/airQualityStations.js';
import { breathPayload, hourRows } from '../testSupport/airQualityFixtures.mjs';

const NOW = Date.parse('2026-11-07T06:20:00Z');
const DOON_VIEW = { west: 77.5, south: 30, east: 78.5, north: 30.6 };

test('a valid payload keeps both tiers separate and copies its input', () => {
  const raw = breathPayload({ now: NOW });
  const payload = validateBreathPayload(raw);
  assert.equal(payload.stations.tier, 'station');
  assert.equal(payload.citizen.tier, 'citizen');
  assert.equal(payload.stations.stations.length, 2);
  assert.equal(payload.citizen.sensors[0].pm25, 48.2);
  raw.stations.stations[0].name = 'changed';
  assert.equal(payload.stations.stations[0].name, 'Fixture monitor A');
});

test('every typed station state validates; unknown states do not', () => {
  for (const state of [
    'no-monitor',
    'no-data',
    'stale',
    'needs-key',
    'blocked',
    'unavailable',
  ])
    assert.equal(
      validateBreathPayload(breathPayload({ now: NOW, state })).stations.state,
      state,
    );
  const bad = breathPayload({ now: NOW });
  bad.stations.state = 'clean';
  assert.throws(() => validateBreathPayload(bad), /Invalid/);
});

test('malformed and partial payloads are refused, not half-rendered', () => {
  const mutations = [
    (p) => (p.version = 2),
    (p) => (p.stations.stations[0].id = 'http://x'),
    (p) => (p.stations.stations[0].latest[0].unit = 'furlongs'),
    (p) => (p.stations.stations[0].latest[0].value = -5),
    (p) => (p.stations.detail.series.pb = []),
    (p) => (p.citizen.sensors[0].pm25 = 'high'),
    (p) => (p.requested = null),
  ];
  for (const mutate of mutations) {
    const payload = breathPayload({ now: NOW });
    mutate(payload);
    assert.throws(() => validateBreathPayload(payload), /Invalid/);
  }
});

test('station readings carry pollutant, unit, time and the observed class', () => {
  const payload = validateBreathPayload(breathPayload({ now: NOW }));
  const rows = stationReadings(payload.stations.stations[0]);
  assert.deepEqual(rows[1], {
    pollutant: 'pm25',
    label: 'PM2.5',
    value: 62,
    unit: 'µg/m³',
    observedAt: '2026-11-07T05:00:00.000Z',
    class: 'observed',
    basis: 'latest-hour',
  });
});

test('station indices are derived from 24 h means and state their basis', () => {
  const payload = validateBreathPayload(breathPayload({ now: NOW }));
  const indices = stationIndices(payload.stations.detail);
  assert.equal(indices.class, 'derived');
  // PM2.5 62 → 104; PM10 110 → 101 + 99/149 × 9 = 107
  assert.equal(indices.naqi.state, 'ok');
  assert.equal(indices.naqi.display, '107');
  assert.equal(indices.naqi.category, 'moderate');
  assert.equal(indices.naqi.categoryLabel, 'Moderately polluted');
  assert.equal(indices.naqi.dominant, 'PM10');
  assert.equal(indices.naqi.basisEnd, '2026-11-07T06:00:00.000Z');
  const pm25 = indices.naqi.rows.find((row) => row.pollutant === 'pm25');
  assert.equal(pm25.averagingHours, 24);
  assert.equal(pm25.hours, 24);
  assert.equal(pm25.from, '2026-11-06T06:00:00.000Z');
  assert.equal(indices.usAqi.state, 'ok');
  assert.equal(stationIndices(null), null);
});

test('too few hours yield an insufficient index, never a guess', () => {
  const detail = {
    stationId: 'openaq:9001',
    state: 'partial',
    series: {
      pm25: hourRows({ now: NOW, value: 62, count: 10 }),
      pm10: hourRows({ now: NOW, value: 110, count: 10 }),
      no2: hourRows({ now: NOW, value: 35, count: 10 }),
    },
  };
  const indices = stationIndices(detail);
  assert.equal(indices.naqi.state, 'insufficient');
  assert.equal(indices.naqi.reason, 'no-particulate');
  assert.equal(indices.naqi.rows[0].hours, 10);
});

test('sensor payloads validate for the watch', () => {
  const payload = validateSensorPayload({
    version: 1,
    sensorId: 90011,
    state: 'ok',
    reason: null,
    retrievedAt: new Date(NOW).toISOString(),
    hours: hourRows({ now: NOW, value: 62 }),
  });
  assert.equal(payload.hours.length, 24);
  assert.throws(() => validateSensorPayload({ version: 1, sensorId: 'x' }));
});

test('India query point: bounded view inside India only', () => {
  assert.deepEqual(indiaQueryPoint(DOON_VIEW), { lat: 30.3, lon: 78 });
  assert.equal(
    indiaQueryPoint({ west: 60, south: 0, east: 100, north: 40 }),
    null,
  );
  assert.equal(
    indiaQueryPoint({ west: -80, south: 43, east: -79, north: 44 }),
    null,
  );
  assert.equal(indiaQueryPoint(null), null);
});

test('layer readings show the latest hour in grey and say it is not an index', () => {
  const payload = validateBreathPayload(breathPayload({ now: NOW }));
  const reading = stationLayerReading(payload.stations.stations[0], NOW);
  assert.equal(reading.provider, 'openaq-in');
  assert.equal(reading.scale, 'PM2.5');
  assert.equal(reading.label, '62 µg/m³');
  assert.equal(reading.band, null);
  assert.equal(reading.color, '#6b7785');
  assert.equal(reading.risk, 'Latest hourly value, not an index');
  const old = validateBreathPayload(
    breathPayload({ now: NOW, latestAgeMs: 8 * 3_600_000 }),
  );
  assert.equal(stationLayerReading(old.stations.stations[0], NOW), null);
});

test('the India layer source asks only for bounded views and surfaces key state', async () => {
  const asked = [];
  const source = createIndiaStationLayerSource({
    now: () => NOW,
    stations: {
      near: async (point, options) => {
        asked.push({ point, options });
        return validateBreathPayload(breathPayload({ now: NOW }));
      },
    },
  });
  assert.deepEqual(await source.getSnapshot({ view: null }), []);
  assert.equal(asked.length, 0);
  const rows = await source.getSnapshot({ view: DOON_VIEW });
  assert.equal(rows.length, 2);
  assert.equal(asked[0].options.citizen, false);
  const keyless = createIndiaStationLayerSource({
    stations: {
      near: async () =>
        validateBreathPayload(breathPayload({ now: NOW, state: 'needs-key' })),
    },
  });
  await assert.rejects(keyless.getSnapshot({ view: DOON_VIEW }), /OpenAQ key/);
});

test('the composite keeps one provider when another fails', async () => {
  const ok = { getSnapshot: async () => [{ id: 'a' }] };
  const broken = {
    getSnapshot: async () => {
      throw new Error('down');
    },
  };
  const empty = { getSnapshot: async () => [] };
  assert.deepEqual(
    await createCompositeAirQualitySource([ok, broken]).getSnapshot(),
    [{ id: 'a' }],
  );
  await assert.rejects(
    createCompositeAirQualitySource([empty, broken]).getSnapshot(),
    /down/,
  );
  assert.throws(() => createCompositeAirQualitySource([{}]), TypeError);
});

test('the client validates, checks location and never builds upstream URLs', async () => {
  const urls = [];
  const client = createAirQualityStationsSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(breathPayload({ now: NOW })));
    },
  });
  const payload = await client.near(
    { lat: 30.3165, lon: 78.0322 },
    { detail: true, station: 'openaq:9001' },
  );
  assert.equal(payload.stations.state, 'ok');
  assert.equal(
    urls[0],
    '/api/air-quality/near?lat=30.3165&lon=78.0322&detail=1&citizen=1&station=openaq%3A9001',
  );
  await assert.rejects(client.near({ lat: 10, lon: 10 }), /mismatch/);
  await assert.rejects(client.sensor(0), TypeError);
  const failing = createAirQualityStationsSource({
    fetchImpl: async () => new Response('x', { status: 429 }),
  });
  await assert.rejects(
    failing.near({ lat: 30.3165, lon: 78.0322 }),
    (error) => error.code === 'rate-limited',
  );
});
