/** Bounded historical route/place context. No renderer objects or arbitrary payloads. */
import {
  fields,
  fail,
  text,
  id,
  number,
  array,
  nullable,
  oneOf,
  timestamp,
  geometry,
  safeReference,
  jsonTree,
} from './fields.js';
import {
  validateSavedFieldContext,
  validateSavedFireContext,
} from './analysisSources.js';
import { validateSavedMountainWeather } from './mountainWeatherSnapshot.js';

export const SOLAR_METHOD =
  'USNO low-precision solar position; standard -0.833° sunrise and -6° civil twilight; no terrain horizon';
const maybeTime = (value, path) => nullable(value, path, timestamp);
const maybeNumber = (value, path, min, max) =>
  nullable(value, path, (v, p) => number(v, p, min, max));
const maybeText = (value, path) =>
  nullable(value, path, (v, p) => text(v, p, 4096));
function point(row, path) {
  number(row.lat, `${path}.lat`, -90, 90);
  number(row.lon, `${path}.lon`, -180, 180);
}
function route(row, path, budget) {
  fields(row, path, [
    'name',
    'geometry',
    'mode',
    'distanceM',
    'durationS',
    'retrievedAt',
  ]);
  text(row.name, `${path}.name`);
  text(row.mode, `${path}.mode`, 64);
  geometry(row.geometry, `${path}.geometry`, budget, ['LineString']);
  maybeNumber(row.distanceM, `${path}.distanceM`, 0, 100000000);
  maybeNumber(row.durationS, `${path}.durationS`, 0, 31536000);
  maybeTime(row.retrievedAt, `${path}.retrievedAt`);
}
function profile(row, path) {
  fields(row, path, [
    'datum',
    'samples',
    'minM',
    'maxM',
    'sampleSpacingM',
    'resolutionM',
    'complete',
    'sourceId',
    'sourceLabel',
    'retrievedAt',
    'attribution',
    'license',
    'link',
    'datasetVersions',
  ]);
  oneOf(row.datum, `${path}.datum`, ['EGM2008']);
  array(row.samples, `${path}.samples`, 256);
  if (!row.samples.length) fail(path, 'profile requires samples');
  let prior = -1;
  for (const [i, sample] of row.samples.entries()) {
    const at = `${path}.samples[${i}]`;
    fields(sample, at, ['distanceM', 'lat', 'lon', 'elevationM']);
    point(sample, at);
    number(sample.distanceM, `${at}.distanceM`, 0, 100000000);
    if (sample.distanceM < prior) fail(at, 'profile distance is not ordered');
    prior = sample.distanceM;
    maybeNumber(sample.elevationM, `${at}.elevationM`, -12000, 10000);
  }
  const elevations = row.samples
    .map((s) => s.elevationM)
    .filter((v) => v !== null);
  if (
    row.minM !== (elevations.length ? Math.min(...elevations) : null) ||
    row.maxM !== (elevations.length ? Math.max(...elevations) : null)
  )
    fail(path, 'profile extrema do not match supplied samples');
  if (
    typeof row.complete !== 'boolean' ||
    row.complete !== (elevations.length === row.samples.length)
  )
    fail(path, 'profile completeness does not match supplied samples');
  number(row.sampleSpacingM, `${path}.sampleSpacingM`, 0, 100000000);
  maybeNumber(
    row.resolutionM,
    `${path}.resolutionM`,
    Number.MIN_VALUE,
    40000000,
  );
  text(row.sourceId, `${path}.sourceId`, 256);
  text(row.sourceLabel, `${path}.sourceLabel`, 4096);
  array(row.datasetVersions, `${path}.datasetVersions`, 16);
  row.datasetVersions.forEach((v) => text(v, `${path}.datasetVersions`, 128));
  maybeTime(row.retrievedAt, `${path}.retrievedAt`);
  maybeText(row.attribution, `${path}.attribution`);
  maybeText(row.license, `${path}.license`);
  nullable(row.link, `${path}.link`, safeReference);
}
function daylight(row, path) {
  fields(row, path, [
    'sunrise',
    'sunset',
    'civilDawn',
    'civilDusk',
    'daylightSeconds',
    'polarState',
    'method',
  ]);
  for (const name of ['sunrise', 'sunset', 'civilDawn', 'civilDusk'])
    maybeTime(row[name], `${path}.${name}`);
  maybeNumber(row.daylightSeconds, `${path}.daylightSeconds`, 0, 26 * 3600);
  oneOf(row.polarState, `${path}.polarState`, [
    'normal',
    'polar-day',
    'polar-night',
    'transition',
  ]);
  oneOf(row.method, `${path}.method`, [SOLAR_METHOD]);
}
export function validateAnalysisSnapshot(
  row,
  path = '$.snapshot',
  budget = { points: 0 },
) {
  jsonTree(row);
  fields(row, path, [
    'version',
    'capturedAt',
    'route',
    'departureAt',
    'timeZone',
    'localDate',
    'profile',
    'daylight',
    'checkpoints',
    'fireContext',
  ]);
  oneOf(row.version, `${path}.version`, [1]);
  timestamp(row.capturedAt, `${path}.capturedAt`);
  maybeTime(row.departureAt, `${path}.departureAt`);
  text(row.timeZone, `${path}.timeZone`, 128);
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timeZone });
  } catch {
    fail(`${path}.timeZone`, 'unknown time zone');
  }
  if (
    typeof row.localDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate)
  )
    fail(`${path}.localDate`, 'expected calendar date');
  timestamp(`${row.localDate}T00:00:00.000Z`, `${path}.localDate`);
  nullable(row.route, `${path}.route`, (v, p) => route(v, p, budget));
  nullable(row.profile, `${path}.profile`, profile);
  nullable(row.daylight, `${path}.daylight`, daylight);
  array(row.checkpoints, `${path}.checkpoints`, 5);
  for (const [i, entry] of row.checkpoints.entries()) {
    const at = `${path}.checkpoints[${i}]`;
    fields(entry, at, [
      'lat',
      'lon',
      'distanceM',
      'context',
      ...(Object.hasOwn(entry ?? {}, 'mountainWeather')
        ? ['mountainWeather']
        : []),
    ]);
    point(entry, at);
    number(entry.distanceM, `${at}.distanceM`, 0, 100000000);
    validateSavedFieldContext(entry.context, `${at}.context`);
    if (
      entry.context.requested.lat !== entry.lat ||
      entry.context.requested.lon !== entry.lon
    )
      fail(at, 'context belongs to another checkpoint');
    if (Object.hasOwn(entry, 'mountainWeather'))
      validateSavedMountainWeather(
        entry.mountainWeather,
        `${at}.mountainWeather`,
        entry,
      );
  }
  nullable(row.fireContext, `${path}.fireContext`, validateSavedFireContext);
  return row;
}
export function validateAnalysis(entry, path, budget) {
  fields(entry, path, ['id', 'subjectId', 'kind', 'createdAt', 'snapshot']);
  id(entry.subjectId, `${path}.subjectId`);
  oneOf(entry.kind, `${path}.kind`, ['route-context']);
  timestamp(entry.createdAt, `${path}.createdAt`);
  validateAnalysisSnapshot(entry.snapshot, `${path}.snapshot`, budget);
}
