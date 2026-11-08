import assert from 'node:assert/strict';
import test from 'node:test';
import { perfBudgetTestOptions } from '../../scripts/run-perf-tests.mjs';
import {
  assertWithinBudgets,
  measureRuns,
  seededRandom,
} from '../testSupport/perfBench.mjs';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { filterFires } from './firmsIntensity.js';
import { binFires, blurGaussian, buildHeatRaster } from './firmsHeatRaster.js';
import { HEAT_RASTER } from '../layers/firms/policy.js';

// FIRMS ingest -> filter -> global heat raster, the work one data refresh or
// filter drag costs (src/layers/firms/ingestion.js applyFilter and
// rendering.js rebuildHeatRaster). 100,000 synthetic proxy records clustered
// like real fire seasons; the raster uses the production HEAT_RASTER grid.
// The per-cell "N FIRES" aggregation lives inside createRendering's closure
// (not exported), so it is not measured here.
//
// Measured 2026-11-08, Apple M4, Node v26.13.0 — per-run median of 7 (5 for
// blur/buildHeatRaster) after warm-up, median (range) over 3 runs:
//   adapt=39.2ms (31.6-44.1)  filter=2.2ms (2.0-2.3)  bin=3.6ms (3.4-4.2)
//   blur=31.5ms (30.1-38.0)  buildHeatRaster=69.6ms (65.7-80.8)
// Budgets are roughly 2.5x those medians.

const FIRE_COUNT = 100_000;
const CLUSTER_COUNT = 400;
const CLUSTER_SPREAD_DEG = 1.5;
const SEED = 0xf1e5;
const RUNS = Object.freeze({ warmup: 3, runs: 7 });
const RASTER_RUNS = Object.freeze({ warmup: 2, runs: 5 });
const STRONG_FIRE_FILTER = Object.freeze({ minFrp: 10, confidence: 'nominal' });
const BUDGET_MS = Object.freeze({
  adapt: 100,
  filter: 6,
  bin: 10,
  blur: 85,
  buildHeatRaster: 180,
});

const SATELLITES = Object.freeze(['N', 'N20', 'N21', 'Terra', 'Aqua']);
const CONFIDENCE = Object.freeze(['l', 'n', 'h', '45', '80']);
const ACQ_DATES = Object.freeze(['2026-11-06', '2026-11-07']);

/** Deterministic FIRMS proxy rows (src/data/firmsCsv.js shape). */
function syntheticFirmsRecords(count, seed = SEED) {
  const random = seededRandom(seed);
  const centres = Array.from({ length: CLUSTER_COUNT }, () => ({
    lat: -40 + random() * 100,
    lon: -180 + random() * 360,
  }));
  return Array.from({ length: count }, (_, i) => {
    const centre = centres[i % CLUSTER_COUNT];
    const spread = (random() + random() - 1) * CLUSTER_SPREAD_DEG;
    const lat = Math.max(-89.9, Math.min(89.9, centre.lat + spread));
    const lon = ((centre.lon + spread * 1.3 + 540) % 360) - 180;
    return {
      lat: lat.toFixed(5),
      lon: lon.toFixed(5),
      frp: (-Math.log(1 - random()) * 12).toFixed(2),
      confidence: CONFIDENCE[i % CONFIDENCE.length],
      brightness: (300 + random() * 80).toFixed(1),
      daynight: i % 3 === 0 ? 'N' : 'D',
      acqDate: ACQ_DATES[i % ACQ_DATES.length],
      acqTime: String((i * 7) % 2400).padStart(4, '0'),
      instrument: i % 5 < 3 ? 'VIIRS' : 'MODIS',
      satellite: SATELLITES[i % SATELLITES.length],
    };
  });
}

const RECORDS = syntheticFirmsRecords(FIRE_COUNT);

test('synthetic FIRMS inputs adapt and bin deterministically', () => {
  const fires = adaptFirmsRecords(RECORDS);
  assert.equal(fires.length, FIRE_COUNT);
  assert.equal(fires.at(-1).index, FIRE_COUNT - 1);
  const strong = filterFires(fires, STRONG_FIRE_FILTER);
  assert.ok(strong.length > 0 && strong.length < FIRE_COUNT);
  assert.deepEqual(
    filterFires(fires, STRONG_FIRE_FILTER).map((fire) => fire.index),
    strong.map((fire) => fire.index),
  );
  const width = 256;
  const height = 128;
  const grid = binFires(fires, { width, height });
  const total = grid.reduce((sum, value) => sum + value, 0);
  const expected = fires.reduce(
    (sum, fire) => sum + Math.max(0.5, fire.frp || 0),
    0,
  );
  assert.ok(
    Math.abs(total - expected) / expected < 1e-3,
    'binning conserves FRP',
  );
});

test(
  `100,000-fire FIRMS ingest and ${HEAT_RASTER.width}x${HEAT_RASTER.height} heat raster stay within budget`,
  perfBudgetTestOptions(),
  (t) => {
    const adapt = measureRuns(() => adaptFirmsRecords(RECORDS), RUNS);
    const fires = adapt.result;
    assert.equal(fires.length, FIRE_COUNT);

    const filter = measureRuns(
      () => filterFires(fires, STRONG_FIRE_FILTER),
      RUNS,
    );
    const { width, height, sigmaPx } = HEAT_RASTER;
    const bin = measureRuns(() => binFires(fires, { width, height }), RUNS);
    const blur = measureRuns(
      () => blurGaussian(bin.result, width, height, sigmaPx),
      RASTER_RUNS,
    );
    const raster = measureRuns(
      () => buildHeatRaster(fires, HEAT_RASTER),
      RASTER_RUNS,
    );
    assert.equal(raster.result.rgba.length, width * height * 4);
    assert.ok(raster.result.reference > 0);

    const timings = { adapt, filter, bin, blur, buildHeatRaster: raster };
    assertWithinBudgets(t, timings, BUDGET_MS);
  },
);
