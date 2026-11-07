/** Strict validation of a saved Kshitij horizon snapshot (analysis kind `horizon`). */
import {
  fields,
  fail,
  text,
  number,
  array,
  nullable,
  oneOf,
  timestamp,
  safeReference,
  jsonTree,
} from './fields.js';
import {
  HORIZON_SNAPSHOT_CLASSES,
  HORIZON_SNAPSHOT_METHOD,
} from '../horizon/snapshot.js';
import { HORIZON_LABEL, HORIZON_REFRACTION_K } from '../horizon/constants.js';

const maybeTime = (value, path) => nullable(value, path, timestamp);
const maybeNumber = (value, path, min, max) =>
  nullable(value, path, (v, p) => number(v, p, min, max));
const PEAK_STATES = ['skyline', 'visible', 'marginal'];

function degrees(values, path, min, max) {
  array(values, path, 360);
  if (values.length !== 360) fail(path, 'expected 360 whole-degree values');
  values.forEach((value, index) =>
    maybeNumber(value, `${path}[${index}]`, min, max),
  );
}
function observer(row, path) {
  fields(row, path, ['lat', 'lon', 'groundM', 'observerHeightM']);
  number(row.lat, `${path}.lat`, -85, 85);
  number(row.lon, `${path}.lon`, -180, 180);
  number(row.groundM, `${path}.groundM`, -500, 9000);
  number(row.observerHeightM, `${path}.observerHeightM`, 0, 500);
}
function events(row, path) {
  fields(row.sun, `${path}.sun`, [
    'astronomicalRise',
    'astronomicalSet',
    'terrainRise',
    'terrainSet',
    'directSunMinutes',
  ]);
  for (const key of [
    'astronomicalRise',
    'astronomicalSet',
    'terrainRise',
    'terrainSet',
  ])
    maybeTime(row.sun[key], `${path}.sun.${key}`);
  number(row.sun.directSunMinutes, `${path}.sun.directSunMinutes`, 0, 1500);
  fields(row.moon, `${path}.moon`, ['astronomicalRise', 'terrainRise']);
  maybeTime(row.moon.astronomicalRise, `${path}.moon.astronomicalRise`);
  maybeTime(row.moon.terrainRise, `${path}.moon.terrainRise`);
}
function shadow(row, at) {
  fields(row, at, [
    'at',
    'sunAltitudeDeg',
    'sunAzimuthDeg',
    'sunlit',
    'gnomonM',
    'shadowLengthM',
    'shadowAzimuthDeg',
  ]);
  timestamp(row.at, `${at}.at`);
  number(row.sunAltitudeDeg, `${at}.sunAltitudeDeg`, -90, 90);
  number(row.sunAzimuthDeg, `${at}.sunAzimuthDeg`, 0, 359);
  if (typeof row.sunlit !== 'boolean') fail(`${at}.sunlit`, 'expected boolean');
  number(row.gnomonM, `${at}.gnomonM`, Number.MIN_VALUE, 100);
  maybeNumber(row.shadowLengthM, `${at}.shadowLengthM`, 0, 100000);
  maybeNumber(row.shadowAzimuthDeg, `${at}.shadowAzimuthDeg`, 0, 359);
}
function peak(row, at) {
  fields(row, at, [
    'id',
    'name',
    'nameHi',
    'state',
    'azimuthDeg',
    'distanceKm',
    'apparentElevationDeg',
    'demM',
    'osmEleM',
  ]);
  if (typeof row.id !== 'string' || !/^node\/\d{1,15}$/.test(row.id))
    fail(`${at}.id`, 'expected an OSM node reference');
  text(row.name, `${at}.name`, 160);
  nullable(row.nameHi, `${at}.nameHi`, (v, p) => text(v, p, 160));
  oneOf(row.state, `${at}.state`, PEAK_STATES);
  number(row.azimuthDeg, `${at}.azimuthDeg`, 0, 359);
  number(row.distanceKm, `${at}.distanceKm`, 0, 200);
  number(row.apparentElevationDeg, `${at}.apparentElevationDeg`, -90, 90);
  number(row.demM, `${at}.demM`, -500, 9000);
  maybeNumber(row.osmEleM, `${at}.osmEleM`, -500, 9000);
}
function dem(row, path) {
  fields(row, path, [
    'sourceId',
    'label',
    'attribution',
    'license',
    'link',
    'applicableTime',
    'retrievedAt',
    'voidSamples',
    'absentTiles',
    'radiusKm',
  ]);
  oneOf(row.sourceId, `${path}.sourceId`, ['copernicus-glo30']);
  text(row.label, `${path}.label`, 256);
  text(row.attribution, `${path}.attribution`, 600);
  text(row.license, `${path}.license`, 256);
  safeReference(row.link, `${path}.link`);
  text(row.applicableTime, `${path}.applicableTime`, 128);
  maybeTime(row.retrievedAt, `${path}.retrievedAt`);
  number(row.voidSamples, `${path}.voidSamples`, 0, 10000000);
  number(row.absentTiles, `${path}.absentTiles`, 0, 64);
  number(row.radiusKm, `${path}.radiusKm`, 10, 200);
}
function peakSource(row, at) {
  fields(row, at, ['label', 'license', 'attribution', 'extractAt']);
  text(row.label, `${at}.label`, 256);
  text(row.license, `${at}.license`, 64);
  text(row.attribution, `${at}.attribution`, 256);
  timestamp(row.extractAt, `${at}.extractAt`);
}

export function validateHorizonSnapshot(row, path = '$.snapshot') {
  jsonTree(row);
  fields(row, path, [
    'version',
    'capturedAt',
    'localDate',
    'timeZone',
    'label',
    'method',
    'refractionK',
    'observer',
    'horizon',
    'sun',
    'moon',
    'shadow',
    'peaks',
    'dem',
    'peakSource',
    'classes',
  ]);
  oneOf(row.version, `${path}.version`, [1]);
  timestamp(row.capturedAt, `${path}.capturedAt`);
  if (
    typeof row.localDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate)
  )
    fail(`${path}.localDate`, 'expected calendar date');
  text(row.timeZone, `${path}.timeZone`, 128);
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timeZone });
  } catch {
    fail(`${path}.timeZone`, 'unknown time zone');
  }
  oneOf(row.label, `${path}.label`, [HORIZON_LABEL]);
  oneOf(row.method, `${path}.method`, [HORIZON_SNAPSHOT_METHOD]);
  oneOf(row.refractionK, `${path}.refractionK`, [HORIZON_REFRACTION_K]);
  if (JSON.stringify(row.classes) !== JSON.stringify(HORIZON_SNAPSHOT_CLASSES))
    fail(`${path}.classes`, 'unexpected class table');
  observer(row.observer, `${path}.observer`);
  fields(row.horizon, `${path}.horizon`, ['elevationDeg', 'distanceKm']);
  degrees(row.horizon.elevationDeg, `${path}.horizon.elevationDeg`, -90, 90);
  degrees(row.horizon.distanceKm, `${path}.horizon.distanceKm`, 0, 200);
  events(row, path);
  nullable(row.shadow, `${path}.shadow`, shadow);
  array(row.peaks, `${path}.peaks`, 20);
  row.peaks.forEach((entry, index) => peak(entry, `${path}.peaks[${index}]`));
  dem(row.dem, `${path}.dem`);
  nullable(row.peakSource, `${path}.peakSource`, peakSource);
  return row;
}
