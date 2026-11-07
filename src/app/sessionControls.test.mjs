import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionControls } from './sessionControls.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
test('pause uses lifecycle owner and local watch stops without restarting work', async () => {
  const calls = [];
  const enabledIds = new Set([
    'flights',
    'directions',
    'recent-imagery',
    'local-geojson',
  ]);
  const control = createSessionControls({
    dataManager: {
      getEnabledLayerIds: () => new Set(enabledIds),
      setEnabled: async (id, enabled, options) => {
        calls.push({ id, enabled, ...options });
        enabledIds.delete(id);
        return true;
      },
      isEffectivelyEnabled: () => false,
      clearSelectedLayers: () => {
        throw Error('Blanket clear is forbidden');
      },
    },
    watchlists: {
      view: { watches: [{ id: 'one' }, { id: 'foreign', state: 'other-tab' }] },
      stop: async (id) => calls.push(id),
    },
    cancelWork: [() => calls.push('cancel')],
  });
  assert.deepEqual(calls, []);
  const result = await control.pauseLiveData();
  assert.equal(result.ok, true);
  assert.deepEqual(result.stoppedWatchIds, ['one']);
  assert.deepEqual(calls, [
    { id: 'flights', enabled: false, origin: 'session-pause' },
    'one',
    'cancel',
  ]);
  assert.equal(control.busy, false);
  assert.deepEqual(
    [...enabledIds],
    ['directions', 'recent-imagery', 'local-geojson'],
  );
});
test('pause coalesces concurrent requests and reports partial failures', async () => {
  let finish,
    calls = 0;
  const control = createSessionControls({
    dataManager: {
      getEnabledLayerIds: () => new Set(['flights']),
      isEffectivelyEnabled: () => true,
      setEnabled: () => {
        calls++;
        return new Promise((r) => {
          finish = r;
        });
      },
    },
    watchlists: {
      view: { watches: [{ id: 'one' }] },
      stop: async () => {
        throw Error();
      },
    },
    cancelWork: [
      () => {
        throw Error();
      },
    ],
  });
  const a = control.pauseLiveData(),
    b = control.pauseLiveData();
  assert.equal(control.busy, true);
  assert.equal(calls, 1);
  finish(false);
  const result = await a;
  assert.deepEqual(await b, result);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 3);
  assert.equal(control.busy, false);
});
test('a missing lifecycle owner is an explicit failure, not an all-paused claim', async () => {
  const result = await createSessionControls().pauseLiveData();
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].kind, 'layers');
});
test('pausing an in-flight live enable preserves unsaved route and newer user intent', async () => {
  const route = {
    geometry: [
      [78, 30],
      [78.1, 30.1],
    ],
    unsaved: true,
  };
  let savedRoute = structuredClone(route),
    finish;
  const intended = new Set(['directions', 'flights']);
  const control = createSessionControls({
    dataManager: {
      getEnabledLayerIds: () => new Set(intended),
      clearSelectedLayers: () => {
        savedRoute = null;
        throw Error('must not clear all layers');
      },
      setEnabled: (id, on) => {
        assert.equal(id, 'flights');
        assert.equal(on, false);
        intended.delete(id);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  });
  const pending = control.pauseLiveData();
  assert.equal(
    intended.has('flights'),
    false,
    'OFF intent queued without awaiting other work',
  );
  intended.add('flights');
  finish(true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.deepEqual(result.layerResult.notClearedIds, ['flights']);
  assert.deepEqual(savedRoute, route);
  assert.equal(intended.has('directions'), true);
});
test('a rejecting feed disable reports partial pause without touching static owners', async () => {
  const control = createSessionControls({
    dataManager: {
      getEnabledLayerIds: () => new Set(['flights', 'directions']),
      setEnabled: () => {
        throw Error('failed');
      },
    },
  });
  const result = await control.pauseLiveData();
  assert.equal(result.ok, false);
  assert.deepEqual(result.layerResult.notClearedIds, ['flights']);
});
test('all registered polling weather and observation feeds pause while static content remains', async () => {
  const live = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'fire-perimeters',
    'gnss-integrity',
    'drone-airspace',
    'wildlife-sightings',
    's2-ghostmaps',
  ];
  const registered = new Set(LAYER_STATE_REGISTRY.map((row) => row.id));
  assert.ok(
    live.every((id) => registered.has(id)),
    'feed IDs must match the real application registry',
  );
  const staticIds = [
    'directions',
    'recent-imagery',
    'military-installations',
    'submarine-cables',
    'osm-places',
    'street-level',
    'alpr-cameras',
    'my-import',
  ];
  const enabled = new Set([...live, ...staticIds]),
    calls = [];
  const controls = createSessionControls({
    dataManager: {
      getEnabledLayerIds: () => new Set(enabled),
      setEnabled: async (id) => {
        calls.push(id);
        enabled.delete(id);
        return true;
      },
    },
  });
  assert.equal((await controls.pauseLiveData()).ok, true);
  assert.deepEqual(calls.sort(), [...live].sort());
  assert.deepEqual([...enabled], staticIds);
});
