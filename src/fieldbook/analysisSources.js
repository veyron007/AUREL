/** Admitted scientific envelopes only. Imported snapshots cannot carry hidden fields. */
import { validateFieldContextPayload } from '../sources/fieldContextModel.js';
import {
  fields,
  fail,
  text,
  number,
  integer,
  array,
  nullable,
  oneOf,
  timestamp,
} from './fields.js';

export function sameProjection(value, normalized) {
  if (value === normalized) return true;
  if (
    !value ||
    !normalized ||
    typeof value !== 'object' ||
    typeof normalized !== 'object' ||
    Array.isArray(value) !== Array.isArray(normalized)
  )
    return false;
  const keys = Object.keys(value);
  return (
    keys.length === Object.keys(normalized).length &&
    keys.every(
      (key) =>
        Object.hasOwn(normalized, key) &&
        sameProjection(value[key], normalized[key]),
    )
  );
}
export function validateSavedFieldContext(value, path) {
  let admitted;
  try {
    admitted = validateFieldContextPayload(value);
  } catch {
    fail(path, 'invalid forecast context');
  }
  if (!sameProjection(value, admitted))
    fail(path, 'unsupported forecast context fields or metadata');
}
const FIRE_SOURCES = [
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'VIIRS_SNPP_NRT',
  'MODIS_NRT',
];
export function validateSavedFireContext(value, path) {
  fields(value, path, [
    'status',
    'source',
    'fetchedAt',
    'window',
    'bounds',
    'sources',
    'matchedCount',
    'count',
    'truncated',
    'observations',
    'limitations',
  ]);
  oneOf(value.status, `${path}.status`, [
    'ok',
    'partial',
    'stale',
    'unavailable',
    'needs-key',
  ]);
  oneOf(value.source, `${path}.source`, ['NASA FIRMS']);
  nullable(value.fetchedAt, `${path}.fetchedAt`, (v, p) =>
    number(v, p, 0, 8640000000000000),
  );
  fields(value.window, `${path}.window`, ['start', 'end']);
  timestamp(value.window.start, `${path}.window.start`);
  timestamp(value.window.end, `${path}.window.end`);
  if (
    Date.parse(value.window.end) < Date.parse(value.window.start) ||
    Date.parse(value.window.end) - Date.parse(value.window.start) > 24 * 3600000
  )
    fail(`${path}.window`, 'invalid observation window');
  fields(value.bounds, `${path}.bounds`, ['west', 'south', 'east', 'north']);
  const { west, south, east, north } = value.bounds;
  number(west, `${path}.bounds.west`, -180, 180);
  number(east, `${path}.bounds.east`, -180, 180);
  number(south, `${path}.bounds.south`, -90, 90);
  number(north, `${path}.bounds.north`, -90, 90);
  const width = east >= west ? east - west : 360 - west + east;
  if (width > 2 || east <= west || north <= south || north - south > 2)
    fail(`${path}.bounds`, 'area exceeds bounded context');
  array(value.sources, `${path}.sources`, 4);
  for (const row of value.sources) {
    fields(row, `${path}.sources`, ['id', 'status', 'count']);
    oneOf(row.id, `${path}.sources.id`, FIRE_SOURCES);
    oneOf(row.status, `${path}.sources.status`, [
      'ok',
      'partial',
      'unavailable',
      'rate-limited',
      'timeout',
      'invalid-response',
    ]);
    integer(row.count, `${path}.sources.count`, 0, 1000000);
  }
  if (new Set(value.sources.map((row) => row.id)).size !== value.sources.length)
    fail(`${path}.sources`, 'duplicate source');
  integer(value.matchedCount, `${path}.matchedCount`, 0, 1000000);
  integer(value.count, `${path}.count`, 0, 500);
  if (typeof value.truncated !== 'boolean')
    fail(`${path}.truncated`, 'expected truncation flag');
  array(value.observations, `${path}.observations`, 500);
  if (
    value.count !== value.observations.length ||
    value.matchedCount < value.count
  )
    fail(path, 'observation counts do not match');
  if (value.truncated !== value.matchedCount > value.count)
    fail(path, 'truncation does not match observation count');
  for (const [i, row] of value.observations.entries()) {
    const at = `${path}.observations[${i}]`;
    fields(row, at, [
      'id',
      'lat',
      'lon',
      'acquiredAt',
      'sensor',
      'satellite',
      'confidence',
      'frpMw',
      'source',
    ]);
    text(row.id, `${at}.id`, 160);
    number(row.lat, `${at}.lat`, -90, 90);
    number(row.lon, `${at}.lon`, -180, 180);
    if (
      row.lat < south ||
      row.lat > north ||
      !(west <= east
        ? row.lon >= west && row.lon <= east
        : row.lon >= west || row.lon <= east)
    )
      fail(at, 'observation outside requested area');
    timestamp(row.acquiredAt, `${at}.acquiredAt`);
    if (
      Date.parse(row.acquiredAt) < Date.parse(value.window.start) ||
      Date.parse(row.acquiredAt) > Date.parse(value.window.end)
    )
      fail(at, 'observation outside requested time window');
    for (const [name, limit] of [
      ['sensor', 32],
      ['satellite', 32],
      ['confidence', 16],
    ])
      if (row[name] !== '') text(row[name], `${at}.${name}`, limit);
    number(row.frpMw, `${at}.frpMw`, 0, 1000000);
    oneOf(row.source, `${at}.source`, FIRE_SOURCES);
  }
  array(value.limitations, `${path}.limitations`, 5);
  value.limitations.forEach((entry) => text(entry, `${path}.limitations`, 240));
  if (
    ['unavailable', 'needs-key'].includes(value.status) &&
    (value.fetchedAt !== null || value.count !== 0)
  )
    fail(path, 'unavailable context cannot contain observations');
  if (
    ['ok', 'partial', 'stale'].includes(value.status) &&
    value.fetchedAt === null
  )
    fail(path, 'available context requires retrieval time');
  if (
    value.status === 'ok' &&
    (!value.sources.length || value.sources.some((row) => row.status !== 'ok'))
  )
    fail(path, 'source statuses do not support available context');
  if (
    value.status === 'partial' &&
    !value.sources.some((row) => ['ok', 'partial'].includes(row.status))
  )
    fail(path, 'partial context requires an available source');
}
