import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import * as Cesium from 'cesium';
import { useDisplayStore } from '../ui/stores/display.js';
import { useRegionsStore } from '../ui/stores/regions.js';
import { createRegionBindings, createRegionTools } from './regionTools.js';

function fixture() {
  const pinia = createPinia(),
    calls = [];
  const geoFileImport = {
    importFiles: async (files, options) => {
      calls.push(['import', files, options]);
      return [];
    },
    list: () => [{ id: 'owned-import' }],
    remove: (id) => {
      calls.push(['remove', id]);
      return true;
    },
  };
  const options = {
    pinia,
    geoFileImport,
    viewer: { camera: { flyTo: (value) => calls.push(['fly', value]) } },
    styleManager: { _runExplicitNavigation: (_noun, navigate) => navigate() },
    onSelectPlace: (place) => calls.push(['select', place]),
  };
  return { pinia, calls, options };
}
const place = {
  name: 'Local place',
  geometry: { type: 'Point', coordinates: [78.04, 30.32] },
};

test('region bindings subscribe to file publications and honor application navigation refusal', () => {
  const f = fixture(),
    bindings = createRegionBindings(f.options);
  let changes = 0;
  const unsubscribe = bindings.subscribeImports(() => {
    changes++;
  });
  useDisplayStore(f.pinia).publishGeoImport({ rows: [] });
  assert.equal(changes, 1);
  assert.equal(bindings.focusPlace(place), true);
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['fly', 'select'],
  );
  assert.ok(f.calls[0][1].destination);
  assert.ok(
    Math.abs(
      Cesium.Cartographic.fromCartesian(f.calls[0][1].destination).height -
        1500,
    ) < 0.01,
  );
  f.options.styleManager._runExplicitNavigation = () => false;
  assert.equal(bindings.focusPlace(place), false);
  assert.equal(f.calls.length, 2);
  unsubscribe();
  useDisplayStore(f.pinia).publishGeoImport({ rows: [] });
  assert.equal(changes, 1);
  bindings.destroy();
  assert.equal(bindings.focusPlace(place), false);
});

test('region composition acquires nothing on mount; teardown detaches controls and observers', () => {
  const f = fixture(),
    tools = createRegionTools(f.options),
    store = useRegionsStore(f.pinia);
  assert.equal(f.calls.length, 0);
  assert.equal(store.view.status, 'empty');
  assert.equal(store.owns(tools.controller.owner, 'preview'), true);
  tools.destroy();
  tools.destroy();
  assert.equal(store.act('preview'), undefined);
});

test('bindings import through the existing owner and retain narrowly scoped late cleanup after disposal', async () => {
  const f = fixture(),
    bindings = createRegionBindings(f.options);
  await bindings.importFiles([new File(['{}'], 'local.geojson')]);
  assert.equal(f.calls[0][0], 'import');
  assert.deepEqual(f.calls[0][2], {
    autoFly: false,
    presentation: 'local-region',
  });
  assert.deepEqual(bindings.readImports(), [{ id: 'owned-import' }]);
  assert.equal(
    bindings.focusPlace({
      geometry: { type: 'Point', coordinates: [999, 30] },
    }),
    false,
  );
  bindings.destroy();
  assert.deepEqual(await bindings.importFiles([]), []);
  bindings.removeImport('late-own-id');
  assert.deepEqual(f.calls.at(-1), ['remove', 'late-own-id']);
});

test('missing importer or navigation remains unavailable and disposed subscriptions stay silent', () => {
  const pinia = createPinia();
  const bindings = createRegionBindings({ pinia });
  assert.equal(bindings.importFiles, undefined);
  assert.deepEqual(bindings.readImports(), []);
  assert.equal(bindings.removeImport('absent'), false);
  assert.equal(bindings.focusPlace(place), false);
  let notifications = 0;
  bindings.subscribeImports(() => {
    notifications++;
  });
  bindings.destroy();
  useDisplayStore(pinia).publishGeoImport({ rows: [] });
  assert.equal(notifications, 0);
  bindings.subscribeImports(() => {
    notifications++;
  })();
  const noNavigation = createRegionBindings({
    pinia,
    viewer: {
      camera: {
        flyTo() {
          throw new Error('Navigation must own this');
        },
      },
    },
  });
  assert.equal(noNavigation.focusPlace(place), false);
  noNavigation.destroy();
});
