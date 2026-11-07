// i18n-ignore-file: region validation fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateRegionManifest,
  verifyRegionPack,
  searchRegionNames,
} from './pack.js';
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
function reencode(f) {
  f.assets.geometry = encode(f.geojson);
  f.assets.names = encode(f.index);
  for (const asset of f.manifest.assets) {
    asset.byteLength = f.assets[asset.id].length;
    asset.sha256 = hash(f.assets[asset.id]);
  }
  return f;
}
test('verified local pack preserves provenance and null unknown building heights', async () => {
  const f = fixture();
  const result = await verifyRegionPack(f.manifest, f.assets);
  assert.equal(result.geojson.features[0].properties.heightM, null);
  assert.equal(result.manifest.source.extractAt, '2026-11-05T21:23:02Z');
  result.geojson.features[0].properties.name = 'Changed';
  assert.equal(f.geojson.features[0].properties.name, 'Clock Tower');
});
test('manifest rejects remote or traversal assets, unknown fields, weak provenance and excessive bounds/counts', () => {
  for (const mutate of [
    (m) => (m.assets[0].path = 'https://example.com/a'),
    (m) => (m.assets[0].path = '../a'),
    (m) => (m.assets[0].sha256 = 'bad'),
    (m) => (m.source.token = 'secret'),
    (m) => (m.extent = [70, 20, 80, 30]),
    (m) => (m.counts.features = 10001),
    (m) => (m.source.extractAt = '2026-02-30T00:00:00Z'),
    (m) => (m.license.id = 'unknown'),
    (m) => (m.coverage = 'complete'),
  ]) {
    const f = fixture();
    mutate(f.manifest);
    assert.throws(() => validateRegionManifest(f.manifest));
  }
});
test('bytes must match exact manifest length and digest before JSON parsing', async () => {
  const f = fixture();
  f.assets.geometry[0] = 0;
  await assert.rejects(verifyRegionPack(f.manifest, f.assets), /digest/);
  const g = fixture();
  g.assets.names = new Uint8Array(1000000);
  await assert.rejects(verifyRegionPack(g.manifest, g.assets), /length/);
});
test('features reject external properties, out-of-area geometry, fake heights and index/count mismatch', async () => {
  for (const mutate of [
    (f) => (f.geojson.features[0].properties.url = 'https://bad'),
    (f) => (f.geojson.features[0].geometry.coordinates[0][0] = [0, 0]),
    (f) => (f.geojson.features[0].properties.heightM = 10),
    (f) => (f.index.entries[0].id = 'way/2'),
    (f) => (f.manifest.counts.positions = 3),
  ]) {
    const f = fixture();
    mutate(f);
    reencode(f);
    await assert.rejects(verifyRegionPack(f.manifest, f.assets));
  }
});
test('offline names search matches Unicode aliases, ranks exact names, remains bounded and returns detached entries', () => {
  const f = fixture();
  assert.equal(searchRegionNames(f.index, 'घंटाघर')[0].name, 'Clock Tower');
  const found = searchRegionNames(f.index, 'clock', { limit: 1 });
  assert.equal(found.length, 1);
  found[0].coordinates[0] = 0;
  assert.equal(f.index.entries[0].coordinates[0], 78.0405);
  assert.deepEqual(searchRegionNames(f.index, ''), []);
  assert.deepEqual(searchRegionNames(f.index, 'missing'), []);
});

test('actual points, lines and multipolygons preserve only explicitly supplied heights', async () => {
  for (const [kind, type, coordinates, positions, height] of [
    ['place', 'Point', [78.04, 30.32], 1, null],
    [
      'road',
      'LineString',
      [
        [78.04, 30.32],
        [78.041, 30.321],
      ],
      2,
      null,
    ],
    [
      'water',
      'Polygon',
      [
        [
          [78.04, 30.32],
          [78.041, 30.32],
          [78.041, 30.321],
          [78.04, 30.32],
        ],
      ],
      4,
      null,
    ],
    [
      'building',
      'MultiPolygon',
      [
        [
          [
            [78.04, 30.32],
            [78.041, 30.32],
            [78.041, 30.321],
            [78.04, 30.32],
          ],
        ],
      ],
      4,
      12.5,
    ],
  ]) {
    const f = fixture(),
      p = f.geojson.features[0].properties;
    p.kind = kind;
    p.heightM = height;
    p.heightSource = height ? 'height' : null;
    f.geojson.features[0].geometry = { type, coordinates };
    f.index.entries[0].kind = kind;
    if (type === 'Point') f.index.entries[0].coordinates = [78.04, 30.32];
    Object.assign(f.manifest.counts, {
      positions,
      buildings: kind === 'building' ? 1 : 0,
      roads: kind === 'road' ? 1 : 0,
      water: kind === 'water' ? 1 : 0,
      places: kind === 'place' ? 1 : 0,
      suppliedHeights: height ? 1 : 0,
    });
    reencode(f);
    const result = await verifyRegionPack(f.manifest, f.assets);
    assert.equal(result.geojson.features[0].properties.heightM, height);
  }
});
test('invalid geometry/index schemas fail even when attacker recomputes local hashes', async () => {
  for (const mutate of [
    (f) => (f.geojson.features[0].geometry.type = 'GeometryCollection'),
    (f) => f.geojson.features[0].geometry.coordinates[0].pop(),
    (f) => (f.index.entries[0].coordinates = [0, 0]),
    (f) => (f.geojson.features[0].properties.aliases = ['same', 'same']),
    (f) => (f.geojson.features[0].properties.heightSource = 'building:levels'),
    (f) => (f.geojson.features[0].properties.osmId = 1),
    (f) => (f.manifest.id = 123),
    (f) => (f.manifest.assets[1].id = 'geometry'),
    (f) => (f.manifest.limitations = []),
    (f) => (f.index.entries[0].name = 'Different label'),
  ]) {
    const f = fixture();
    mutate(f);
    reencode(f);
    await assert.rejects(verifyRegionPack(f.manifest, f.assets));
  }
});
test('empty local index and invalid search limits never initiate fallback', () => {
  assert.deepEqual(searchRegionNames(null, 'clock'), []);
  assert.deepEqual(
    searchRegionNames(fixture().index, 'clock', { limit: 21 }),
    [],
  );
  assert.deepEqual(searchRegionNames(fixture().index, 123), []);
});
