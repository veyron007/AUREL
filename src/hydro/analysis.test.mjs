import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGridSpec } from './grid.js';
import {
  decodeHeights,
  encodeHeights,
  sampleMeshGrid,
  tilesForGrid,
} from './demSampler.js';
import {
  createTileSampler,
  decodeQuantizedMesh,
  tileRectangle,
} from './quantizedMesh.js';
import { createRaindropAnalysis, insideWithMargin } from './analysis.js';
import { createHydroClient } from './workerClient.js';
import { validateRiverSubset } from './farField.js';

const zz = (value) => ((value << 1) ^ (value >> 31)) >>> 0;

/** Encode a quantized-mesh tile: a 3×3 vertex lattice with heights from fn(u, v). */
function encodeTile(fn, minHeight = 0, maxHeight = 1000) {
  const us = [],
    vs = [],
    hs = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      us.push(i * 16383.5);
      vs.push(j * 16383.5);
      hs.push(
        ((fn(i / 2, j / 2) - minHeight) / (maxHeight - minHeight)) * 32767,
      );
    }
  const q = (list) => list.map((v) => Math.round(v));
  const triangles = [];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const a = j * 3 + i;
      triangles.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  // Number vertices by first use, as the format's high-water mark requires.
  const order = [],
    rename = new Map();
  for (const index of triangles)
    if (!rename.has(index)) {
      rename.set(index, order.length);
      order.push(index);
    }
  const [u, v, h] = [us, vs, hs].map((list) => q(order.map((i) => list[i])));
  let highest = 0;
  const codes = triangles.map((original) => {
    const index = rename.get(original);
    const code = highest - index;
    if (index === highest) highest++;
    return code;
  });
  const n = u.length;
  let size = 88 + 4 + n * 6;
  if (size % 2) size++;
  size += 4 + codes.length * 2;
  const view = new DataView(new ArrayBuffer(size));
  view.setFloat32(24, minHeight, true);
  view.setFloat32(28, maxHeight, true);
  view.setUint32(88, n, true);
  let at = 92;
  for (const list of [u, v, h]) {
    let previous = 0;
    for (const value of list) {
      view.setUint16(at, zz(value - previous), true);
      previous = value;
      at += 2;
    }
  }
  if (at % 2) at++;
  view.setUint32(at, codes.length / 3, true);
  at += 4;
  for (const code of codes) {
    view.setUint16(at, code, true);
    at += 2;
  }
  return new Uint8Array(view.buffer);
}

test('quantized-mesh decoding interpolates inside triangles', () => {
  const mesh = decodeQuantizedMesh(
    encodeTile((x, y) => 100 + 200 * x + 50 * y),
  );
  assert.equal(mesh.u.length, 9);
  assert.equal(mesh.indices.length, 24);
  const rect = tileRectangle(12, 5872, 2738);
  const sample = createTileSampler(mesh, rect);
  const lon = rect.west + 0.25 * (rect.east - rect.west),
    lat = rect.south + 0.75 * (rect.north - rect.south);
  assert.ok(Math.abs(sample(lon, lat) - (100 + 50 + 37.5)) < 0.1);
  assert.ok(Number.isNaN(sample(rect.west - 1, lat)));
  assert.throws(() => decodeQuantizedMesh(new Uint8Array(40)));
});

test('the mesh sampler converts to orthometric heights, counts missing tiles and refuses big windows', async () => {
  const spec = createGridSpec({
    west: 78.0,
    north: 30.4,
    cols: 40,
    rows: 40,
    stepLonDeg: 1 / 1200,
    stepLatDeg: 1 / 1200,
  });
  const tiles = tilesForGrid(spec, 12);
  assert.ok(tiles.length >= 1 && tiles.length <= 4);
  const failing = tiles[0];
  const sampled = await sampleMeshGrid(spec, {
    level: 12,
    fetchTile: async (tile) => {
      if (tile.x === failing.x && tile.y === failing.y && tiles.length > 1)
        throw new Error('HTTP 503');
      return encodeTile(() => 700);
    },
    geoidHeight: () => -42,
  });
  const finite = [...sampled.heights].filter(Number.isFinite);
  assert.ok(finite.every((h) => Math.abs(h - 742) < 0.05));
  assert.equal(sampled.failedTiles, tiles.length > 1 ? 1 : 0);
  assert.equal(sampled.missingCells, sampled.heights.length - finite.length);
  await assert.rejects(
    sampleMeshGrid(spec, {
      level: 14,
      maxTiles: 2,
      fetchTile: async () => encodeTile(() => 1),
      geoidHeight: () => 0,
    }),
    /terrain tiles/,
  );
});

test('bundled height encoding keeps quarter-metre steps and missing cells', () => {
  const codes = encodeHeights(Float32Array.from([640.13, NaN, -12, 8848.86]));
  const back = decodeHeights(codes);
  assert.equal(back[0], 640.25);
  assert.ok(Number.isNaN(back[1]));
  assert.equal(back[2], -12);
  assert.equal(back[3], 8848.75);
});

const manifest = JSON.parse(
  fs.readFileSync(
    new URL('../../public/hydro/doon/manifest.json', import.meta.url),
    'utf8',
  ),
);
const demBytes = fs.readFileSync(
  new URL('../../public/hydro/doon/dem.u16', import.meta.url),
);
const codes = new Uint16Array(
  demBytes.buffer,
  demBytes.byteOffset,
  demBytes.byteLength / 2,
);
const readJson = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../../public/hydro/${name}`, import.meta.url),
      'utf8',
    ),
  );
const analysis = createRaindropAnalysis({
  client: createHydroClient({ createWorker: () => null }),
  loadBundled: async () => ({ manifest, codes }),
  loadRivers: async () => validateRiverSubset(readJson('rivers.json')),
  loadBasins: async () => readJson('basins-doon.json'),
});
const offline = createRaindropAnalysis({
  client: createHydroClient({ createWorker: () => null }),
  loadBundled: async () => ({ manifest, codes }),
});

test('a Rajpur drop crosses Dehradun, turns east into the Song and reaches the Ganga', async () => {
  const result = await analysis.analyze({ lon: 78.08, lat: 30.36 });
  assert.equal(result.dem.kind, 'bundled');
  assert.equal(result.worker, 'main-thread');
  const path = result.drop.path;
  // Through the city, south of the Rajpur Road start.
  assert.ok(
    path.some(([lon, lat]) => lat < 30.32 && lon > 78.03 && lon < 78.08),
  );
  // East past Doiwala towards the Song.
  assert.ok(
    path.some(([lon, lat]) => lon > 78.1 && lat < 30.15 && lat > 30.05),
  );
  // Into the Ganga reach near Raiwala.
  assert.ok(path.some(([lon, lat]) => lon > 78.2 && lat < 30.06));
  assert.equal(result.drop.end, 'edge');
  assert.equal(result.window.resolution.stepArcSec, 3);
  assert.ok(result.disclosure.raisedCells > 0, 'sink filling disclosed');
  assert.equal(result.disclosure.method, 'priority-flood-epsilon');
  // Names: Rispana, then the Song, then the Ganga, in that order.
  const song = result.rivers.indexOf('Song'),
    ganga = result.rivers.indexOf('Ganga');
  assert.ok(result.rivers.indexOf('Rispana') >= 0);
  assert.ok(song > result.rivers.indexOf('Rispana') && ganga > song);
  // HydroRIVERS hands off near the window edge and reaches the ocean.
  assert.equal(result.farField.status, 'ok');
  assert.equal(result.farField.end, 'ocean');
  assert.ok(result.farField.handoffM < 1000);
  assert.ok(result.farField.lengthKm > 1500);
  assert.ok(
    Number.isSafeInteger(result.basin?.id),
    'HydroBASINS level-12 unit',
  );
});

test('a Selaqui drop goes west to the Asan and the Yamuna', async () => {
  const result = await analysis.analyze({ lon: 77.86, lat: 30.37 });
  const path = result.drop.path;
  assert.ok(
    path.every(([lon]) => lon <= 77.87),
    'never crosses east into the Song basin',
  );
  assert.ok(path.some(([lon, lat]) => lon < 77.75 && lat > 30.4));
  assert.ok(path.at(-1)[0] < 77.61, 'leaves through the western edge');
  assert.ok(result.drop.catchment.areaKm2 > 0);
  const asan = result.rivers.indexOf('Asan'),
    yamuna = result.rivers.indexOf('Yamuna');
  assert.ok(asan >= 0 && yamuna > asan, result.rivers.join(' > '));
  assert.ok(!result.rivers.includes('Song'));
});

test('without the HydroSHEDS subset the trace stops at the window and says so', async () => {
  const result = await offline.analyze({ lon: 78.08, lat: 30.36 });
  assert.equal(result.farField.status, 'unavailable');
  assert.deepEqual(result.rivers, []);
  assert.equal(result.basin, null);
});

test('outside the bundled grid without terrain access the analysis says so', async () => {
  assert.equal(
    insideWithMargin(createGridSpec(manifest.grid), { lon: 78.5, lat: 30.3 }),
    false,
  );
  await assert.rejects(
    offline.analyze({ lon: 78.5, lat: 30.3 }),
    (error) => error.code === 'offline-outside-pack',
  );
});
