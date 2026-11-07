/**
 * Shared shapes for the Orbit Witness routes. The server normalises upstream
 * STAC and Open-Meteo responses into these; the browser re-validates them.
 * No browser globals; imported by server/providers/orbit-witness.
 */
export const SCENE_QUERY_LIMITS = Object.freeze({
  maxSideDeg: 2,
  maxDays: 14,
  pageSize: 100,
  maxScenes: 200,
});
export const CATALOGUE_SOURCES = Object.freeze(['earth-search', 'cmr-stac-lpcloud']);
export const CATALOGUE_STATUSES = Object.freeze([
  'ok',
  'partial',
  'unavailable',
  'rate-limited',
  'timeout',
  'invalid-response',
  'blocked',
]);
const COLLECTIONS = Object.freeze({
  'sentinel-2-l2a': 'earth-search',
  'landsat-c2-l2': 'earth-search',
  'HLSS30_2.0': 'cmr-stac-lpcloud',
  'HLSL30_2.0': 'cmr-stac-lpcloud',
});
export const SCENE_COLLECTIONS = Object.freeze(Object.keys(COLLECTIONS));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const invalid = (message = 'Invalid Orbit Witness data') => {
  throw new TypeError(message);
};
const finiteIn = (value, min, max) =>
  Number.isFinite(value) && value >= min && value <= max;

/** Validate a scene search: a small box and a past window of whole UTC days. */
export function validateSceneQuery({ bbox, from, to }, { now = Date.now() } = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4) invalid('Expected a bounding box');
  const [west, south, east, north] = bbox;
  if (
    !finiteIn(west, -180, 180) ||
    !finiteIn(east, -180, 180) ||
    !finiteIn(south, -90, 90) ||
    !finiteIn(north, -90, 90) ||
    west >= east ||
    south >= north ||
    east - west > SCENE_QUERY_LIMITS.maxSideDeg ||
    north - south > SCENE_QUERY_LIMITS.maxSideDeg
  )
    invalid('The search area must be at most two degrees per side');
  if (!DAY.test(from) || !DAY.test(to)) invalid('Expected UTC days');
  const fromMs = Date.parse(`${from}T00:00:00Z`),
    toMs = Date.parse(`${to}T00:00:00Z`);
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    fromMs > toMs ||
    toMs > today ||
    (toMs - fromMs) / DAY_MS + 1 > SCENE_QUERY_LIMITS.maxDays
  )
    invalid('The window must be 1–14 past UTC days');
  return { bbox: [west, south, east, north], from, to, fromMs, toMs: toMs + DAY_MS - 1 };
}

function ringFromGeometry(geometry) {
  const ring =
    geometry?.type === 'Polygon'
      ? geometry.coordinates?.[0]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates?.[0]?.[0]
        : null;
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const step = Math.max(1, Math.ceil(ring.length / 64));
  const points = ring
    .filter((_, i) => i % step === 0 || i === ring.length - 1)
    .map((p) => [Number(p?.[0]), Number(p?.[1])]);
  return points.every(([lon, lat]) => finiteIn(lon, -180, 180) && finiteIn(lat, -90, 90))
    ? points
    : null;
}

function hlsPlatform(id) {
  if (/^HLS\.S30\./.test(id)) return 'sentinel-2';
  if (/^HLS\.L30\./.test(id)) return 'landsat';
  return null;
}

/** One STAC Item → a catalogue scene row, or null when it cannot be trusted. */
export function normalizeStacItem(item, source) {
  const id = typeof item?.id === 'string' ? item.id.slice(0, 160) : '';
  const collection = item?.collection;
  if (!id || COLLECTIONS[collection] !== source) return null;
  const datetime = item?.properties?.datetime;
  if (typeof datetime !== 'string' || !Number.isFinite(Date.parse(datetime))) return null;
  const cloud = Number(item?.properties?.['eo:cloud_cover']);
  const platform =
    typeof item?.properties?.platform === 'string'
      ? item.properties.platform.toLowerCase().slice(0, 40)
      : hlsPlatform(id);
  return {
    id,
    collection,
    source,
    platform: platform || 'unknown',
    datetime: new Date(Date.parse(datetime)).toISOString(),
    cloudCover: finiteIn(cloud, 0, 100) ? Math.round(cloud * 10) / 10 : null,
    productId:
      collection === 'HLSS30_2.0' ? 'S30' : collection === 'HLSL30_2.0' ? 'L30' : null,
    footprint: ringFromGeometry(item?.geometry),
  };
}

/** Validate the `/api/orbit-witness/scenes` payload; returns a detached copy. */
export function validateCataloguePayload(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.sources)) invalid();
  if (typeof value.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.retrievedAt)))
    invalid();
  const sources = value.sources.map((row) => {
    if (
      !CATALOGUE_SOURCES.includes(row?.id) ||
      !CATALOGUE_STATUSES.includes(row?.status) ||
      !Number.isSafeInteger(row?.count) ||
      row.count < 0
    )
      invalid();
    return { id: row.id, status: row.status, count: row.count, truncated: Boolean(row.truncated) };
  });
  if (new Set(sources.map((row) => row.id)).size !== sources.length) invalid();
  if (!Array.isArray(value.scenes) || value.scenes.length > SCENE_QUERY_LIMITS.maxScenes)
    invalid();
  const scenes = value.scenes.map((row) => {
    const scene = normalizeStacItem(
      {
        id: row?.id,
        collection: row?.collection,
        properties: {
          datetime: row?.datetime,
          'eo:cloud_cover': row?.cloudCover,
          platform: row?.platform,
        },
        geometry: row?.footprint ? { type: 'Polygon', coordinates: [row.footprint] } : null,
      },
      row?.source,
    );
    if (!scene) invalid();
    return scene;
  });
  const ok = sources.filter((row) => row.status === 'ok' && !row.truncated).length;
  const answered = sources.filter((row) => ['ok', 'partial'].includes(row.status)).length;
  return {
    version: 1,
    retrievedAt: new Date(Date.parse(value.retrievedAt)).toISOString(),
    status:
      ok === CATALOGUE_SOURCES.length ? 'ok' : answered ? 'partial' : 'unavailable',
    sources,
    scenes,
  };
}

/** Validate the `/api/orbit-witness/cloud` payload. */
export function validateCloudPayload(value) {
  if (!value || value.version !== 1) invalid();
  if (!['ok', 'stale', 'unavailable', 'blocked'].includes(value.status)) invalid();
  if (!['ok', 'stale'].includes(value.status))
    return { status: value.status, reason: String(value.reason || '').slice(0, 80), hours: [] };
  if (!Array.isArray(value.hours) || !value.hours.length || value.hours.length > 400) invalid();
  const hours = value.hours.map((row) => {
    const timeMs = Date.parse(row?.time);
    if (!Number.isFinite(timeMs) || !finiteIn(row?.cloudCoverPct, 0, 100)) invalid();
    return { timeMs, cloudCoverPct: row.cloudCoverPct };
  });
  return {
    status: value.status,
    retrievedAt: new Date(Date.parse(value.retrievedAt)).toISOString(),
    model: String(value.model || 'best_match').slice(0, 40),
    validFromMs: hours[0].timeMs,
    validToMs: hours[hours.length - 1].timeMs,
    hours,
  };
}
