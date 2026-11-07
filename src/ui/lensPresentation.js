import { layerSnapshot } from '../data/layerSnapshot.js';

const KINDS = new Set([
  'observation',
  'forecast',
  'imagery',
  'derived',
  'manual',
  'simulation',
  'unknown',
]);
const FEEDS = new Set([
  'unknown',
  'nominal',
  'loading',
  'degraded',
  'stale',
  'partial',
  'fallback',
  'unavailable',
  'blocked',
]);
const COVERAGE = new Set(['unknown', 'supported', 'unsupported', 'partial']);
const text = (value, limit = 240) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A geographic extent, never a camera-height-derived resolution claim. */
function extentOf(value) {
  const box = Array.isArray(value)
    ? value
    : value && [value.west, value.south, value.east, value.north];
  if (!box || box.length !== 4 || !box.every(finite)) return null;
  const [west, south, east, north] = box;
  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    south > north
  )
    return null;
  return [...box];
}
function stamp(value) {
  if (!finite(value) || value < 0 || value > 8640000000000000) return null;
  return value;
}

/** Detached whitelist: context records may contain live Cesium objects. */
export function normalizeLensSelection(record) {
  if (!record || typeof record !== 'object') return null;
  const point =
    record.geometry?.type === 'Point' ? record.geometry.coordinates : null;
  const lat = point?.[1] ?? record.lat ?? record.latitude;
  const lon = point?.[0] ?? record.lon ?? record.longitude;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  const name =
    text(record.name || record.label || record.title || record.place) ||
    `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return {
    id: text(record.id, 160) || `place:${lat.toFixed(6)}:${lon.toFixed(6)}`,
    name,
    aliases: [
      ...new Set(
        (Array.isArray(record.aliases) ? record.aliases : [])
          .map((value) => text(value))
          .filter(Boolean),
      ),
    ].slice(0, 20),
    geometry: { type: 'Point', coordinates: [lon, lat] },
    extent: extentOf(record.extent || record.bbox),
    sourceId: text(record.sourceId || record.layerId, 120) || null,
    sourceLabel: text(record.sourceLabel || record.source) || null,
  };
}

/** Metadata is admitted only when supplied explicitly; unknown remains null. */
export function normalizeLensEvidence(row, scope = 'selection') {
  if (!row || typeof row !== 'object') return null;
  const sourceId = text(row.sourceId || row.id || row.layerId, 120);
  if (!sourceId) return null;
  const uncertaintyM =
    finite(row.uncertaintyM) && row.uncertaintyM >= 0 ? row.uncertaintyM : null;
  return {
    sourceId,
    sourceLabel:
      text(row.sourceLabel || row.label || row.name || row.source) || sourceId,
    kind: KINDS.has(row.kind) ? row.kind : 'unknown',
    applicableTime: stamp(row.applicableTime),
    retrievedAt: stamp(row.retrievedAt),
    extent: extentOf(row.extent),
    resolutionM:
      finite(row.resolutionM) && row.resolutionM > 0 ? row.resolutionM : null,
    uncertainty: uncertaintyM,
    // Keep the explicit unit when this presentation is projected again.
    uncertaintyM,
    coverage: COVERAGE.has(row.coverage) ? row.coverage : 'unknown',
    feedState: FEEDS.has(row.feedState) ? row.feedState : 'unknown',
    attribution: text(row.attribution, 1000) || null,
    license: text(row.license, 240) || null,
    // No arbitrary source URLs leave the Lens. A later admitted source can
    // expose a validated reference through its dedicated evidence adapter.
    link: null,
    scope: ['map', 'layer', 'selection'].includes(scope) ? scope : 'selection',
    feedUpdatedAt: row.feedUpdatedAt > 0 ? stamp(row.feedUpdatedAt) : null,
  };
}

/** Existing feed inventory; counts intentionally cannot imply local coverage. */
export function buildLensEvidence({
  selection,
  layers = [],
  mapSource = null,
  selectedSource = null,
} = {}) {
  if (!selection) return [];
  const map =
    mapSource &&
    normalizeLensEvidence({ ...mapSource, kind: 'imagery' }, 'map');
  const selected =
    selectedSource && normalizeLensEvidence(selectedSource, 'selection');
  const feeds = (Array.isArray(layers) ? layers : [])
    .filter((layer) => layer?.enabled)
    .slice(0, 80)
    .map((layer) => {
      const snapshot = layerSnapshot(layer);
      return normalizeLensEvidence(
        {
          sourceId: snapshot.id,
          sourceLabel: snapshot.source || snapshot.name,
          feedState: snapshot.feedState,
          feedUpdatedAt: snapshot.lastUpdate,
          kind: layer.evidence?.kind,
        },
        'layer',
      );
    });
  return [map, selected, ...feeds].filter(Boolean);
}
