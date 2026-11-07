import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createDefaultMapSources } from './defaultSources.js';
import { PRESENTED_MAP_STACK_IDS } from '../mapStackChips.js';
import { SHARE_VIEW_ENUMS } from '../share/viewCodec.js';
import { createOfflineOverviewImagery } from './imagery.js';
import { existsSync } from 'node:fs';

test('Free-only explains preserved credentials and disables all keyed map routes', () => {
  const registry = createDefaultMapSources({
    freeOnly: true,
    cesiumToken: 'saved-fixture',
    googleApiKey: 'saved-fixture',
    googleTileset: {},
  });
  assert.equal(registry.defaultId, 'esri-imagery');
  assert.equal(registry.recoveryId, null);
  for (const id of ['photoreal', 'bing-aerial', 'bing-labels']) {
    const source = registry.sources.find(
      ({ descriptor }) => descriptor.id === id,
    );
    assert.equal(source.available, false);
    assert.match(source.unavailableReason(), /Free-only.*saved keys/);
  }
  assert.equal(
    registry.sources.find(({ descriptor }) => descriptor.id === 'photoreal')
      .tileset,
    null,
  );
});

test('overview acquires only bundled Cesium assets, with no ion or remote tile URL', async (t) => {
  Cesium.buildModuleUrl.setBaseUrl('http://localhost:4173/cesium/');
  t.after(() => Cesium.buildModuleUrl._clearBaseResource());
  t.mock.method(
    Cesium.TileMapServiceImageryProvider,
    'fromUrl',
    async (url, options) => {
      assert.equal(
        url,
        'http://localhost:4173/cesium/Assets/Textures/NaturalEarthII',
      );
      assert.equal(options.maximumLevel, 2);
      return { url };
    },
  );
  t.mock.method(Cesium.IonImageryProvider, 'fromAssetId', () =>
    assert.fail('ion forbidden'),
  );
  await createOfflineOverviewImagery();
  for (const name of ['tilemapresource.xml', '0/0/0.jpg', '0/1/0.jpg'])
    assert.ok(
      existsSync(
        new URL(
          `../../node_modules/cesium/Build/Cesium/Assets/Textures/NaturalEarthII/${name}`,
          import.meta.url,
        ),
      ),
    );
});

test('offline overview is selectable, shareable and never acquires remote terrain', async () => {
  const registry = createDefaultMapSources({ cesiumToken: 'fixture-token' });
  const overview = registry.sources.find(
    (source) => source.descriptor.id === 'offline-overview',
  );
  assert.ok(overview, 'bundled overview must exist');
  assert.equal(overview.available, true);
  assert.ok(PRESENTED_MAP_STACK_IDS.includes('offline-overview'));
  assert.ok(SHARE_VIEW_ENUMS.mapStack.includes('offline-overview'));
  const terrain = await overview.terrain.create();
  assert.ok(terrain.provider instanceof Cesium.EllipsoidTerrainProvider);
  assert.equal(
    terrain.fallback,
    undefined,
    'no remote terrain retry is scheduled',
  );
  assert.match(overview.credit, /Natural Earth/);
});

test('online road imagery falls back to the bounded local overview', () => {
  const registry = createDefaultMapSources();
  const osm = registry.sources.find((source) => source.descriptor.id === 'osm');
  assert.equal(osm.constructionFallback?.id, 'offline-overview');
  assert.equal(osm.tileFailureFallback?.id, 'offline-overview');
  const overview = registry.sources.find(
    (source) => source.descriptor.id === 'offline-overview',
  );
  assert.equal(overview.constructionFallback, undefined);
  assert.equal(overview.tileFailureFallback, undefined);
});
