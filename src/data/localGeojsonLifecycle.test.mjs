import test from 'node:test';
import assert from 'node:assert/strict';
import { localGeoJsonServices } from '../app/localGeojsonServices.js';
import { createLocalGeoJsonLayer as createLayer } from './localGeojsonCore.js';
import { getContextStore } from './contextStore.js';
import { parseLocalGeojsonDataset } from './localGeojsonParse.js';
import {
  NODE_RENDER_OPTIONS,
  localSceneStub,
  renderedRecords,
} from './localGeojsonSceneStub.mjs';

/** The catalog's services, with the overlay host each test supplies. */
const createLocalGeoJsonLayer = (options) =>
  createLayer({ ...NODE_RENDER_OPTIONS, ...options }, {
    ...localGeoJsonServices,
    overlayHost: options.overlayHost,
  });

const dataset = JSON.stringify({
  type: 'Feature', id: 'dam', properties: { name: 'Test dam' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0, 0.01], [0, 0]]] },
});
const response = () => ({ ok: true, text: async () => dataset });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function harness(t) {
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  t.after(() => {
    layer.destroy(viewer);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const scene = localSceneStub();
  const listeners = new Set();
  const event = { addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  let handlers = 0;
  let parseWorker = null;
  const viewer = {
    scene: { ...scene, canvas: {}, preRender: event, requestRender() {} },
    camera: { moveEnd: event },
  };
  const create = () => createLocalGeoJsonLayer({
    id: 'local-dams', name: 'Dams', color: '#0088ff', url: '/dams.geojsonl',
    parseWorkerFactory: () => parseWorker?.(),
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    screenSpaceEventHandlerFactory() {
      handlers++;
      return { setInputAction() {}, destroy() { handlers--; } };
    },
  });
  const layer = create();
  return {
    layer,
    create,
    viewer,
    /** Builds the layer currently holds in the scene (root collections). */
    builds: () => viewer.scene.primitives.items.length,
    groundBuilds: () => viewer.scene.groundPrimitives.items.length,
    drawn: () => renderedRecords(viewer.scene),
    listeners,
    handlers: () => handlers,
    /** Route the dataset parse through a worker double (null: this thread). */
    useParseWorker(factory) { parseWorker = factory; },
  };
}

/** The context record's `dataSource` handle: shown once the build is live. */
function contextHandle() {
  return [...getContextStore().entities.values()][0]?.dataSource;
}

test('destroy removes context records and permits a fresh replacement', async t => {
  const env = harness(t);
  t.mock.method(globalThis, 'fetch', async () => response());
  await env.layer.enable(env.viewer);
  const oldEntity = [...getContextStore().entities.values()][0].entity;
  assert.equal(getContextStore().entities.size, 1);
  env.layer.disable(env.viewer);
  assert.equal(getContextStore().entities.size, 0, 'disable releases its records with the source');
  assert.equal(env.builds(), 0, 'disable removes the built primitives from the scene');
  assert.equal(env.groundBuilds(), 0);
  env.layer.destroy(env.viewer);
  assert.equal(getContextStore().entities.size, 0);
  assert.equal(env.builds(), 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.handlers(), 0);
  const replacement = env.create();
  await replacement.enable(env.viewer);
  assert.equal(getContextStore().entities.size, 1);
  assert.notEqual([...getContextStore().entities.values()][0].entity, oldEntity);
  replacement.destroy(env.viewer);
  await env.layer.enable(env.viewer);
  assert.equal(getContextStore().entities.size, 0);
});

for (const phase of ['fetch', 'text', 'parse']) {
  test(`destroy during ${phase} leaves no late objects or context records`, async t => {
    const env = harness(t);
    const entered = deferred();
    const release = deferred();
    const pause = async value => { entered.resolve(); await release.promise; return value; };
    let signal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      signal = options.signal;
      if (phase === 'fetch') return pause(response());
      if (phase === 'text') return { ok: true, text: () => pause(dataset) };
      return response();
    });
    if (phase === 'parse') {
      // A worker double that holds its reply until released.
      env.useParseWorker(() => {
        const worker = {
          terminate() {},
          postMessage({ text }) {
            pause().then(() =>
              worker.onmessage?.({ data: { ok: true, records: parseLocalGeojsonDataset(text) } }),
            );
          },
        };
        return worker;
      });
    }
    const loading = env.layer.enable(env.viewer);
    await entered.promise;
    env.layer.destroy(env.viewer);
    assert.equal(signal.aborted, true);
    release.resolve();
    await loading;
    assert.equal(env.builds(), 0);
    assert.equal(env.groundBuilds(), 0);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.handlers(), 0);
    assert.equal(getContextStore().entities.size, 0);
    assert.deepEqual(env.layer.getStats(), { count: 0, lastUpdate: null, error: null });
  });
}

test('concurrent enable and disable/re-enable share one pending dataset load', async t => {
  const env = harness(t);
  const release = deferred();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    await release.promise;
    return response();
  });
  const first = env.layer.enable(env.viewer);
  env.layer.disable(env.viewer);
  const second = env.layer.enable(env.viewer);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(env.builds(), 1);
  assert.equal(env.handlers(), 1);
  assert.equal(env.listeners.size, 2);
  assert.equal(contextHandle().show, true);
});

test('disable during loading releases the completed source; re-enable rebuilds without refetching', async t => {
  const env = harness(t);
  const release = deferred();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { await release.promise; return response(); });
  const loading = env.layer.enable(env.viewer);
  env.layer.disable(env.viewer);
  release.resolve();
  await loading;
  assert.equal(env.builds(), 0, 'a load that finishes after disable() builds nothing');
  assert.equal(env.listeners.size, 0);
  assert.equal(getContextStore().entities.size, 0);
  await env.layer.enable(env.viewer);
  assert.equal(env.builds(), 1);
  assert.equal(contextHandle().show, true);
  assert.equal(fetchMock.mock.callCount(), 1, 'the parsed dataset is cached across the toggle');
});

test('a toggle-off frees every primitive and a toggle-on rebuilds them from the cached dataset', async t => {
  const env = harness(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => response());
  await env.layer.enable(env.viewer);
  const first = env.drawn();
  assert.equal(first.length, 1);
  assert.equal(env.groundBuilds(), 1);
  assert.equal(getContextStore().entities.size, 1);
  const root = env.viewer.scene.primitives.items[0];
  env.layer.disable(env.viewer);
  assert.equal(env.builds(), 0, 'no primitive stays registered while the layer is off');
  assert.equal(env.groundBuilds(), 0);
  assert.equal(root.isDestroyed(), true, 'disable frees the GPU resources, not just hides them');
  assert.equal(getContextStore().entities.size, 0);
  assert.equal(env.layer.getLodDiagnostics().total, 0);
  assert.equal(env.layer.getStats().count, 1, 'the row keeps reporting the dataset size');
  await env.layer.enable(env.viewer);
  const second = env.drawn();
  assert.notEqual(second[0].carrier, first[0].carrier, 're-enable builds fresh carriers');
  assert.equal(contextHandle().show, true);
  assert.equal(second.length, 1);
  assert.equal(getContextStore().entities.size, 1);
  assert.equal(fetchMock.mock.callCount(), 1, 'no second fetch for a bundled dataset');
  assert.equal(env.layer.getLodDiagnostics().total, 1);
});
