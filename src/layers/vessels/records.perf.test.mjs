import assert from 'node:assert/strict';
import test from 'node:test';
import { perfBudgetTestOptions } from '../../../scripts/run-perf-tests.mjs';
import {
  assertWithinBudgets,
  measureRuns,
  seededRandom,
} from '../../testSupport/perfBench.mjs';
import { VesselRecords } from './records.js';
import { createVesselLayer } from './index.js';
import { DEFAULT_RENDER_ROWS } from './policy.js';

// AIS vessel reconciliation at the default 12,000-row render cap.
//  - records: the portable VesselRecords.reconcile store with no-op effects.
//  - snapshot: the production snapshot path through createVesselLayer's
//    test seam (_applyAisFeedSnapshotForTest: classify -> reconcile ->
//    billboard add/update -> forced visibility + label pass) against a
//    non-recording billboard collection and a viewer without a real scene.
// Each "update" moves 10% of the fleet; reconcile still visits every row.
//
// Measured 2026-11-08, Apple M4, Node v26.13.0 — per-run median of 7 after
// warm-up, median (range) over 3 runs:
//   recordsInitial=2.4ms (1.9-2.7)  recordsUpdate=1.7ms (1.6-3.0)
//   snapshotInitial=18.6ms (18.6-24.6)  snapshotUpdate=13.9ms (12.8-14.4)
// Budgets are roughly 2.5-3x those medians, with a floor for sub-10 ms rows.

const VESSEL_COUNT = DEFAULT_RENDER_ROWS;
const MOVED_FRACTION_DIVISOR = 10;
const SEED = 0xa15;
const RUNS = Object.freeze({ warmup: 3, runs: 7 });
const BUDGET_MS = Object.freeze({
  recordsInitial: 8,
  recordsUpdate: 8,
  snapshotInitial: 55,
  snapshotUpdate: 40,
});
const VESSEL_TYPES = Object.freeze([
  'Cargo',
  'Tanker',
  'Fishing',
  'Passenger',
  'Tug',
  'Pleasure Craft',
]);
const noop = () => {};

/** Deterministic AIS proxy rows (/api/vessels `rows` shape). */
function syntheticVesselRows(count, seed = SEED) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    mmsi: String(200_000_000 + i),
    lat: Number((-60 + random() * 125).toFixed(5)),
    lon: Number((-180 + random() * 360).toFixed(5)),
    name: `SYNTH VESSEL ${i}`,
    imo: String(9_000_000 + i),
    type: VESSEL_TYPES[i % VESSEL_TYPES.length],
    destination: i % 4 ? 'ROTTERDAM' : '',
    speed: Number((random() * 24).toFixed(1)),
    course: Math.floor(random() * 360),
    heading: i % 7 ? Math.floor(random() * 360) : null,
    last_position_UTC: '2026-11-08T00:00:00Z',
    last_position_epoch: 1_793_836_800 + i,
  }));
}

/** New rows with every `divisor`-th vessel (offset by `pass`) nudged north. */
function moveFraction(rows, pass, divisor = MOVED_FRACTION_DIVISOR) {
  return rows.map((row, i) =>
    i % divisor === pass % divisor
      ? {
          ...row,
          lat: Math.min(89, row.lat + 0.01),
          course: (row.course + 5) % 360,
        }
      : row,
  );
}

function countingEffects() {
  const counts = { added: 0, updated: 0, removed: 0 };
  return {
    counts,
    effects: {
      add: () => {
        counts.added += 1;
      },
      beforeUpdate: () => null,
      updated: () => {
        counts.updated += 1;
      },
      remove: () => {
        counts.removed += 1;
      },
      removed: noop,
      staleSelected: noop,
    },
  };
}

/** Non-recording BillboardCollection stand-in that only counts lifecycle. */
function billboardCollection() {
  const counts = { added: 0, removed: 0 };
  return {
    counts,
    show: true,
    add(options) {
      counts.added += 1;
      return { ...options };
    },
    remove() {
      counts.removed += 1;
      return true;
    },
  };
}

function vesselLayerHarness() {
  const layer = createVesselLayer({
    source: { getSnapshot: async () => ({ records: [] }) },
    services: {
      context: {
        clearSelectedEntityContextForLayer: noop,
        registerEntityContext: () => null,
      },
      trails: {
        createTrail: () => ({ setPositions: noop, clear: noop, destroy: noop }),
      },
      labels: {},
      picking: { unregisterPickOwner: noop },
      overlay: {
        setOverlayEntries: noop,
        setOverlaySourceVisible: noop,
        clearOverlaySource: noop,
      },
      geoid: {},
      sprites: {},
      focus: {
        focusNowMs: () => 10_000,
        getFocusTarget: () => null,
        focusPassIsNeeded: () => false,
        forgetSpriteFocus: noop,
      },
      worldFocus: {},
      render: {
        holdContinuousRender: noop,
        releaseContinuousRender: noop,
        governorRequestRender: noop,
      },
    },
  });
  const camera = {
    positionWC: { x: 0, y: 0, z: 7_000_000 },
    heading: 0,
    pitch: -1.2,
    roll: 0,
  };
  const viewer = { camera, scene: { primitives: { add: noop } } };
  const collection = billboardCollection();
  layer.testing._setVesselStateForTest({
    viewer,
    billboardCollection: collection,
  });
  const apply = (rows) =>
    layer.testing._applyAisFeedSnapshotForTest(viewer, {
      status: 'live',
      lastMessageAt: 1,
      complete: true,
      freshness: 'current',
      observedAtMs: 1,
      rows,
    });
  return {
    apply,
    collection,
    vesselCount: () => layer.testing._getVesselStateForTest().vesselCount,
  };
}

const ROWS = syntheticVesselRows(VESSEL_COUNT);

test('vessel reconcile keeps record identity across a 10% moved refresh', () => {
  const store = new VesselRecords({ now: () => 1_000 });
  const { counts, effects } = countingEffects();
  store.reconcile(ROWS, {}, effects);
  const first = store.byMmsi.get(ROWS[0].mmsi);
  store.reconcile(moveFraction(ROWS, 0), {}, effects);
  assert.deepEqual(counts, {
    added: VESSEL_COUNT,
    updated: VESSEL_COUNT,
    removed: 0,
  });
  assert.equal(store.byMmsi.get(ROWS[0].mmsi), first);
  assert.equal(store.all.length, VESSEL_COUNT);

  const harness = vesselLayerHarness();
  assert.equal(harness.apply(ROWS).reconciled, true);
  assert.equal(
    harness.apply(moveFraction(ROWS, 1)).acceptedRowCount,
    VESSEL_COUNT,
  );
  assert.equal(harness.vesselCount(), VESSEL_COUNT);
  assert.deepEqual(harness.collection.counts, {
    added: VESSEL_COUNT,
    removed: 0,
  });
});

test(
  '12,000-vessel initial and 10%-moved reconciles stay within budget',
  perfBudgetTestOptions(),
  (t) => {
    const movedRows = Array.from(
      { length: MOVED_FRACTION_DIVISOR },
      (_, pass) => moveFraction(ROWS, pass),
    );
    const recordsInitial = measureRuns(() => {
      const store = new VesselRecords({ now: () => 1_000 });
      store.reconcile(ROWS, {}, countingEffects().effects);
      return store;
    }, RUNS);
    const store = recordsInitial.result;
    const recordsUpdate = measureRuns(
      (i) =>
        store.reconcile(
          movedRows[i % movedRows.length],
          {},
          countingEffects().effects,
        ),
      RUNS,
    );
    assert.equal(store.all.length, VESSEL_COUNT);

    const snapshotInitial = measureRuns(() => {
      const harness = vesselLayerHarness();
      harness.apply(ROWS);
      return harness;
    }, RUNS);
    const harness = snapshotInitial.result;
    const snapshotUpdate = measureRuns(
      (i) => harness.apply(movedRows[i % movedRows.length]),
      RUNS,
    );
    assert.equal(harness.vesselCount(), VESSEL_COUNT);
    assert.equal(harness.collection.counts.removed, 0);

    const timings = {
      recordsInitial,
      recordsUpdate,
      snapshotInitial,
      snapshotUpdate,
    };
    assertWithinBudgets(t, timings, BUDGET_MS);
  },
);
