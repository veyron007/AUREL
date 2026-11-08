import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  localGeojsonRecordsFromFeatures,
  localGeojsonTransferables,
  parseLocalGeojsonDataset,
} from './localGeojsonParse.js';
import { parseLocalGeojsonOffThread } from './localGeojsonParseClient.js';
import { localRecordAnchor } from './localGeojsonRecords.js';
import { parseGeojsonLines } from '../sources/infrastructureData.js';

// The Entity path these layers used before WP4.2, reimplemented here as the
// oracle: GeoJsonDataSource.load with the layer's options, then each entity's
// stem anchor (its position, else the bounding-sphere centre of its polygon
// hierarchy), its id, rounded lat/lon and unwrapped properties.

const DATASETS = Object.freeze({
  datacenters: '../data/local_data/datacenters/datacenters.geojsonl',
  dams: '../data/local_data/dams/dams.geojsonl',
});
const noop = () => {};

function silentContext2d() {
  return new Proxy(
    {},
    {
      get: (target, key) => (key in target ? target[key] : noop),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
}

function withDocumentStub(t) {
  const had = Object.hasOwn(globalThis, 'document');
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: silentContext2d }),
  };
  t.after(() => {
    if (had) globalThis.document = original;
    else delete globalThis.document;
  });
}

function unwrap(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(unwrap);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry?.getValue === 'function'
        ? unwrap(entry.getValue(Cesium.JulianDate.now()))
        : unwrap(entry),
    ]),
  );
}

function rounded(carto) {
  return {
    latitude: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
    longitude: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
  };
}

async function entityPathRecords(features) {
  const color = Cesium.Color.fromCssColorString('#00ffff');
  const source = await Cesium.GeoJsonDataSource.load(
    { type: 'FeatureCollection', features },
    {
      clampToGround: true,
      stroke: color,
      fill: color.withAlpha(0.3),
      strokeWidth: 2,
      markerSize: 8,
      markerColor: color,
    },
  );
  const now = Cesium.JulianDate.now();
  const entities = source.entities.values;
  const stems = [];
  for (const entity of entities) {
    let position = entity.position?.getValue(now);
    if (!position && entity.polygon) {
      const hierarchy = entity.polygon.hierarchy?.getValue(now);
      if (hierarchy?.positions?.length)
        position = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
    }
    if (!position) continue;
    const properties = entity.properties?.getValue(now);
    stems.push({
      id: String(entity.id),
      position,
      ...rounded(Cesium.Cartographic.fromCartesian(position)),
      properties: unwrap(properties || {}),
    });
  }
  return {
    count: entities.length,
    stems,
    pins: entities.filter((entity) => entity.billboard).length,
  };
}

function primitivePathRecords(text) {
  const parsed = parseLocalGeojsonDataset(text);
  const stems = [];
  for (const record of parsed) {
    const anchor = localRecordAnchor(record);
    if (!anchor) continue;
    stems.push({
      id: record.id,
      position: anchor.position,
      ...rounded(Cesium.Cartographic.fromCartesian(anchor.position)),
      properties: record.properties,
    });
  }
  return {
    count: parsed.length,
    stems,
    pins: parsed.filter((record) => record.kind === 'point').length,
  };
}

for (const [name, path] of Object.entries(DATASETS)) {
  test(`the bundled ${name} dataset yields the Entity path's records exactly`, async (t) => {
    withDocumentStub(t);
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    const before = await entityPathRecords(parseGeojsonLines(text));
    const after = primitivePathRecords(text);
    assert.equal(after.count, before.count, 'record count');
    assert.equal(after.pins, before.pins, 'Point pins');
    assert.equal(after.stems.length, before.stems.length, 'stem count');
    assert.ok(
      before.stems.length >= 700,
      `the oracle saw ${before.stems.length} stems`,
    );
    for (let i = 0; i < before.stems.length; i++) {
      const a = before.stems[i];
      const b = after.stems[i];
      assert.equal(b.id, a.id, `id at ${i}`);
      assert.ok(
        Cesium.Cartesian3.equals(b.position, a.position),
        `${a.id} anchor`,
      );
      assert.equal(b.latitude, a.latitude, `${a.id} latitude`);
      assert.equal(b.longitude, a.longitude, `${a.id} longitude`);
      assert.deepEqual(b.properties, a.properties, `${a.id} properties`);
    }
  });
}

test('multipart features keep Cesium suffixed ids, lines and null geometries take ids', () => {
  const records = localGeojsonRecordsFromFeatures([
    {
      type: 'Feature',
      id: 7,
      properties: { name: 'two parts' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [0, 1],
              [0, 0],
            ],
          ],
          [
            [
              [2, 0],
              [3, 0],
              [2, 1],
              [2, 0],
            ],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      id: 7,
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [2, 2],
            [3, 3],
          ],
        ],
      },
    },
    { type: 'Feature', id: 8, geometry: null },
    {
      type: 'Feature',
      id: 9,
      geometry: { type: 'Polygon', coordinates: [[]] },
    },
  ]);
  assert.deepEqual(
    records.map((record) => [record.id, record.kind]),
    [
      ['7', 'polygon'],
      ['7_2', 'polygon'],
      ['7_3', 'line'],
      ['7_4', 'line'],
      ['8', 'empty'],
    ],
  );
});

test('a missing geometry or unknown geometry type fails the dataset like the Entity path', () => {
  assert.throws(
    () => localGeojsonRecordsFromFeatures([{ type: 'Feature', id: 1 }]),
    /feature\.geometry is required/,
  );
  assert.throws(
    () =>
      localGeojsonRecordsFromFeatures([
        { type: 'Feature', id: 1, geometry: { type: 'Curve' } },
      ]),
    /Unknown geometry type: Curve/,
  );
  assert.throws(
    () => parseLocalGeojsonDataset('{"type":"Feature"\n'),
    SyntaxError,
  );
});

test('every coordinate buffer is transferable', () => {
  const records = parseLocalGeojsonDataset(
    [
      '{"type":"Feature","id":1,"geometry":{"type":"Point","coordinates":[1,2]}}',
      '{"type":"Feature","id":2,"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[0,0]],[[0.1,0.1],[0.2,0.1],[0.1,0.2],[0.1,0.1]]]}}',
    ].join('\n'),
  );
  assert.equal(localGeojsonTransferables(records).length, 3);
});

/** A worker double that runs the real worker protocol on this thread. */
function fakeWorker({ fail = false } = {}) {
  const worker = {
    terminated: false,
    terminate() {
      worker.terminated = true;
    },
    postMessage({ text }) {
      queueMicrotask(() => {
        if (fail) {
          worker.onerror?.({ message: 'blocked', preventDefault: noop });
          return;
        }
        try {
          worker.onmessage({
            data: { ok: true, records: parseLocalGeojsonDataset(text) },
          });
        } catch (error) {
          worker.onmessage({
            data: { ok: false, name: error.name, message: error.message },
          });
        }
      });
    },
  };
  return worker;
}

test('the worker client returns records, keeps SyntaxError and falls back when the worker fails', async () => {
  const text =
    '{"type":"Feature","id":1,"geometry":{"type":"Point","coordinates":[1,2]}}';
  const worker = fakeWorker();
  const records = await parseLocalGeojsonOffThread(text, {
    workerFactory: () => worker,
  });
  assert.equal(records[0].id, '1');
  assert.equal(worker.terminated, true);
  await assert.rejects(
    parseLocalGeojsonOffThread('{"type":', {
      workerFactory: () => fakeWorker(),
    }),
    SyntaxError,
  );
  const fallback = await parseLocalGeojsonOffThread(text, {
    workerFactory: () => fakeWorker({ fail: true }),
  });
  assert.equal(fallback.length, 1);
  const thrown = await parseLocalGeojsonOffThread(text, {
    workerFactory: () => {
      throw new Error('no workers');
    },
  });
  assert.equal(thrown.length, 1);
  const controller = new AbortController();
  const pending = parseLocalGeojsonOffThread(text, {
    signal: controller.signal,
    workerFactory: () => ({ postMessage: noop, terminate: noop }),
  });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
