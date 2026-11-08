import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { localGeoJsonServices } from '../app/localGeojsonServices.js';
import { getContextStore } from './contextStore.js';
import { createLocalGeoJsonLayer as createLayer } from './localGeojsonCore.js';
import {
  LOCAL_FOOTPRINT_ALPHA,
  LOCAL_PIN_SIZE_PX,
  createLocalGeojsonPrimitives,
} from './localGeojsonPrimitives.js';
import {
  NODE_RENDER_OPTIONS,
  localSceneStub,
  renderedRecords,
  sceneIsEmpty,
} from './localGeojsonSceneStub.mjs';

const BASE = Cesium.Color.fromCssColorString('#00ffff');
const square = (lon, lat, size = 0.01) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];
const FEATURES = [
  {
    type: 'Feature',
    id: 'a',
    properties: { name: 'Alpha DC' },
    geometry: { type: 'Polygon', coordinates: [square(0, 0)] },
  },
  // Overlaps 'a': Cesium's ground batch puts it in a second primitive.
  {
    type: 'Feature',
    id: 'b',
    properties: { name: 'Bravo DC' },
    geometry: { type: 'Polygon', coordinates: [square(0.005, 0.005)] },
  },
  {
    type: 'Feature',
    id: 'c',
    properties: { name: 'Charlie DC' },
    geometry: { type: 'Polygon', coordinates: [square(1, 1)] },
  },
  {
    type: 'Feature',
    id: 'p',
    properties: { name: 'Pin DC' },
    geometry: { type: 'Point', coordinates: [2, 2] },
  },
  {
    type: 'Feature',
    id: 'l',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [3, 3],
        [3.1, 3.1],
      ],
    },
  },
];

function event() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    raise() {
      for (const fn of [...listeners]) fn();
    },
  };
}

/**
 * GroundPolylinePrimitive builds a render state at construction, which checks
 * the WebGL line-width limits; Node has no context, so they read 0..0.
 */
function allowLineWidths(t) {
  const max = Cesium.ContextLimits._maximumAliasedLineWidth;
  Cesium.ContextLimits._maximumAliasedLineWidth = 1;
  t.after(() => {
    Cesium.ContextLimits._maximumAliasedLineWidth = max;
  });
}

async function enabledLayer(t, { pick = () => null } = {}) {
  allowLineWidths(t);
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () =>
      FEATURES.map((feature) => JSON.stringify(feature)).join('\n'),
  }));
  let click = null;
  let doubleClick = null;
  const flights = [];
  const pins = [];
  const renderRequests = [];
  const viewer = {
    selectedEntity: undefined,
    scene: {
      ...localSceneStub(),
      canvas: { clientWidth: 800, clientHeight: 600 },
      preRender: event(),
      postRender: event(),
      requestRender() {},
      screenSpaceCameraController: { enableInputs: true },
      pick: (position) => pick(position),
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(1, 1, 3_000_000),
      positionCartographic: { height: 3_000_000 },
      frustum: { fov: Math.PI / 3 },
      moveEnd: event(),
      flyTo: (options) => flights.push(options),
    },
  };
  const layer = createLayer(
    {
      ...NODE_RENDER_OPTIONS,
      pinImage: (color, size) => {
        pins.push([color.toCssHexString(), size]);
        return 'data:image/png;base64,';
      },
      id: 'local-datacenters',
      name: 'Datacenters',
      color: '#00ffff',
      url: '/datacenters.geojsonl',
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      projectToWindow: () => ({ x: 400, y: 300 }),
      screenSpaceEventHandlerFactory: () => ({
        setInputAction(fn, type) {
          if (type === Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
            doubleClick = fn;
          else click = fn;
        },
        destroy() {},
      }),
    },
    {
      ...localGeoJsonServices,
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      governorRequestRender: (reason) => renderRequests.push(reason),
    },
  );
  t.after(() => {
    layer.destroy(viewer);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  await layer.enable(viewer);
  return {
    layer,
    viewer,
    flights,
    pins,
    renderRequests,
    click: (position = {}) => click({ position }),
    doubleClick: (position = {}) => doubleClick({ position }),
  };
}

test('records draw as stems, tips, one shared pin image and batched footprints', async (t) => {
  const env = await enabledLayer(t);
  const drawn = renderedRecords(env.viewer.scene);
  assert.deepEqual(
    drawn.map((record) => record.carrier.id),
    ['a', 'b', 'c', 'p'],
  );
  for (const { carrier, stem, point } of drawn) {
    assert.equal(stem.id, carrier);
    assert.equal(point.id, carrier);
    assert.equal(stem.width, 3.5);
    assert.equal(point.pixelSize, 10);
    assert.equal(point.outlineWidth, 2);
    assert.ok(Cesium.Color.equals(point.outlineColor, Cesium.Color.BLACK));
    assert.equal(point.disableDepthTestDistance, Number.POSITIVE_INFINITY);
    assert.equal(carrier.__localLayerId, 'local-datacenters');
    assert.equal(carrier.__gevContextId, `local-datacenters:${carrier.id}`);
  }
  const pins = env.viewer.scene.primitives.items[0].get(1);
  assert.equal(pins.length, 1, 'only the Point feature carries a pin');
  const pin = pins.get(0);
  assert.equal(pin.verticalOrigin, Cesium.VerticalOrigin.BOTTOM);
  assert.equal(pin.heightReference, Cesium.HeightReference.CLAMP_TO_GROUND);
  assert.equal(pin.id.id, 'p');
  assert.deepEqual(env.pins, [['#00ffff', LOCAL_PIN_SIZE_PX]]);

  const ground = env.viewer.scene.groundPrimitives.items[0];
  assert.equal(ground.length, 3, 'two footprint batches plus the ground line');
  const [first, second, line] = [0, 1, 2].map((i) => ground.get(i));
  assert.ok(first instanceof Cesium.GroundPrimitive);
  assert.ok(second instanceof Cesium.GroundPrimitive);
  assert.ok(line instanceof Cesium.GroundPolylinePrimitive);
  assert.deepEqual(
    first.geometryInstances.map((instance) => instance.id.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    second.geometryInstances.map((instance) => instance.id.id),
    ['b'],
  );
  assert.equal(first.classificationType, Cesium.ClassificationType.BOTH);
  const fill = first.geometryInstances[0].attributes.color.value;
  assert.deepEqual(
    [...fill],
    [0, 255, 255, Math.floor(LOCAL_FOOTPRINT_ALPHA * 255)],
  );
  assert.ok(first.appearance instanceof Cesium.PerInstanceColorAppearance);
  assert.equal(first.appearance.flat, true);
  assert.equal(line.geometryInstances[0].geometry.width, 2);
  assert.equal(
    env.layer.getStats().count,
    5,
    'the line still counts as a dataset record',
  );
  assert.equal(env.layer.getLodDiagnostics().total, 4);
});

test('a picked tip selects its context record and flies to the stem base', async (t) => {
  let picked = null;
  const env = await enabledLayer(t, { pick: () => picked });
  const [record] = renderedRecords(env.viewer.scene);
  picked = { primitive: record.point, id: record.carrier };
  env.click();
  assert.equal(env.viewer.selectedEntity, record.carrier);
  assert.equal(getContextStore().selectedEntityId, 'local-datacenters:a');
  const target = Cesium.Cartographic.fromCartesian(env.flights[0].destination);
  const base = record.carrier.__localBaseCarto;
  assert.ok(Math.abs(target.longitude - base.longitude) < 1e-12);
  assert.ok(Math.abs(target.latitude - base.latitude) < 1e-12);
  assert.ok(Math.abs(target.height - 5000) < 1e-3);
  assert.equal(
    env.viewer.scene.screenSpaceCameraController.enableInputs,
    false,
  );
  env.flights[0].complete();
  assert.equal(env.viewer.scene.screenSpaceCameraController.enableInputs, true);

  env.layer.disable(env.viewer);
  assert.equal(
    env.viewer.selectedEntity,
    undefined,
    'disable clears the carrier selection',
  );
  assert.ok(sceneIsEmpty(env.viewer.scene));
});

test('a picked ground line flies to its first vertex; foreign picks are ignored', async (t) => {
  let picked = null;
  const env = await enabledLayer(t, { pick: () => picked });
  const line = env.viewer.scene.groundPrimitives.items[0].get(2);
  picked = { primitive: line, id: line.geometryInstances[0].id };
  env.click();
  const target = Cesium.Cartographic.fromCartesian(env.flights[0].destination);
  assert.ok(Math.abs(Cesium.Math.toDegrees(target.longitude) - 3) < 1e-9);
  picked = { id: { __localLayerId: 'local-dams' } };
  env.click();
  picked = { id: { __localLayerId: 'local-datacenters', id: 'stale' } };
  env.click();
  assert.equal(env.flights.length, 1, "only this layer's live carriers fly");
});

test('footprint shows wait for their ground primitive and follow the carrier', () => {
  const scene = localSceneStub();
  const renderer = createLocalGeojsonPrimitives({
    scene,
    color: BASE,
    ...NODE_RENDER_OPTIONS,
  });
  const carrier = { id: 'a', show: true };
  const rings = [
    square(0, 0).map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
  ];
  const base = Cesium.Cartesian3.fromDegrees(0.005, 0.005);
  const tip = Cesium.Cartesian3.fromDegrees(0.005, 0.005, 2000);
  const visual = renderer.addRecord({
    carrier,
    base,
    tip,
    rings,
    isPoint: false,
  });
  renderer.attach();
  assert.equal(
    visual.stem.show,
    false,
    'visuals start hidden until the first walk',
  );
  assert.equal(visual.point.show, false);
  renderer.setVisible(visual, carrier, true);
  assert.equal(visual.stem.show, true);
  assert.equal(visual.point.show, true);
  assert.equal(
    renderer.maintain(),
    2,
    'not ready: the show and the geometry release wait',
  );

  const primitive = scene.groundPrimitives.items[0].get(0);
  const attributes = { show: new Uint8Array([0]) };
  Object.defineProperty(primitive, 'ready', { value: true });
  primitive.getGeometryInstanceAttributes = (id) =>
    id === carrier ? attributes : undefined;
  const creation = { geometryInstances: [] };
  primitive._classificationPrimitiveOptions = creation;
  assert.equal(renderer.maintain(), 0);
  assert.equal(renderer.pending, 0);
  assert.equal(attributes.show[0], 1);
  assert.equal(
    creation.geometryInstances,
    undefined,
    'creation geometry released once ready',
  );
  carrier.show = false;
  renderer.setVisible(visual, carrier, false);
  assert.equal(
    attributes.show[0],
    0,
    'a ready primitive takes the show at once',
  );

  renderer.destroy();
  assert.ok(sceneIsEmpty(scene));
  assert.equal(primitive.isDestroyed(), true);
  renderer.destroy();
});

test('a ground primitive finishing after a parked frame gets one more frame, once', async (t) => {
  const env = await enabledLayer(t);
  env.viewer.scene.preRender.raise(); // first walk: LOD shows what it admits
  env.viewer.scene.postRender.raise();
  assert.deepEqual(env.renderRequests, [], 'nothing ready, nothing to draw');
  const ground = env.viewer.scene.groundPrimitives.items[0];
  for (let i = 0; i < ground.length; i++) {
    const primitive = ground.get(i);
    if (!(primitive instanceof Cesium.GroundPrimitive)) continue;
    Object.defineProperty(primitive, 'ready', { value: true });
    primitive.getGeometryInstanceAttributes = () => ({
      show: new Uint8Array([0]),
    });
  }
  env.viewer.scene.postRender.raise();
  assert.deepEqual(env.renderRequests, [
    'local-ground-ready:local-datacenters',
  ]);
  env.viewer.scene.postRender.raise();
  assert.equal(env.renderRequests.length, 1, 'no progress, no further frames');
  env.layer.disable(env.viewer);
  assert.equal(env.viewer.scene.postRender.listeners.size, 0);
});

test('a double-clicked record locks the camera on its base, as Entities did', async (t) => {
  let picked = null;
  const env = await enabledLayer(t, { pick: () => picked });
  const added = [];
  env.viewer.entities = {
    add: (options) => {
      const entity = { ...options };
      added.push(entity);
      return entity;
    },
    remove: (entity) => {
      added.splice(added.indexOf(entity), 1);
      return true;
    },
  };
  env.viewer.trackedEntityChanged = new Cesium.Event();
  const [record] = renderedRecords(env.viewer.scene);
  picked = { primitive: record.point, id: record.carrier };
  env.doubleClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(added.length, 1);
  assert.equal(env.viewer.trackedEntity, added[0]);
  assert.ok(
    Cesium.Cartesian3.equals(
      added[0].position,
      record.carrier.__localBaseCartesian,
    ),
  );
  assert.equal(env.viewer.selectedEntity, record.carrier);

  picked = { id: { __localLayerId: 'someone-else' } };
  env.doubleClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(added.length, 1, 'a foreign pick leaves the lock alone');

  env.layer.disable(env.viewer);
  assert.equal(env.viewer.trackedEntity, undefined);
  assert.equal(added.length, 0, 'disable removes the helper');
});
