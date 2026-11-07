// i18n-ignore-file: horizon engine fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AZIMUTH_COUNT,
  EARTH_RADIUS_M,
  HORIZON_LABEL,
  HORIZON_REFRACTION_K,
} from './constants.js';
import { bearingDeg, destination, distanceM, radialDistances } from './geodesy.js';
import { apparentElevationDeg, horizonAt, marchHorizon } from './rayMarch.js';
import { base64ToInt16, decodeGridPayload, int16ToBase64 } from './grid.js';
import { computeHorizon } from './compute.js';
import { syntheticPayload } from './testFixtures.mjs';

const DEG = 180 / Math.PI;

test('radial schedule starts at 60 m, steps 30 m near and 1 % far, ends at the radius', () => {
  const d = radialDistances(200000);
  assert.equal(d[0], 60);
  assert.equal(d[1], 90);
  assert.equal(d.at(-1), 200000);
  assert.ok(d.every((value, i) => i === 0 || value > d[i - 1]));
  assert.ok(d.length > 450 && d.length < 650, `count ${d.length}`);
  const i = d.findIndex((value) => value > 50000);
  assert.ok(Math.abs(d[i] - d[i - 1] - d[i - 1] * 0.01) < 0.2);
});

test('destination, distance and bearing agree for a 74 km ray', () => {
  const start = { lat: 30.4597, lon: 78.1058 };
  const end = destination(start.lat, start.lon, 35, 74000);
  assert.ok(Math.abs(distanceM(start, end) - 74000) < 0.01);
  assert.ok(Math.abs(bearingDeg(start, end) - 35) < 1e-6);
});

test('ray-march finds the known horizon of a synthetic ring ridge', () => {
  // Flat plain at 0 m with a 100 m ridge 1 km away in every direction.
  const payload = syntheticPayload({
    height: (az, d) => (d >= 990 && d <= 1020 ? 100 : 0),
  });
  const { grid } = decodeGridPayload(payload);
  const horizon = marchHorizon(grid, 0);
  const ridgeAt = grid.distances.find((d) => d >= 990);
  const expected = apparentElevationDeg(100, ridgeAt, 0);
  assert.equal(horizon.elevationDeg.length, AZIMUTH_COUNT);
  for (const value of horizon.elevationDeg)
    assert.ok(Math.abs(value - expected) < 1e-9);
  assert.ok(Math.abs(expected - Math.atan(100 / ridgeAt) * DEG) < 0.01);
  assert.equal(horizon.distanceM[0], ridgeAt);
  assert.equal(horizon.refractionK, HORIZON_REFRACTION_K);
});

test('ray-march picks the higher angle, not the higher mountain', () => {
  // East: 200 m hill at 2 km (5.7°) in front of a 2000 m range at 15 km (7.6°).
  const payload = syntheticPayload({
    height: (az, d) =>
      az === 90
        ? Math.abs(d - 2000) < 20
          ? 200
          : Math.abs(d - 15000) < 100
            ? 2000
            : 0
        : 0,
  });
  const { grid } = decodeGridPayload(payload);
  const horizon = marchHorizon(grid, 0);
  assert.ok(Math.abs(horizon.distanceM[180] - 15000) < 160);
  assert.equal(horizon.heightM[180], 2000);
  assert.ok(horizonAt(horizon, 90) > 7);
  assert.ok(horizonAt(horizon, 90.25) > 3, 'interpolates between rays');
});

test('refraction k = 0.13 lifts distant terrain by the effective-radius term', () => {
  const d = 100000;
  const without = apparentElevationDeg(0, d, 0, 0);
  const withK = apparentElevationDeg(0, d, 0, 0.13);
  // Geometric dip of sea level at 100 km: d / 2R radians.
  assert.ok(
    Math.abs(without - -Math.atan(d / (2 * EARTH_RADIUS_M)) * DEG) < 1e-9,
  );
  assert.ok(
    Math.abs(withK - without - ((0.13 * d) / (2 * EARTH_RADIUS_M)) * DEG) <
      1e-4,
  );
  assert.ok(withK > without);
  assert.throws(() => apparentElevationDeg(0, d, 0, 1), /refraction/);
  assert.throws(() => apparentElevationDeg(0, 0, 0), /positive/);
});

test('voids never raise the horizon, are counted, and an all-void ray is null', () => {
  const payload = syntheticPayload({
    height: (az, d) =>
      az === 0
        ? -32768
        : az === 90 && d < 5000
          ? -32768
          : d > 3000 && d < 3100
            ? 50
            : 0,
  });
  const { grid, meta } = decodeGridPayload(payload);
  const horizon = marchHorizon(grid, 0);
  assert.equal(horizon.elevationDeg[0], null);
  assert.equal(horizon.distanceM[0], null);
  assert.ok(horizon.elevationDeg[180] < 0, 'ridge inside the void is not invented');
  assert.ok(horizon.elevationDeg[90] > 0, 'other rays still see the ridge');
  assert.equal(horizon.voidSamples, meta.voidSamples);
  assert.ok(meta.voidSamples > grid.distances.length);
  const result = computeHorizon({
    payload,
    localDate: '2026-12-21',
    timeZone: 'Asia/Kolkata',
    now: '2026-11-07T00:00:00.000Z',
  });
  assert.equal(result.dem.voidSamples, meta.voidSamples);
});

test('grid codec round-trips and rejects foreign geometry', () => {
  const values = Int16Array.from([0, 1, -1, 32767, -32768, 6316]);
  assert.deepEqual(
    [...base64ToInt16(int16ToBase64(values), values.length)],
    [...values],
  );
  assert.throws(() => base64ToInt16(int16ToBase64(values), 5), /Invalid/);
  const payload = syntheticPayload();
  assert.throws(
    () =>
      decodeGridPayload({
        ...payload,
        distancesM: payload.distancesM.map((d) => d + 1),
      }),
    /Invalid/,
  );
  assert.throws(
    () => decodeGridPayload({ ...payload, azimuthCount: 360 }),
    /Invalid/,
  );
  assert.throws(
    () =>
      decodeGridPayload({
        ...payload,
        source: { ...payload.source, id: 'other' },
      }),
    /Invalid/,
  );
  assert.throws(
    () => decodeGridPayload({ ...payload, radiusM: 500000 }),
    /Invalid/,
  );
});

test('result is labelled terrain-only and states its method and limits', () => {
  const result = computeHorizon({
    payload: syntheticPayload({ groundM: 2000 }),
    observerHeightM: 1.7,
    localDate: '2026-12-21',
    timeZone: 'Asia/Kolkata',
    now: '2026-11-07T00:00:00.000Z',
  });
  assert.equal(result.label, HORIZON_LABEL);
  assert.equal(result.refractionK, 0.13);
  assert.match(result.method, /k = 0\.13/);
  assert.equal(result.observer.eyeM, 2001.7);
  assert.ok(result.limits.some((line) => /terrain-only/i.test(line)));
  assert.throws(
    () =>
      computeHorizon({
        payload: syntheticPayload(),
        observerHeightM: -1,
        localDate: '2026-12-21',
        timeZone: 'Asia/Kolkata',
      }),
    /observer/i,
  );
  assert.throws(
    () =>
      computeHorizon({
        payload: syntheticPayload({ groundM: null }),
        localDate: '2026-12-21',
        timeZone: 'Asia/Kolkata',
      }),
    /no height/,
  );
});
