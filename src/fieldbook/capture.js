/** Explicit capture adapters. Never inspect storage, provider keys, or Cesium objects. */
import {
  createFieldbook,
  validateFieldbook,
  newFieldbookId,
  ATTACHMENT_TYPES,
  FIELDBOOK_LIMITS,
} from './document.js';
import { validateRouteSnapshot } from '../layers/directions/snapshot.js';
const PALETTE = new Set(['primary', 'amber', 'cyan', 'green', 'red']);
const MIME_BY_EXTENSION = Object.freeze({
  txt: 'text/plain',
  json: 'application/json',
  geojson: 'application/geo+json',
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
});
const clock = () => new Date().toISOString();
const copy = (value) => JSON.parse(JSON.stringify(value));
function validateRows(collection, rows, now = clock()) {
  const project = createFieldbook({ now });
  validateFieldbook({ ...project, [collection]: rows });
  return rows;
}

/** A captured provider route is saved evidence, not a fresh routing request. */
export function captureRoute(
  layer,
  { name = 'Saved route', now = clock() } = {},
) {
  const snapshot = validateRouteSnapshot(layer?.getRouteSnapshot?.());
  if (!snapshot) return null;
  const row = {
    id: newFieldbookId(),
    name,
    geometry: {
      type: 'LineString',
      coordinates: snapshot.geometry.map((pair) => [...pair]),
    },
    mode: snapshot.mode,
    sourceId: 'osm-routing',
    sourceLabel: snapshot.source,
    distanceM: snapshot.distanceM,
    durationSec: snapshot.durationS,
    createdAt: now,
    applicableTime: null,
    retrievedAt:
      snapshot.lastUpdate === null
        ? null
        : new Date(snapshot.lastUpdate).toISOString(),
    snapshot: copy(snapshot),
  };
  return validateRows('routes', [row], now)[0];
}

function pair(value) {
  // Manual geometry is draped; sampled renderer heights are not authored elevation.
  const lon = Array.isArray(value) ? value[0] : value?.lon;
  const lat = Array.isArray(value) ? value[1] : value?.lat;
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  )
    throw new Error('Drawing coordinates cannot be saved safely.');
  return [lon, lat];
}
function ring(points) {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > FIELDBOOK_LIMITS.points
  )
    throw new Error('Drawing ring is invalid or too large.');
  const result = points.map(pair);
  if (result[0][0] !== result.at(-1)[0] || result[0][1] !== result.at(-1)[1])
    result.push([...result[0]]);
  return result;
}
function drawingGeometry(mark) {
  if (mark.type === 'pin')
    return { type: 'Point', coordinates: pair(mark.anchor) };
  if (mark.type === 'route') {
    if (!Array.isArray(mark.path) || mark.path.length > FIELDBOOK_LIMITS.points)
      throw new Error('Drawing path is invalid or too large.');
    return { type: 'LineString', coordinates: mark.path.map(pair) };
  }
  if (mark.type === 'area') {
    if (mark.polygons) {
      if (!Array.isArray(mark.polygons) || mark.polygons.length > 64)
        throw new Error('Drawing parts are invalid or too large.');
      return {
        type: 'MultiPolygon',
        coordinates: mark.polygons.map((part) => {
          if (!Array.isArray(part) || part.length > 64)
            throw new Error('Drawing rings are invalid or too large.');
          return part.map(ring);
        }),
      };
    }
    return { type: 'Polygon', coordinates: [ring(mark.ring)] };
  }
  throw new Error('This drawing type cannot be saved.');
}

/** Only user-authored manual marks enter a Fieldbook; never live/resolved overlays. */
export function captureManualDrawings(engine, { now = clock() } = {}) {
  const marks = (engine?.list?.() || []).filter((mark) => mark.manual === true);
  if (marks.length > FIELDBOOK_LIMITS.drawings)
    throw new Error('Too many drawings to save.');
  const rows = marks.map((mark) => ({
    id: newFieldbookId(),
    name: mark.name || mark.label || 'Untitled drawing',
    geometry: drawingGeometry(mark),
    color: PALETTE.has(mark.color) ? mark.color : 'primary',
    hidden: mark.hidden === true,
    createdAt: now,
  }));
  return validateRows('drawings', rows, now);
}
function drawingSpec(row) {
  if (row.color !== null && !PALETTE.has(row.color))
    throw new Error(
      'This saved drawing color is not supported by the drawing tool.',
    );
  const base = { manual: true, label: row.name, color: row.color || 'primary' };
  const points = row.geometry.coordinates;
  if (row.geometry.type === 'Point')
    return { ...base, type: 'pin', longitude: points[0], latitude: points[1] };
  if (row.geometry.type === 'LineString')
    return { ...base, type: 'route', path: copy(points) };
  return {
    ...base,
    type: 'area',
    origin: 'area',
    polygons: copy(row.geometry.type === 'Polygon' ? [points] : points),
  };
}
/** Validate the complete batch first. Manual specs never resolve names or call routing. */
export async function restoreManualDrawings(engine, rows, { signal } = {}) {
  validateRows('drawings', rows);
  const specs = rows.map(drawingSpec);
  if (!specs.length || signal?.aborted) return { ok: false, drawn: 0, ids: [] };
  const result = await engine.annotate(specs, {
    persist: true,
    clearPrevious: false,
    flyTo: false,
    signal,
  });
  result.results?.forEach((item, index) => {
    if (item.ok && rows[index]?.hidden) engine.setHidden(item.id, true);
  });
  return result;
}

/** Existing v6 scene JSON only: external and bundle asset references stay references. */
export function captureScene(
  director,
  { name = 'Saved scenes', now = clock() } = {},
) {
  const document = director?.getProjectSnapshot?.();
  if (!document) throw new Error('No scene document is available.');
  return validateRows(
    'sceneDocuments',
    [{ id: newFieldbookId(), name, document }],
    now,
  )[0];
}

/** Store an explicitly selected local file as inert bytes; no import, parsing, or fetch. */
export async function captureAttachment(file, { now = clock() } = {}) {
  if (
    !file ||
    !Number.isInteger(file.size) ||
    file.size < 0 ||
    file.size > FIELDBOOK_LIMITS.attachmentBytes
  )
    throw new Error('Local file exceeds the supported size limit (2 MiB).');
  const name = String(file.name || '');
  const mimeType = MIME_BY_EXTENSION[name.split('.').at(-1)?.toLowerCase()];
  if (!mimeType || !ATTACHMENT_TYPES.includes(mimeType))
    throw new Error('This local file type is not supported.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    bytes.byteLength !== file.size ||
    bytes.byteLength > FIELDBOOK_LIMITS.attachmentBytes
  )
    throw new Error('Local file size changed while reading.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const row = {
    id: newFieldbookId(),
    name,
    mimeType,
    encoding: 'base64',
    data: btoa(binary),
    bytes: bytes.length,
    createdAt: now,
  };
  return validateRows('attachments', [row], now)[0];
}
