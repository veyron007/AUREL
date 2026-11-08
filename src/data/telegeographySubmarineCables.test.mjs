import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { MAP_STACKS } from '../mapStackController.js';
import {
  CABLE_LABEL_DEPTH_DECISION,
  CABLE_OVERLAY_COLLISION_CAPACITY,
  CABLE_OVERLAY_SOURCE_ID,
  CABLE_REFERENCE_LABEL_WINNER_CAP,
  CABLE_STEM_TIP_EPSILON_M,
  CABLE_SWEEP_MOTION_EPSILON_M,
  CABLE_SWEEP_MOTION_PROBE_INTERVAL_MS,
  cableClassificationTypeForScene,
  cableClassificationTypeForStack,
  cableReferencePriority,
  createCableOverlayEntry,
  createCableOverlayPublisher,
  createCableReferenceSweepGate,
  createTeleGeographySubmarineCableLayer,
  selectCableReferenceLabelWinners,
  updateCableReferenceStem,
} from './telegeographySubmarineCables.js';

test('cable reference winners remain nearest-first and hard-capped', () => {
  const records = Array.from({ length: 300 }, (_, index) => ({
    entity: { id: `reference-${index}` },
    label: `Reference ${index}`,
    visible: true,
    distanceM: 1000 + index,
  }));

  let winners = selectCableReferenceLabelWinners(records);
  assert.equal(winners.length, CABLE_REFERENCE_LABEL_WINNER_CAP);
  assert.equal(winners[0], records[0]);
  assert.equal(winners.at(-1), records[CABLE_REFERENCE_LABEL_WINNER_CAP - 1]);

  for (let index = 0; index < 80; index++) records[index].visible = false;
  winners = selectCableReferenceLabelWinners(records);
  assert.equal(winners.length, CABLE_REFERENCE_LABEL_WINNER_CAP);
  assert.equal(
    winners[0],
    records[80],
    'hidden references release their slots to the next nearest',
  );

  records[90].distanceM = 10_000_000; // beyond the 9,000 km reference range
  winners = selectCableReferenceLabelWinners(records);
  assert.ok(
    !winners.includes(records[90]),
    'out-of-range references never reach the host',
  );
});

test('cable overlay entries satisfy the shared presentation contract', () => {
  const tip = Cesium.Cartesian3.fromDegrees(-40, 35, 2500);
  const record = {
    id: 'cable-reference-0-atlantic-1',
    kind: 'cable',
    label: 'Atlantic Crossing-1',
    tip,
    distanceM: 400_000,
  };
  const entry = createCableOverlayEntry(record);

  assert.equal(entry.id, 'cable-reference-0-atlantic-1');
  assert.equal(
    entry.position,
    tip,
    'entry stays attached to the mutable stem-tip Cartesian',
  );
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'Atlantic Crossing-1');
  assert.equal(entry.accent, '#39d5ff');
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(
    entry.interactive,
    false,
    'point/stem/line picking remains Cesium-native',
  );
  assert.equal(entry.maxDistance, 9_000_000);
  assert.equal(entry.distanceFadeStartRatio, 0.7);
  assert.deepEqual(
    entry.distanceScale,
    {
      near: 250_000,
      nearValue: 1,
      far: 9_000_000,
      farValue: 0.62,
    },
    'former native scaleByDistance curve is preserved',
  );
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.terrainOcclusion, false);
  assert.equal(entry.verticalOnly, true);
  assert.equal(entry.placement, 'above');

  const landing = createCableOverlayEntry({
    id: 'landing-point-reference-1-lisbon',
    kind: 'landing-point',
    label: 'Lisbon, Portugal',
    tip,
    distanceM: 100_000,
  });
  assert.equal(
    landing.accent,
    '#8fffd2',
    'landing points keep their mint accent',
  );
  assert.equal(landing.interactive, false);
});

test('cable reference priority is nearest-first and sweep-stable', () => {
  assert.ok(cableReferencePriority(1_000) > cableReferencePriority(1_000_000));
  assert.ok(
    cableReferencePriority(1_000_000) > cableReferencePriority(8_000_000),
  );
  assert.equal(
    cableReferencePriority(500_000),
    cableReferencePriority(500_000 + 10_000),
    '50 km quantization keeps slow camera drift from reshuffling ranks',
  );
  assert.equal(
    cableReferencePriority(undefined),
    cableReferencePriority(9_000_000),
    'missing distances rank like the range edge instead of jumping the queue',
  );
});

test('cable overlay publisher owns the production show/publish/hide lifecycle', () => {
  const calls = [];
  const publisher = createCableOverlayPublisher({
    host: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clear', ...args]),
    },
  });

  publisher.publish([{ id: 'ignored-before-show' }]);
  publisher.show();
  publisher.show();
  publisher.publish([{ id: 'cable-1' }]);
  publisher.hide();
  publisher.publish([{ id: 'dropped-while-hidden' }]);
  publisher.hide();

  assert.deepEqual(calls[0], ['visible', CABLE_OVERLAY_SOURCE_ID, true]);
  assert.deepEqual(calls[1].slice(0, 3), [
    'entries',
    CABLE_OVERLAY_SOURCE_ID,
    [{ id: 'cable-1' }],
  ]);
  assert.deepEqual(calls[1][3], {
    cohortLimit: CABLE_REFERENCE_LABEL_WINNER_CAP,
    collisionCapacity: CABLE_OVERLAY_COLLISION_CAPACITY,
    moving: false,
  });
  assert.deepEqual(calls[2], ['clear', CABLE_OVERLAY_SOURCE_ID]);
  assert.deepEqual(calls[3], ['visible', CABLE_OVERLAY_SOURCE_ID, false]);
  assert.equal(
    calls.length,
    4,
    'hidden publishers drop late publishes; repeat hide is a no-op',
  );

  // The production teardown (layer.destroy) is hide(): the publisher stays
  // reusable for the layer's supported re-init-after-destroy contract. There
  // is intentionally no permanent-destroy method to test.
  assert.equal(publisher.destroy, undefined);
  publisher.show();
  publisher.publish([{ id: 'cable-2' }]);
  assert.deepEqual(calls[4], ['visible', CABLE_OVERLAY_SOURCE_ID, true]);
  assert.deepEqual(calls[5].slice(0, 3), [
    'entries',
    CABLE_OVERLAY_SOURCE_ID,
    [{ id: 'cable-2' }],
  ]);
});

test('cable ground lines classify against exactly the active surface on every stack', () => {
  // Photorealistic tiles render with the globe hidden — 3D-tile pass only.
  assert.equal(
    cableClassificationTypeForStack('photoreal'),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  // Every globe stack renders imagery on the shown globe — terrain pass only.
  for (const stackId of ['bing-aerial', 'bing-labels', 'esri-imagery', 'osm']) {
    assert.equal(
      cableClassificationTypeForStack(stackId),
      Cesium.ClassificationType.TERRAIN,
      `${stackId} must classify against terrain so cables stay visible there`,
    );
  }
  // Unknown stack → BOTH: visible on every surface, the shipped fallback.
  // A TRUTHY unknown id must reach it too — "not photoreal" is not the same
  // claim as "renders on the globe", and asserting TERRAIN for an id this
  // module has never heard of would hide the cables on a future 3D-tile
  // stack instead of degrading to the documented safe behavior.
  assert.equal(
    cableClassificationTypeForStack('some-future-stack'),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    cableClassificationTypeForStack('photoreal-v2'),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    cableClassificationTypeForStack(''),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    cableClassificationTypeForStack(undefined),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    cableClassificationTypeForStack(null),
    Cesium.ClassificationType.BOTH,
  );

  // Every id that actually ships must be a KNOWN id: a stack added to
  // MAP_STACKS without a mapping here silently loses its halved command set,
  // so the omission fails loudly instead of degrading quietly.
  for (const stack of MAP_STACKS) {
    assert.notEqual(
      cableClassificationTypeForStack(stack.id),
      Cesium.ClassificationType.BOTH,
      `MAP_STACKS id '${stack.id}' has no cable classification mapping`,
    );
  }

  // Boot fires no stack event; the initial value derives from live scene
  // state exactly like the height-datum listeners: photoreal ⇔ globe hidden.
  assert.equal(
    cableClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    cableClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(
    cableClassificationTypeForScene(null),
    Cesium.ClassificationType.BOTH,
  );
});

test('cable reference sweep gate is dirty-only — no timer path', () => {
  const gate = createCableReferenceSweepGate();
  assert.equal(gate.shouldRun(), true, 'initial dirtiness covers enable/load');
  // However many frames render, an un-dirtied gate never runs the sweep —
  // the former 500 ms timer path is gone.
  for (let frame = 0; frame < 200; frame++) {
    assert.equal(gate.shouldRun(), false);
  }
  gate.markDirty();
  assert.equal(gate.shouldRun(), true, 'moveEnd dirtiness runs exactly once');
  assert.equal(gate.shouldRun(), false);
  gate.reset();
  assert.equal(gate.shouldRun(), true, 'reset restores the initial dirtiness');
});

test('the sweep gate falls back to motion probes for cameras that never emit moveEnd', () => {
  let clock = 0;
  const frameMs = 1000 / 60;
  const origin = Cesium.Cartesian3.fromDegrees(-40, 35, 4_500_000);
  const camera = { positionWC: Cesium.Cartesian3.clone(origin) };
  const gate = createCableReferenceSweepGate({ now: () => clock });
  const runFrames = (count, step = () => {}) => {
    let sweeps = 0;
    for (let frame = 0; frame < count; frame++) {
      clock += frameMs;
      step(frame);
      if (gate.shouldRun(camera)) sweeps++;
    }
    return sweeps;
  };

  assert.equal(
    gate.shouldRun(camera),
    true,
    'initial dirtiness still covers enable/load',
  );

  // PARKED: 100 s of frames on a camera that never moves must cost ZERO
  // sweeps — the fallback is motion-aware, not a reinstated timer.
  assert.equal(
    runFrames(6000),
    0,
    'a parked camera costs zero sweeps however long frames flow',
  );

  // Sub-epsilon jitter is not motion either: the probe compares against the
  // last SWEPT position, so numeric noise can never accumulate into a sweep.
  const jitter = runFrames(6000, (frame) => {
    camera.positionWC = Cesium.Cartesian3.add(
      origin,
      new Cesium.Cartesian3(
        0,
        0,
        (frame % 2) * (CABLE_SWEEP_MOTION_EPSILON_M / 10),
      ),
      new Cesium.Cartesian3(),
    );
  });
  assert.equal(jitter, 0, 'sub-epsilon camera jitter never earns a sweep');

  // TRACKING: a follow camera advances every frame and never emits moveEnd.
  // The sweep must land inside one probe window instead of starving forever.
  const timedGate = createCableReferenceSweepGate({ now: () => clock });
  const timedCamera = { positionWC: Cesium.Cartesian3.clone(origin) };
  assert.equal(timedGate.shouldRun(timedCamera), true, 'the gate starts dirty');
  const trackingStart = clock;
  let sweepAt = null;
  for (let frame = 0; frame < 600 && sweepAt === null; frame++) {
    clock += frameMs;
    timedCamera.positionWC = Cesium.Cartesian3.add(
      origin,
      new Cesium.Cartesian3(0, 0, 12 * (frame + 1)), // ~0.7 km/s: a tracked jet
      new Cesium.Cartesian3(),
    );
    if (timedGate.shouldRun(timedCamera)) sweepAt = clock;
  }
  assert.notEqual(
    sweepAt,
    null,
    'a continuously moving camera must not starve the sweep',
  );
  assert.ok(
    sweepAt - trackingStart <= CABLE_SWEEP_MOTION_PROBE_INTERVAL_MS + frameMs,
    `the fallback sweep must land inside one probe window (landed at ${sweepAt - trackingStart} ms)`,
  );
  assert.ok(
    sweepAt - trackingStart >= CABLE_SWEEP_MOTION_PROBE_INTERVAL_MS,
    'and never sooner — the probe stays bounded to one sample per window',
  );

  // moveEnd still wins immediately: an event-dirtied gate does not wait for
  // the probe window it is sitting inside.
  timedGate.markDirty();
  assert.equal(
    timedGate.shouldRun(timedCamera),
    true,
    'moveEnd dirtiness bypasses the probe window',
  );
  assert.equal(
    timedGate.shouldRun(timedCamera),
    false,
    'and still runs exactly once',
  );

  // A gate called without a camera keeps the pure dirty-only contract.
  const cameraless = createCableReferenceSweepGate({ now: () => clock });
  assert.equal(cameraless.shouldRun(), true);
  clock += CABLE_SWEEP_MOTION_PROBE_INTERVAL_MS * 10;
  assert.equal(
    cameraless.shouldRun(),
    false,
    'no camera state means no motion fallback',
  );
});

function makeStemRecord(lon = -40, lat = 35) {
  const base = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const tip = Cesium.Cartesian3.fromDegrees(lon, lat, 2500);
  const stemPositionBuffers = [
    [base, tip],
    [base, tip],
  ];
  const setCalls = { position: 0, polyline: 0, polylineArrays: [] };
  return {
    record: {
      point: {
        set position(_value) {
          setCalls.position++;
        },
      },
      stem: {
        set positions(value) {
          setCalls.polyline++;
          setCalls.polylineArrays.push(value);
        },
      },
      base,
      tip,
      nextTip: Cesium.Cartesian3.clone(tip),
      stemPositionBuffers,
      stemPositionBufferIndex: 0,
      reference: { lon, lat },
    },
    setCalls,
    stemPositionBuffers,
  };
}

test('staticized stems redefine constants only on real tip changes, alternating buffers', () => {
  const { record, setCalls, stemPositionBuffers } = makeStemRecord();
  const canvasHeight = 900;
  const fov = Math.PI / 3;
  const camera = Cesium.Cartesian3.fromDegrees(-40, 35, 500_000);

  assert.equal(
    updateCableReferenceStem(record, camera, canvasHeight, fov),
    true,
  );
  assert.equal(setCalls.position, 1);
  assert.equal(setCalls.polyline, 1);
  assert.equal(
    setCalls.polylineArrays[0],
    stemPositionBuffers[1],
    'first real update selects the alternate buffer',
  );

  // Sub-epsilon camera noise must not redefine anything.
  const jitter = Cesium.Cartesian3.add(
    camera,
    new Cesium.Cartesian3(CABLE_STEM_TIP_EPSILON_M / 10, 0, 0),
    new Cesium.Cartesian3(),
  );
  assert.equal(
    updateCableReferenceStem(record, jitter, canvasHeight, fov),
    false,
  );
  assert.equal(setCalls.position, 1);
  assert.equal(setCalls.polyline, 1);

  // A real camera move flips back to the first buffer: steady state allocates
  // no arrays beyond the two preallocated ones.
  const moved = Cesium.Cartesian3.add(
    camera,
    new Cesium.Cartesian3(0, 0, 400_000),
    new Cesium.Cartesian3(),
  );
  assert.equal(
    updateCableReferenceStem(record, moved, canvasHeight, fov),
    true,
  );
  assert.equal(setCalls.polylineArrays[1], stemPositionBuffers[0]);
  assert.equal(new Set(setCalls.polylineArrays).size, 2);

  // Stem height honors the shipped 700 m..85 km clamp.
  const tipCarto = Cesium.Cartographic.fromCartesian(record.tip);
  assert.ok(tipCarto.height >= 700 && tipCarto.height <= 85_000);
});

test('the depth decision is the dated Option-2 host migration, superseding Option 1', () => {
  assert.deepEqual(CABLE_LABEL_DEPTH_DECISION, {
    option: 2,
    decidedAt: '2026-08-18',
    supersedes: '2026-08-02',
    depthTested: false,
  });
});

test('cables create no entities, native labels or per-frame geometry callbacks', () => {
  const source = [
    '../../data/telegeographySubmarineCables.js',
    '../../app/layers/submarineCables.js',
    '../../app/layers/overlayHost.js',
    'rendering.js',
    'renderer.js',
    'primitives.js',
    'model.js',
    'overlay.js',
    'surface.js',
    'ingestion.js',
    'interaction.js',
    'geometry.js',
    'lifecycle.js',
  ]
    .map((file) =>
      readFileSync(
        new URL('../layers/submarineCables/' + file, import.meta.url),
        'utf8',
      ),
    )
    .join('\n');
  assert.doesNotMatch(
    source,
    /new Cesium\.LabelGraphics/,
    'reverting to native labels must fail this pin',
  );
  assert.doesNotMatch(
    source,
    /new Cesium\.CallbackProperty/,
    'reverting to per-frame stem callbacks must fail this pin',
  );
  assert.doesNotMatch(
    source,
    /GeoJsonDataSource\.load|CustomDataSource|entities\.add/,
    'the layer must stay off the Entity path',
  );
  assert.match(
    source,
    /setOverlayEntries/,
    'labels must flow through the shared world-overlay host',
  );
  assert.match(source, /record\.point\.position = record\.tip/);
  assert.match(
    source,
    /const stemPositionBuffers = \[\s*\[base, tip\],\s*\[base, tip\],?\s*\]/,
  );
  assert.match(source, /record\.stem\.positions = stemPositions/);
});

const CABLE_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'ac1',
      properties: { id: 'ac1', name: 'Atlantic Crossing-1' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-40, 35],
          [-30, 40],
        ],
      },
    },
  ],
};
const LANDING_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'lisbon',
      properties: { id: 'lisbon', name: 'Lisbon, Portugal', is_tbd: false },
      geometry: { type: 'Point', coordinates: [-9.1, 38.7] },
    },
  ],
};

function fixtureForUrl(url) {
  return String(url).includes('landing-point')
    ? LANDING_FIXTURE
    : CABLE_FIXTURE;
}

// Node has no WebGL context: give the appearances' render states the limits a
// real context reports, as the other primitive-backed layer tests do.
Cesium.ContextLimits._minimumAliasedLineWidth = 1;
Cesium.ContextLimits._maximumAliasedLineWidth = 10;

/** Node has no canvas or DOM classes: stand-ins for the two DOM-bound factories. */
const NODE_RENDER_OPTIONS = Object.freeze({
  pinImage: () => 'data:image/png;base64,',
  stemMaterial: () => ({ type: 'Color', destroy() {} }),
});

/** A scene collection that records what it holds and destroys what it drops. */
function sceneCollection({ rejectAdd = false } = {}) {
  const items = [];
  return {
    items,
    add(primitive) {
      if (rejectAdd) throw new Error('scene rejected the primitives');
      items.push(primitive);
      return primitive;
    },
    remove(primitive) {
      const index = items.indexOf(primitive);
      if (index < 0) return false;
      items.splice(index, 1);
      if (!primitive.isDestroyed?.()) primitive.destroy?.();
      return true;
    },
  };
}

function makeStubViewer(listeners, { rejectAdd = false } = {}) {
  const flights = [];
  const viewer = {
    flights,
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-40, 35, 4_500_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd: {
        addEventListener: (fn) => {
          listeners.moveEnd.add(fn);
          return () => listeners.moveEnd.delete(fn);
        },
      },
      heading: 0,
      cancelFlight() {},
      flyTo(options) {
        flights.push(options);
      },
    },
    scene: {
      canvas: { clientHeight: 900 },
      primitives: sceneCollection({ rejectAdd }),
      groundPrimitives: sceneCollection(),
      frameState: { mode: Cesium.SceneMode.SCENE3D },
      updateHeight: () => () => {},
      getHeight: () => undefined,
      requestRender() {},
      pickResult: null,
      pick() {
        return viewer.scene.pickResult;
      },
      preRender: {
        addEventListener: (fn) => {
          listeners.preRender.add(fn);
          return () => listeners.preRender.delete(fn);
        },
      },
      postRender: {
        addEventListener: (fn) => {
          listeners.postRender.add(fn);
          return () => listeners.postRender.delete(fn);
        },
      },
    },
  };
  return viewer;
}

/** The layer's collections, read back from the stub scene. */
function rendered(viewer) {
  const root = viewer.scene.primitives.items[0] || null;
  const ground = viewer.scene.groundPrimitives.items[0] || null;
  const list = (collection) =>
    collection
      ? Array.from({ length: collection.length }, (_, i) => collection.get(i))
      : [];
  const groundPrimitives = list(ground);
  return {
    root,
    ground,
    pins: root ? list(root.get(0)) : [],
    stems: root ? list(root.get(1)) : [],
    tips: root ? list(root.get(2)) : [],
    pinCollection: root?.get(0) || null,
    tipCollection: root?.get(2) || null,
    lines:
      groundPrimitives.find(
        (primitive) => primitive instanceof Cesium.GroundPolylinePrimitive,
      ) || null,
    groundPrimitives,
  };
}

function sceneIsEmpty(viewer) {
  return (
    viewer.scene.primitives.items.length === 0 &&
    viewer.scene.groundPrimitives.items.length === 0
  );
}

function createLayer({ source, mapStackEventTarget = null, clock } = {}) {
  const hostCalls = [];
  const clickActions = [];
  const layer = createTeleGeographySubmarineCableLayer({
    overlayHost: {
      setVisible: (...args) => hostCalls.push(['visible', ...args]),
      setEntries: (...args) => hostCalls.push(['entries', ...args]),
      clearSource: (...args) => hostCalls.push(['clear', ...args]),
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(action) {
        clickActions.push(action);
      },
      destroy() {},
    }),
    ...(source ? { source } : {}),
    mapStackEventTarget,
    ...(clock ? { sweepClock: clock } : {}),
    renderOptions: NODE_RENDER_OPTIONS,
  });
  return { layer, hostCalls, clickActions };
}

/**
 * Harness whose fetches stay PENDING until the test releases them, honoring
 * the abort signal like real fetch (reject with AbortError on abort). Load
 * lifecycle races are sequenced deterministically through it.
 */
function createDeferredCableLayerHarness({ rejectAdd = false } = {}) {
  const listeners = {
    preRender: new Set(),
    moveEnd: new Set(),
    postRender: new Set(),
  };
  const pendingFetches = [];
  const abortError = () =>
    Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const entry = {
        url: String(url),
        settled: false,
        release() {
          if (entry.settled) return;
          entry.settled = true;
          resolve({ ok: true, json: async () => fixtureForUrl(url) });
        },
      };
      const signal = options?.signal;
      if (signal) {
        if (signal.aborted) {
          entry.settled = true;
          reject(abortError());
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            if (entry.settled) return;
            entry.settled = true;
            reject(abortError());
          },
          { once: true },
        );
      }
      pendingFetches.push(entry);
    });

  const { layer, hostCalls } = createLayer();
  const viewer = makeStubViewer(listeners, { rejectAdd });
  layer.init(viewer);

  return {
    layer,
    viewer,
    hostCalls,
    listeners,
    pendingFetches,
    raiseSweep() {
      for (const fn of listeners.preRender) fn();
    },
    releaseAll() {
      for (const entry of [...pendingFetches]) entry.release();
      pendingFetches.length = 0;
    },
    async settle() {
      // Drain the microtask/timer interleave the load path spans.
      for (let i = 0; i < 8; i++)
        await new Promise((resolve) => setTimeout(resolve, 0));
    },
    cleanup() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('an abort landing at the post-fetch boundary stops the stale load before any build', async () => {
  const env = createDeferredCableLayerHarness();
  try {
    env.layer.enable(env.viewer);
    // Release A's fetches and abort in the SAME frame: A's continuation runs
    // with ownership already lost, and the post-fetch owns() check is the guard.
    env.releaseAll();
    env.layer.disable();
    env.layer.enable(env.viewer);
    await env.settle();
    assert.ok(sceneIsEmpty(env.viewer), 'stale load A must build nothing');

    env.releaseAll();
    await env.settle();
    assert.equal(env.viewer.scene.primitives.items.length, 1);
    assert.equal(env.viewer.scene.groundPrimitives.items.length, 1);
    assert.equal(env.layer.getStats().count, 2);
  } finally {
    env.layer.destroy(env.viewer);
    env.cleanup();
  }
});

test('a scene that rejects the primitives leaves nothing behind and reports the error', async () => {
  const env = createDeferredCableLayerHarness({ rejectAdd: true });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    env.layer.enable(env.viewer);
    env.releaseAll();
    await env.settle();
    assert.ok(sceneIsEmpty(env.viewer));
    assert.match(env.layer.getStats().error, /scene rejected/);
    assert.equal(env.layer.getStats().loading, false);
  } finally {
    console.warn = originalWarn;
    env.layer.destroy(env.viewer);
    env.cleanup();
  }
});

test('a direct destroy of a published layer clears and hides its host source', async () => {
  const env = createDeferredCableLayerHarness();
  try {
    env.layer.enable(env.viewer);
    env.releaseAll();
    await env.settle();
    assert.equal(env.viewer.scene.primitives.items.length, 1, 'loaded');
    // Drive the sweep through the layer's real preRender listener so the
    // host actually holds published cable entries.
    env.raiseSweep();
    assert.ok(
      env.hostCalls.some(([type]) => type === 'entries'),
      'sweep must publish before the direct destroy',
    );
    env.hostCalls.length = 0;

    // Destroy DIRECTLY — no disable() first. The publisher teardown must
    // still clear the published source and hide it.
    env.layer.destroy(env.viewer);
    assert.ok(
      env.hostCalls.some(
        ([type, id]) => type === 'clear' && id === CABLE_OVERLAY_SOURCE_ID,
      ),
      'direct destroy must clear the published host source',
    );
    assert.deepEqual(
      env.hostCalls.at(-1),
      ['visible', CABLE_OVERLAY_SOURCE_ID, false],
      'direct destroy must hide the host source after clearing it',
    );
    assert.ok(sceneIsEmpty(env.viewer), 'destroy frees every primitive');
  } finally {
    env.cleanup();
  }
});

test("a stale aborted load never clobbers the next load's lifecycle (A/B/C toggle race)", async () => {
  const env = createDeferredCableLayerHarness();
  try {
    // A: enable starts a load whose fetches stay pending.
    env.layer.enable(env.viewer);
    assert.equal(
      env.pendingFetches.length,
      2,
      'load A has two fetches in flight',
    );

    // Abort A and immediately start B before A's rejection lands.
    env.layer.disable();
    env.layer.enable(env.viewer);
    await env.settle(); // A's stale catch/finally runs here, after B began.

    // C: with A's stale completion having cleared nothing it does not own,
    // the layer still reports a load in flight, so update() must not start a
    // third load.
    void env.layer.update(env.viewer);
    await env.settle();
    const inFlight = env.pendingFetches.filter(
      (entry) => !entry.settled,
    ).length;
    assert.equal(
      inFlight,
      2,
      "only load B's two fetches remain in flight — no duplicate load C",
    );

    // Releasing everything must produce exactly one set of primitives.
    env.releaseAll();
    await env.settle();
    assert.equal(env.viewer.scene.primitives.items.length, 1);
    assert.equal(env.viewer.scene.groundPrimitives.items.length, 1);
    const stats = env.layer.getStats();
    assert.equal(stats.error, null);
    assert.equal(stats.count, 2, 'one cable + one landing point loaded once');
  } finally {
    env.layer.destroy(env.viewer);
    env.cleanup();
  }
});

test('destroy mid-load stays clean and a re-enabled layer reloads exactly once', async () => {
  const env = createDeferredCableLayerHarness();
  try {
    // Destroy while load A's fetches are still in flight.
    env.layer.enable(env.viewer);
    assert.equal(env.pendingFetches.length, 2);
    env.layer.destroy(env.viewer);

    // Legacy contract: the layer supports re-init after destroy. Enable D
    // before A's aborted rejection lands.
    env.layer.enable(env.viewer);
    await env.settle(); // A's stale finally runs here.

    // A's stale completion must not have cleared D's in-flight lifecycle:
    // update() must not start a duplicate load E.
    void env.layer.update(env.viewer);
    await env.settle();
    const inFlight = env.pendingFetches.filter(
      (entry) => !entry.settled,
    ).length;
    assert.equal(inFlight, 2, "only load D's two fetches remain in flight");

    env.releaseAll();
    await env.settle();
    assert.equal(env.viewer.scene.primitives.items.length, 1);
    assert.equal(env.viewer.scene.groundPrimitives.items.length, 1);
    assert.equal(env.layer.getStats().count, 2);
  } finally {
    env.layer.destroy(env.viewer);
    env.cleanup();
  }
});

async function createRealCableLayerHarness({
  source,
  mapStackEventTarget = null,
} = {}) {
  // The sweep gate's motion-fallback clock is FROZEN here and advanced only by
  // the tests that exercise it, so every other harness test observes the pure
  // event-dirty behavior with no wall-clock coupling.
  let clockMs = 0;
  const { layer, hostCalls, clickActions } = createLayer({
    source,
    mapStackEventTarget,
    clock: () => clockMs,
  });
  const listeners = {
    preRender: new Set(),
    moveEnd: new Set(),
    postRender: new Set(),
  };
  const viewer = makeStubViewer(listeners);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => fixtureForUrl(url),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    // enable() fires load() without awaiting it (legacy contract); poll the
    // layer's own stats until the load settles.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const stats = layer.getStats();
      if (stats.count > 0 || stats.error) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(layer.getStats().error, null, 'harness load must succeed');
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    hostCalls,
    listeners,
    raiseSweep() {
      for (const fn of listeners.preRender) fn();
    },
    advanceClock(ms) {
      clockMs += ms;
    },
    /** Click with `scene.pick` returning `picked`; returns the flight, if any. */
    click(picked) {
      viewer.scene.pickResult = picked;
      const before = viewer.flights.length;
      for (const action of clickActions) action({ position: { x: 1, y: 1 } });
      return viewer.flights.length > before ? viewer.flights.at(-1) : null;
    },
  };
}

function flightTarget(flight) {
  const carto = Cesium.Cartographic.fromCartesian(flight.destination);
  return {
    lon: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
    lat: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
  };
}

test('a map-stack change re-classifies the cable lines once, and destroy detaches the listener', async () => {
  const listeners = new Map();
  const eventTarget = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {
      if (listeners.get(name) === fn) listeners.delete(name);
    },
  };
  const env = await createRealCableLayerHarness({
    mapStackEventTarget: eventTarget,
  });
  // The harness scene has no globe → BOTH at init (safe unknown fallback).
  assert.equal(
    rendered(env.viewer).lines.classificationType,
    Cesium.ClassificationType.BOTH,
  );
  const listener = listeners.get('gev:map-stack-changed');
  assert.equal(
    typeof listener,
    'function',
    'init must subscribe to the stack event',
  );

  const before = rendered(env.viewer).lines;
  listener({ detail: { activeId: 'photoreal', status: 'ready' } });
  const photoreal = rendered(env.viewer).lines;
  assert.equal(
    photoreal.classificationType,
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.ok(before.isDestroyed(), 'the replaced line primitive is freed');
  assert.equal(
    rendered(env.viewer).groundPrimitives.length,
    1,
    'exactly one cable line primitive after the rebuild',
  );

  listener({ detail: { activeId: 'osm', status: 'ready' } });
  assert.equal(
    rendered(env.viewer).lines.classificationType,
    Cesium.ClassificationType.TERRAIN,
  );
  listener({ detail: { activeId: 'osm', status: 'ready' } });
  assert.ok(
    !rendered(env.viewer).lines.isDestroyed(),
    'an unchanged surface does not rebuild',
  );

  env.layer.destroy(env.viewer);
  assert.equal(
    listeners.has('gev:map-stack-changed'),
    false,
    'destroy must detach the stack listener',
  );
});

test('markers and tips blend in one translucent pass with the shipped styling', async () => {
  const env = await createRealCableLayerHarness();
  try {
    const view = rendered(env.viewer);
    assert.equal(
      view.pinCollection.blendOption,
      Cesium.BlendOption.TRANSLUCENT,
    );
    assert.equal(
      view.tipCollection.blendOption,
      Cesium.BlendOption.TRANSLUCENT,
    );

    // Landing point: the GeoJSON default pin, ground-clamped, bottom anchored.
    assert.equal(view.pins.length, 1);
    const pin = view.pins[0];
    assert.equal(pin.heightReference, Cesium.HeightReference.CLAMP_TO_GROUND);
    assert.equal(pin.verticalOrigin, Cesium.VerticalOrigin.BOTTOM);

    // Reference tips and stems: cable then landing point.
    const cable = Cesium.Color.fromCssColorString('#39d5ff');
    const landing = Cesium.Color.fromCssColorString('#8fffd2');
    assert.deepEqual(
      view.tips.map((tip) => [tip.pixelSize, tip.outlineWidth]),
      [
        [7, 1],
        [8, 1],
      ],
    );
    assert.ok(Cesium.Color.equals(view.tips[0].color, cable.withAlpha(0.84)));
    assert.ok(Cesium.Color.equals(view.tips[1].color, landing.withAlpha(0.94)));
    assert.ok(
      Cesium.Color.equals(
        view.tips[0].outlineColor,
        Cesium.Color.BLACK.withAlpha(0.65),
      ),
    );
    assert.equal(view.tips[0].disableDepthTestDistance, 0);
    assert.deepEqual(
      view.stems.map((stem) => stem.width),
      [2, 2.4],
    );

    // Cable ground line: RHUMB, 2.5 px, the base colour at 0.92 alpha.
    const [instance] = view.lines.geometryInstances;
    assert.equal(instance.geometry.width, 2.5);
    assert.equal(instance.geometry.arcType, Cesium.ArcType.RHUMB);
    assert.deepEqual(
      Array.from(instance.attributes.color.value),
      Array.from(
        Cesium.ColorGeometryInstanceAttribute.toValue(cable.withAlpha(0.92)),
      ),
    );
    assert.ok(view.lines.appearance instanceof Cesium.PolylineColorAppearance);
  } finally {
    env.layer.destroy(env.viewer);
  }
});

test('picking a cable, a landing pin, a stem or a tip resolves its record and flies to it', async () => {
  const env = await createRealCableLayerHarness();
  try {
    const view = rendered(env.viewer);
    const lineKey = view.lines.geometryInstances[0].id;
    const atlantic = flightTarget(
      env.click({ id: lineKey, primitive: view.lines }),
    );
    // A LineString without properties.coordinates anchors at its mean vertex.
    assert.deepEqual(atlantic, { lon: -35, lat: 37.5 });
    assert.deepEqual(env.layer.resolvePick({ id: lineKey }), {
      kind: 'cable',
      reference: { lon: -35, lat: 37.5 },
      label: 'Atlantic Crossing-1',
    });

    const pin = view.pins[0];
    assert.deepEqual(flightTarget(env.click({ id: pin.id, primitive: pin })), {
      lon: -9.1,
      lat: 38.7,
    });
    assert.equal(
      env.layer.resolvePick({ id: pin.id }).label,
      'Lisbon, Portugal',
    );

    const stem = view.stems[1];
    const tip = view.tips[1];
    assert.equal(stem.id, tip.id, 'a stem and its tip share one record');
    assert.deepEqual(env.layer.resolvePick({ id: tip.id, primitive: tip }), {
      kind: 'landing-point',
      reference: { lon: -9.1, lat: 38.7 },
      label: 'Lisbon, Portugal',
      featureId: 'lisbon',
    });
    assert.ok(env.click({ primitive: stem, id: stem.id }));

    // Foreign picks and empty space never fly.
    assert.equal(env.click({ id: 'flight-abc123' }), null);
    assert.equal(env.click({ id: { name: 'entity' } }), null);
    assert.equal(env.click(null), null);

    env.layer.disable();
    assert.equal(
      env.layer.resolvePick({ id: lineKey }),
      null,
      'a disabled layer resolves nothing',
    );
  } finally {
    env.layer.destroy(env.viewer);
  }
});

test('a real enabled cable layer publishes host entries and has zero native labels', async () => {
  const env = await createRealCableLayerHarness();
  env.raiseSweep();

  const publishes = env.hostCalls.filter(([type]) => type === 'entries');
  assert.ok(publishes.length > 0, 'sweep must publish to the shared host');
  const [, sourceId, entries, options] = publishes.at(-1);
  assert.equal(sourceId, CABLE_OVERLAY_SOURCE_ID);
  assert.equal(entries.length, 2, 'one cable + one landing point reference');
  assert.ok(entries.every((entry) => entry.variant === 'label'));
  assert.deepEqual(options, {
    cohortLimit: CABLE_REFERENCE_LABEL_WINNER_CAP,
    collisionCapacity: CABLE_OVERLAY_COLLISION_CAPACITY,
    moving: false,
  });

  const stats = env.layer.getStats();
  assert.equal(stats.referenceLabelCount, 2);

  env.layer.disable();
  assert.ok(
    env.hostCalls.some(
      ([type, id]) => type === 'clear' && id === CABLE_OVERLAY_SOURCE_ID,
    ),
    'disable must clear the host source',
  );
  assert.deepEqual(
    env.hostCalls.at(-1),
    ['visible', CABLE_OVERLAY_SOURCE_ID, false],
    'disable must hide the host source after clearing it',
  );

  env.layer.destroy(env.viewer);
  assert.ok(sceneIsEmpty(env.viewer), 'destroy must remove every primitive');
});

/** Count real stem rewrites on one reference stem. */
function countStemRewrites(stem) {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(stem),
    'positions',
  );
  const counter = { count: 0 };
  Object.defineProperty(stem, 'positions', {
    configurable: true,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      counter.count++;
      descriptor.set.call(this, value);
    },
  });
  return counter;
}

test('stems never re-size mid-drag; exactly one re-size lands on moveEnd', async () => {
  const env = await createRealCableLayerHarness();
  env.raiseSweep(); // initial sizing at the parked camera

  const rewrites = countStemRewrites(rendered(env.viewer).stems[0]);

  // Mid-drag: the camera moves every tick and frames keep rendering, but no
  // moveEnd fires. However long this goes on, the stems must not move.
  const camera = env.viewer.camera.positionWC;
  for (let tick = 0; tick < 30; tick++) {
    env.viewer.camera.positionWC = Cesium.Cartesian3.add(
      camera,
      new Cesium.Cartesian3(0, 0, 100_000 * (tick + 1)),
      new Cesium.Cartesian3(),
    );
    env.raiseSweep(); // preRender fires every frame during a drag
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    rewrites.count,
    0,
    'render ticks without moveEnd must never re-size a stem',
  );

  // The gesture ends close over the cable's reference point (inside the
  // 700 m..85 km stem clamp band, so the re-size is a real tip change):
  // one moveEnd, one sweep, exactly one re-size.
  env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(
    -35,
    37.5,
    400_000,
  );
  for (const fn of env.listeners.moveEnd) fn();
  env.raiseSweep();
  assert.equal(rewrites.count, 1, 'moveEnd re-sizes the stem exactly once');
  env.raiseSweep();
  assert.equal(rewrites.count, 1, 'the next frame does not re-run the sweep');

  env.layer.destroy(env.viewer);
});

test('a tracked camera that never emits moveEnd is swept by the motion fallback', async () => {
  const env = await createRealCableLayerHarness();
  // Tracking hands over a mid-altitude follow camera. 400 km keeps the stem
  // inside the 700 m..85 km clamp band, so a sweep is observable as a real
  // tip re-size.
  env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(
    -35,
    37.5,
    400_000,
  );
  env.raiseSweep(); // initial sizing at the tracking handoff

  const rewrites = countStemRewrites(rendered(env.viewer).stems[0]);

  // Entity tracking / orbit: the follow camera advances every frame and
  // moveEnd NEVER fires. Frames are simulated at 60 Hz on the harness clock.
  const origin = env.viewer.camera.positionWC;
  const frameMs = 1000 / 60;
  const trackFrames = (from, to) => {
    for (let frame = from; frame < to; frame++) {
      env.advanceClock(frameMs);
      env.viewer.camera.positionWC = Cesium.Cartesian3.add(
        origin,
        new Cesium.Cartesian3(0, 0, 200 * (frame + 1)),
        new Cesium.Cartesian3(),
      );
      env.raiseSweep();
    }
  };

  trackFrames(0, 60);
  assert.equal(
    rewrites.count,
    0,
    'inside the probe window a tracked camera re-sizes nothing',
  );

  // Past the window the fallback fires — exactly once, not per frame.
  trackFrames(60, 130);
  assert.equal(
    rewrites.count,
    1,
    'the tracked camera earns exactly one fallback sweep per window',
  );

  // Tracking stops but frames keep rendering. The motion accumulated since
  // the last fallback sweep settles in exactly ONE further sweep...
  const parkFrames = (count) => {
    for (let frame = 0; frame < count; frame++) {
      env.advanceClock(frameMs);
      env.raiseSweep();
    }
  };
  parkFrames(240); // 4 s parked: two full probe windows
  assert.equal(
    rewrites.count,
    2,
    'a stopped camera settles its residual motion in one further sweep',
  );

  // ...and the parked camera then costs zero sweeps for as long as it sits.
  parkFrames(3600); // 60 s parked
  assert.equal(
    rewrites.count,
    2,
    'a settled parked camera never spends another sweep',
  );

  env.layer.destroy(env.viewer);
});

test('an unchanged cohort never republishes, so a parked camera stays governor-idle', async () => {
  const env = await createRealCableLayerHarness();
  const publishCount = () =>
    env.hostCalls.filter(([type]) => type === 'entries').length;

  env.raiseSweep();
  assert.equal(publishCount(), 1, 'first sweep publishes the cohort');

  // moveEnd with an unchanged camera re-arms the sweep; the identical winner
  // set must NOT reach the host again (each publish costs a requested render).
  for (const fn of env.listeners.moveEnd) fn();
  env.raiseSweep();
  for (const fn of env.listeners.moveEnd) fn();
  env.raiseSweep();
  assert.equal(publishCount(), 1, 'identical cohorts are skipped');

  // A real camera move changes distances beyond the 50 km priority quantum,
  // so the next sweep publishes again.
  env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(
    -40,
    35,
    6_500_000,
  );
  for (const fn of env.listeners.moveEnd) fn();
  env.raiseSweep();
  assert.equal(publishCount(), 2, 'a changed cohort publishes');

  // disable → enable must force a republish even when the cohort is identical
  // (the hide cleared the host source).
  env.layer.disable();
  env.layer.enable(env.viewer);
  await new Promise((resolve) => setTimeout(resolve, 10));
  env.raiseSweep();
  assert.equal(
    publishCount(),
    3,
    're-enable republishes after the hide cleared the source',
  );

  env.layer.destroy(env.viewer);
});

test('a toggle-off frees every primitive and a toggle-on rebuilds them without refetching', async () => {
  const env = await createRealCableLayerHarness();
  const before = rendered(env.viewer);
  assert.equal(env.viewer.scene.primitives.items.length, 1);
  assert.equal(env.viewer.scene.groundPrimitives.items.length, 1);
  assert.equal(env.layer.getStats().count, 2);

  // Any fetch after this point is a bug: the rebuild must come from the cache.
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('unexpected refetch');
  };
  try {
    env.layer.disable();
    assert.ok(sceneIsEmpty(env.viewer), 'disable must remove the primitives');
    for (const primitive of [
      before.root,
      before.ground,
      before.lines,
      before.pinCollection,
      before.tipCollection,
    ]) {
      assert.ok(primitive.isDestroyed(), 'disable frees GPU resources');
    }

    env.layer.enable(env.viewer);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && sceneIsEmpty(env.viewer)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fetches, 0, 'the rebuild must not touch the network');
    assert.equal(env.layer.getStats().error, null);
    assert.equal(env.layer.getStats().count, 2);
    assert.equal(rendered(env.viewer).stems.length, 2, 'stems are rebuilt');

    env.layer.destroy(env.viewer);
    assert.ok(sceneIsEmpty(env.viewer));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('another GeoJSON source renders with its own label and rebuilds from accepted cache', async () => {
  let reads = 0;
  const source = {
    label: 'Test cable directory',
    async fetch(signal) {
      signal.throwIfAborted();
      reads += 1;
      return { cables: CABLE_FIXTURE, landingPoints: LANDING_FIXTURE };
    },
  };
  const env = await createRealCableLayerHarness({ source });
  try {
    assert.equal(env.layer.source, source.label);
    assert.equal(reads, 1);
    env.layer.disable();
    assert.ok(sceneIsEmpty(env.viewer));
    env.layer.enable(env.viewer);
    for (let i = 0; i < 8; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(env.layer.getStats().count, 2);
    assert.equal(env.viewer.scene.primitives.items.length, 1);
    assert.equal(reads, 1);
  } finally {
    env.layer.destroy(env.viewer);
  }
});

function multipartCableFixture() {
  return [
    {
      type: 'Feature',
      properties: {
        id: 'alpha',
        name: 'Alpha cable',
        color: '#ff0000',
        coordinates: [-40, 35],
      },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-40, 35],
            [-39, 36],
          ],
          [
            [-38, 37],
            [-37, 38],
          ],
          [
            [-36, 39],
            [-35, 40],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        id: 'beta',
        name: 'Beta cable',
        color: '#0000ff',
        coordinates: [140, -35],
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [140, -35],
          [141, -34],
        ],
      },
    },
  ];
}

function geometrySource(cables, landingPoints = []) {
  return {
    label: 'Multipart test source',
    async fetch() {
      return {
        cables: { type: 'FeatureCollection', features: cables },
        landingPoints: { type: 'FeatureCollection', features: landingPoints },
      };
    },
  };
}

/** Every drawn ground segment's pick record, in draw order. */
function segmentRecords(env) {
  return rendered(env.viewer).lines.geometryInstances.map((instance) =>
    env.layer.resolvePick({ id: instance.id }),
  );
}

test('multipart association accepts frozen provider collections without modifying them', async () => {
  const payload = {
    cables: { type: 'FeatureCollection', features: multipartCableFixture() },
    landingPoints: {
      type: 'FeatureCollection',
      features: multipartCableFixture(),
    },
  };
  payload.cables.features[0].properties.__gevSourceFeatureIndex =
    'provider value';
  const before = structuredClone(payload);
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  freeze(payload);
  const env = await createRealCableLayerHarness({
    source: { label: 'Frozen multipart source', fetch: async () => payload },
  });
  try {
    const lines = rendered(env.viewer).groundPrimitives.filter(
      (primitive) => primitive instanceof Cesium.GroundPolylinePrimitive,
    );
    assert.equal(lines.length, 2, 'cable lines and landing lines');
    for (const primitive of lines) {
      assert.deepEqual(
        primitive.geometryInstances.map(
          (instance) => env.layer.resolvePick({ id: instance.id })?.label,
        ),
        ['Alpha cable', 'Alpha cable', 'Alpha cable', 'Beta cable'],
      );
    }
    assert.equal(rendered(env.viewer).stems.length, 4);
    assert.deepEqual(payload, before);
  } finally {
    env.layer.destroy(env.viewer);
  }
});

test('multipart cables retain their own styling, picking and culling on every segment', async () => {
  const features = multipartCableFixture();
  const before = JSON.stringify(features);
  const env = await createRealCableLayerHarness({
    source: geometrySource(features),
  });
  try {
    const instances = rendered(env.viewer).lines.geometryInstances;
    assert.equal(instances.length, 4);
    for (const [index, instance] of instances.entries()) {
      const feature = features[index < 3 ? 0 : 1];
      const info = env.layer.resolvePick({ id: instance.id });
      assert.equal(info?.label, feature.properties.name, instance.id);
      assert.deepEqual(info.reference, {
        lon: feature.properties.coordinates[0],
        lat: feature.properties.coordinates[1],
      });
      assert.deepEqual(
        Array.from(instance.attributes.color.value),
        Array.from(
          Cesium.ColorGeometryInstanceAttribute.toValue(
            Cesium.Color.fromCssColorString(feature.properties.color).withAlpha(
              0.92,
            ),
          ),
        ),
      );
      assert.equal(instance.geometry.width, 2.5);
    }
    // The sweep culls every segment by its feature's reference point; the
    // line primitive is not ready in Node, so the values queue for it.
    env.raiseSweep();
    const visibleTips = rendered(env.viewer).tips.map((tip) => tip.show);
    assert.deepEqual(visibleTips, [true, false]);
    assert.equal(
      rendered(env.viewer).stems.length,
      2,
      'one reference per feature',
    );
    assert.equal(
      JSON.stringify(features),
      before,
      'source features stay unchanged',
    );
  } finally {
    env.layer.destroy(env.viewer);
  }
});

test('multipart association supports missing and repeated IDs', async () => {
  const features = multipartCableFixture();
  features[1].id = 'alpha_2';
  delete features[1].properties.id;
  const generated = structuredClone(features[1]);
  delete generated.id;
  generated.properties.name = 'Generated cable';
  features.push(generated);
  const repeated = structuredClone(features[1]);
  repeated.properties.id = 'alpha';
  repeated.properties.name = 'Repeated ID cable';
  features.push(repeated);
  const env = await createRealCableLayerHarness({
    source: geometrySource(features),
  });
  try {
    assert.deepEqual(
      segmentRecords(env).map((info) => info?.label),
      [
        'Alpha cable',
        'Alpha cable',
        'Alpha cable',
        'Beta cable',
        'Generated cable',
        'Repeated ID cable',
      ],
    );
    assert.deepEqual(
      rendered(env.viewer).tips.map(
        (tip) => env.layer.resolvePick({ id: tip.id }).featureId,
      ),
      ['alpha', 'alpha_2', 'cable-2', 'alpha'],
    );
  } finally {
    env.layer.destroy(env.viewer);
  }
});

test('multipart landing geometry keeps every pick with one reference per feature', async () => {
  const features = multipartCableFixture();
  const env = await createRealCableLayerHarness({
    source: geometrySource([], features),
  });
  try {
    const records = segmentRecords(env);
    assert.deepEqual(
      records.map((info) => info?.label),
      ['Alpha cable', 'Alpha cable', 'Alpha cable', 'Beta cable'],
    );
    assert.ok(records.every((info) => info.kind === 'landing-point'));
    assert.equal(rendered(env.viewer).stems.length, 2);
    // Landing lines keep the GeoJSON defaults and draw on every surface.
    const instance = rendered(env.viewer).lines.geometryInstances[0];
    assert.equal(instance.geometry.width, 2);
    assert.equal(
      rendered(env.viewer).lines.classificationType,
      Cesium.ClassificationType.BOTH,
    );
  } finally {
    env.layer.destroy(env.viewer);
  }
});

/**
 * The records the Entity path produced, recomputed from the raw file: one
 * per GeoJSON entity (MultiLineString members, Points), labelled and
 * anchored by the feature, plus one reference per feature.
 */
function expectedRecords(features, kind) {
  const label = (feature) =>
    String(
      feature.properties?.name || feature.properties?.id || feature.id || '',
    ).trim();
  const reference = (feature) =>
    feature.properties?.coordinates
      ? {
          lon: feature.properties.coordinates[0],
          lat: feature.properties.coordinates[1],
        }
      : {
          lon: feature.geometry.coordinates[0],
          lat: feature.geometry.coordinates[1],
        };
  const parts = (feature) =>
    feature.geometry.type === 'MultiLineString'
      ? feature.geometry.coordinates.length
      : 1;
  return {
    segments: features.flatMap((feature) =>
      Array.from({ length: parts(feature) }, () => ({
        kind,
        reference: reference(feature),
        label: label(feature),
      })),
    ),
    references: features.map((feature, index) => ({
      kind,
      reference: reference(feature),
      label: label(feature),
      featureId: String(
        feature.properties?.id || feature.id || `${kind}-${index}`,
      ),
    })),
  };
}

function readBundled(name) {
  return JSON.parse(
    readFileSync(
      new URL(
        `./local_data/telegeography_submarine_cables/${name}`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
}

test('every bundled cable segment and landing point keeps its record (equivalence)', async () => {
  const cables = readBundled('cable-geo.json');
  const landings = readBundled('landing-point-geo.json');
  const env = await createRealCableLayerHarness({
    source: {
      label: 'TeleGeography',
      fetch: async () => ({ cables, landingPoints: landings }),
    },
  });
  try {
    const expectedCables = expectedRecords(cables.features, 'cable');
    const expectedLandings = expectedRecords(
      landings.features,
      'landing-point',
    );
    const view = rendered(env.viewer);
    assert.equal(
      env.layer.getStats().count,
      cables.features.length + landings.features.length,
    );
    assert.deepEqual(segmentRecords(env), expectedCables.segments);
    assert.deepEqual(
      view.pins.map((pin) => env.layer.resolvePick({ id: pin.id })),
      expectedLandings.segments,
    );
    assert.deepEqual(
      view.tips.map((tip) => env.layer.resolvePick({ id: tip.id })),
      expectedCables.references
        .map((info) => ({ ...info, kind: 'cable' }))
        .concat(expectedLandings.references),
    );
    // Each landing pin sits on its own point, sized as the 6 px pin.
    assert.equal(view.pins.length, 1917);
    assert.equal(view.stems.length, cables.features.length + 1917);
    // The bundled colours survive per segment.
    const colored = cables.features.flatMap((feature) =>
      feature.geometry.coordinates.map(() => feature.properties.color),
    );
    assert.deepEqual(
      view.lines.geometryInstances.map((instance) =>
        Array.from(instance.attributes.color.value),
      ),
      colored.map((css) =>
        Array.from(
          Cesium.ColorGeometryInstanceAttribute.toValue(
            Cesium.Color.fromCssColorString(css).withAlpha(0.92),
          ),
        ),
      ),
    );
  } finally {
    env.layer.destroy(env.viewer);
  }
});
