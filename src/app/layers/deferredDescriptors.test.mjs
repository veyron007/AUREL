// Each deferred layer's descriptor answers exactly as the real layer does
// while it is off: same static fields, same methods, same default parameters
// and idle statistics. Built from the same catalog the application builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceServices } from '../surfaceServices.js';
import { createApplicationCatalog } from '../constructCatalog.js';
import { createStandaloneLayerSources } from '../../standalone/layerSources.js';
import { DEFERRED_LAYER_DESCRIPTORS } from './deferredDescriptors.js';
import { isDeferredLayerPending, loadDeferredLayer } from '../deferredLayer.js';

function ownSurface(layer) {
  const values = {};
  const methods = [];
  for (let owner = layer; owner && owner !== Object.prototype;) {
    for (const key of Object.getOwnPropertyNames(owner)) {
      if (key === 'constructor' || key in values || methods.includes(key))
        continue;
      const value = Object.getOwnPropertyDescriptor(owner, key).value;
      if (typeof value === 'function') {
        if (!key.endsWith('ForTest')) methods.push(key);
      } else values[key] = value;
    }
    owner = Object.getPrototypeOf(owner);
  }
  return { values, methods: methods.sort() };
}

test('every deferred descriptor matches the layer it stands for', async (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = createApplicationCatalog({
    sources: createStandaloneLayerSources(),
    signal: lifetime.signal,
    surface: createSurfaceServices({
      terrainSource: { getHeights: async () => [] },
      signal: lifetime.signal,
      eventTarget: null,
    }),
  });
  const ids = Object.keys(DEFERRED_LAYER_DESCRIPTORS);
  assert.ok(ids.length >= 10);
  for (const id of ids) {
    const descriptor = DEFERRED_LAYER_DESCRIPTORS[id];
    const standIn = catalog.get(id);
    assert.ok(isDeferredLayerPending(standIn), `${id} starts unloaded`);
    assert.deepEqual(standIn.getParams?.() ?? null, descriptor.params, id);
    const layer = await loadDeferredLayer(standIn);
    assert.equal(isDeferredLayerPending(standIn), false, `${id} loaded`);
    const { values, methods } = ownSurface(layer);
    const { id: realId, ...statics } = values;
    assert.equal(realId, id);
    assert.deepEqual(descriptor.values, statics, `${id} static fields`);
    assert.deepEqual([...descriptor.methods].sort(), methods, `${id} methods`);
    assert.deepEqual(
      descriptor.params,
      layer.getParams?.() ?? null,
      `${id} default parameters`,
    );
    assert.deepEqual(
      descriptor.stats,
      layer.getStats?.() ?? null,
      `${id} idle statistics`,
    );
    assert.equal(standIn.name, layer.name, `${id} forwards once loaded`);
  }
});

test('the catalog module imports no deferred layer statically', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('../constructCatalog.js', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(
    (match) => match[1],
  );
  for (const file of [
    './layers/earthquakes.js',
    './layers/perimeters.js',
    './layers/ghostMaps.js',
    './layers/droneAirspace.js',
    './layers/wildlifeSightings.js',
    './layers/alprCameras.js',
    './layers/traffic.js',
    './layers/bikeshare.js',
    './layers/submarineCables.js',
    './layers/firms.js',
    './layers/cctv.js',
    './layers/radio.js',
    './layers/rocketLaunches.js',
    './layers/transit.js',
    '../data/bhoteKoshiEvent.js',
  ]) {
    assert.ok(!imports.includes(file), `${file} is imported statically`);
    assert.match(
      source,
      new RegExp(`import\\('${file.replace('.', '\\.')}'\\)`),
    );
  }
});
