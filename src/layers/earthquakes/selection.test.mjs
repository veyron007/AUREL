import assert from 'node:assert/strict';
import test from 'node:test';
import { createEarthquakeSelection } from './selection.js';

const ROW = {
  stableId: 'us6000u1f1',
  usgsId: 'us6000u1f1',
  lat: 30.8109,
  lon: 78.4864,
  depthKm: 20.964,
  mag: 4.4,
  place: '9 km NNE of Uttarkashi, India',
  time: Date.parse('2026-10-10T14:37:31.202Z'),
};

function fakes() {
  const calls = [];
  let action = null;
  const context = {
    registerEntityContext: (entity, metadata) => {
      calls.push(['register', metadata]);
      entity.__gevContextId = metadata.id;
      return metadata;
    },
    selectEntityContext: (entity) =>
      calls.push(['select', entity.__gevContextId]),
    clearSelectedEntityContextForLayer: (id) => calls.push(['clear', id]),
    removeEntityContextsForLayer: (id, options) =>
      calls.push(['remove', id, [...(options?.retainIds ?? [])]]),
  };
  const picking = {
    resolvePickId: (picked) => picked?.id?.id ?? null,
    isOwnedByOtherLayer: (_layer, id) => id.startsWith('flight:'),
    registerPickOwner: (id) => calls.push(['owner', id]),
    unregisterPickOwner: (id) => calls.push(['unowner', id]),
  };
  const handler = {
    setInputAction: (fn) => {
      action = fn;
    },
    destroy: () => calls.push(['destroy']),
  };
  return {
    calls,
    context,
    picking,
    handler,
    click: (position) => action(position),
  };
}

test('registers events with the USGS fields Second Source needs', () => {
  const f = fakes();
  const selection = createEarthquakeSelection({
    context: f.context,
    picking: f.picking,
    screenSpaceEventHandlerFactory: () => f.handler,
  });
  selection.register([{ entity: {}, row: ROW }], { show: true });
  const [, metadata] = f.calls.find(([kind]) => kind === 'register');
  assert.equal(metadata.id, 'earthquake:us6000u1f1');
  assert.equal(metadata.layerId, 'earthquakes');
  assert.deepEqual(metadata.properties, {
    usgsId: 'us6000u1f1',
    mag: 4.4,
    timeMs: ROW.time,
    depthKm: 20.964,
    place: ROW.place,
  });
  assert.deepEqual(f.calls.at(-1), [
    'remove',
    'earthquakes',
    ['earthquake:us6000u1f1'],
  ]);
});

test('a click on a registered disc selects it; empty ground clears; other layers are left alone', () => {
  const f = fakes();
  const entity = { id: 'earthquake:us6000u1f1' };
  let picked = { id: entity };
  const selection = createEarthquakeSelection({
    context: f.context,
    picking: f.picking,
    screenSpaceEventHandlerFactory: () => f.handler,
  });
  selection.install({ scene: { canvas: {}, pick: () => picked } });
  selection.register([{ entity, row: ROW }], { show: true });
  f.click({ position: { x: 1, y: 1 } });
  assert.deepEqual(f.calls.at(-1), ['select', 'earthquake:us6000u1f1']);
  picked = { id: { id: 'flight:abc' } };
  f.click({ position: { x: 1, y: 1 } });
  assert.deepEqual(f.calls.at(-1), ['select', 'earthquake:us6000u1f1']);
  picked = undefined;
  f.click({ position: { x: 1, y: 1 } });
  assert.deepEqual(f.calls.at(-1), ['clear', 'earthquakes']);
  selection.uninstall();
  assert.ok(f.calls.some(([kind]) => kind === 'destroy'));
});

test('headless hosts render without selection instead of throwing', () => {
  const throwing = () => {
    throw new ReferenceError('window is not defined');
  };
  const selection = createEarthquakeSelection({
    context: {
      registerEntityContext: throwing,
      selectEntityContext: throwing,
      clearSelectedEntityContextForLayer: throwing,
      removeEntityContextsForLayer: throwing,
    },
    picking: { resolvePickId: () => null, isOwnedByOtherLayer: () => false },
    screenSpaceEventHandlerFactory: () => {
      throw new ReferenceError('document is not defined');
    },
  });
  assert.doesNotThrow(() => selection.install({ scene: {} }));
  assert.doesNotThrow(() => selection.install({ scene: { canvas: {} } }));
  assert.doesNotThrow(() => selection.register([{ entity: {}, row: ROW }], {}));
  assert.doesNotThrow(() => selection.clear());
});
