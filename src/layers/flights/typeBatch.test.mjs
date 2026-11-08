import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnrichment } from './enrichment.js';
import { createFlightState } from './state.js';
import { TYPE_BATCH_MAX, TYPE_BATCH_RETRY_MS } from './policy.js';

function services() {
  const names = [
    'picking',
    'sprites',
    'trails',
    'aircraftPresentation',
    'camera',
    'militaryRegistry',
    'labels',
    'groundFloor',
    'meshFloor',
    'geoid',
    'focus',
    'readout',
    'context',
    'render',
    'recession',
  ];
  return {
    ...Object.fromEntries(names.map((name) => [name, {}])),
    groundSnap: { createGroundSnap: () => ({ clear() {} }) },
  };
}

const hexAt = (index) => (0xa00000 + index).toString(16);

function harness(reply) {
  const batches = [];
  const singles = [];
  const source = {
    async getTypeBatch(hexes) {
      batches.push(hexes);
      return reply(hexes, batches.length);
    },
    async getEnrichment(query) {
      singles.push(query);
      return { found: false };
    },
  };
  const flightState = createFlightState({ source, services: services() });
  const enrichment = createEnrichment({
    flightState,
    services: {},
    parts: {
      rendering: {
        _applyFleetBillboardPresentation() {},
        _syncModelToClass() {},
      },
      tracking: { _updateTrackedLabelModel() {} },
    },
  });
  return { flightState, enrichment, batches, singles };
}

function addAircraft(flightState, count) {
  const hexes = Array.from({ length: count }, (_, index) => hexAt(index));
  for (const hex of hexes) flightState.records.data.set(hex, { category: 0 });
  return hexes;
}

test('130 aircraft are enriched in two batch requests, not 130 lookups', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const { flightState, enrichment, batches, singles } = harness((hexes) => ({
    results: Object.fromEntries(
      hexes.map((hex) => [hex, { found: true, typeCode: 'B738' }]),
    ),
    pending: [],
  }));
  const hexes = addAircraft(flightState, 130);
  for (const hex of hexes) enrichment._requestTypeEnrichment(hex);
  for (let step = 0; step < 10; step++) {
    t.mock.timers.tick(1_000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [TYPE_BATCH_MAX, 130 - TYPE_BATCH_MAX],
  );
  assert.equal(singles.length, 0);
  for (const hex of hexes)
    assert.equal(flightState.records.data.get(hex).typeCode, 'B738');
});

test('pending aircraft are asked again later, and a miss is final', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const { flightState, enrichment, batches } = harness((hexes, round) =>
    round === 1
      ? { results: { [hexes[0]]: { found: false } }, pending: hexes.slice(1) }
      : {
          results: Object.fromEntries(
            hexes.map((hex) => [hex, { found: true, typeCode: 'C172' }]),
          ),
          pending: [],
        },
  );
  const [miss, later] = addAircraft(flightState, 2);
  enrichment._requestTypeEnrichment(miss);
  enrichment._requestTypeEnrichment(later);
  for (let step = 0; step < 3; step++) {
    t.mock.timers.tick(TYPE_BATCH_RETRY_MS);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(batches, [[miss, later], [later]]);
  assert.equal(flightState.records.data.get(later).typeCode, 'C172');
  assert.equal(flightState.records.data.get(miss).typeCode, undefined);
});

test('a priority aircraft jumps to the front of the next batch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const { flightState, enrichment, batches } = harness(() => ({
    results: {},
    pending: [],
  }));
  const [ambient, tracked] = addAircraft(flightState, 2);
  enrichment._requestTypeEnrichment(ambient);
  enrichment._requestTypeEnrichment(tracked, true);
  t.mock.timers.tick(1_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(batches[0], [tracked, ambient]);
});

test('without a batch transport the per-aircraft path still works', async () => {
  const source = {
    async getEnrichment() {
      return { found: true, typeCode: 'A320' };
    },
  };
  const flightState = createFlightState({ source, services: services() });
  const enrichment = createEnrichment({
    flightState,
    services: {},
    parts: {
      rendering: {
        _applyFleetBillboardPresentation() {},
        _syncModelToClass() {},
      },
    },
  });
  const [hex] = addAircraft(flightState, 1);
  enrichment._requestTypeEnrichment(hex);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flightState.records.data.get(hex).typeCode, 'A320');
});
