import {
  FORECAST_FIELDS,
  FORECAST_DAYS,
  ENSEMBLE_MODEL,
  ANTECEDENT_DAYS,
} from '../../../src/sources/mountainWeatherModel.js';
import { SourceError } from './acquire.js';
import { openMeteoDeciUnits } from './budget.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
/** Historical range: fifteen whole UTC days ending yesterday. */
export const HISTORICAL_DAYS = 15;
export const HISTORICAL_DATASETS = Object.freeze(['era5_land', 'era5']);
const FIELD_NAMES = Object.keys(FORECAST_FIELDS);

const fail = (reason = 'upstream-unavailable') => new SourceError(reason);
const numeric = (v) => typeof v === 'number' && Number.isFinite(v);

/** Request weights in deci-units; tests pin these to the provider formula. */
export const WEIGHTS = Object.freeze({
  forecastModel: openMeteoDeciUnits({
    variables: FIELD_NAMES.length,
    days: FORECAST_DAYS,
  }),
  ensemble: openMeteoDeciUnits({
    variables: 1,
    members: ENSEMBLE_MODEL.members,
    days: FORECAST_DAYS,
  }),
  historical: openMeteoDeciUnits({
    variables: 1,
    members: HISTORICAL_DATASETS.length,
    days: HISTORICAL_DAYS,
  }),
});

function baseParams(point) {
  const params = {
    latitude: String(point.lat),
    longitude: String(point.lon),
    timezone: 'GMT',
  };
  if (point.elevationM !== null) params.elevation = String(point.elevationM);
  return params;
}
export function forecastUrl(point, spec) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    ...baseParams(point),
    models: spec.model,
    hourly: Object.values(FORECAST_FIELDS)
      .map(([name]) => name)
      .join(','),
    forecast_days: String(FORECAST_DAYS),
    wind_speed_unit: 'ms',
  }).toString();
  return url.href;
}
export function ensembleUrl(point) {
  const url = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  url.search = new URLSearchParams({
    ...baseParams(point),
    models: ENSEMBLE_MODEL.model,
    hourly: 'precipitation',
    forecast_days: String(FORECAST_DAYS),
  }).toString();
  return url.href;
}
export function historicalUrl(point, clock) {
  const today = Math.floor(clock / DAY) * DAY;
  const date = (ms) => new Date(ms).toISOString().slice(0, 10);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    ...baseParams(point),
    models: HISTORICAL_DATASETS.join(','),
    hourly: 'precipitation',
    start_date: date(today - HISTORICAL_DAYS * DAY),
    end_date: date(today - DAY),
  }).toString();
  return url.href;
}
export function metaUrl(name) {
  return `https://api.open-meteo.com/data/${name}/static/meta.json`;
}

function hourTimes(raw, maxHours) {
  if (
    !raw ||
    raw.utc_offset_seconds !== 0 ||
    !numeric(raw.latitude) ||
    !numeric(raw.longitude) ||
    !Array.isArray(raw.hourly?.time) ||
    !raw.hourly.time.length ||
    raw.hourly.time.length > maxHours
  )
    throw fail();
  return raw.hourly.time.map((time, i) => {
    if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:00$/.test(time))
      throw fail();
    const at = Date.parse(time + ':00.000Z');
    if (!Number.isFinite(at)) throw fail();
    if (i && at - Date.parse(raw.hourly.time[i - 1] + ':00.000Z') !== HOUR)
      throw fail();
    return at;
  });
}
function column(raw, key, length, min, max) {
  const values = raw.hourly[key];
  if (!Array.isArray(values) || values.length !== length) throw fail();
  return values.map((v) => (numeric(v) && v >= min && v <= max ? v : null));
}
const grid = (raw) => ({ lat: raw.latitude, lon: raw.longitude });
const elevation = (raw) =>
  numeric(raw.elevation) && raw.elevation >= -500 && raw.elevation <= 9000
    ? raw.elevation
    : null;

/**
 * One deterministic model. A variable the model does not provide arrives
 * with unit "undefined" and only nulls; it is listed as unsupported rather
 * than treated as zero. Any other unit change rejects the response.
 */
export function normalizeForecastModel(raw) {
  const times = hourTimes(raw, (FORECAST_DAYS + 1) * 24);
  const unsupported = [];
  const columns = {};
  for (const [name, [key, unit, min, max]] of Object.entries(FORECAST_FIELDS)) {
    const values = column(raw, key, times.length, min, max);
    if (raw.hourly_units?.[key] !== unit) {
      if (values.some((v) => v !== null)) throw fail('unit-mismatch');
      unsupported.push(name);
    }
    columns[name] = values;
  }
  if (unsupported.length === FIELD_NAMES.length) throw fail('no-data');
  return {
    grid: grid(raw),
    elevationM: elevation(raw),
    unsupported,
    times,
    columns,
  };
}
export function normalizeEnsemble(raw) {
  const times = hourTimes(raw, (FORECAST_DAYS + 1) * 24);
  const keys = [
    'precipitation',
    ...Array.from(
      { length: ENSEMBLE_MODEL.members - 1 },
      (_, i) => `precipitation_member${String(i + 1).padStart(2, '0')}`,
    ),
  ];
  const members = [];
  for (const key of keys) {
    if (!Object.hasOwn(raw.hourly, key)) continue;
    if (raw.hourly_units?.[key] !== 'mm') throw fail('unit-mismatch');
    members.push(column(raw, key, times.length, 0, 1000));
  }
  if (!members.length || members.every((m) => m.every((v) => v === null)))
    throw fail('no-data');
  return { grid: grid(raw), times, members };
}
export function normalizeHistorical(raw) {
  const times = hourTimes(raw, (HISTORICAL_DAYS + 1) * 24);
  const datasets = {};
  for (const name of HISTORICAL_DATASETS) {
    const key = `precipitation_${name}`;
    if (!Object.hasOwn(raw.hourly, key)) continue;
    if (raw.hourly_units?.[key] !== 'mm') {
      const values = column(raw, key, times.length, 0, 1000);
      if (values.some((v) => v !== null)) throw fail('unit-mismatch');
      continue;
    }
    datasets[name] = column(raw, key, times.length, 0, 1000);
  }
  return { grid: grid(raw), times, datasets };
}
export function normalizeRunMeta(raw) {
  const seconds = raw?.last_run_initialisation_time;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw fail();
  return new Date(seconds * 1000).toISOString();
}

/** Sum each complete 24 h IMD window (ending 03:00 UTC); incomplete windows are null. */
export function imdWindows(times, values, firstStart, count) {
  const index = new Map(times.map((at, i) => [at, i]));
  return Array.from({ length: count }, (_, day) => {
    const start = firstStart + day * DAY;
    let sum = 0;
    for (let at = start; at < start + DAY; at += HOUR) {
      const i = index.get(at);
      if (i === undefined || values[i] === null) return { start, sum: null };
      sum += values[i];
    }
    return { start, sum: Math.round(sum * 100) / 100 };
  });
}
export const isoDay = (start) => ({
  start: new Date(start).toISOString(),
  end: new Date(start + DAY).toISOString(),
});

/**
 * Choose the reanalysis for the antecedent total: ERA5-Land when its latest
 * seven complete IMD windows are at least as recent as ERA5's, otherwise
 * ERA5. Days are never mixed between datasets.
 */
export function antecedentWindows(normalized, firstStart, count) {
  let best = null;
  for (const name of HISTORICAL_DATASETS) {
    const values = normalized.datasets[name];
    if (!values) continue;
    const windows = imdWindows(normalized.times, values, firstStart, count);
    let end = windows.length;
    while (end > 0 && windows[end - 1].sum === null) end--;
    let start = end;
    while (
      start > 0 &&
      windows[start - 1].sum !== null &&
      end - start < ANTECEDENT_DAYS
    )
      start--;
    const run = windows.slice(start, end);
    if (!run.length) continue;
    const latest = run.at(-1).start;
    if (
      !best ||
      run.length > best.days.length ||
      (run.length === best.days.length && latest > best.latest)
    )
      best = { dataset: name, days: run, latest };
  }
  return best;
}
