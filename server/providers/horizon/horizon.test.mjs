// i18n-ignore-file: horizon DEM provider fixtures
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createByteBudget,
  createGlo30Reader,
  createTileSource,
  tileName,
  tileUrl,
} from './glo30.js';
import { blocksForBox, samplePolarGrid, tileWidth } from './sampler.js';
import {
  createHorizonMiddleware,
  createHorizonTerrainService,
  parseTerrainQuery,
} from './index.js';
import { decodeGridPayload } from '../../../src/horizon/grid.js';
import { marchHorizon } from '../../../src/horizon/rayMarch.js';

const N30E078 = 'Copernicus_DSM_COG_10_N30_00_E078_00_DEM';

test('GLO-30 tile names follow the south-west corner and admit only the bucket', () => {
  assert.equal(tileName(30.4597, 78.1058), N30E078);
  assert.equal(tileName(-0.5, -0.5), 'Copernicus_DSM_COG_10_S01_00_W001_00_DEM');
  assert.equal(
    tileUrl(N30E078),
    `https://copernicus-dem-30m.s3.amazonaws.com/${N30E078}/${N30E078}.tif`,
  );
  assert.throws(() => tileUrl('../etc/passwd'), /unsupported/);
  assert.equal(tileWidth(30), 3600);
  assert.equal(tileWidth(55), 2400);
  assert.equal(tileWidth(-51), 2400);
});

test('byte budget refuses oversize slices and totals', () => {
  const budget = createByteBudget({ maxBytes: 100, maxRequests: 2 });
  budget.reserve(60);
  assert.throws(() => budget.reserve(60), /budget/);
  budget.reserve(40);
  assert.throws(() => budget.reserve(1), /budget/);
});

test('tile source accepts only exact 206 ranges and maps 404 to an absent tile', async () => {
  const budget = createByteBudget();
  const ok = createTileSource(N30E078, {
    budget,
    fetchImpl: async (url, init) => {
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Range, 'bytes=0-3');
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { 'content-range': 'bytes 0-3/100', etag: '"abc"' },
      });
    },
  });
  const [buffer] = await ok.fetch([{ offset: 0, length: 4 }]);
  assert.equal(buffer.byteLength, 4);
  const full = createTileSource(N30E078, {
    budget,
    fetchImpl: async () => new Response(new Uint8Array(4), { status: 200 }),
  });
  await assert.rejects(
    full.fetch([{ offset: 0, length: 4 }]),
    /invalid-range-response/,
  );
  const missing = createTileSource(N30E078, {
    budget,
    fetchImpl: async () => new Response('NoSuchKey', { status: 404 }),
  });
  await assert.rejects(
    missing.fetch([{ offset: 0, length: 4 }]),
    /absent-tile/,
  );
});

test('blocks cover a box per level without reading', () => {
  const near = blocksForBox(0, {
    south: 30.37,
    north: 30.55,
    west: 78.0,
    east: 78.21,
  });
  assert.deepEqual(
    near.map((b) => `${b.name}:${b.bx},${b.by}`),
    [`${N30E078}:0,1`, `${N30E078}:0,2`],
  );
  const far = blocksForBox(3, {
    south: 28.66,
    north: 32.26,
    west: 76.02,
    east: 80.18,
  });
  assert.equal(far.length, 25);
});

/** Synthetic blocks: flat 500 m with one 3000 m summit 14 km east. */
function syntheticReader({ absent = new Set() } = {}) {
  return async (name, level, bx, by) => {
    if (absent.has(name)) return null;
    const south = Number(name.slice(23, 25)),
      west = Number(name.slice(30, 33));
    const width = 3600 / 2 ** level,
      size = Math.min(1024, width - bx * 1024),
      rows = Math.min(1024, width - by * 1024);
    const data = new Int16Array(size * rows).fill(500);
    const res = 2 ** level / 3600;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < size; x++) {
        const lat = south + 1 - (by * 1024 + y + 0.5) * res,
          lon = west + (bx * 1024 + x + 0.5) * res;
        if (Math.abs(lat - 30.4597) < 0.004 && Math.abs(lon - 78.25) < 0.004)
          data[y * size + x] = 3000;
      }
    return {
      name,
      level,
      bx,
      by,
      width: size,
      height: rows,
      data,
      etag: '"e"',
      retrievedAt: '2026-11-07T00:00:00.000Z',
      cached: false,
    };
  };
}

test('polar sampler reads the ground, finds a synthetic summit and treats absent tiles as 0 m', async () => {
  const sampled = await samplePolarGrid({
    lat: 30.4597,
    lon: 78.1058,
    radiusM: 20000,
    readBlock: syntheticReader({
      absent: new Set(['Copernicus_DSM_COG_10_N30_00_E077_00_DEM']),
    }),
  });
  assert.equal(sampled.groundM, 500);
  assert.equal(sampled.voidSamples, 0);
  assert.deepEqual(sampled.absentTiles, [
    'Copernicus_DSM_COG_10_N30_00_E077_00_DEM',
  ]);
  const n = sampled.distances.length;
  const east = [...sampled.heights.subarray(180 * n, 181 * n)];
  assert.ok(east.includes(3000), 'max-pooled summit survives');
  const service = createHorizonTerrainService({
    reader: { readBlock: syntheticReader(), blockSize: 1024 },
  });
  const payload = await service.getTerrain({
    lat: 30.4597,
    lon: 78.1058,
    radiusKm: 20,
  });
  const { grid, meta } = decodeGridPayload(payload);
  assert.equal(meta.source.id, 'copernicus-glo30');
  assert.match(meta.source.attribution, /Copernicus WorldDEM-30/);
  const horizon = marchHorizon(grid, 501.7);
  const top = horizon.elevationDeg.indexOf(Math.max(...horizon.elevationDeg));
  assert.ok(Math.abs(horizon.azimuthsDeg[top] - 90) <= 1);
});

test('reader remembers an absent tile and writes nothing for it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'horizon-dem-'));
  try {
    let fetches = 0;
    const reader = createGlo30Reader({
      cacheDir: dir,
      fetchImpl: async () => {
        fetches++;
        return new Response('NoSuchKey', { status: 404 });
      },
    });
    const name = 'Copernicus_DSM_COG_10_N10_00_E070_00_DEM';
    const options = { budget: createByteBudget() };
    assert.equal(await reader.readBlock(name, 3, 0, 0, options), null);
    assert.equal(await reader.readBlock(name, 3, 0, 0, options), null);
    assert.equal(fetches, 1);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('terrain query parsing is strict', () => {
  const parse = (query) =>
    parseTerrainQuery(new URL(`http://x/api/horizon/terrain?${query}`));
  assert.deepEqual(parse('lat=30.4597&lon=78.1058'), {
    lat: 30.4597,
    lon: 78.1058,
    radiusKm: 200,
  });
  assert.equal(parse('lat=30&lon=78&radiusKm=50').radiusKm, 50);
  for (const bad of [
    'lat=30',
    'lat=91&lon=0',
    'lat=30&lon=78&radiusKm=5',
    'lat=30&lon=78&radiusKm=50.5',
    'lat=30&lon=78&x=1',
    'lat=30&lat=31&lon=78',
    'lat=1e1&lon=78',
  ])
    assert.throws(() => parse(bad), /invalid-request/, bad);
});

function call(middleware, { url, method = 'GET' }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      writeHead(status, values = {}) {
        this.statusCode = status;
        Object.assign(this.headers, values);
      },
      end(body) {
        this.writableEnded = true;
        resolve({
          status: this.statusCode,
          body: body ? JSON.parse(body) : null,
        });
      },
    };
    middleware(
      {
        url,
        method,
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
      () => resolve({ status: 'next' }),
    );
  });
}

test('middleware answers only its path, refuses bad input and maps errors', async () => {
  const middleware = createHorizonMiddleware({
    service: {
      async getTerrain() {
        throw new Error('range-budget-exceeded');
      },
    },
  });
  assert.equal((await call(middleware, { url: '/api/other' })).status, 'next');
  assert.equal(
    (
      await call(middleware, {
        url: '/api/horizon/terrain?lat=30&lon=78',
        method: 'POST',
      })
    ).status,
    405,
  );
  assert.equal(
    (await call(middleware, { url: '/api/horizon/terrain?lat=x' })).status,
    400,
  );
  const failed = await call(middleware, {
    url: '/api/horizon/terrain?lat=30&lon=78',
  });
  assert.equal(failed.status, 503);
  assert.match(failed.body.error, /budget/);
});
