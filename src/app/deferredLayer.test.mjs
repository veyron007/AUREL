// A deferred layer imports its code on first use, exactly once, and hands
// the real layer everything the application gave the stand-in meanwhile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerLifecycle } from '../data/lifecycle.js';
import {
  createDeferredLayer,
  isDeferredLayerPending,
  loadDeferredLayer,
} from './deferredLayer.js';

const DESCRIPTOR = Object.freeze({
  id: 'demo',
  values: Object.freeze({ name: 'Demo', icon: 'D', updateInterval: 0 }),
  methods: Object.freeze([
    'attachDataManager',
    'destroy',
    'disable',
    'enable',
    'getParams',
    'getRowControls',
    'getStats',
    'init',
    'setParams',
    'setRowControlsListener',
    'subscribeSelection',
    'update',
    'findThing',
  ]),
  params: Object.freeze({ mode: 'all', limit: 5 }),
  stats: Object.freeze({ count: 0, lastUpdate: null }),
});

function realLayer(log) {
  let params = { mode: 'all', limit: 5 };
  const listeners = new Set();
  return {
    id: 'demo',
    name: 'Demo',
    icon: 'D',
    updateInterval: 0,
    attachDataManager: (manager) => log.push(['attach', manager]),
    setRowControlsListener: (listener) => log.push(['rows', listener]),
    subscribeSelection(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (value) => listeners.forEach((listener) => listener(value)),
    getParams: () => ({ ...params }),
    setParams(next) {
      params = { ...params, ...next };
      log.push(['params', next]);
      return true;
    },
    getStats: () => ({ count: 3, lastUpdate: 1 }),
    getRowControls: () => ({ chips: [] }),
    init: async () => log.push(['init']),
    enable: async () => log.push(['enable']),
    disable: async () => log.push(['disable']),
    update: async () => log.push(['update']),
    destroy: () => log.push(['destroy']),
    findThing: () => 'found',
  };
}

function deferredDemo({ fail = 0 } = {}) {
  const log = [];
  let imports = 0;
  const layer = createDeferredLayer(DESCRIPTOR, async () => {
    imports += 1;
    if (imports <= fail) throw new Error('network down');
    return realLayer(log);
  });
  return { layer, log, imports: () => imports };
}

test('before loading, the stand-in answers like an idle layer', () => {
  const { layer, imports } = deferredDemo();
  assert.equal(layer.id, 'demo');
  assert.equal(layer.name, 'Demo');
  assert.equal(typeof layer.getRowControls, 'function');
  assert.equal(layer.getRowControls(), null);
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null });
  assert.deepEqual(layer.getParams(), { mode: 'all', limit: 5 });
  assert.equal(layer.findThing(), undefined);
  assert.equal(layer.missing, undefined);
  assert.ok(isDeferredLayerPending(layer));
  assert.equal(imports(), 0, 'nothing is imported until used');
});

test('enabling twice imports once and replays what the stand-in was given', async () => {
  const { layer, log, imports } = deferredDemo();
  layer.attachDataManager('manager-1');
  layer.attachDataManager('manager-2');
  const rows = () => {};
  layer.setRowControlsListener(rows);
  assert.equal(layer.setParams({ limit: 9 }), true);
  assert.deepEqual(layer.getParams(), { mode: 'all', limit: 9 });
  const seen = [];
  layer.subscribeSelection((value) => seen.push(value));
  const dropped = layer.subscribeSelection(() => seen.push('dropped'));
  dropped();
  await Promise.all([layer.init({}), layer.enable({})]);
  await layer.enable({});
  assert.equal(imports(), 1);
  assert.deepEqual(log, [
    ['attach', 'manager-2'],
    ['rows', rows],
    ['params', { limit: 9 }],
    ['init'],
    ['enable'],
    ['enable'],
  ]);
  assert.deepEqual(layer.getParams(), { mode: 'all', limit: 9 });
  assert.deepEqual(layer.getStats(), { count: 3, lastUpdate: 1 });
  assert.equal(layer.findThing(), 'found');
  layer.emit('picked');
  assert.deepEqual(seen, ['picked']);
  assert.equal(isDeferredLayerPending(layer), false);
});

test('a failed import is a layer error with a readable message, and retries', async () => {
  const { layer, imports } = deferredDemo({ fail: 1 });
  await assert.rejects(layer.init({}), (error) => {
    assert.match(error.message, /Demo could not be loaded/);
    assert.equal(error.layerId, 'demo');
    assert.match(error.cause.message, /network down/);
    return true;
  });
  assert.ok(isDeferredLayerPending(layer));
  await layer.init({});
  assert.equal(imports(), 2);
  assert.equal(isDeferredLayerPending(layer), false);
});

test('the lifecycle reports the import failure as a normal layer failure', async (t) => {
  const { layer } = deferredDemo({ fail: 1 });
  const lifecycle = new LayerLifecycle({});
  t.after(() => lifecycle.destroyAll());
  lifecycle.register(layer);
  const failures = [];
  lifecycle.subscribe((change) => {
    if (change.type === 'visibility-failed') failures.push(change);
  });
  assert.equal(await lifecycle.setEnabled('demo', true), false);
  assert.equal(lifecycle.isEnabled('demo'), false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].phase, 'init');
  assert.match(failures[0].error.message, /could not be loaded/);
  assert.equal(await lifecycle.setEnabled('demo', true), true);
  assert.equal(lifecycle.isEnabled('demo'), true);
});

test('a layer destroyed before loading never constructs', async () => {
  const { layer, imports } = deferredDemo();
  layer.destroy();
  await assert.rejects(loadDeferredLayer(layer), /destroyed/);
  assert.equal(imports(), 0);
});

test('non-deferred layers load at once', async () => {
  const plain = { id: 'plain' };
  assert.equal(await loadDeferredLayer(plain), plain);
  assert.equal(isDeferredLayerPending(plain), false);
});

test('descriptors must describe a complete layer', () => {
  assert.throws(() => createDeferredLayer({}, () => {}), /needs an id/);
  assert.throws(
    () => createDeferredLayer({ id: 'x', methods: ['init'] }, () => {}),
    /no enable/,
  );
  assert.throws(
    () => createDeferredLayer({ ...DESCRIPTOR }, null),
    /loader is required/,
  );
});
