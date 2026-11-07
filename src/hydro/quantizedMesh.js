/**
 * Minimal quantized-mesh-1.0 reader for height sampling, independent of
 * Cesium so the browser, the worker tests and the offline build share one
 * decoder. Format: https://github.com/CesiumGS/quantized-mesh (Apache-2.0).
 * Extensions (normals, water mask, metadata) are ignored.
 */

const HEADER_BYTES = 88;
const QUANT = 32767;
/** Refuse absurd tiles before allocating: Re:Earth tiles hold a few thousand vertices. */
export const MAX_TILE_VERTICES = 262_144;

const zigzag = (value) => (value >> 1) ^ -(value & 1);

/**
 * Decode one tile.
 * @param {ArrayBuffer|Uint8Array} input Uncompressed tile bytes.
 * @returns {{minHeight:number, maxHeight:number, u:Uint16Array, v:Uint16Array, h:Float64Array, indices:Uint32Array}}
 */
export function decodeQuantizedMesh(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < HEADER_BYTES + 8)
    throw new RangeError('Terrain tile is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minHeight = view.getFloat32(24, true),
    maxHeight = view.getFloat32(28, true);
  let offset = HEADER_BYTES;
  const vertexCount = view.getUint32(offset, true);
  offset += 4;
  if (
    !Number.isFinite(minHeight) ||
    !Number.isFinite(maxHeight) ||
    vertexCount < 3 ||
    vertexCount > MAX_TILE_VERTICES ||
    offset + vertexCount * 6 > bytes.byteLength
  )
    throw new RangeError('Terrain tile header is invalid');
  const u = new Uint16Array(vertexCount),
    v = new Uint16Array(vertexCount),
    h = new Float64Array(vertexCount);
  let uu = 0,
    vv = 0,
    hh = 0;
  const span = maxHeight - minHeight;
  for (let i = 0; i < vertexCount; i++) {
    uu += zigzag(view.getUint16(offset + i * 2, true));
    vv += zigzag(view.getUint16(offset + (vertexCount + i) * 2, true));
    hh += zigzag(view.getUint16(offset + (2 * vertexCount + i) * 2, true));
    u[i] = uu;
    v[i] = vv;
    h[i] = minHeight + (hh / QUANT) * span;
  }
  offset += vertexCount * 6;
  const wide = vertexCount > 65536;
  const width = wide ? 4 : 2;
  if (offset % width) offset += width - (offset % width);
  if (offset + 4 > bytes.byteLength)
    throw new RangeError('Terrain tile has no triangles');
  const triangleCount = view.getUint32(offset, true);
  offset += 4;
  if (offset + triangleCount * 3 * width > bytes.byteLength)
    throw new RangeError('Terrain tile triangles are truncated');
  const indices = new Uint32Array(triangleCount * 3);
  let highest = 0;
  for (let i = 0; i < indices.length; i++) {
    const code = wide
      ? view.getUint32(offset + i * 4, true)
      : view.getUint16(offset + i * 2, true);
    const index = highest - code;
    if (code === 0) highest++;
    if (index < 0 || index >= vertexCount)
      throw new RangeError('Terrain tile index is out of range');
    indices[i] = index;
  }
  return { minHeight, maxHeight, u, v, h, indices };
}

/** Geographic rectangle of a TMS EPSG:4326 tile (2×1 tiles at level 0). */
export function tileRectangle(level, x, y) {
  const size = 180 / 2 ** level;
  return {
    west: -180 + x * size,
    east: -180 + (x + 1) * size,
    south: -90 + y * size,
    north: -90 + (y + 1) * size,
  };
}

/** Tile coordinates containing a point at a level. */
export function tileForPoint(level, lon, lat) {
  const size = 180 / 2 ** level;
  const x = Math.min(2 ** (level + 1) - 1, Math.floor((lon + 180) / size));
  const y = Math.min(2 ** level - 1, Math.floor((lat + 90) / size));
  return { x, y };
}

const BINS = 32;

/**
 * Build a sampler that interpolates heights inside a decoded tile.
 * @returns {(lon:number, lat:number) => number} NaN outside every triangle.
 */
export function createTileSampler(mesh, rectangle) {
  const { u, v, h, indices } = mesh;
  const bins = Array.from({ length: BINS * BINS }, () => []);
  const binOf = (q) => Math.min(BINS - 1, Math.floor((q / (QUANT + 1)) * BINS));
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2];
    const x0 = binOf(Math.min(u[a], u[b], u[c])),
      x1 = binOf(Math.max(u[a], u[b], u[c]));
    const y0 = binOf(Math.min(v[a], v[b], v[c])),
      y1 = binOf(Math.max(v[a], v[b], v[c]));
    for (let by = y0; by <= y1; by++)
      for (let bx = x0; bx <= x1; bx++) bins[by * BINS + bx].push(t);
  }
  const width = rectangle.east - rectangle.west,
    height = rectangle.north - rectangle.south;
  return function sample(lon, lat) {
    const qu = ((lon - rectangle.west) / width) * QUANT,
      qv = ((lat - rectangle.south) / height) * QUANT;
    if (!(qu >= -0.5 && qu <= QUANT + 0.5 && qv >= -0.5 && qv <= QUANT + 0.5))
      return NaN;
    const list =
      bins[binOf(Math.max(0, Math.min(QUANT, qv))) * BINS +
        binOf(Math.max(0, Math.min(QUANT, qu)))];
    for (const t of list) {
      const a = indices[t],
        b = indices[t + 1],
        c = indices[t + 2];
      const det =
        (v[b] - v[c]) * (u[a] - u[c]) + (u[c] - u[b]) * (v[a] - v[c]);
      if (det === 0) continue;
      const wa = ((v[b] - v[c]) * (qu - u[c]) + (u[c] - u[b]) * (qv - v[c])) / det;
      const wb = ((v[c] - v[a]) * (qu - u[c]) + (u[a] - u[c]) * (qv - v[c])) / det;
      const wc = 1 - wa - wb;
      const tolerance = -1e-6;
      if (wa >= tolerance && wb >= tolerance && wc >= tolerance)
        return wa * h[a] + wb * h[b] + wc * h[c];
    }
    return NaN;
  };
}
