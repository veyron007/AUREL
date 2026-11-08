import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { perfBudgetTestOptions } from '../../scripts/run-perf-tests.mjs';
import {
  assertWithinBudgets,
  measureRuns,
  measureRunsAsync,
  seededRandom,
} from '../testSupport/perfBench.mjs';
import { createLocalGeoJsonLayer } from './localGeojsonCore.js';
import {
  NODE_RENDER_OPTIONS,
  localSceneStub,
} from './localGeojsonSceneStub.mjs';
import { selectInfraLod } from './localGeojsonLod.js';
import {
  INFRASTRUCTURE_DATA_URLS,
  parseGeojsonLines,
} from '../sources/infrastructureData.js';

// Local datacenter GeoJSON ingest through createLocalGeoJsonLayer with the
// shipped datacenter options (src/data/infrastructure.js), a faked fetch, a
// stub click-handler factory and a viewer whose scene only collects the
// layer's primitives (src/data/localGeojsonSceneStub.mjs; no WebGL, so no GPU
// upload is measured). Node has no Worker, so the dataset parse runs on this
// thread here; in the browser it runs in localGeojsonParse.worker.js.
//  - parse: parseGeojsonLines over the synthetic .geojsonl text.
//  - enable: fetch + parse into compact records + carriers, context records,
//    stem/tip/pin/footprint primitives and overlay entries (a fresh layer per
//    run, so nothing is cached).
//  - firstWalk: the first preRender walk, which builds the globe-LOD active
//    set (selectInfraLod + eviction grace), sizes stems and publishes the
//    overlay cohort.
//  - lodRecompute: moveEnd + preRender on a loaded layer (camera settle).
//  - selectInfraLod: the pure LOD ranking over every record.
// Inputs are 4,352 synthetic features shaped like the shipped
// datacenters.geojsonl (≈81% 13-vertex polygons, ≈19% points, a few
// multipolygons; ≈78% named), so the benchmark never reads the data file.
//
// Measured 2026-11-08, Apple M4, Node v26.13.0 — per-run median of 7 (5 for
// enable/firstWalk) after warm-up, median (range) over 3 runs:
//   Entity path (GeoJsonDataSource):  parse=6.3ms  enable=140ms
//     firstWalk=7.7ms  lodRecompute=0.55ms  selectInfraLod=0.32ms
//   Primitive path (WP4.2):  parse=6.5ms (6.2-6.6)  enable=52ms (50-53)
//     firstWalk=2.6ms (2.5-3.3)  lodRecompute=0.61ms (0.60-0.65)
//     selectInfraLod=0.28ms (0.23-0.30)
// Budgets are roughly 3x those medians, with a floor for sub-ms rows.

const FEATURE_COUNT = 4_352;
const POINT_EVERY = 5; // ≈19% points in the shipped file
const MULTIPOLYGON_EVERY = 541; // 8 in the shipped file
const POLYGON_VERTICES = 12; // plus the closing vertex: 13, as shipped
const FOOTPRINT_DEG = 0.0005;
const NAMED_FRACTION = 0.78;
const OPERATOR_FRACTION = 0.6;
const SEED = 0xdc;
// A regional camera over Europe (between the global and regional LOD bands).
const CAMERA = Object.freeze({ lon: 8, lat: 48, heightM: 2_000_000 });
const CANVAS = Object.freeze({ clientWidth: 1600, clientHeight: 900 });
const SYNC_RUNS = Object.freeze({ warmup: 3, runs: 7 });
const ENABLE_RUNS = Object.freeze({ warmup: 2, runs: 5 });
const BUDGET_MS = Object.freeze({
  parse: 25,
  enable: 160,
  firstWalk: 10,
  lodRecompute: 5,
  selectInfraLod: 2,
});
const OPERATORS = Object.freeze([
  'Amazon Web Services',
  'Equinix',
  'Digital Realty',
  'Google',
  'Microsoft',
  'OVHcloud',
]);
const noop = () => {};
// The shipped datacenter options from src/data/infrastructure.js, plus test
// seams for the click handler and window projection.
const DATACENTER_OPTIONS = Object.freeze({
  ...NODE_RENDER_OPTIONS,
  id: 'local-datacenters',
  name: 'Datacenters',
  color: '#00ffff',
  icon: '▣',
  source: 'Local',
  osmDerived: true,
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
  screenSpaceEventHandlerFactory: () => ({
    setInputAction: noop,
    destroy: noop,
  }),
  projectToWindow: () => ({
    x: CANVAS.clientWidth / 2,
    y: CANVAS.clientHeight / 2,
  }),
});

function ring(lon, lat, random) {
  const vertices = Array.from({ length: POLYGON_VERTICES }, (_, k) => {
    const angle = (k / POLYGON_VERTICES) * Math.PI * 2;
    const r = FOOTPRINT_DEG * (0.6 + random() * 0.4);
    return [
      Number((lon + Math.cos(angle) * r).toFixed(9)),
      Number((lat + Math.sin(angle) * r).toFixed(9)),
    ];
  });
  return [...vertices, vertices[0]];
}

function geometryFor(i, lon, lat, random) {
  if (i % MULTIPOLYGON_EVERY === 0) {
    return {
      type: 'MultiPolygon',
      coordinates: [[ring(lon, lat, random)], [ring(lon + 0.002, lat, random)]],
    };
  }
  if (i % POINT_EVERY === 0) return { type: 'Point', coordinates: [lon, lat] };
  return { type: 'Polygon', coordinates: [ring(lon, lat, random)] };
}

/** Deterministic datacenters.geojsonl text (one Feature per line). */
function syntheticDatacenterLines(count, seed = SEED) {
  const random = seededRandom(seed);
  const lines = Array.from({ length: count }, (_, i) => {
    const lon = Number((-125 + random() * 270).toFixed(6));
    const lat = Number((-45 + random() * 105).toFixed(6));
    const tags = {
      telecom: 'data_center',
      building: 'yes',
      ...(random() < NAMED_FRACTION ? { name: `Synthetic DC ${i}` } : {}),
      ...(random() < OPERATOR_FRACTION
        ? { operator: OPERATORS[i % OPERATORS.length] }
        : {}),
    };
    return JSON.stringify({
      id: 1_000_000 + i,
      type: 'Feature',
      geometry: geometryFor(i, lon, lat, random),
      properties: { id: i, tags, type: 'data_center', osm_id: 1_000_000 + i },
    });
  });
  return lines.join('\n');
}

/** A listener list with the add/remove shape Cesium events expose. */
function eventStub() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
  };
}

function viewerStub() {
  const preRender = eventStub();
  const moveEnd = eventStub();
  const scene = localSceneStub();
  const viewer = {
    selectedEntity: undefined,
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(
        CAMERA.lon,
        CAMERA.lat,
        CAMERA.heightM,
      ),
      positionCartographic: { height: CAMERA.heightM },
      frustum: {
        fov: Math.PI / 3,
        computeCullingVolume: () => ({ planes: [] }),
      },
      moveEnd,
      flyTo: noop,
    },
    scene: {
      ...scene,
      canvas: CANVAS,
      preRender,
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      pick: () => null,
      requestRender: noop,
    },
  };
  return { viewer, preRender, moveEnd, scene };
}

function servicesStub() {
  const published = { entries: 0, contexts: 0 };
  return {
    published,
    services: {
      overlayHost: {
        setVisible: noop,
        setEntries: (_source, entries) => {
          published.entries = entries.length;
        },
        clearSource: noop,
      },
      registerEntityContext: () => {
        published.contexts += 1;
      },
      selectEntityContext: noop,
      clearSelectedEntityContextForLayer: noop,
      removeEntityContextsForLayer: noop,
      governorRequestRender: noop,
      showOsmCredit: noop,
      hideOsmCredit: noop,
    },
  };
}

/** Install `value` on globalThis[key]; returns a function that restores it. */
function overrideGlobal(key, value) {
  const had = Object.hasOwn(globalThis, key);
  const original = globalThis[key];
  globalThis[key] = value;
  return () => {
    if (had) globalThis[key] = original;
    else delete globalThis[key];
  };
}

/** Run `fn` with fetch and window faked; restores both afterwards. */
async function withFakeFetch(text, fn) {
  const restores = [
    overrideGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => text,
    })),
    overrideGlobal('window', { dispatchEvent: noop }),
  ];
  try {
    return await fn();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

/** Create a datacenter layer and enable it on a fresh stub viewer. */
async function enableDatacenters() {
  const stub = viewerStub();
  const { services, published } = servicesStub();
  const layer = createLocalGeoJsonLayer(
    {
      ...DATACENTER_OPTIONS,
      url: INFRASTRUCTURE_DATA_URLS['local-datacenters'],
    },
    services,
  );
  await layer.enable(stub.viewer);
  return { ...stub, layer, published };
}

/** First preRender after enable or a camera settle; the walk is not throttled. */
function walk(harness) {
  harness.moveEnd.raise();
  harness.preRender.raise();
  return harness.layer.getLodDiagnostics();
}

const TEXT = syntheticDatacenterLines(FEATURE_COUNT);
// One record per polygon of a MultiPolygon (two each here), as Cesium's
// GeoJsonDataSource made one entity each.
const MULTIPOLYGON_COUNT = Math.ceil(FEATURE_COUNT / MULTIPOLYGON_EVERY);
const ENTITY_COUNT = FEATURE_COUNT + MULTIPOLYGON_COUNT;

test('synthetic datacenters ingest into one stem per feature and a bounded LOD set', async () => {
  const features = parseGeojsonLines(TEXT);
  assert.equal(features.length, FEATURE_COUNT);
  await withFakeFetch(TEXT, async () => {
    const harness = await enableDatacenters();
    try {
      assert.equal(harness.scene.primitives.items.length, 1);
      assert.equal(harness.scene.groundPrimitives.items.length, 1);
      assert.equal(harness.published.contexts, ENTITY_COUNT);
      const lod = walk(harness);
      assert.equal(lod.total, ENTITY_COUNT);
      assert.equal(lod.computed, true);
      assert.ok(lod.active > 0 && lod.active <= lod.budgetLimit);
      assert.ok(harness.published.entries > 0);
    } finally {
      harness.layer.destroy(harness.viewer);
    }
  });
});

test(
  '4,352-feature datacenter ingest and LOD build stay within budget',
  perfBudgetTestOptions(),
  async (t) => {
    const parse = measureRuns(() => parseGeojsonLines(TEXT), SYNC_RUNS);
    const timings = await withFakeFetch(TEXT, async () => {
      const harnesses = [];
      const enable = await measureRunsAsync(async () => {
        const harness = await enableDatacenters();
        harnesses.push(harness);
        return harness;
      }, ENABLE_RUNS);
      const firstWalk = measureRuns(
        (i) => walk(harnesses[i % harnesses.length]),
        ENABLE_RUNS,
      );
      const loaded = enable.result;
      const lodRecompute = measureRuns(() => walk(loaded), SYNC_RUNS);
      assert.equal(lodRecompute.result.total, ENTITY_COUNT);
      for (const harness of harnesses) harness.layer.destroy(harness.viewer);
      return { enable, firstWalk, lodRecompute };
    });

    const candidates = parse.result.map((feature, i) => ({
      id: String(feature.id),
      priority: i % 300,
      distanceM: 500_000 + ((i * 7919) % 9_000_000),
      inView: i % 3 !== 0,
    }));
    const lodSelect = measureRuns(
      () => selectInfraLod(candidates, { cameraHeightM: CAMERA.heightM }),
      SYNC_RUNS,
    );
    assert.ok(lodSelect.result.activeIds.length > 0);

    const all = { parse, ...timings, selectInfraLod: lodSelect };
    assertWithinBudgets(t, all, BUDGET_MS);
  },
);
