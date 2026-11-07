/**
 * The `peaks` region-pack theme: OSM `natural=peak` nodes with `name`,
 * `name:hi` and `ele`, for naming the summits on a computed horizon.
 * Strict admission like the core pack; this module never fetches.
 */
import { validateAssetPath } from '../director/packs/manifest.js';

/**
 * Caps: the core pack's 4 MiB and 10,000-feature ceilings apply unchanged.
 * A skyline gazetteer needs the horizon radius (200 km) around its region,
 * so its extent cap is 500 km per side instead of the core pack's 10 km.
 */
export const PEAK_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  features: 10000,
  sideKm: 500,
});
export const PEAK_SOURCE_URL =
  'https://download.geofabrik.de/asia/india/central-zone.html';
const fail = (reason) => {
  throw new Error(`Invalid peaks pack: ${reason}`);
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
function text(value, max = 240) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    fail('text');
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
    fail('count');
}
function stamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('timestamp');
}
export function validatePeakExtent(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite) ||
    value[0] >= value[2] ||
    value[1] >= value[3] ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[2]) > 180 ||
    Math.abs(value[1]) > 85 ||
    Math.abs(value[3]) > 85
  )
    fail('extent');
  const width =
      (value[2] - value[0]) *
      111.32 *
      Math.cos((((value[1] + value[3]) / 2) * Math.PI) / 180),
    height = (value[3] - value[1]) * 111.32;
  if (width > PEAK_LIMITS.sideKm || height > PEAK_LIMITS.sideKm)
    fail('extent exceeds limit');
}
export function validatePeaksManifest(value) {
  fields(value, [
    'version',
    'id',
    'theme',
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
    value.theme !== 'peaks' ||
    !/^[-a-z0-9]{1,80}$/.test(value.id) ||
    value.coverage !== 'partial'
  )
    fail('identity');
  text(value.name);
  validatePeakExtent(value.extent);
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
    value.source.url !== PEAK_SOURCE_URL
  )
    fail('source');
  text(value.source.label);
  stamp(value.source.extractAt);
  stamp(value.source.retrievedAt);
  if (!/^[a-f0-9]{64}$/.test(value.source.extractSha256)) fail('digest');
  fields(value.license, ['id', 'url', 'attribution']);
  if (
    value.license.id !== 'ODbL-1.0' ||
    value.license.url !== 'https://opendatacommons.org/licenses/odbl/1-0/'
  )
    fail('license');
  text(value.license.attribution);
  if (!Array.isArray(value.assets) || value.assets.length !== 1)
    fail('assets');
  const [asset] = value.assets;
  fields(asset, ['id', 'path', 'format', 'byteLength', 'sha256']);
  validateAssetPath(asset.path);
  if (
    asset.id !== 'peaks' ||
    asset.path !== 'peaks.json' ||
    asset.format !== 'peak-gazetteer'
  )
    fail('asset');
  if (
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength < 1 ||
    asset.byteLength > PEAK_LIMITS.bytes ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    fail('asset size');
  fields(value.counts, [
    'peaks',
    'withElevation',
    'withHindiName',
    'skippedUnnamed',
  ]);
  Object.values(value.counts).forEach(count);
  if (
    value.counts.peaks > PEAK_LIMITS.features ||
    value.counts.withElevation > value.counts.peaks ||
    value.counts.withHindiName > value.counts.peaks
  )
    fail('counts');
  if (
    !Array.isArray(value.limitations) ||
    !value.limitations.length ||
    value.limitations.length > 12
  )
    fail('limitations');
  value.limitations.forEach((note) => text(note, 600));
  return JSON.parse(JSON.stringify(value));
}

/** Validate the gazetteer body against its manifest; returns entries. */
export function validatePeakGazetteer(value, manifest) {
  fields(value, ['version', 'entries']);
  if (value.version !== 1 || !Array.isArray(value.entries)) fail('gazetteer');
  if (value.entries.length > PEAK_LIMITS.features) fail('feature limit');
  const [west, south, east, north] = manifest.extent;
  let previous = '',
    withElevation = 0,
    withHindiName = 0;
  for (const entry of value.entries) {
    fields(entry, ['id', 'name', 'nameHi', 'eleM', 'lat', 'lon']);
    if (!/^node\/\d{1,15}$/.test(entry.id) || entry.id <= previous)
      fail('peak id');
    previous = entry.id;
    text(entry.name, 160);
    if (entry.nameHi !== null) {
      text(entry.nameHi, 160);
      withHindiName++;
    }
    if (entry.eleM !== null) {
      if (
        !Number.isFinite(entry.eleM) ||
        entry.eleM < -500 ||
        entry.eleM > 9000
      )
        fail('elevation');
      withElevation++;
    }
    if (
      !Number.isFinite(entry.lat) ||
      !Number.isFinite(entry.lon) ||
      entry.lon < west ||
      entry.lon > east ||
      entry.lat < south ||
      entry.lat > north
    )
      fail('position');
  }
  if (
    manifest.counts.peaks !== value.entries.length ||
    manifest.counts.withElevation !== withElevation ||
    manifest.counts.withHindiName !== withHindiName
  )
    fail('counts');
  return value.entries.map((entry) => ({ ...entry }));
}

async function digestHex(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify local manifest and bytes; returns `{ manifest, entries }`. */
export async function verifyPeaksPack(
  value,
  bytes,
  { digest = digestHex } = {},
) {
  const manifest = validatePeaksManifest(value);
  const [asset] = manifest.assets;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteLength)
    fail('asset length');
  if ((await digest(bytes)) !== asset.sha256) fail('asset digest');
  const parsed = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  return { manifest, entries: validatePeakGazetteer(parsed, manifest) };
}

/** Source record a horizon result carries for its peak names. */
export function peakSourceRecord(manifest) {
  return {
    id: 'osm-peaks',
    label: `OpenStreetMap natural=peak (${manifest.name})`,
    license: manifest.license.id,
    attribution: manifest.license.attribution,
    link: 'https://www.openstreetmap.org/copyright',
    retrievedAt: manifest.source.retrievedAt,
    extractAt: manifest.source.extractAt,
    extent: [...manifest.extent],
  };
}
