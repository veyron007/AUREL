import { validateAssetPath } from '../director/packs/manifest.js';

export const REGION_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  features: 10000,
  positions: 100000,
  names: 10000,
  sideKm: 10,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (reason) => {
  throw new Error(`Invalid local region pack: ${reason}`);
};
function fields(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    fail('fields');
}
function string(value, max = 240, empty = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    fail('text');
}
function integer(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('count');
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    fail('timestamp');
}
function hash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('digest');
}
export function validateRegionExtent(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite) ||
    value[0] >= value[2] ||
    value[1] >= value[3] ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[2]) > 180 ||
    Math.abs(value[1]) > 90 ||
    Math.abs(value[3]) > 90
  )
    fail('extent');
  const width =
      (value[2] - value[0]) *
      111.32 *
      Math.cos((((value[1] + value[3]) / 2) * Math.PI) / 180),
    height = (value[3] - value[1]) * 111.32;
  if (width > REGION_LIMITS.sideKm || height > REGION_LIMITS.sideKm)
    fail('extent exceeds limit');
}
function point(value, bounds) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(Number.isFinite) ||
    value[0] < bounds[0] ||
    value[0] > bounds[2] ||
    value[1] < bounds[1] ||
    value[1] > bounds[3]
  )
    fail('position');
}
function aliases(value) {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    new Set(value).size !== value.length
  )
    fail('aliases');
  value.forEach((name) => string(name, 160));
}
const KINDS = ['road', 'building', 'water', 'place'];
const COUNT_KEYS = [
  'features',
  'positions',
  'names',
  'roads',
  'buildings',
  'water',
  'places',
  'suppliedHeights',
];
/** Metadata preview is independent of acquisition or rendering; paths are local asset names only. */
export function validateRegionManifest(value) {
  fields(value, [
    'version',
    'id',
    'name',
    'extent',
    'source',
    'license',
    'assets',
    'counts',
    'coverage',
    'limitations',
  ]);
  if (
    value.version !== 1 ||
    !/^[-a-z0-9]{1,80}$/.test(value.id) ||
    value.coverage !== 'partial'
  )
    fail('identity');
  string(value.id, 80);
  string(value.name);
  validateRegionExtent(value.extent);
  fields(value.source, [
    'id',
    'label',
    'url',
    'extractAt',
    'retrievedAt',
    'extractSha256',
  ]);
  if (
    value.source.id !== 'openstreetmap-geofabrik' ||
    value.source.url !==
      'https://download.geofabrik.de/asia/india/central-zone.html'
  )
    fail('source');
  string(value.source.label);
  timestamp(value.source.extractAt);
  timestamp(value.source.retrievedAt);
  hash(value.source.extractSha256);
  if (Date.parse(value.source.extractAt) > Date.parse(value.source.retrievedAt))
    fail('source date');
  fields(value.license, ['id', 'url', 'attribution']);
  if (
    value.license.id !== 'ODbL-1.0' ||
    value.license.url !== 'https://opendatacommons.org/licenses/odbl/1-0/'
  )
    fail('license');
  string(value.license.attribution);
  if (!Array.isArray(value.assets) || value.assets.length !== 2) fail('assets');
  const specs = {
    geometry: ['geometry.geojson', 'geojson'],
    names: ['names.json', 'name-index'],
  };
  let bytes = 0;
  const ids = new Set();
  for (const asset of value.assets) {
    fields(asset, ['id', 'path', 'format', 'byteLength', 'sha256']);
    validateAssetPath(asset.path);
    if (
      ids.has(asset.id) ||
      !specs[asset.id] ||
      asset.path !== specs[asset.id][0] ||
      asset.format !== specs[asset.id][1]
    )
      fail('asset');
    ids.add(asset.id);
    integer(asset.byteLength, REGION_LIMITS.bytes);
    if (!asset.byteLength) fail('asset length');
    bytes += asset.byteLength;
    hash(asset.sha256);
  }
  if (bytes > REGION_LIMITS.bytes) fail('asset size');
  fields(value.counts, COUNT_KEYS);
  for (const key of COUNT_KEYS)
    integer(
      value.counts[key],
      key === 'positions' ? REGION_LIMITS.positions : REGION_LIMITS.features,
    );
  if (
    value.counts.features !==
      value.counts.roads +
        value.counts.buildings +
        value.counts.water +
        value.counts.places ||
    value.counts.names > value.counts.features ||
    value.counts.suppliedHeights > value.counts.buildings
  )
    fail('counts');
  if (
    !Array.isArray(value.limitations) ||
    !value.limitations.length ||
    value.limitations.length > 12
  )
    fail('limitations');
  value.limitations.forEach((note) => string(note, 600));
  return copy(value);
}
function properties(feature) {
  const p = feature.properties;
  fields(p, [
    'kind',
    'name',
    'aliases',
    'osmId',
    'osmType',
    'category',
    'heightM',
    'heightSource',
  ]);
  string(p.osmId, 18);
  if (
    !KINDS.includes(p.kind) ||
    !['node', 'way', 'relation'].includes(p.osmType) ||
    !/^\d{1,18}$/.test(p.osmId) ||
    feature.id !== `${p.osmType}/${p.osmId}`
  )
    fail('feature identity');
  string(p.name, 160, true);
  string(p.category, 80, true);
  aliases(p.aliases);
  if (p.heightM === null) {
    if (p.heightSource !== null) fail('height provenance');
  } else if (
    p.kind !== 'building' ||
    !Number.isFinite(p.heightM) ||
    p.heightM <= 0 ||
    p.heightM > 1000 ||
    p.heightSource !== 'height'
  )
    fail('height provenance');
}
function validateGeometry(collection, manifest) {
  fields(collection, ['type', 'features']);
  if (
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features) ||
    collection.features.length > REGION_LIMITS.features
  )
    fail('collection');
  const byId = new Map(),
    counts = {
      features: collection.features.length,
      positions: 0,
      names: 0,
      roads: 0,
      buildings: 0,
      water: 0,
      places: 0,
      suppliedHeights: 0,
    };
  for (const f of collection.features) {
    fields(f, ['type', 'id', 'properties', 'geometry']);
    if (f.type !== 'Feature' || byId.has(f.id)) fail('feature');
    properties(f);
    counts[
      { road: 'roads', building: 'buildings', water: 'water', place: 'places' }[
        f.properties.kind
      ]
    ]++;
    if (f.properties.name) counts.names++;
    if (f.properties.heightM !== null) counts.suppliedHeights++;
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    function position(p) {
      point(p, manifest.extent);
      if (++counts.positions > REGION_LIMITS.positions) fail('position limit');
      bounds[0] = Math.min(bounds[0], p[0]);
      bounds[1] = Math.min(bounds[1], p[1]);
      bounds[2] = Math.max(bounds[2], p[0]);
      bounds[3] = Math.max(bounds[3], p[1]);
    }
    function line(points, ring = false) {
      if (!Array.isArray(points) || points.length < (ring ? 4 : 2))
        fail('line');
      points.forEach(position);
      if (
        ring &&
        (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])
      )
        fail('unclosed ring');
    }
    fields(f.geometry, ['type', 'coordinates']);
    const g = f.geometry;
    if (g.type === 'Point') position(g.coordinates);
    else if (g.type === 'LineString') line(g.coordinates);
    else if (g.type === 'Polygon') {
      if (
        !Array.isArray(g.coordinates) ||
        !g.coordinates.length ||
        g.coordinates.length > 128
      )
        fail('polygon');
      g.coordinates.forEach((ring) => line(ring, true));
    } else if (g.type === 'MultiPolygon') {
      if (
        !Array.isArray(g.coordinates) ||
        !g.coordinates.length ||
        g.coordinates.length > 128
      )
        fail('multipolygon');
      g.coordinates.forEach((polygon) => {
        if (!Array.isArray(polygon) || !polygon.length || polygon.length > 128)
          fail('polygon');
        polygon.forEach((ring) => line(ring, true));
      });
    } else fail('geometry');
    if (
      (f.properties.kind === 'building' &&
        !['Polygon', 'MultiPolygon'].includes(g.type)) ||
      (f.properties.kind === 'road' && g.type !== 'LineString')
    )
      fail('geometry kind');
    byId.set(f.id, { feature: f, bounds });
  }
  for (const key of COUNT_KEYS)
    if (counts[key] !== manifest.counts[key]) fail('count mismatch');
  return byId;
}
function validateIndex(index, manifest, byId) {
  fields(index, ['version', 'entries']);
  if (
    index.version !== 1 ||
    !Array.isArray(index.entries) ||
    index.entries.length !== manifest.counts.names
  )
    fail('index');
  const ids = new Set();
  for (const entry of index.entries) {
    fields(entry, ['id', 'name', 'aliases', 'kind', 'coordinates']);
    const found = byId.get(entry.id);
    if (!found || ids.has(entry.id) || !found.feature.properties.name)
      fail('index reference');
    ids.add(entry.id);
    const p = found.feature.properties;
    if (
      entry.name !== p.name ||
      entry.kind !== p.kind ||
      JSON.stringify(entry.aliases) !== JSON.stringify(p.aliases)
    )
      fail('index metadata');
    point(entry.coordinates, found.bounds);
  }
}
async function digestHex(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
/** Verify supplied local bytes before anything can be enabled; this function never fetches. */
export async function verifyRegionPack(
  value,
  assets,
  { digest = digestHex } = {},
) {
  const manifest = validateRegionManifest(value),
    parsed = {};
  for (const asset of manifest.assets) {
    const bytes = assets?.[asset.id];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteLength)
      fail('asset length');
    if ((await digest(bytes)) !== asset.sha256) fail('asset digest');
    parsed[asset.id] = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  }
  const byId = validateGeometry(parsed.geometry, manifest);
  validateIndex(parsed.names, manifest, byId);
  return { manifest, geojson: parsed.geometry, index: parsed.names };
}
const normalized = (value) =>
  String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/gu, ' ');
/** Search only the already verified local index, with no network fallback. */
export function searchRegionNames(index, query, { limit = 8 } = {}) {
  if (
    typeof query !== 'string' ||
    query.length > 160 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    return [];
  const needle = normalized(query);
  if (!needle) return [];
  return (index?.entries || [])
    .slice(0, REGION_LIMITS.names)
    .flatMap((entry) => {
      const labels = [entry.name, ...entry.aliases].map(normalized);
      const score = labels.some((name) => name === needle)
        ? 0
        : labels.some((name) => name.startsWith(needle))
          ? 1
          : labels.some((name) => name.includes(needle))
            ? 2
            : 3;
      return score < 3 ? [{ entry, score }] : [];
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.entry.name.localeCompare(b.entry.name) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, limit)
    .map(({ entry }) => copy(entry));
}
