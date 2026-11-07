/**
 * Pure OpenAQ v3 payload normalizers. Malformed structure throws; individual
 * unusable rows are skipped, because one bad sensor is not evidence that the
 * station list is broken.
 */
import { POLLUTANTS, canonicalUnit } from '../../../src/airQuality/naqi.js';

const HOUR_MS = 3_600_000;
/** Stations per query: the nearest few, so a lookup stays inside its budget. */
export const OPENAQ_MAX_STATIONS = 3;

const invalid = () =>
  Object.assign(new Error('Invalid OpenAQ response'), {
    code: 'invalid-response',
  });

const results = (payload) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.results)
  )
    throw invalid();
  return payload.results;
};

const finite = (value, min, max) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

const text = (value, max = 160) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const utc = (value) => {
  const ms = Date.parse(value?.utc ?? value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

function sensorRow(sensor) {
  const name = String(sensor?.parameter?.name ?? '').toLowerCase();
  const pollutant = Object.hasOwn(POLLUTANTS, name) ? name : null;
  if (!pollutant || !canonicalUnit(sensor?.parameter?.units)) return null;
  if (!Number.isSafeInteger(sensor?.id)) return null;
  return { sensorId: sensor.id, pollutant, unit: sensor.parameter.units };
}

function stationRow(location) {
  if (location.isMonitor !== true || location.isMobile === true) return null;
  const lat = location.coordinates?.latitude;
  const lon = location.coordinates?.longitude;
  if (!finite(lat, -90, 90) || !finite(lon, -180, 180)) return null;
  if (!Number.isSafeInteger(location.id)) return null;
  const sensors = (Array.isArray(location.sensors) ? location.sensors : [])
    .map(sensorRow)
    .filter(Boolean);
  if (sensors.length === 0) return null;
  return {
    id: `openaq:${location.id}`,
    locationId: location.id,
    name: text(location.name) ?? `OpenAQ ${location.id}`,
    locality: text(location.locality),
    owner: text(location.owner?.name),
    dataProvider: text(location.provider?.name),
    lat,
    lon,
    distanceM: finite(location.distance, 0, 1e7)
      ? Math.round(location.distance)
      : null,
    licenses: (Array.isArray(location.licenses) ? location.licenses : [])
      .map((license) => text(license?.name, 120))
      .filter(Boolean)
      .slice(0, 4),
    lastObservedAt: utc(location.datetimeLast),
    sensors,
  };
}

/**
 * Reference monitors (`isMonitor`, not mobile) within the query radius,
 * nearest first. Low-cost sensors never enter the station tier.
 */
export function normalizeLocations(
  payload,
  { limit = OPENAQ_MAX_STATIONS } = {},
) {
  const stations = [];
  for (const location of results(payload)) {
    if (!location || typeof location !== 'object') throw invalid();
    const station = stationRow(location);
    if (station) stations.push(station);
  }
  return stations
    .sort(
      (a, b) =>
        (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
        a.locationId - b.locationId,
    )
    .slice(0, limit);
}

/** Newest value per known sensor of one station, by pollutant. */
export function normalizeLatest(payload, station) {
  const bySensor = new Map(station.sensors.map((s) => [s.sensorId, s]));
  const latest = new Map();
  for (const row of results(payload)) {
    if (!row || typeof row !== 'object') throw invalid();
    const sensor = bySensor.get(row.sensorsId);
    const observedAt = utc(row.datetime);
    if (!sensor || !finite(row.value, 0, 1e6) || !observedAt) continue;
    const previous = latest.get(sensor.sensorId);
    if (previous && previous.observedAt >= observedAt) continue;
    latest.set(sensor.sensorId, {
      pollutant: sensor.pollutant,
      sensorId: sensor.sensorId,
      value: row.value,
      unit: sensor.unit,
      observedAt,
    });
  }
  return [...latest.values()].sort(
    (a, b) => a.pollutant.localeCompare(b.pollutant) || a.sensorId - b.sensorId,
  );
}

/**
 * Hourly aggregates for one sensor. Rows that do not cover exactly one clock
 * hour are dropped; OpenAQ's own flag is kept so averaging can exclude it.
 */
export function normalizeHours(payload) {
  const hours = [];
  for (const row of results(payload)) {
    if (!row || typeof row !== 'object') throw invalid();
    const fromMs = Date.parse(row.period?.datetimeFrom?.utc);
    const endMs = Date.parse(row.period?.datetimeTo?.utc);
    if (!Number.isFinite(fromMs) || !Number.isFinite(endMs)) continue;
    if (endMs - fromMs !== HOUR_MS || endMs % HOUR_MS !== 0) continue;
    if (!finite(row.value, 0, 1e6) || !canonicalUnit(row.parameter?.units))
      continue;
    hours.push({
      endMs,
      value: row.value,
      unit: row.parameter.units,
      flagged: row.flagInfo?.hasFlags === true,
    });
  }
  return hours.sort((a, b) => a.endMs - b.endMs);
}
