/**
 * @module airQuality/stations
 *
 * Validation and presentation for the same-site `/api/air-quality` payload.
 * Pure. Codes, not prose: views translate state ids and category labels.
 *
 * Two tiers stay separate all the way to the screen: reference monitors
 * (observed, regulatory) and citizen sensors (observed, uncalibrated). The
 * CAMS model card is a third, separate source owned by field context and is
 * never read here.
 */
import {
  POLLUTANTS,
  computeNaqi,
  computeUsAqi,
  NAQI_CATEGORIES,
  unitLabel,
  US_AQI_CATEGORIES,
} from './naqi.js';

export const STATION_STATES = Object.freeze([
  'ok',
  'partial',
  'stale',
  'no-monitor',
  'no-data',
  'needs-key',
  'blocked',
  'rate-limited',
  'unavailable',
  'invalid-response',
]);
export const CITIZEN_STATES = Object.freeze([
  'ok',
  'stale',
  'no-sensor',
  'disabled',
  'rate-limited',
  'unavailable',
  'invalid-response',
]);
const DETAIL_STATES = new Set([...STATION_STATES, 'invalid-request']);

const invalid = () => new TypeError('Invalid air-quality payload');
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const isoOrNull = (value) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw invalid();
  return new Date(value).toISOString();
};
const textOrNull = (value, max = 200) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
};
const point = (value) => {
  if (!isObject(value) || !finite(value.lat, -90, 90)) throw invalid();
  if (!finite(value.lon, -180, 180)) throw invalid();
  return { lat: value.lat, lon: value.lon };
};

function latestRow(row) {
  if (!isObject(row) || !Object.hasOwn(POLLUTANTS, row.pollutant))
    throw invalid();
  if (!finite(row.value, 0, 1e6) || !unitLabel(row.unit)) throw invalid();
  return {
    pollutant: row.pollutant,
    sensorId: Number.isSafeInteger(row.sensorId) ? row.sensorId : null,
    value: row.value,
    unit: row.unit,
    observedAt: isoOrNull(row.observedAt),
  };
}

function stationRow(row) {
  if (!isObject(row) || typeof row.id !== 'string') throw invalid();
  if (!/^openaq:\d{1,12}$/.test(row.id)) throw invalid();
  const { lat, lon } = point(row);
  if (!Array.isArray(row.sensors) || !Array.isArray(row.latest))
    throw invalid();
  return {
    id: row.id,
    name: textOrNull(row.name) ?? row.id,
    locality: textOrNull(row.locality),
    owner: textOrNull(row.owner),
    dataProvider: textOrNull(row.dataProvider),
    lat,
    lon,
    distanceM: finite(row.distanceM, 0, 1e7) ? row.distanceM : null,
    licenses: Array.isArray(row.licenses)
      ? row.licenses.filter((x) => typeof x === 'string').slice(0, 4)
      : [],
    lastObservedAt: isoOrNull(row.lastObservedAt ?? null),
    sensors: row.sensors
      .filter(
        (s) =>
          isObject(s) &&
          Number.isSafeInteger(s.sensorId) &&
          Object.hasOwn(POLLUTANTS, s.pollutant) &&
          unitLabel(s.unit),
      )
      .map((s) => ({
        sensorId: s.sensorId,
        pollutant: s.pollutant,
        unit: s.unit,
      })),
    latest: row.latest.slice(0, 16).map(latestRow),
  };
}

function hoursRows(rows) {
  if (!Array.isArray(rows) || rows.length > 60) throw invalid();
  return rows.map((row) => {
    if (!isObject(row) || !Number.isFinite(row.endMs)) throw invalid();
    if (!finite(row.value, 0, 1e6) || !unitLabel(row.unit)) throw invalid();
    return {
      endMs: row.endMs,
      value: row.value,
      unit: row.unit,
      flagged: row.flagged === true,
    };
  });
}

function detailBlock(value) {
  if (value === null) return null;
  if (!isObject(value) || !DETAIL_STATES.has(value.state)) throw invalid();
  if (!isObject(value.series)) throw invalid();
  const series = {};
  for (const [pollutant, rows] of Object.entries(value.series)) {
    if (!Object.hasOwn(POLLUTANTS, pollutant)) throw invalid();
    series[pollutant] = hoursRows(rows);
  }
  return {
    stationId: textOrNull(value.stationId),
    state: value.state,
    reason: textOrNull(value.reason),
    retrievedAt: isoOrNull(value.retrievedAt),
    series,
  };
}

function citizenRow(row) {
  if (!isObject(row) || typeof row.id !== 'string') throw invalid();
  if (!/^sensor-community:\d{1,12}$/.test(row.id)) throw invalid();
  const { lat, lon } = point(row);
  const pm = (v) => {
    if (v === null) return null;
    if (!finite(v, 0, 2000)) throw invalid();
    return v;
  };
  return {
    id: row.id,
    lat,
    lon,
    distanceM: finite(row.distanceM, 0, 1e7) ? row.distanceM : null,
    sensorType: textOrNull(row.sensorType, 40),
    pm25: pm(row.pm25 ?? null),
    pm10: pm(row.pm10 ?? null),
    observedAt: isoOrNull(row.observedAt),
  };
}

/**
 * Validate a `/api/air-quality/near` response into a fresh, bounded copy.
 * @throws {TypeError} on any structural problem.
 */
export function validateBreathPayload(value) {
  if (!isObject(value) || value.version !== 1) throw invalid();
  const stations = value.stations;
  const citizen = value.citizen;
  if (!isObject(stations) || !STATION_STATES.includes(stations.state))
    throw invalid();
  if (!isObject(citizen) || !CITIZEN_STATES.includes(citizen.state))
    throw invalid();
  if (!Array.isArray(stations.stations) || stations.stations.length > 10)
    throw invalid();
  if (!Array.isArray(citizen.sensors) || citizen.sensors.length > 20)
    throw invalid();
  return {
    version: 1,
    requested: point(value.requested),
    stations: {
      tier: 'station',
      state: stations.state,
      reason: textOrNull(stations.reason),
      retrievedAt: isoOrNull(stations.retrievedAt ?? null),
      radiusM: finite(stations.radiusM, 0, 1e6) ? stations.radiusM : null,
      stations: stations.stations.map(stationRow),
      detail: detailBlock(stations.detail ?? null),
    },
    citizen: {
      tier: 'citizen',
      state: citizen.state,
      reason: textOrNull(citizen.reason),
      retrievedAt: isoOrNull(citizen.retrievedAt ?? null),
      radiusM: finite(citizen.radiusM, 0, 1e6) ? citizen.radiusM : null,
      sensors: citizen.sensors.map(citizenRow),
    },
  };
}

/** Validate a `/api/air-quality/sensor` response (the watch's input). */
export function validateSensorPayload(value) {
  if (!isObject(value) || value.version !== 1) throw invalid();
  if (!Number.isSafeInteger(value.sensorId)) throw invalid();
  if (!DETAIL_STATES.has(value.state)) throw invalid();
  return {
    sensorId: value.sensorId,
    state: value.state,
    reason: textOrNull(value.reason),
    retrievedAt: isoOrNull(value.retrievedAt ?? null),
    hours: hoursRows(value.hours),
  };
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function indexCard(result, categories) {
  const rows = result.subIndices.map((row) => ({
    pollutant: row.pollutant,
    label: POLLUTANTS[row.pollutant].label,
    averagingHours: row.averagingHours,
    hours: row.hours,
    mean: row.mean,
    unit: unitLabel(row.unit),
    state: row.state,
    index: row.index,
    floor: row.floor,
    openEnded: row.openEnded,
    category: row.category,
    converted: row.converted,
    from: iso(row.fromMs),
    to: iso(row.toMs),
  }));
  if (result.state !== 'ok')
    return {
      state: 'insufficient',
      reason: result.reason,
      basisEnd: iso(result.basisEndMs),
      rows,
    };
  const category = categories.find((entry) => entry.id === result.category);
  return {
    state: 'ok',
    value: result.openEnded ? null : result.index,
    display: result.openEnded ? `${result.floor}+` : String(result.index),
    category: result.category,
    categoryLabel: category?.label ?? null,
    dominant: POLLUTANTS[result.dominant].label,
    basisEnd: iso(result.basisEndMs),
    converted: rows.some((row) => row.state === 'ok' && row.converted),
    rows,
  };
}

/**
 * NAQI and US AQI for the detail station, or null when no hours were fetched.
 * Both indices are `derived`: AUREL's calculation from observed hours.
 */
export function stationIndices(detail) {
  if (!detail || Object.keys(detail.series).length === 0) return null;
  return {
    stationId: detail.stationId,
    class: 'derived',
    naqi: indexCard(computeNaqi(detail.series), NAQI_CATEGORIES),
    usAqi: indexCard(computeUsAqi(detail.series), US_AQI_CATEGORIES),
  };
}

/** Readings of one station as display rows, each with unit, time and class. */
export function stationReadings(station) {
  return station.latest.map((row) => ({
    pollutant: row.pollutant,
    label: POLLUTANTS[row.pollutant].label,
    value: row.value,
    unit: unitLabel(row.unit),
    observedAt: row.observedAt,
    class: 'observed',
    basis: 'latest-hour',
  }));
}
