/**
 * Bounded DEM sampler for hydro work.
 *
 * Source: the keyless Re:Earth quantized mesh the globe already renders
 * (`mapterhorn-egm08 / cesium-mesh / ellipsoid`, CC BY 4.0). Heights are
 * ellipsoidal; the bundled EGM96 geoid converts them to orthometric metres.
 * The mesh is built on EGM2008, so a smooth residual of about a metre remains
 * (0.9 m at Rajpur): it shifts the whole window, not its slopes.
 *
 * The point-height proxy (`/api/terrain/heights`, 64 points per call at
 * roughly 0.1 s per point upstream) cannot fill a 65,536-cell window in useful
 * time, so the sampler decodes the same mesh tiles directly, within a tile
 * ceiling.
 */
import { cellCenter, createGridSpec } from './grid.js';
import {
  createTileSampler,
  decodeQuantizedMesh,
  tileForPoint,
  tileRectangle,
} from './quantizedMesh.js';

export const MESH_SOURCE = Object.freeze({
  id: 'reearth-mapterhorn-mesh',
  name: 'Re:Earth / Mapterhorn terrain mesh',
  tileset: 'mapterhorn-egm08 / cesium-mesh / ellipsoid',
  url: 'https://terrain.reearth.land/cesium-mesh/ellipsoid',
  license: 'CC BY 4.0',
  attribution: 'Re:Earth Terrain, Mapterhorn, EGM2008 (NGA)',
  link: 'https://terrain.reearth.land/',
});

/** Live window: 256 × 256 cells of 3″ (about 80 m × 93 m at 30° N). */
export const LIVE_WINDOW = Object.freeze({
  cols: 256,
  rows: 256,
  stepLonDeg: 1 / 1200,
  stepLatDeg: 1 / 1200,
  level: 12,
  maxTiles: 49,
});

/** Tiles at `level` that cover a grid. */
export function tilesForGrid(spec, level) {
  const sw = tileForPoint(level, spec.west + 1e-9, spec.south + 1e-9);
  const ne = tileForPoint(level, spec.east - 1e-9, spec.north - 1e-9);
  const tiles = [];
  for (let y = sw.y; y <= ne.y; y++)
    for (let x = sw.x; x <= ne.x; x++) tiles.push({ level, x, y });
  return tiles;
}

/** Tile URL on the keyless mesh. */
export const meshTileUrl = ({ level, x, y }, base = MESH_SOURCE.url) =>
  `${base}/${level}/${x}/${y}.terrain`;

async function mapLimited(items, limit, task, signal) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Sample orthometric heights for every cell of `spec` from mesh tiles.
 * @param {object} spec Grid from createGridSpec.
 * @param {{fetchTile:(tile:object, signal?:AbortSignal)=>Promise<ArrayBuffer|Uint8Array>, geoidHeight:(lat:number, lon:number)=>number, level?:number, maxTiles?:number, concurrency?:number, signal?:AbortSignal}} options
 */
export async function sampleMeshGrid(
  spec,
  {
    fetchTile,
    geoidHeight,
    level = LIVE_WINDOW.level,
    maxTiles = LIVE_WINDOW.maxTiles,
    concurrency = 4,
    signal,
  },
) {
  if (typeof fetchTile !== 'function' || typeof geoidHeight !== 'function')
    throw new TypeError('Mesh sampling needs a tile reader and a geoid');
  const tiles = tilesForGrid(spec, level);
  if (tiles.length > maxTiles)
    throw new RangeError(
      `Window needs ${tiles.length} terrain tiles; the limit is ${maxTiles}`,
    );
  const heights = new Float32Array(spec.cols * spec.rows).fill(NaN);
  const samplers = await mapLimited(
    tiles,
    concurrency,
    async (tile) => {
      try {
        const mesh = decodeQuantizedMesh(await fetchTile(tile, signal));
        return {
          rectangle: tileRectangle(tile.level, tile.x, tile.y),
          sample: null,
          mesh,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return null;
      }
    },
    signal,
  );
  const lookup = new Map();
  tiles.forEach((tile, index) => {
    const entry = samplers[index];
    if (!entry) return;
    entry.sample = createTileSampler(entry.mesh, entry.rectangle);
    lookup.set(`${tile.x}/${tile.y}`, entry.sample);
  });
  let missing = 0;
  for (let cell = 0; cell < heights.length; cell++) {
    const [lon, lat] = cellCenter(spec, cell);
    const { x, y } = tileForPoint(level, lon, lat);
    const sample = lookup.get(`${x}/${y}`);
    const ellipsoidal = sample ? sample(lon, lat) : NaN;
    if (Number.isFinite(ellipsoidal))
      heights[cell] = ellipsoidal - geoidHeight(lat, lon);
    else missing++;
  }
  return {
    heights,
    missingCells: missing,
    tiles: tiles.length,
    failedTiles: samplers.filter((entry) => !entry).length,
    level,
  };
}

/** Bundled grid encoding: unsigned 16-bit, 0.25 m steps from −500 m, 65535 = missing. */
export const BUNDLED_ENCODING = Object.freeze({
  offsetM: -500,
  stepM: 0.25,
  missing: 65535,
});

export function encodeHeights(heights) {
  const out = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    const value = heights[i];
    out[i] = Number.isFinite(value)
      ? Math.max(
          0,
          Math.min(
            65534,
            Math.round(
              (value - BUNDLED_ENCODING.offsetM) / BUNDLED_ENCODING.stepM,
            ),
          ),
        )
      : BUNDLED_ENCODING.missing;
  }
  return out;
}

export function decodeHeights(codes) {
  const out = new Float32Array(codes.length);
  for (let i = 0; i < codes.length; i++)
    out[i] =
      codes[i] === BUNDLED_ENCODING.missing
        ? NaN
        : BUNDLED_ENCODING.offsetM + codes[i] * BUNDLED_ENCODING.stepM;
  return out;
}

/** Validate a bundled DEM manifest and return its grid. */
export function bundledDemSpec(manifest) {
  const grid = manifest?.grid;
  if (manifest?.version !== 1 || !grid)
    throw new TypeError('Invalid DEM manifest');
  return createGridSpec(grid);
}
