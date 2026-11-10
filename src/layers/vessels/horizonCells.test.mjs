import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';

import { HORIZON_CELL_DEG, horizonCellKey } from './horizonCells.js';
import { createHorizonVisibility } from './horizonVisibility.js';

/** Deterministic PRNG so a failure reproduces. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Vessels as the layer holds them: a record and its horizon point. */
function fixtureFleet(random, count) {
  const visuals = new Map();
  const records = [];
  for (let i = 0; i < count; i++) {
    // Clusters (ports, lanes) and scatter, plus the poles and dateline.
    const clustered = random() < 0.6;
    const lat = clustered
      ? 30 + random() * 4
      : i % 97 === 0
        ? 90 * Math.sign(random() - 0.5)
        : random() * 180 - 90;
    const lon = clustered
      ? -75 + random() * 4
      : i % 89 === 0
        ? 180 * Math.sign(random() - 0.5)
        : random() * 360 - 180;
    const record = { lat, lon };
    records.push(record);
    visuals.set(record, {
      surfacePosition:
        i % 211 === 0 ? null : Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    });
  }
  return { records, getVisual: (record) => visuals.get(record) };
}

/** Cameras from street level to far space, above and below the surface. */
function fixtureCameras(random, count) {
  const heights = [-50, 5, 300, 2_000, 30_000, 400_000, 5e6, 2e7, 8e7];
  return Array.from({ length: count }, (_, i) =>
    Cesium.Cartesian3.fromDegrees(
      random() * 360 - 180,
      random() * 180 - 90,
      heights[i % heights.length] * (0.5 + random()),
    ),
  );
}

/** The per-vessel pass this replaces. */
function perVessel(records, getVisual, occluder) {
  return records.map((record) => {
    const point = getVisual(record).surfacePosition;
    if (!point || !occluder) return true;
    return occluder.isPointVisible(point);
  });
}

function perCell(horizon, records, getVisual, camera, occluder) {
  horizon.prepare(records, getVisual, 1);
  horizon.classify(camera);
  return records.map((record, i) =>
    horizon.isVisible(i, getVisual(record).surfacePosition, occluder),
  );
}

test('per-cell visibility equals the per-vessel horizon test (randomized)', () => {
  for (const seed of [1, 2, 3, 4]) {
    const random = rng(seed);
    const { records, getVisual } = fixtureFleet(random, 3_000);
    const horizon = createHorizonVisibility();
    for (const camera of fixtureCameras(random, 40)) {
      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        camera,
      );
      assert.deepEqual(
        perCell(horizon, records, getVisual, camera, occluder),
        perVessel(records, getVisual, occluder),
        `seed ${seed}`,
      );
    }
  }
});

test('vessels right at the horizon still match the per-vessel test', () => {
  const camera = Cesium.Cartesian3.fromDegrees(0, 0, 1_000_000);
  const occluder = new Cesium.EllipsoidalOccluder(
    Cesium.Ellipsoid.WGS84,
    camera,
  );
  // The horizon from 1,000 km sits about 28.9° away; sample densely across it.
  const records = [];
  const visuals = new Map();
  for (let k = 0; k < 4_000; k++) {
    const record = { lat: 0, lon: 27 + k * 0.001 };
    records.push(record);
    visuals.set(record, {
      surfacePosition: Cesium.Cartesian3.fromDegrees(record.lon, 0, 0),
    });
  }
  const getVisual = (record) => visuals.get(record);
  const expected = perVessel(records, getVisual, occluder);
  assert.ok(expected.includes(true) && expected.includes(false));
  assert.deepEqual(
    perCell(createHorizonVisibility(), records, getVisual, camera, occluder),
    expected,
  );
});

test('without a camera every vessel reads visible, as before', () => {
  const { records, getVisual } = fixtureFleet(rng(9), 50);
  const horizon = createHorizonVisibility();
  horizon.prepare(records, getVisual, 1);
  horizon.classify(null);
  assert.ok(
    records.every((record, i) =>
      horizon.isVisible(i, getVisual(record).surfacePosition, null),
    ),
  );
});

test('most cells are decided without testing their vessels', () => {
  const { records, getVisual } = fixtureFleet(rng(5), 12_000);
  const horizon = createHorizonVisibility();
  horizon.prepare(records, getVisual, 1);
  const stats = horizon.classify(
    Cesium.Cartesian3.fromDegrees(-70, 30, 8_000_000),
  );
  assert.ok(stats.cellsTested < stats.cellsDecided / 4, JSON.stringify(stats));
});

test('the index is rebuilt only when the records or a point change', () => {
  const { records, getVisual } = fixtureFleet(rng(6), 20);
  const horizon = createHorizonVisibility();
  let reads = 0;
  const counting = (record) => {
    reads++;
    return getVisual(record);
  };
  horizon.prepare(records, counting, 1);
  const afterBuild = reads;
  horizon.prepare(records, counting, 1);
  assert.equal(reads, afterBuild);
  horizon.prepare(records, counting, 2);
  assert.ok(reads > afterBuild);
});

test('cell keys are integers that wrap at the dateline and clamp at the pole', () => {
  assert.equal(horizonCellKey(0, 180), horizonCellKey(0, -180));
  assert.equal(horizonCellKey(90, 0), horizonCellKey(89.9, 0));
  assert.notEqual(horizonCellKey(0, 0), horizonCellKey(0, HORIZON_CELL_DEG));
  assert.ok(Number.isInteger(horizonCellKey(-12.3, 45.6)));
});
