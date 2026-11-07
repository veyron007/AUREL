/**
 * Polar DEM sampler: 720 rays × the shared radial schedule, each sample the
 * highest DEM cell in its footprint (max-pooled) once the footprint is wider
 * than a cell, bilinear otherwise. Near field reads the full 30 m grid, the
 * middle the ¼ overview (~120 m), the far field the ⅛ overview (~240 m).
 */
import {
  AZIMUTH_COUNT,
  AZIMUTH_STEP_DEG,
} from '../../../src/horizon/constants.js';
import {
  destination,
  radialDistances,
  radialStepAt,
} from '../../../src/horizon/geodesy.js';
import { tileName, VOID } from './glo30.js';

const M_PER_DEG = 111320;
const MAX_POOL_SIDE = 9;
export const SAMPLING_LEVELS = Object.freeze([
  { level: 0, fromM: 0, toM: 10000, resolutionArcSec: 1 },
  { level: 2, fromM: 10000, toM: 60000, resolutionArcSec: 4 },
  { level: 3, fromM: 60000, toM: Infinity, resolutionArcSec: 8 },
]);
export const SAMPLING_NOTE =
  'max-pooled footprint per sample; full 30 m grid within 10 km, ¼ overview to 60 km, ⅛ overview beyond; overviews are averaged';

/** Full-grid width of a GLO-30 tile by latitude band (readme table). */
export function tileWidth(south) {
  const a = Math.abs(south < 0 ? south + 1 : south);
  return a < 50 ? 3600 : a < 60 ? 2400 : a < 70 ? 1800 : a < 80 ? 1200 : a < 85 ? 720 : 360;
}

function levelFor(distanceM) {
  return SAMPLING_LEVELS.find((entry) => distanceM < entry.toM).level;
}

/** Blocks needed to cover a lat/lon box at one level. */
export function blocksForBox(level, box, blockSize = 1024) {
  const out = [];
  for (let south = Math.floor(box.south); south <= Math.floor(box.north); south++)
    for (let west = Math.floor(box.west); west <= Math.floor(box.east); west++) {
      const width = tileWidth(south) / 2 ** level,
        height = 3600 / 2 ** level;
      const x0 = Math.max(0, Math.floor((box.west - west) * width)),
        x1 = Math.min(width - 1, Math.floor((box.east - west) * width)),
        y0 = Math.max(0, Math.floor((south + 1 - box.north) * height)),
        y1 = Math.min(height - 1, Math.floor((south + 1 - box.south) * height));
      if (x0 > x1 || y0 > y1) continue;
      const name = tileName(south + 0.5, west + 0.5);
      for (let by = Math.floor(y0 / blockSize); by <= Math.floor(y1 / blockSize); by++)
        for (let bx = Math.floor(x0 / blockSize); bx <= Math.floor(x1 / blockSize); bx++)
          out.push({ name, level, bx, by });
    }
  return out;
}

function boxAround(lat, lon, radiusM) {
  const dLat = radiusM / M_PER_DEG,
    dLon = radiusM / (M_PER_DEG * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return {
    south: Math.max(-89.999, lat - dLat),
    north: Math.min(89.999, lat + dLat),
    west: Math.max(-179.999, lon - dLon),
    east: Math.min(179.999, lon + dLon),
  };
}

/** Lookup over loaded blocks; absent tiles read as 0 m per the dataset readme. */
function createLookup(blocks, absentTiles, blockSize) {
  const index = new Map();
  for (const block of blocks)
    if (block) index.set(`${block.name}|${block.level}|${block.bx}|${block.by}`, block);
  function locate(level, lat, lon) {
    const name = tileName(lat, lon);
    if (absentTiles.has(name)) return { absent: true };
    const south = Math.floor(lat),
      west = Math.floor(lon);
    const width = tileWidth(south) / 2 ** level,
      height = 3600 / 2 ** level;
    const gx = Math.floor((lon - west) * width),
      gy = Math.floor((south + 1 - lat) * height);
    const block = index.get(
      `${name}|${level}|${Math.floor(gx / blockSize)}|${Math.floor(gy / blockSize)}`,
    );
    if (!block) return null;
    return { block, x: gx - block.bx * blockSize, y: gy - block.by * blockSize };
  }
  function cell(level, lat, lon) {
    const at = locate(level, lat, lon);
    if (!at) return VOID;
    if (at.absent) return 0;
    const { block, x, y } = at;
    if (x < 0 || y < 0 || x >= block.width || y >= block.height) return VOID;
    return block.data[y * block.width + x];
  }
  function resolution(level, lat) {
    const south = Math.floor(lat);
    return {
      lat: 1 / (3600 / 2 ** level),
      lon: 1 / (tileWidth(south) / 2 ** level),
    };
  }
  /** Bilinear between the four cell centres around (lat, lon). */
  function bilinear(level, lat, lon) {
    const res = resolution(level, lat);
    const fx = (lon - res.lon / 2) / res.lon,
      fy = (lat - res.lat / 2) / res.lat;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      tx = fx - x0,
      ty = fy - y0;
    const at = (ix, iy) =>
      cell(level, (iy + 0.5) * res.lat, (ix + 0.5) * res.lon);
    const v00 = at(x0, y0),
      v10 = at(x0 + 1, y0),
      v01 = at(x0, y0 + 1),
      v11 = at(x0 + 1, y0 + 1);
    if ([v00, v10, v01, v11].includes(VOID)) return cell(level, lat, lon);
    return Math.round(
      v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty,
    );
  }
  /** Highest valid cell within ±halfM of (lat, lon); VOID if none. */
  function pooled(level, lat, lon, halfM) {
    const res = resolution(level, lat);
    const cellLatM = res.lat * M_PER_DEG,
      cellLonM = res.lon * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    if (halfM < Math.min(cellLatM, cellLonM)) return bilinear(level, lat, lon);
    const ny = Math.min(MAX_POOL_SIDE, 2 * Math.ceil(halfM / cellLatM) + 1),
      nx = Math.min(MAX_POOL_SIDE, 2 * Math.ceil(halfM / cellLonM) + 1);
    const stepLat = (2 * halfM) / M_PER_DEG / Math.max(1, ny - 1),
      stepLon =
        (2 * halfM) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)) / Math.max(1, nx - 1);
    const lat0 = lat - (stepLat * (ny - 1)) / 2,
      lon0 = lon - (stepLon * (nx - 1)) / 2;
    let best = VOID;
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const value = cell(level, lat0 + iy * stepLat, lon0 + ix * stepLon);
        if (value !== VOID && (best === VOID || value > best)) best = value;
      }
    return best;
  }
  return { bilinear, pooled };
}

/**
 * Sample the polar grid around (lat, lon).
 * @param {{ lat:number, lon:number, radiusM:number,
 *   readBlock:(name:string, level:number, bx:number, by:number)=>Promise<object|null>,
 *   blockSize?:number }} input
 */
export async function samplePolarGrid({ lat, lon, radiusM, readBlock, blockSize = 1024 }) {
  const distances = radialDistances(radiusM);
  const requests = [];
  for (const entry of SAMPLING_LEVELS) {
    if (entry.fromM >= radiusM) continue;
    const outer = Math.min(radiusM, entry.toM) + 2000;
    requests.push(...blocksForBox(entry.level, boxAround(lat, lon, outer), blockSize));
  }
  const absentTiles = new Set(),
    blocks = [];
  for (const request of requests) {
    const block = await readBlock(request.name, request.level, request.bx, request.by);
    if (block === null) absentTiles.add(request.name);
    else blocks.push(block);
  }
  const lookup = createLookup(blocks, absentTiles, blockSize);
  const groundM = lookup.bilinear(0, lat, lon);
  const n = distances.length;
  const heights = new Int16Array(AZIMUTH_COUNT * n);
  let voidSamples = 0;
  const halfArc = Math.tan(((AZIMUTH_STEP_DEG / 2) * Math.PI) / 180);
  for (let ray = 0; ray < AZIMUTH_COUNT; ray++) {
    const azimuth = ray * AZIMUTH_STEP_DEG;
    for (let j = 0; j < n; j++) {
      const d = distances[j];
      const point = destination(lat, lon, azimuth, d);
      const halfM = Math.max(radialStepAt(distances, j) / 2, d * halfArc);
      const value = lookup.pooled(levelFor(d), point.lat, point.lon, halfM);
      heights[ray * n + j] = value;
      if (value === VOID) voidSamples++;
    }
  }
  const used = blocks.filter(Boolean);
  const tiles = [...new Map(used.map((b) => [b.name, b])).values()].map((b) => ({
    name: b.name,
    etag: b.etag ?? null,
    retrievedAt: b.retrievedAt ?? null,
  }));
  const dates = used.map((b) => Date.parse(b.retrievedAt)).filter(Number.isFinite);
  return {
    distances,
    heights,
    groundM: groundM === VOID ? null : groundM,
    voidSamples,
    absentTiles: [...absentTiles].sort(),
    tiles,
    retrievedAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    fromCache: used.filter((b) => b.cached).length,
    fetched: used.filter((b) => !b.cached).length,
  };
}
