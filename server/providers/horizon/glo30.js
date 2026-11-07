/**
 * Copernicus DEM GLO-30 Public on AWS Open Data: keyless HTTPS range reads of
 * 1° Cloud Optimized GeoTIFF tiles, cached as Int16 metre blocks.
 *
 * Tile key: Copernicus_DSM_COG_10_{N|S}dd_00_{E|W}ddd_00_DEM, named by the
 * south-west corner. Each COG holds the full grid (3600 rows; width by
 * latitude band) and three averaged overviews (½, ¼, ⅛), in 1024 px tiles,
 * DEFLATE with floating-point predictor. Ocean tiles do not exist; the
 * dataset readme says to read them as 0 m.
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { GeoTIFF } from 'geotiff';

export const GLO30_HOST = 'copernicus-dem-30m.s3.amazonaws.com';
export const GLO30_SOURCE = Object.freeze({
  id: 'copernicus-glo30',
  label: 'Copernicus DEM GLO-30 Public (AWS Open Data)',
  attribution:
    'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
  license: 'Copernicus DEM licence (free for any use, attribution required)',
  link: 'https://registry.opendata.aws/copernicus-dem/',
  applicableTime:
    'TanDEM-X acquisitions 2011-2015 (Copernicus DEM 2021 release)',
});
const BLOCK = 1024;
const MAX_SLICE = 8 * 1024 * 1024;
export const VOID = -32768;

/** Tile key for the 1° cell containing (lat, lon). */
export function tileName(lat, lon) {
  const south = Math.floor(lat),
    west = Math.floor(lon);
  const ns = south < 0 ? 'S' : 'N',
    ew = west < 0 ? 'W' : 'E';
  return `Copernicus_DSM_COG_10_${ns}${String(Math.abs(south)).padStart(2, '0')}_00_${ew}${String(Math.abs(west)).padStart(3, '0')}_00_DEM`;
}
const NAME = /^Copernicus_DSM_COG_10_[NS]\d{2}_00_[EW]\d{3}_00_DEM$/;
export function tileUrl(name) {
  if (!NAME.test(name)) throw new Error('unsupported-tile');
  return `https://${GLO30_HOST}/${name}/${name}.tif`;
}

/** Shared per-request byte and request budget. */
export function createByteBudget({
  maxBytes = 96 * 1024 * 1024,
  maxRequests = 400,
} = {}) {
  let bytes = 0,
    requests = 0;
  return {
    reserve(length) {
      if (
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > MAX_SLICE ||
        bytes + length > maxBytes ||
        requests + 1 > maxRequests
      )
        throw Object.assign(new Error('range-budget-exceeded'), {
          budget: { bytes, requests, length },
        });
      bytes += length;
      requests++;
    },
    snapshot: () => ({ bytes, requests, maxBytes, maxRequests }),
  };
}

async function discard(response) {
  await response.body?.cancel?.().catch(() => {});
}

/** GeoTIFF source that only accepts exact 206 ranges from the admitted host. */
export function createTileSource(name, { fetchImpl = fetch, budget }) {
  const url = tileUrl(name);
  let etag = null,
    fileSize = null;
  return {
    get etag() {
      return etag;
    },
    get fileSize() {
      return fileSize;
    },
    async fetch(slices, signal) {
      const out = [];
      for (const { offset, length } of slices) {
        signal?.throwIfAborted();
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(length)
        )
          throw new Error('invalid-range');
        budget.reserve(length);
        const response = await fetchImpl(url, {
          signal,
          redirect: 'error',
          headers: {
            Range: `bytes=${offset}-${offset + length - 1}`,
            ...(etag ? { 'If-Match': etag } : {}),
          },
        });
        if (response.status === 404 || response.status === 403) {
          await discard(response);
          throw new Error('absent-tile');
        }
        if (response.status === 429 || response.status === 503) {
          await discard(response);
          throw new Error('rate-limited');
        }
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('content-range') || '',
        );
        const nextEtag = response.headers.get('etag');
        if (
          response.status !== 206 ||
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) > offset + length - 1 ||
          (etag && nextEtag !== etag)
        ) {
          await discard(response);
          throw new Error('invalid-range-response');
        }
        etag ||= nextEtag;
        fileSize = Number(match[3]);
        out.push(await response.arrayBuffer());
      }
      return out;
    },
    async close() {},
  };
}

function encodeBlock(block) {
  const { data, cached, ...meta } = block;
  const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
  const out = Buffer.alloc(4 + metaBytes.length + data.byteLength);
  out.writeUInt32LE(metaBytes.length, 0);
  metaBytes.copy(out, 4);
  for (let i = 0; i < data.length; i++)
    out.writeInt16LE(data[i], 4 + metaBytes.length + i * 2);
  return out;
}
function decodeBlock(bytes) {
  const metaLength = bytes.readUInt32LE(0);
  const meta = JSON.parse(bytes.subarray(4, 4 + metaLength).toString('utf8'));
  const body = bytes.subarray(4 + metaLength);
  if (
    !Number.isSafeInteger(meta.width) ||
    !Number.isSafeInteger(meta.height) ||
    body.byteLength !== meta.width * meta.height * 2
  )
    return null;
  const data = new Int16Array(meta.width * meta.height);
  for (let i = 0; i < data.length; i++) data[i] = body.readInt16LE(i * 2);
  return { ...meta, data, cached: true };
}

/**
 * Cached block reader. A block is one 1024 px COG tile of one level, stored
 * as Int16 metres (voids -32768) with its georeference.
 */
export function createGlo30Reader({
  fetchImpl = fetch,
  cacheDir = path.join(process.cwd(), '.gev-cache', 'horizon-dem'),
  memoryMaxBytes = 160 * 1024 * 1024,
  diskMaxBytes = 320 * 1024 * 1024,
  now = () => Date.now(),
} = {}) {
  const memory = new Map();
  let memoryBytes = 0;
  const absent = new Set();
  const inflight = new Map();

  function remember(key, block) {
    if (memory.has(key)) memoryBytes -= memory.get(key).data.byteLength;
    memory.delete(key);
    memory.set(key, block);
    memoryBytes += block.data.byteLength;
    for (const [oldKey, old] of memory) {
      if (memoryBytes <= memoryMaxBytes) break;
      memory.delete(oldKey);
      memoryBytes -= old.data.byteLength;
    }
  }
  const file = (key) => path.join(cacheDir, `${key}.blk`);
  async function readDisk(key) {
    try {
      return decodeBlock(await fsp.readFile(file(key)));
    } catch {
      return null;
    }
  }
  async function pruneDisk() {
    const names = (await fsp.readdir(cacheDir)).filter((name) =>
      name.endsWith('.blk'),
    );
    const entries = await Promise.all(
      names.map(async (name) => {
        const stat = await fsp.stat(path.join(cacheDir, name));
        return { name, size: stat.size, at: stat.mtimeMs };
      }),
    );
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a, b) => a.at - b.at)) {
      if (total <= diskMaxBytes) break;
      await fsp.rm(path.join(cacheDir, entry.name), { force: true });
      total -= entry.size;
    }
  }
  async function writeDisk(key, block) {
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(file(key), encodeBlock(block));
      await pruneDisk();
    } catch {
      console.warn('[horizon-dem] cache write failed');
    }
  }

  /** One open GeoTIFF per tile and request budget, so headers are read once. */
  const open = new WeakMap();
  function openTile(name, budget) {
    if (!open.has(budget)) open.set(budget, new Map());
    const tiles = open.get(budget);
    if (!tiles.has(name)) {
      const source = createTileSource(name, { fetchImpl, budget });
      tiles.set(
        name,
        GeoTIFF.fromSource(source).then((tiff) => ({ tiff, source })),
      );
    }
    return tiles.get(name);
  }

  async function fetchBlock(name, level, bx, by, { budget, signal }) {
    const { tiff, source } = await openTile(name, budget);
    const image = await tiff.getImage(level);
    const full = await tiff.getImage(0);
    const [originLon, originLat] = full.getOrigin();
    const [fullResLon, fullResLat] = full.getResolution();
    const scaleX = full.getWidth() / image.getWidth(),
      scaleY = full.getHeight() / image.getHeight();
    const x0 = bx * BLOCK,
      y0 = by * BLOCK,
      x1 = Math.min(image.getWidth(), x0 + BLOCK),
      y1 = Math.min(image.getHeight(), y0 + BLOCK);
    if (x0 >= x1 || y0 >= y1) throw new Error('invalid-block');
    const [raster] = await image.readRasters({
      window: [x0, y0, x1, y1],
      signal,
    });
    const data = new Int16Array(raster.length);
    let voids = 0;
    for (let i = 0; i < raster.length; i++) {
      const value = raster[i];
      if (!Number.isFinite(value) || value < -1000 || value > 9000) {
        data[i] = VOID;
        voids++;
      } else data[i] = Math.round(value);
    }
    return {
      name,
      level,
      bx,
      by,
      width: x1 - x0,
      height: y1 - y0,
      levelWidth: image.getWidth(),
      levelHeight: image.getHeight(),
      west: originLon + x0 * fullResLon * scaleX,
      north: originLat + y0 * fullResLat * scaleY,
      resLon: fullResLon * scaleX,
      resLat: -fullResLat * scaleY,
      etag: source.etag,
      retrievedAt: new Date(now()).toISOString(),
      voids,
      data,
    };
  }

  /**
   * One block, or `null` for a tile the bucket does not hold (ocean, or a
   * tile not released publicly).
   */
  async function readBlock(name, level, bx, by, options) {
    if (absent.has(name)) return null;
    const key = `${name}_L${level}_${bx}_${by}`;
    if (memory.has(key)) {
      const block = memory.get(key);
      remember(key, block);
      return block;
    }
    if (!inflight.has(key)) {
      const task = (async () => {
        const disk = await readDisk(key);
        if (disk) return disk;
        const block = await fetchBlock(name, level, bx, by, options);
        await writeDisk(key, block);
        return { ...block, cached: false };
      })().finally(() => inflight.delete(key));
      inflight.set(key, task);
    }
    try {
      const block = await inflight.get(key);
      remember(key, block);
      return block;
    } catch (error) {
      if (error.message === 'absent-tile') {
        absent.add(name);
        return null;
      }
      throw error;
    }
  }
  return { readBlock, blockSize: BLOCK };
}
