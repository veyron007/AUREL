import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useLensStore } from '../ui/stores/lens.js';
import { createPlannerBindings } from './plannerTools.js';

function fixture() {
  const pinia = createPinia();
  const calls = [];
  let routeListener;
  let disposed = 0;
  const directions = {
    getRouteSnapshot: () => ({ marker: 'snapshot' }),
    subscribeRoute: (cb) => {
      routeListener = cb;
      return () => {
        disposed += 1;
      };
    },
  };
  const bindings = createPlannerBindings({
    pinia,
    dataManager: { layers: new Map([['directions', { module: directions }]]) },
    operations: {
      requests: {
        terrain: {
          getProfileHeights: async (points) => {
            calls.push(points);
            return points.map((point) => ({
              lat: point.lat,
              lon: point.lon,
              elevation: 651,
              ellipsoid: 608,
              provenance: {
                tileset: 'mapterhorn-egm08',
                version: '5',
                retrievedAt: '2026-11-07T00:00:00.000Z',
              },
            }));
          },
        },
      },
    },
    fieldbook: {
      saveAnalysis: async (...args) => {
        calls.push(args);
        return true;
      },
    },
    contextSource: {
      getContext: async (point) => {
        calls.push(point);
        return { fixture: true };
      },
    },
    fireSource: async (request) => {
      calls.push(request.bounds);
      return { status: 'needs-key' };
    },
  });
  return {
    pinia,
    bindings,
    calls,
    emitRoute: () => routeListener?.(),
    get disposed() {
      return disposed;
    },
  };
}
test('planner bindings do not fetch on construction and use explicit bounded owner calls', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  const terrain = await f.bindings.getTerrain([{ lat: 30, lon: 78 }]);
  assert.equal(terrain.results[0].elevation, 651);
  assert.equal(terrain.results[0].provenance.tileset, 'mapterhorn-egm08');
  assert.deepEqual(await f.bindings.getContext({ lat: 30, lon: 78 }), {
    fixture: true,
  });
  assert.deepEqual(
    await f.bindings.getFireContext({
      bounds: { west: 78, south: 30, east: 79, north: 31 },
    }),
    { status: 'needs-key' },
  );
  f.bindings.destroy();
  await assert.rejects(f.bindings.getTerrain([{ lat: 30, lon: 78 }]));
});
test('selection and route updates notify only their owner; destroy detaches both', async () => {
  const f = fixture();
  let changes = 0;
  f.bindings.subscribeChanges(() => {
    changes += 1;
  });
  useLensStore(f.pinia).publish({
    selection: {
      id: 'dehradun',
      geometry: { type: 'Point', coordinates: [78, 30] },
    },
  });
  await nextTick();
  assert.equal(changes, 1);
  assert.equal(f.bindings.readSelection().id, 'dehradun');
  f.emitRoute();
  assert.equal(changes, 2);
  f.bindings.destroy();
  useLensStore(f.pinia).publish({ selection: null });
  await nextTick();
  assert.equal(changes, 2);
  assert.equal(f.disposed, 1);
});

test('profile focus never resurrects a previous height after a missing refresh', async () => {
  const point = { lat: 30, lon: 78 };
  let row = {
    ...point,
    elevation: 651,
    ellipsoid: 608,
    provenance: { tileset: 'mapterhorn-egm08', version: '5' },
  };
  let added = 0;
  const bindings = createPlannerBindings({
    pinia: createPinia(),
    viewer: {
      entities: {
        add: () => {
          added++;
          return {};
        },
        remove() {},
      },
    },
    operations: {
      requests: { terrain: { getProfileHeights: async () => [row] } },
    },
  });
  await bindings.getTerrain([point]);
  bindings.focusSample({ ...point, elevationM: 651 });
  assert.equal(added, 1);
  row = null;
  await bindings.getTerrain([point]);
  bindings.focusSample({ ...point, elevationM: null });
  bindings.focusSample({ ...point, elevationM: 651 });
  assert.equal(added, 1);
  bindings.destroy();
});
