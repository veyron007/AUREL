#!/usr/bin/env node
/**
 * Build the bundled Doon DEM used by Raindrop offline and for clicks inside
 * the Doon window. Reads the keyless Re:Earth / Mapterhorn quantized mesh
 * (the terrain the globe already renders) at level 12, converts to
 * orthometric heights with the bundled EGM96 geoid, and writes a 3″ grid.
 *
 *   node scripts/build-hydro-doon.mjs [--out public/hydro/doon]
 *
 * Network: about 240 tile requests to terrain.reearth.land, four at a time.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { meanSeaLevel } from 'egm96-universal';
import { createGridSpec } from '../src/hydro/grid.js';
import {
  BUNDLED_ENCODING,
  MESH_SOURCE,
  encodeHeights,
  meshTileUrl,
  sampleMeshGrid,
  tilesForGrid,
} from '../src/hydro/demSampler.js';

const STEP = 1 / 1200;
/** West, south, east, north: the Yamuna at the Asan to the Ganga below Raiwala. */
const DOON_EXTENT = Object.freeze([77.6, 29.98, 78.32, 30.56]);
const LEVEL = 12;

const outArg = process.argv.indexOf('--out');
const outDir = path.resolve(
  outArg > 0 ? process.argv[outArg + 1] : 'public/hydro/doon',
);
const [west, south, east, north] = DOON_EXTENT;
const spec = createGridSpec({
  west,
  north,
  cols: Math.round((east - west) / STEP),
  rows: Math.round((north - south) / STEP),
  stepLonDeg: STEP,
  stepLatDeg: STEP,
});
const tiles = tilesForGrid(spec, LEVEL);
let fetched = 0;

async function fetchTile(tile) {
  const response = await fetch(meshTileUrl(tile), {
    headers: {
      Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9',
      'User-Agent': 'AUREL-hydro-build/1.0',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
  fetched++;
  if (fetched % 20 === 0) console.log(`tiles ${fetched}/${tiles.length}`);
  return bytes;
}

const layer = await fetch(`${MESH_SOURCE.url}/layer.json`).then((r) =>
  r.json(),
);
const retrievedAt = new Date().toISOString();
const result = await sampleMeshGrid(spec, {
  fetchTile,
  geoidHeight: (lat, lon) => meanSeaLevel(lat, lon),
  level: LEVEL,
  maxTiles: 400,
});
const codes = encodeHeights(result.heights);
const bytes = Buffer.from(codes.buffer);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dem.u16'), bytes);
const manifest = {
  version: 1,
  id: 'doon-dem',
  name: 'Doon valley terrain grid',
  grid: {
    west: spec.west,
    north: spec.north,
    cols: spec.cols,
    rows: spec.rows,
    stepLonDeg: STEP,
    stepLatDeg: STEP,
  },
  extent: DOON_EXTENT,
  encoding: {
    type: 'uint16-le',
    ...BUNDLED_ENCODING,
    datum:
      'EGM96 orthometric (bundled geoid applied to an EGM2008-based ellipsoidal mesh)',
  },
  source: {
    ...MESH_SOURCE,
    version: String(layer.version),
    level: LEVEL,
    tiles: result.tiles,
    failedTiles: result.failedTiles,
    retrievedAt,
  },
  missingCells: result.missingCells,
  asset: {
    path: 'dem.u16',
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  limitations: [
    'Grid spacing is 3 arc-seconds; the source mesh is simplified, so effective resolution is coarser on smooth ground.',
    'Culverts, storm drains, embankments, bridges and buildings are not in the terrain and are ignored.',
  ],
};
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  `wrote ${spec.cols}×${spec.rows} grid, ${result.missingCells} missing cells, ${result.failedTiles} failed tiles`,
);
