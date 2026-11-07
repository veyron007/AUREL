/**
 * IMERG half-hourly precipitation read from the keyless NASA GIBS layer
 * `IMERG_Precipitation_Rate_30min` through its published colormap
 * (`GPM_Precipitation_Rate.xml`, 220 rate classes in mm/h plus "insignificant"
 * and "no data"). A pixel colour is looked up exactly in that colormap and
 * becomes a rate interval; nothing is guessed from colour distance.
 *
 * Accumulations are interval sums of rate × 0.5 h. Basin means weight each
 * 0.1° IMERG cell by the catchment area inside it; cells without data are
 * excluded and reported as missing coverage, never filled with zero.
 *
 * Pure; the server decodes tiles with zlib, the tests with fixtures.
 */

export const GIBS_IMERG = Object.freeze({
  layer: 'IMERG_Precipitation_Rate_30min',
  colormap:
    'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml',
  legend:
    'https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg',
  tileBase: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best',
  matrixSet: '2km',
  level: 5,
  tileSpanDeg: 9,
  tilePixels: 512,
  stepMinutes: 30,
  products:
    'GPM IMERG Early (near real time) and Final, V07, 0.1°, half-hourly',
});

/** Half-hour steps in each reported window. */
export const IMERG_WINDOWS = Object.freeze({ '1h': 2, '3h': 6, '24h': 48 });

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Parse the GIBS v1.3 colormap into an exact RGB lookup.
 * @param {string} xml
 * @returns {Map<string, {lo:number, hi:number}|null>} null marks "no data".
 */
export function parseColormap(xml) {
  if (typeof xml !== 'string' || !xml.includes('<ColorMap'))
    throw new TypeError('Not a GIBS colormap');
  const lookup = new Map();
  const entry = /<ColorMapEntry\b([^>]*)\/?>/g;
  let match;
  while ((match = entry.exec(xml))) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    const rgb = (attrs.rgb || '').split(',').map(Number);
    if (rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v))) continue;
    const key = rgb.join(',');
    if (attrs.nodata === 'true') {
      lookup.set(key, null);
      continue;
    }
    const range = /^\[([^,]+),([^)\]]+)[)\]]$/.exec(attrs.value || '');
    if (!range) continue;
    const lo = range[1] === '-INF' ? 0 : Number(range[1]);
    const hi = range[2] === '+INF' ? Infinity : Number(range[2]);
    if (!Number.isFinite(lo) || !(hi > lo)) continue;
    lookup.set(key, { lo: Math.max(0, lo), hi });
  }
  if (lookup.size < 10) throw new TypeError('Colormap has too few classes');
  return lookup;
}

/**
 * Decode an 8-bit palette PNG (colour type 3, non-interlaced) to RGB per pixel.
 * @param {Uint8Array} bytes
 * @param {(data:Uint8Array)=>Uint8Array} inflate zlib inflate.
 */
export function decodePalettePng(bytes, inflate) {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value))
    throw new TypeError('Not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    width = 0,
    height = 0,
    palette = null,
    alpha = null;
  const idat = [];
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.byteLength !== length) throw new TypeError('PNG is truncated');
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || colour !== 3 || interlace !== 0)
        throw new TypeError('Unsupported PNG layout');
      if (width > 4096 || height > 4096) throw new RangeError('PNG too large');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !palette || !idat.length) throw new TypeError('PNG incomplete');
  const joined = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of idat) {
    joined.set(part, at);
    at += part.length;
  }
  const raw = inflate(joined);
  const stride = width + 1;
  if (raw.length < stride * height) throw new TypeError('PNG data is short');
  const indices = new Uint8Array(width * height);
  const previous = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const row = raw.subarray(y * stride + 1, (y + 1) * stride);
    const out = indices.subarray(y * width, (y + 1) * width);
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? out[x - 1] : 0,
        b = previous[x],
        c = x > 0 ? previous[x - 1] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new TypeError('Bad PNG filter');
      out[x] = (row[x] + predictor) & 255;
    }
    previous.set(out);
  }
  return {
    width,
    height,
    rgbAt(px, py) {
      const index = indices[py * width + px];
      return [
        palette[index * 3],
        palette[index * 3 + 1],
        palette[index * 3 + 2],
      ];
    },
    alphaAt(px, py) {
      const index = indices[py * width + px];
      return alpha && index < alpha.length ? alpha[index] : 255;
    },
  };
}

/** Level-5 tile and pixel holding a point on the GIBS EPSG:4326 2km set. */
export function gibsPixel(lon, lat) {
  const { tileSpanDeg: span, tilePixels: size } = GIBS_IMERG;
  const col = Math.floor((lon + 180) / span),
    row = Math.floor((90 - lat) / span);
  const px = Math.min(
    size - 1,
    Math.floor((((lon + 180) % span) / span) * size),
  );
  const py = Math.min(
    size - 1,
    Math.floor((((90 - lat) % span) / span) * size),
  );
  return { row, col, px, py };
}

/** GIBS tile URL for a time step. */
export function gibsTileUrl(time, { row, col }) {
  const { tileBase, layer, matrixSet, level } = GIBS_IMERG;
  return `${tileBase}/${layer}/default/${time}/${matrixSet}/${level}/${row}/${col}.png`;
}

/** Rate interval at a pixel, or null for no data. */
export function rateAt(tile, lookup, px, py) {
  const key = tile.rgbAt(px, py).join(',');
  if (!lookup.has(key)) return null;
  return lookup.get(key);
}

/** Half-hour step times ending at `latest` (ISO), newest first. */
export function stepTimes(latest, steps) {
  const end = Date.parse(latest);
  if (!Number.isFinite(end)) throw new TypeError('Invalid IMERG time');
  return Array.from({ length: steps }, (_, index) =>
    new Date(end - index * 1800_000).toISOString().replace('.000Z', 'Z'),
  );
}

/** Latest published time from a GIBS DescribeDomains response. */
export function latestFromDomains(xml) {
  const domain = /<Domain>([^<]+)<\/Domain>/.exec(String(xml || ''))?.[1];
  const end = domain?.split('/')[1];
  if (!end || !Number.isFinite(Date.parse(end))) return null;
  return new Date(Date.parse(end)).toISOString().replace('.000Z', 'Z');
}

/**
 * Area-weighted basin mean of per-cell intervals.
 * @param {Array<{key:string, km2:number}>} weights
 * @param {Map<string, {lo:number, hi:number}|null>|Record<string, {lo:number, hi:number}|null>} values
 */
export function basinMean(weights, values) {
  const get = (key) =>
    values instanceof Map ? values.get(key) : values?.[key];
  let total = 0,
    covered = 0,
    lo = 0,
    hi = 0;
  for (const { key, km2 } of weights) {
    if (!(km2 > 0)) continue;
    total += km2;
    const value = get(key);
    if (!value || !Number.isFinite(value.lo) || !Number.isFinite(value.hi))
      continue;
    covered += km2;
    lo += value.lo * km2;
    hi += value.hi * km2;
  }
  if (!covered) return { lo: null, hi: null, coverage: 0, totalKm2: total };
  return {
    lo: lo / covered,
    hi: hi / covered,
    coverage: covered / total,
    totalKm2: total,
  };
}

/**
 * Sum half-hourly rate intervals (mm/h) into an accumulation interval (mm).
 * Steps whose mean is unknown are counted as missing, not as zero.
 */
export function accumulate(stepMeans) {
  let lo = 0,
    hi = 0,
    present = 0;
  for (const step of stepMeans) {
    if (step?.lo == null || step?.hi == null) continue;
    present++;
    lo += step.lo * 0.5;
    hi += step.hi * 0.5;
  }
  return {
    lo: present ? lo : null,
    hi: present ? hi : null,
    steps: stepMeans.length,
    presentSteps: present,
    complete: present === stepMeans.length,
  };
}
