import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cesium';
import { createDirectionsLayer } from './index.js';
import { createRouteSnapshot } from './snapshot.js';
import * as annotations from '../../annotations/worldAnnotationRenderer.js';
import * as input from '../../data/inputOwnership.js';
const noop = () => {};
test('route observers coexist with the row owner and detach explicitly', async (t) => {
  const { layer, viewer } = fixture(t);
  layer.enable(viewer);
  let changes = 0;
  const stop = layer.subscribeRoute(() => {
    changes += 1;
  });
  layer.restoreSavedRoute(saved());
  assert.ok(changes > 0);
  const before = changes;
  stop();
  layer.setParams({ clear: true });
  assert.equal(changes, before);
});
const saved = () =>
  createRouteSnapshot(
    {
      mode: 'foot',
      distanceM: 1200,
      durationS: 800,
      geometry: [
        [78.04, 30.32],
        [78.05, 30.33],
      ],
      steps: [{ instruction: 'Continue', lat: 30.32, lon: 78.04 }],
    },
    { lat: 30.32, lon: 78.04 },
    { lat: 30.33, lon: 78.05 },
    1000,
  );
function fixture(t) {
  let requests = 0,
    warms = 0,
    resolve;
  const viewer = {
    entities: new C.EntityCollection(),
    scene: {
      canvas: document.createElement('canvas'),
      primitives: { add: (p) => p, remove: noop },
      screenSpaceCameraController: { enableInputs: true },
    },
    camera: { moveEnd: new C.Event() },
  };
  const layer = createDirectionsLayer({
    source: {
      getRoute() {
        requests++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    },
    services: {
      annotations,
      input,
      scenePick: {},
      camera: {},
      overlays: {
        setOverlayEntries: noop,
        setOverlaySourceVisible: noop,
        clearOverlaySource: noop,
      },
      render: {
        governorRequestRender: noop,
        holdContinuousRender: noop,
        releaseContinuousRender: noop,
      },
      sprites: {
        registerSpriteCollection: noop,
        unregisterSpriteCollection: noop,
        restoreSpriteOrder: noop,
      },
      picking: { registerPickOwner: noop, unregisterPickOwner: noop },
      ground: {
        warmGroundFloor() {
          warms++;
        },
        cachedGroundFloor: () => null,
        GROUND_FLOOR_LIFT_M: 1,
      },
    },
  });
  layer.init(viewer);
  t.after(() => layer.destroy(viewer));
  return {
    layer,
    viewer,
    requests: () => requests,
    warms: () => warms,
    resolve: (value) => resolve(value),
  };
}
test('saved routes restore exact geometry without routing or warming providers', (t) => {
  const f = fixture(t);
  assert.equal(f.layer.getRouteSnapshot(), null);
  assert.equal(
    f.layer.restoreSavedRoute(saved()),
    false,
    'explicit caller must enable layer first',
  );
  f.layer.enable(f.viewer);
  assert.equal(f.layer.restoreSavedRoute(saved()), true);
  assert.equal(f.requests(), 0);
  assert.equal(f.warms(), 0);
  assert.deepEqual(f.layer.getRouteSnapshot(), saved());
  const before = f.layer.getRouteSnapshot();
  assert.equal(f.layer.restoreSavedRoute({ ...saved(), version: 2 }), false);
  assert.deepEqual(f.layer.getRouteSnapshot(), before);
});
test('restoring revokes pending routing so late results cannot replace saved evidence', async (t) => {
  const f = fixture(t);
  f.layer.enable(f.viewer);
  f.layer.placeEndpoint('a', { lat: 0, lon: 0 });
  f.layer.placeEndpoint('b', { lat: 1, lon: 1 });
  assert.equal(f.requests(), 1);
  assert.equal(f.layer.restoreSavedRoute(saved()), true);
  f.resolve({
    ok: true,
    geometry: [
      [0, 0],
      [1, 1],
    ],
    steps: [],
    distanceM: 1,
    durationS: 1,
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(f.layer.getRouteSnapshot(), saved());
  assert.equal(f.warms(), 0);
});
