import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATION_WATCH_COOLDOWN_MS,
  conditionThreshold,
  createStationCondition,
  createStationWatchSource,
  describeCondition,
  evaluateCondition,
  reduceStationWatchCheck,
  validateStationCondition,
} from './watch.js';
import {
  createWatchDefinition,
  emptyWatchRuntime,
  validateWatchRecord,
  validateWatchRuntime,
} from '../watchlists/model.js';
import { hourRows } from '../testSupport/airQualityFixtures.mjs';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-07T06:20:00Z');
const station = {
  id: 'openaq:9001',
  name: 'Fixture monitor A',
  lat: 30.32,
  lon: 78.04,
  sensors: [
    { sensorId: 90011, pollutant: 'pm25', unit: 'µg/m³' },
    { sensorId: 90012, pollutant: 'pm10', unit: 'µg/m³' },
  ],
};
const condition = createStationCondition({
  station,
  pollutant: 'pm25',
  category: 'poor',
});
const series = (now, value, count = 24) => ({
  state: 'ok',
  retrievedAt: new Date(now).toISOString(),
  hours: hourRows({ now, value, count }),
});

/** Run checks one hour apart; returns every runtime. */
function run(values, { start = T0, runtime = emptyWatchRuntime() } = {}) {
  const runtimes = [];
  let current = runtime;
  values.forEach((value, i) => {
    const now = start + i * HOUR;
    const result = typeof value === 'object' ? value : series(now, value);
    current = validateWatchRuntime(
      reduceStationWatchCheck(current, result, {
        condition,
        now,
        intervalMs: HOUR,
      }),
    );
    runtimes.push(current);
  });
  return runtimes;
}

test('a condition names one station sensor and a NAQI category', () => {
  assert.deepEqual(condition, {
    type: 'aq-station-threshold',
    provider: 'openaq',
    stationId: 'openaq:9001',
    stationName: 'Fixture monitor A',
    sensorId: 90011,
    pollutant: 'pm25',
    category: 'poor',
  });
  assert.deepEqual(conditionThreshold(condition), {
    value: 91,
    unit: 'µg/m³',
    averagingHours: 24,
  });
  assert.equal(describeCondition(condition).categoryLabel, 'Poor');
  assert.throws(() =>
    createStationCondition({ station, pollutant: 'o3', category: 'poor' }),
  );
  assert.throws(() =>
    validateStationCondition({ ...condition, category: 'good' }),
  );
  assert.throws(() =>
    validateStationCondition({ ...condition, stationId: 'x' }),
  );
});

test('evaluation uses the 24 h mean and its completeness rule', () => {
  assert.equal(
    evaluateCondition(condition, hourRows({ now: T0, value: 95 })).side,
    'above',
  );
  assert.equal(
    evaluateCondition(condition, hourRows({ now: T0, value: 89 })).side,
    'below',
  );
  const thin = evaluateCondition(
    condition,
    hourRows({ now: T0, value: 300, count: 12 }),
  );
  assert.equal(thin.state, 'insufficient');
  assert.equal(evaluateCondition(condition, []).state, 'no-data');
});

test('the first check is a silent baseline, even when already above', () => {
  const [first] = run([150]);
  assert.equal(first.notifications.length, 0);
  assert.equal(first.station.side, 'above');
  assert.notEqual(first.baselineAt, null);
  assert.equal(first.coverage, 'complete');
});

test('fires once per crossing, not while it stays above', () => {
  const runtimes = run([40, 40, 150, 150, 150]);
  assert.equal(runtimes.at(-1).notifications.length, 1);
  const note = runtimes.at(-1).notifications[0];
  assert.equal(note.kind, 'aq-crossing');
  assert.equal(note.stationId, 'openaq:9001');
  assert.equal(note.pollutant, 'pm25');
  assert.equal(note.category, 'poor');
  assert.equal(note.mean, 150);
  assert.equal(note.unit, 'µg/m³');
  assert.equal(note.averagingHours, 24);
  assert.equal(note.hours, 24);
  // 301 + 99/129 × (150 − 121) = 323.3 → 323
  assert.equal(note.index, 323);
});

test('a cooldown suppresses a second crossing within six hours', () => {
  const quick = run([40, 150, 40, 150]);
  assert.equal(quick.at(-1).notifications.length, 1);
  // Re-armed after the cooldown has elapsed.
  const later = run([40, 150, 40], {});
  const after = run([150], {
    start: T0 + 2 * HOUR + STATION_WATCH_COOLDOWN_MS,
    runtime: later.at(-1),
  });
  assert.equal(after.at(-1).notifications.length, 2);
});

test('the same observation hour is never evaluated twice', () => {
  const [baseline] = run([40]);
  const first = reduceStationWatchCheck(baseline, series(T0, 150), {
    condition,
    now: T0 + 10 * 60_000,
    intervalMs: HOUR,
  });
  assert.equal(first.coverage, 'stale');
  assert.equal(first.notifications.length, 0);
  assert.equal(first.station.side, 'below');
});

test('missing hours keep the last side: a gap is not a crossing', () => {
  const runtimes = run([
    40,
    {
      state: 'ok',
      retrievedAt: new Date(T0).toISOString(),
      hours: hourRows({ now: T0 + HOUR, value: 150, count: 10 }),
    },
    150,
  ]);
  assert.equal(runtimes[1].coverage, 'partial');
  assert.equal(runtimes[1].station.side, 'below');
  assert.equal(runtimes[2].notifications.length, 1);
});

test('source failure is unavailable and changes nothing else', () => {
  const [baseline] = run([40]);
  const failed = reduceStationWatchCheck(
    baseline,
    { state: 'blocked', hours: [] },
    { condition, now: T0 + HOUR, intervalMs: HOUR },
  );
  assert.equal(failed.coverage, 'unavailable');
  assert.equal(failed.lastSuccessAt, baseline.lastSuccessAt);
  assert.deepEqual(failed.station, baseline.station);
});

test('watch records carry the condition; FIRMS records cannot carry station state', () => {
  const place = {
    id: 'station:openaq:9001',
    name: station.name,
    geometry: { coordinates: [station.lon, station.lat] },
  };
  const definition = createWatchDefinition(
    { place, intervalMinutes: 60, condition },
    { id: 'w1', now: T0 },
  );
  assert.equal(definition.condition.sensorId, 90011);
  const runtime = run([40, 150]).at(-1);
  const record = validateWatchRecord({ definition, runtime, lease: null });
  assert.equal(record.runtime.notifications.length, 1);
  const { condition: _omit, ...firms } = definition;
  assert.throws(() =>
    validateWatchRecord({ definition: firms, runtime, lease: null }),
  );
  assert.throws(() =>
    validateWatchRuntime({ ...runtime, station: { side: 'sideways' } }),
  );
});

test('the watch source reads one sensor through the same-site client', async () => {
  const asked = [];
  const source = createStationWatchSource({
    stations: {
      sensor: async (id) => {
        asked.push(id);
        return series(T0, 40);
      },
    },
  });
  const result = await source.check(condition);
  assert.deepEqual(asked, [90011]);
  assert.equal(result.series.hours.length, 24);
  assert.throws(() => createStationWatchSource({}), TypeError);
});
