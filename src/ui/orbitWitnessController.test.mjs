import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { OrbitWitnessController } from './orbitWitnessController.js';
import { useOrbitWitnessStore } from './stores/orbitWitness.js';
import { missionElementSets } from '../orbitWitness/tle.js';
import {
  FIXTURE_TLE,
  MUSSOORIE,
  syntheticPlan,
  boxAround,
  SYNTHETIC_PLAN_NAME,
} from '../orbitWitness/testFixtures.mjs';

const nowMs = Date.parse('2026-11-07T06:00:00Z');
const selection = {
  id: 'mussoorie',
  name: 'Mussoorie',
  geometry: { type: 'Point', coordinates: [MUSSOORIE.lon, MUSSOORIE.lat] },
  extent: null,
};

function harness({ catalogue, director, createWatch } = {}) {
  setActivePinia(createPinia());
  const calls = {
    elements: 0,
    cloud: 0,
    catalogue: 0,
    overlay: [],
    downloads: [],
  };
  let current = selection;
  const listeners = new Set();
  const controller = new OrbitWitnessController({
    store: useOrbitWitnessStore(),
    now: () => nowMs,
    readSelection: () => current,
    subscribeSelection: (listener) => (
      listeners.add(listener),
      () => listeners.delete(listener)
    ),
    elements: {
      async read() {
        calls.elements += 1;
        return { sets: missionElementSets(FIXTURE_TLE), stale: false };
      },
    },
    cloud: {
      async forecast() {
        calls.cloud += 1;
        return { status: 'unavailable', hours: [] };
      },
    },
    catalogue: {
      async search(query) {
        calls.catalogue += 1;
        calls.query = query;
        return (
          catalogue ?? {
            status: 'ok',
            retrievedAt: '2026-11-07T06:00:00.000Z',
            sources: [
              { id: 'earth-search', status: 'ok', count: 1 },
              { id: 'cmr-stac-lpcloud', status: 'ok', count: 0 },
            ],
            scenes: [
              {
                id: 'S2B_43RGP_20261104_0_L2A',
                collection: 'sentinel-2-l2a',
                source: 'earth-search',
                platform: 'sentinel-2b',
                datetime: '2026-11-04T05:40:35.189Z',
                cloudCover: 0.1,
                productId: null,
                footprint: boxAround(MUSSOORIE, 0.5),
              },
            ],
          }
        );
      },
    },
    overlay: {
      async show(shapes) {
        calls.overlay.push(shapes);
        return true;
      },
      clear() {
        calls.overlay.push(null);
      },
      destroy() {},
    },
    director,
    createWatch,
    download: (name, text) => calls.downloads.push({ name, text }),
  });
  controller.init();
  return {
    controller,
    calls,
    select(next) {
      current = next;
      listeners.forEach((listener) => listener());
    },
  };
}

test('opening Orbit Witness requests nothing; prediction is explicit', async () => {
  const { controller, calls } = harness();
  assert.equal(calls.elements + calls.cloud + calls.catalogue, 0);
  assert.equal(controller.view.status, 'idle');
  assert.equal(await controller.predict(), true);
  assert.deepEqual([calls.elements, calls.cloud, calls.catalogue], [1, 1, 1]);
  assert.deepEqual(
    calls.query.bbox.map((v) => Math.round(v * 1e4) / 1e4),
    [78.0144, 30.4098, 78.1144, 30.5098],
  );
  assert.equal(calls.query.to, '2026-11-07');
  const s2b = controller.view.missions.find((row) => row.id === 'sentinel-2b');
  assert.match(s2b.epoch, /^2026-11-06T20:45/);
  assert.ok(s2b.epochAgeDays < 1);
  assert.equal(s2b.confidence, 'fresh');
  const pass = s2b.passes.find((row) => row.time.startsWith('2026-11-04'));
  assert.equal(pass.lanes.product.status, 'available');
  assert.equal(pass.lanes.cloud.status, 'unknown');
  // Element sets are reused for an hour.
  await controller.predict();
  assert.equal(calls.elements, 1);
});

test('without a selection Orbit Witness asks for one', async () => {
  const { controller, calls, select } = harness();
  select(null);
  assert.equal(await controller.predict(), false);
  assert.match(controller.view.error, /Select a place in Lens/);
  assert.equal(calls.catalogue, 0);
});

test('a catalogue outage keeps the product lane unknown', async () => {
  const { controller } = harness({
    catalogue: { status: 'unavailable', sources: [], scenes: [] },
  });
  await controller.predict();
  const pass = controller.view.missions
    .find((row) => row.id === 'sentinel-2b')
    .passes.find((row) => row.past);
  assert.equal(pass.lanes.product.status, 'unknown');
});

test('loaded plans re-check passes without new requests; non-plans are refused', async () => {
  const { controller, calls } = harness();
  await controller.predict();
  const file = (name, text) => ({
    name,
    size: text.length,
    text: async () => text,
  });
  const plan = syntheticPlan([
    {
      id: '7',
      start: '2026-11-04T05:30:00.000',
      end: '2026-11-04T05:52:00.000',
      ring: boxAround(MUSSOORIE),
    },
  ]);
  assert.equal(
    await controller.loadPlans([
      file(SYNTHETIC_PLAN_NAME, plan),
      file('notes.kml', '<kml/>'),
    ]),
    false,
  );
  assert.match(controller.view.feedback, /notes\.kml/);
  assert.equal(controller.view.plans.length, 1);
  const pass = controller.view.missions
    .find((row) => row.id === 'sentinel-2b')
    .passes.find((row) => row.time.startsWith('2026-11-04'));
  assert.equal(pass.lanes.planned.status, 'confirmed');
  assert.equal(calls.catalogue, 1);
  controller.clearPlans();
  assert.equal(controller.view.plans.length, 0);
});

test('a footprint shows the modelled swath and the observed scene footprint', async () => {
  const { controller, calls } = harness();
  await controller.predict();
  const pass = controller.view.missions.find((row) => row.id === 'sentinel-2b')
    .passes[0];
  assert.equal(await controller.showFootprint(pass.id), true);
  const [shapes] = calls.overlay;
  assert.ok(shapes.predicted.length > 4);
  assert.equal(Object.hasOwn(shapes, 'label'), false);
  assert.match(controller.view.feedback, /scene footprint \(observed\)/);
  assert.equal(
    controller.view.missions.find((row) => row.id === 'sentinel-2b').passes[0]
      .footprint,
    true,
  );
  controller.clearFootprint();
  assert.equal(calls.overlay.at(-1), null);
});

test('the ride goes through the director and its caption names the epoch and the dramatisation', async () => {
  const rides = [];
  const director = {
    running: false,
    subscribe(listener) {
      this.listener = listener;
      return () => {};
    },
    async ride(scene) {
      rides.push(scene);
      this.running = true;
      this.listener();
      return true;
    },
    stop() {
      this.running = false;
      this.listener();
    },
  };
  const { controller } = harness({ director });
  await controller.predict();
  const pass = controller.view.missions.find((row) => row.id === 'sentinel-2b')
    .passes[0];
  assert.equal(await controller.ride(pass.id), true);
  assert.equal(rides.length, 1);
  assert.match(
    controller.view.ride.caption,
    /^Dramatised ride · orbit propagated, epoch 2026-11-06 20:45 UTC/,
  );
  director.stop();
  assert.equal(controller.view.ride, null);
});

test('exported records carry the lanes, the epoch and the ride label', async () => {
  const { controller, calls } = harness();
  await controller.predict();
  const pass = controller.view.missions.find((row) => row.id === 'sentinel-2b')
    .passes[0];
  assert.equal(controller.exportRecord(pass.id), true);
  const record = JSON.parse(calls.downloads[0].text);
  assert.match(calls.downloads[0].name, /^orbit-witness-sentinel-2b-/);
  assert.equal(record.class, 'simulated');
  assert.match(record.label, /orbit propagated, epoch/);
  assert.equal(record.lanes.predicted.class, 'modelled');
  assert.equal(record.orbit.epoch, '2026-11-06T20:45:23.948Z');
});

test('watching creates a scene watch for the selected place; selection change resets', async () => {
  const created = [];
  const { controller, calls, select } = harness({
    createWatch: async (place) => (created.push(place), true),
  });
  assert.equal(await controller.watch(), true);
  assert.equal(created[0].id, 'mussoorie');
  assert.match(controller.view.feedback, /Watchlists/);
  await controller.predict();
  select({
    ...selection,
    id: 'other',
    geometry: { type: 'Point', coordinates: [77, 29] },
  });
  assert.equal(controller.view.status, 'idle');
  assert.equal(controller.view.missions.length, 0);
  assert.equal(calls.overlay.at(-1), null);
  controller.destroy();
  assert.equal(await controller.predict(), false);
});
