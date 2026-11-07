// i18n-ignore-file: region controller test fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RegionsController } from './regionsController.js';
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const feature = {
    type: 'Feature',
    id: 'way/1',
    properties: {
      kind: 'building',
      name: 'Clock Tower',
      aliases: ['घंटाघर'],
      osmId: '1',
      osmType: 'way',
      category: 'yes',
      heightM: null,
      heightSource: null,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [78.04, 30.32],
          [78.041, 30.32],
          [78.041, 30.321],
          [78.04, 30.32],
        ],
      ],
    },
  };
  const geojson = { type: 'FeatureCollection', features: [feature] };
  const index = {
    version: 1,
    entries: [
      {
        id: 'way/1',
        name: 'Clock Tower',
        aliases: ['घंटाघर'],
        kind: 'building',
        coordinates: [78.0405, 30.3205],
      },
    ],
  };
  const assets = { geometry: encode(geojson), names: encode(index) };
  const manifest = {
    version: 1,
    id: 'dehradun-core',
    name: 'Dehradun core',
    extent: [78.02, 30.3, 78.07, 30.35],
    source: {
      id: 'openstreetmap-geofabrik',
      label: 'OpenStreetMap via Geofabrik',
      url: 'https://download.geofabrik.de/asia/india/central-zone.html',
      extractAt: '2026-11-05T21:23:02Z',
      retrievedAt: '2026-11-07T12:00:00Z',
      extractSha256: 'a'.repeat(64),
    },
    license: {
      id: 'ODbL-1.0',
      url: 'https://opendatacommons.org/licenses/odbl/1-0/',
      attribution: '© OpenStreetMap contributors',
    },
    assets: [
      {
        id: 'geometry',
        path: 'geometry.geojson',
        format: 'geojson',
        byteLength: assets.geometry.length,
        sha256: hash(assets.geometry),
      },
      {
        id: 'names',
        path: 'names.json',
        format: 'name-index',
        byteLength: assets.names.length,
        sha256: hash(assets.names),
      },
    ],
    counts: {
      features: 1,
      positions: 4,
      names: 1,
      roads: 0,
      buildings: 1,
      water: 0,
      places: 0,
      suppliedHeights: 0,
    },
    coverage: 'partial',
    limitations: ['Community mapping can be incomplete.'],
  };
  return { manifest, assets, geojson, index };
}

function setup(overrides = {}) {
  const pack = fixture(),
    calls = [],
    rows = [{ id: 'unrelated' }],
    views = [];
  const controller = new RegionsController({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      const value = url.endsWith('manifest.json')
        ? encode(pack.manifest)
        : url.endsWith('geometry.geojson')
          ? pack.assets.geometry
          : pack.assets.names;
      return new Response(value);
    },
    importFiles: async (files) => {
      calls.push(['import', files]);
      rows.push({ id: 'region-1' });
      return [{ ok: true, id: 'region-1' }];
    },
    readImports: () => rows,
    removeImport: (id) => {
      calls.push(['remove', id]);
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      );
      return true;
    },
    focusPlace: (place) => {
      calls.push(['focus', place]);
      return true;
    },
    publish: (view) => views.push(view),
    ...overrides,
  });
  controller.init();
  return {
    controller,
    pack,
    calls,
    rows,
    views,
    get view() {
      return views.at(-1);
    },
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};

test('default fetch retains the browser global receiver', async () => {
  const original = globalThis.fetch,
    pack = fixture();
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response(encode(pack.manifest)));
  };
  const controller = new RegionsController();
  try {
    controller.init();
    assert.equal(await controller.preview(), true);
  } finally {
    controller.destroy();
    globalThis.fetch = original;
  }
});

test('region preview fetches only metadata; enabling verifies bytes, imports one file, searches locally and removes only owned geometry', async () => {
  const f = setup();
  assert.equal(f.calls.length, 0);
  assert.equal(f.view.status, 'empty');
  assert.equal(await f.controller.enable(), false);
  assert.equal(await f.controller.preview(), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.view.loaded, false);
  assert.equal(f.view.canEnable, true);
  assert.equal(await f.controller.enable(), true);
  assert.equal(f.view.status, 'ready');
  assert.equal(f.view.indexReady, true);
  assert.equal(f.calls.filter((c) => c[0] === 'import').length, 1);
  const file = f.calls.find((c) => c[0] === 'import')[1][0];
  assert.equal(file.name, 'dehradun-core.geojson');
  assert.equal(
    JSON.parse(await file.text()).features[0].properties.heightM,
    null,
  );
  f.controller.search('घंटाघर');
  assert.equal(f.view.results.length, 1);
  assert.equal(f.view.results[0].lat, 30.3205);
  assert.equal(f.controller.focus('way/1'), true);
  assert.equal(f.calls.find((c) => c[0] === 'focus')[1].geometry.type, 'Point');
  assert.equal(await f.controller.enable(), false);
  f.controller.remove();
  assert.deepEqual(f.rows, [{ id: 'unrelated' }]);
  assert.equal(f.view.indexReady, false);
  assert.equal(f.controller.focus('way/1'), false);
  f.controller.destroy();
});
test('tampered bytes, foreign pack IDs, oversized responses and HTTP failures never import geometry', async () => {
  for (const type of ['digest', 'identity', 'large', 'http']) {
    const f = setup();
    if (type === 'identity') f.pack.manifest.id = 'other-region';
    if (type === 'digest') f.pack.assets.geometry[0] = 32;
    if (type === 'large')
      f.controller.fetchImpl = async () => new Response('x'.repeat(32769));
    if (type === 'http')
      f.controller.fetchImpl = async () => new Response('', { status: 404 });
    await f.controller.preview();
    await f.controller.enable();
    assert.equal(f.view.status, 'error', type);
    assert.equal(
      f.calls.some((c) => c[0] === 'import'),
      false,
      type,
    );
    f.controller.destroy();
  }
});
test('cancelled fetch cannot publish late metadata and always uses fixed credentialless redirect-blocked paths', async () => {
  const pending = deferred(),
    f = setup({
      fetchImpl: (_url, opts) => {
        assert.equal(opts.redirect, 'error');
        assert.equal(opts.credentials, 'omit');
        return pending.promise;
      },
    });
  const work = f.controller.preview();
  assert.equal(f.view.canCancel, true);
  f.controller.cancel();
  pending.resolve(new Response(encode(f.pack.manifest)));
  assert.equal(await work, false);
  assert.equal(f.view.status, 'empty');
  f.controller.destroy();
});
test('cancel or destroy during mounting cleans up its late import without touching other imports', async () => {
  for (const action of ['cancel', 'destroy']) {
    const pending = deferred(),
      f = setup({ importFiles: () => pending.promise });
    await f.controller.preview();
    const work = f.controller.enable();
    while (!f.view.mounting) await new Promise((r) => setImmediate(r));
    assert.equal(f.view.canCancel, false);
    f.controller[action]();
    f.rows.push({ id: 'late-region' });
    pending.resolve([{ ok: true, id: 'late-region' }]);
    assert.equal(await work, false);
    assert.deepEqual(f.rows, [{ id: 'unrelated' }]);
    assert.equal(
      f.views.some((v) => v.loaded),
      false,
    );
    f.controller.destroy();
  }
});
test('manual importer removal clears verified search state and detaches subscriptions on disposal', async () => {
  let listener,
    removed = 0;
  const f = setup({
    subscribeImports: (fn) => {
      listener = fn;
      return () => {
        removed++;
      };
    },
  });
  await f.controller.preview();
  await f.controller.enable();
  f.rows.splice(1, 1);
  listener();
  assert.equal(f.view.loaded, false);
  assert.equal(f.view.results.length, 0);
  assert.equal(f.view.canEnable, true);
  f.controller.destroy();
  f.controller.destroy();
  assert.equal(removed, 1);
  assert.equal(await f.controller.preview(), false);
});
test('failed import keeps preview retryable; unknown IDs and long search do not navigate', async () => {
  const f = setup({
    importFiles: async () => [{ ok: false, error: 'private error' }],
  });
  await f.controller.preview();
  assert.equal(await f.controller.enable(), false);
  assert.equal(f.view.canEnable, true);
  assert.equal(f.view.error.includes('private'), false);
  f.controller.search('x'.repeat(200));
  assert.equal(f.view.query.length, 160);
  assert.equal(f.controller.focus('unknown'), false);
  f.controller.destroy();
});

test('cancelled enable bytes cannot clear a newer mounting operation or enable a second import', async () => {
  const blocked = deferred(),
    mounting = deferred(),
    f = setup();
  await f.controller.preview();
  const originalFetch = f.controller.fetchImpl;
  let hold = true;
  f.controller.fetchImpl = (url, options) =>
    hold && url.endsWith('geometry.geojson')
      ? blocked.promise
      : originalFetch(url, options);
  const old = f.controller.enable();
  f.controller.cancel();
  hold = false;
  f.controller.importFiles = () => mounting.promise;
  const fresh = f.controller.enable();
  while (!f.view.mounting) await new Promise((r) => setImmediate(r));
  blocked.resolve(new Response(f.pack.assets.geometry));
  assert.equal(await old, false);
  assert.equal(f.view.mounting, true);
  assert.equal(f.view.canCancel, false);
  assert.equal(await f.controller.enable(), false);
  f.rows.push({ id: 'new-region' });
  mounting.resolve([{ ok: true, id: 'new-region' }]);
  assert.equal(await fresh, true);
  f.controller.destroy();
});

test('region errors do not escape, redirected assets are rejected and invalid searches stay local', async () => {
  const f = setup({ fetchImpl: async () => ({ ok: true, redirected: true }) });
  assert.equal(await f.controller.preview(), false);
  assert.equal(f.controller.cancel(), false);
  assert.equal(f.controller.remove(), false);
  f.controller.search(null);
  assert.equal(f.view.query, '');
  f.controller.destroy();
  assert.equal(f.controller.cancel(), false);
  assert.equal(f.controller.focus('x'), false);
});
