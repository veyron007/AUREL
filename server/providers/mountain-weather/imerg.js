import {
  IMERG_HALF_HOURS,
  SOURCES,
  emptyPart,
} from '../../../src/sources/mountainWeatherModel.js';
import { SourceError, createSourceCache } from './acquire.js';
import { readPaletteIndex } from './png.js';

const HALF_HOUR = 1800000;
const LAYER = 'IMERG_Precipitation_Rate_30min';
const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
export const COLORMAP_URL =
  'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml';
/** Level 5 of the GIBS 2km tile matrix set: 40 × 20 tiles of 9° at 512 px. */
const TILE_LEVEL = 5;
const TILE_DEGREES = 9;
const TILE_PIXELS = 512;
const MAX_TILE_BYTES = 256 * 1024;
const CONCURRENCY = 4;

const stamp = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function domainsUrl(clock) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return `${BASE}/1.0.0/${LAYER}/default/2km/all/${day(clock - 2 * 86400000)}T00:00:00Z--${day(clock + 86400000)}T00:00:00Z.xml`;
}
export function tileFor(point) {
  const col = Math.floor((point.lon + 180) / TILE_DEGREES);
  const row = Math.floor((90 - point.lat) / TILE_DEGREES);
  const scale = TILE_PIXELS / TILE_DEGREES;
  return {
    row: Math.min(row, 19),
    col: Math.min(col, 39),
    x: Math.min(
      TILE_PIXELS - 1,
      Math.floor((point.lon + 180 - col * TILE_DEGREES) * scale),
    ),
    y: Math.min(
      TILE_PIXELS - 1,
      Math.floor((90 - point.lat - row * TILE_DEGREES) * scale),
    ),
  };
}
export function tileUrl(time, tile) {
  return `${BASE}/${LAYER}/default/${stamp(time)}/2km/${TILE_LEVEL}/${tile.row}/${tile.col}.png`;
}
/** IMERG's own 0.1° cell centre, not the requested point. */
export function imergCell(point) {
  const centre = (v) => Number((Math.floor(v * 10) / 10 + 0.05).toFixed(2));
  return { lat: centre(point.lat), lon: centre(point.lon) };
}

/** Latest half-hour listed by GIBS DescribeDomains. */
export function parseLatest(xml) {
  const domains = [
    ...String(xml).matchAll(/<Domain>([^<]{1,4096})<\/Domain>/g),
  ];
  let latest = null;
  for (const [, text] of domains)
    for (const [stampText] of text.matchAll(
      /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g,
    )) {
      const at = Date.parse(stampText);
      if (
        Number.isFinite(at) &&
        at % HALF_HOUR === 0 &&
        (!latest || at > latest)
      )
        latest = at;
    }
  if (!latest) throw new SourceError('no-data');
  return latest;
}

/**
 * Parse the published GIBS colormap into ref → { rgb, low, high | nodata }.
 * Interval values are mm/h; "-INF" lower bounds become 0 and "+INF" upper
 * bounds stay open (null).
 */
export function parseColormap(xml) {
  const entries = new Map();
  for (const [tag] of String(xml).matchAll(/<ColorMapEntry\b[^>]{1,512}\/>/g)) {
    const attr = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    const ref = Number(attr('ref'));
    const rgb = attr('rgb')?.split(',').map(Number);
    if (
      !Number.isInteger(ref) ||
      ref < 0 ||
      ref > 255 ||
      rgb?.length !== 3 ||
      rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      throw new SourceError('colormap-mismatch');
    if (attr('nodata') === 'true') {
      entries.set(ref, { rgb, nodata: true });
      continue;
    }
    const interval = (attr('value') || '').match(
      /^\[(-INF|\d+(?:\.\d+)?),(\+?INF|\d+(?:\.\d+)?)\)$/,
    );
    if (!interval) throw new SourceError('colormap-mismatch');
    const low = interval[1] === '-INF' ? 0 : Number(interval[1]);
    const high = /INF$/.test(interval[2]) ? null : Number(interval[2]);
    if (high !== null && !(high > low))
      throw new SourceError('colormap-mismatch');
    entries.set(ref, { rgb, nodata: false, low, high });
  }
  if (entries.size < 3) throw new SourceError('colormap-mismatch');
  return entries;
}

/** Map one palette index to its published class; any RGB disagreement is unknown. */
export function classify(colormap, { index, rgb }) {
  const entry = colormap.get(index);
  if (!entry || entry.rgb.some((v, i) => v !== rgb[i]))
    throw new SourceError('colormap-mismatch');
  return entry.nodata ? null : { low: entry.low, high: entry.high };
}

const round2 = (v) => Math.round(v * 100) / 100;

export function createImergSource({ acquire, now = Date.now }) {
  const meta = createSourceCache({ now, max: 4 });
  const tiles = createSourceCache({ now, max: 160 });
  const latest = () =>
    meta('domains', { ttlMs: 15 * 60000, staleMs: 6 * 3600000 }, async () =>
      parseLatest(
        await acquire({
          url: domainsUrl(now()),
          units: 1,
          maxBytes: 64 * 1024,
          read: 'text',
        }),
      ),
    );
  const colormap = () =>
    meta('colormap', { ttlMs: 24 * 3600000, staleMs: 7 * 86400000 }, async () =>
      parseColormap(
        await acquire({
          url: COLORMAP_URL,
          units: 1,
          maxBytes: 128 * 1024,
          read: 'text',
        }),
      ),
    );
  const tile = (time, where) =>
    tiles(
      `${time}|${where.row}|${where.col}`,
      { ttlMs: 6 * 3600000, staleMs: 0 },
      () =>
        acquire({
          url: tileUrl(time, where),
          units: 1,
          maxBytes: MAX_TILE_BYTES,
          read: 'bytes',
        }),
    );
  return async function readImerg(point) {
    let domain, map;
    try {
      [domain, map] = await Promise.all([latest(), colormap()]);
    } catch (error) {
      return emptyPart('imerg', error.state || 'unavailable', error.reason);
    }
    const where = tileFor(point);
    const times = Array.from(
      { length: IMERG_HALF_HOURS },
      (_, i) => domain.value - (IMERG_HALF_HOURS - 1 - i) * HALF_HOUR,
    );
    const rows = new Array(times.length);
    let refusal = null,
      mismatch = false,
      earliest = Math.min(domain.retrievedAt, map.retrievedAt);
    let next = 0;
    async function worker() {
      while (next < times.length) {
        const i = next++;
        rows[i] = {
          time: new Date(times[i]).toISOString(),
          lowMmH: null,
          highMmH: null,
        };
        if (refusal) continue;
        try {
          const result = await tile(times[i], where);
          earliest = Math.min(earliest, result.retrievedAt);
          const value = classify(
            map.value,
            readPaletteIndex(result.value, where.x, where.y),
          );
          if (value)
            rows[i] = { ...rows[i], lowMmH: value.low, highMmH: value.high };
        } catch (error) {
          if (error?.state === 'blocked') refusal = error;
          if (error?.reason === 'colormap-mismatch') mismatch = true;
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const present = rows.filter((r) => r.lowMmH !== null);
    const missingCount = rows.length - present.length;
    const stale = domain.stale || map.stale;
    const state = !present.length
      ? refusal
        ? 'blocked'
        : 'unavailable'
      : stale
        ? 'stale'
        : missingCount
          ? 'partial'
          : 'ready';
    return {
      ...SOURCES.imerg,
      state,
      reason: mismatch
        ? 'colormap-mismatch'
        : refusal
          ? refusal.reason
          : missingCount
            ? 'no-data'
            : stale
              ? domain.reason || map.reason
              : null,
      retrievedAt: present.length ? new Date(earliest).toISOString() : null,
      cell: imergCell(point),
      latestAt: new Date(domain.value).toISOString(),
      halfHours: present.length ? rows : [],
      missingCount: present.length ? missingCount : IMERG_HALF_HOURS,
      totalLowMm: present.length
        ? round2(present.reduce((sum, r) => sum + r.lowMmH * 0.5, 0))
        : null,
      totalHighMm:
        !missingCount && present.every((r) => r.highMmH !== null)
          ? round2(present.reduce((sum, r) => sum + r.highMmH * 0.5, 0))
          : null,
    };
  };
}
