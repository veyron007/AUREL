/**
 * Bounded mountain-weather payload shared by the server projection, the
 * same-origin client and Fieldbook snapshots. Every value keeps its source,
 * unit, applicable time and class; unknown values stay null.
 */
const HOUR = 3600000;
const DAY = 24 * HOUR;
/** IMD reports 24 h rainfall ending 03:00 UTC (08:30 IST). */
export const IMD_DAY_END_UTC_HOUR = 3;
export const SHEET_WINDOW_HOURS = 24;
export const FORECAST_DAYS = 7;
export const ANTECEDENT_DAYS = 7;
export const IMERG_HALF_HOURS = 48;

export const FORECAST_MODELS = Object.freeze([
  Object.freeze({
    id: 'icon',
    model: 'icon_seamless',
    meta: 'dwd_icon',
    label: 'DWD ICON',
    resolutionKm: 13,
  }),
  Object.freeze({
    id: 'gfs',
    model: 'gfs_seamless',
    meta: 'ncep_gfs025',
    label: 'NOAA GFS',
    resolutionKm: 25,
  }),
  Object.freeze({
    id: 'ifs',
    model: 'ecmwf_ifs025',
    meta: 'ecmwf_ifs025',
    label: 'ECMWF IFS',
    resolutionKm: 25,
  }),
]);
export const ENSEMBLE_MODEL = Object.freeze({
  model: 'ecmwf_ifs025',
  meta: 'ecmwf_ifs025_ensemble',
  label: 'ECMWF ENS',
  members: 51,
  resolutionKm: 25,
});
export const ANTECEDENT_DATASETS = Object.freeze({
  era5_land: Object.freeze({ label: 'ERA5-Land', resolutionKm: 9 }),
  era5: Object.freeze({ label: 'ERA5', resolutionKm: 25 }),
});
/** name: [Open-Meteo variable, unit, min, max] */
export const FORECAST_FIELDS = Object.freeze({
  temperatureC: ['temperature_2m', '°C', -100, 70],
  freezingLevelM: ['freezing_level_height', 'm', -1000, 12000],
  snowfallCm: ['snowfall', 'cm', 0, 1000],
  precipitationMm: ['precipitation', 'mm', 0, 1000],
  cloudLowPct: ['cloud_cover_low', '%', 0, 100],
  cloudMidPct: ['cloud_cover_mid', '%', 0, 100],
  cloudHighPct: ['cloud_cover_high', '%', 0, 100],
  visibilityM: ['visibility', 'm', 0, 1000000],
  capeJkg: ['cape', 'J/kg', 0, 20000],
  wind700Mps: ['wind_speed_700hPa', 'm/s', 0, 200],
  wind700Deg: ['wind_direction_700hPa', '°', 0, 360],
  wind500Mps: ['wind_speed_500hPa', 'm/s', 0, 200],
  wind500Deg: ['wind_direction_500hPa', '°', 0, 360],
});
export const MOUNTAIN_STATES = Object.freeze([
  'ready',
  'partial',
  'stale',
  'empty',
  'unavailable',
  'blocked',
]);
export const MOUNTAIN_REASONS = Object.freeze([
  'upstream-unavailable',
  'budget-storage',
  'budget-busy',
  'budget-units',
  'clock-reversed',
  'daily-limit',
  'monthly-limit',
  'minute-limit',
  'rate-limited',
  'no-data',
  'unit-mismatch',
  'colormap-mismatch',
]);
export const SOURCES = Object.freeze({
  forecast: Object.freeze({
    sourceId: 'open-meteo-forecast-models',
    sourceLabel: 'Open-Meteo forecast API (ICON, GFS, IFS)',
    class: 'modelled',
    attribution: 'Weather data by Open-Meteo; DWD, NOAA and ECMWF models',
    license: 'CC BY 4.0',
    link: 'https://open-meteo.com/en/docs',
  }),
  ensemble: Object.freeze({
    sourceId: 'open-meteo-ensemble-ecmwf',
    sourceLabel: 'Open-Meteo Ensemble API (ECMWF ENS, 51 members)',
    class: 'modelled',
    attribution: 'Ensemble data by Open-Meteo; ECMWF',
    license: 'CC BY 4.0',
    link: 'https://open-meteo.com/en/docs/ensemble-api',
  }),
  antecedent: Object.freeze({
    sourceId: 'open-meteo-historical-reanalysis',
    sourceLabel: 'Open-Meteo Historical API (ERA5-Land, ERA5)',
    class: 'modelled',
    attribution:
      'Reanalysis data by Open-Meteo; Copernicus Climate Change Service (ECMWF)',
    license: 'CC BY 4.0',
    link: 'https://open-meteo.com/en/docs/historical-weather-api',
  }),
  imerg: Object.freeze({
    sourceId: 'nasa-gibs-imerg-30min',
    sourceLabel: 'NASA GIBS IMERG Precipitation Rate (30-min)',
    class: 'observed',
    attribution:
      'NASA GPM IMERG V07 (Early, later replaced by Final) via NASA GIBS; values read from published colormap classes',
    license: 'NASA open data',
    link: 'https://nasa-gibs.github.io/gibs-api-docs/',
  }),
});

const error = () => new Error('Invalid mountain weather data');
const numeric = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const nullableNumber = (v, min, max) => v === null || numeric(v, min, max);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function keys(value, names) {
  if (!isObject(value)) throw error();
  const present = Object.keys(value);
  if (
    present.length !== names.length ||
    present.some((k) => !names.includes(k))
  )
    throw error();
}
export function utcIso(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw error();
  return value;
}
const maybeIso = (v) => (v === null ? null : utcIso(v));
function hourIso(value) {
  utcIso(value);
  if (Date.parse(value) % HOUR) throw error();
  return value;
}

/** Validated, rounded query cell; elevation is a 50 m band or null. */
export function mountainQueryPoint(point) {
  if (
    !point ||
    !numeric(point.lat, -90, 90) ||
    !numeric(point.lon, -180, 180) ||
    !(
      point.elevationM === null ||
      point.elevationM === undefined ||
      numeric(point.elevationM, -500, 9000)
    )
  )
    throw error();
  return {
    lat: Number(point.lat.toFixed(2)),
    lon: Number(point.lon.toFixed(2)),
    elevationM: Number.isFinite(point.elevationM)
      ? Math.round(point.elevationM / 50) * 50
      : null,
  };
}

/** Start of the IMD 24 h window (ending 03:00 UTC) that contains `at`. */
export function imdDayStart(at) {
  const offset = IMD_DAY_END_UTC_HOUR * HOUR;
  return Math.floor((at - offset) / DAY) * DAY + offset;
}

function checkState(part) {
  if (
    !MOUNTAIN_STATES.includes(part.state) ||
    !(part.reason === null || MOUNTAIN_REASONS.includes(part.reason))
  )
    throw error();
  maybeIso(part.retrievedAt);
  if (['ready', 'partial', 'stale'].includes(part.state) && !part.retrievedAt)
    throw error();
}
const SOURCE_KEYS = Object.keys(SOURCES.forecast);
function checkSource(part, kind) {
  for (const key of SOURCE_KEYS)
    if (part[key] !== SOURCES[kind][key]) throw error();
}
function checkGrid(grid) {
  if (grid === null) return;
  keys(grid, ['lat', 'lon']);
  if (!numeric(grid.lat, -90, 90) || !numeric(grid.lon, -180, 180))
    throw error();
}
function checkDayWindow(row) {
  utcIso(row.start);
  utcIso(row.end);
  const start = Date.parse(row.start);
  if (Date.parse(row.end) - start !== DAY || imdDayStart(start) !== start)
    throw error();
}
function checkOrdered(rows, field, step) {
  rows.forEach((row, i) => {
    if (i && Date.parse(row[field]) - Date.parse(rows[i - 1][field]) !== step)
      throw error();
  });
}

function validateForecastModel(row, spec) {
  keys(row, [
    'id',
    'model',
    'label',
    'resolutionKm',
    'state',
    'runAt',
    'grid',
    'elevationM',
    'unsupported',
    'hours',
    'days',
  ]);
  if (
    row.id !== spec.id ||
    row.model !== spec.model ||
    row.label !== spec.label ||
    row.resolutionKm !== spec.resolutionKm ||
    !['ready', 'missing'].includes(row.state)
  )
    throw error();
  maybeIso(row.runAt);
  checkGrid(row.grid);
  if (!nullableNumber(row.elevationM, -500, 9000)) throw error();
  if (
    !Array.isArray(row.unsupported) ||
    row.unsupported.some((k) => !Object.hasOwn(FORECAST_FIELDS, k)) ||
    new Set(row.unsupported).size !== row.unsupported.length
  )
    throw error();
  if (!Array.isArray(row.hours) || row.hours.length > SHEET_WINDOW_HOURS)
    throw error();
  for (const hour of row.hours) {
    keys(hour, ['time', ...Object.keys(FORECAST_FIELDS)]);
    hourIso(hour.time);
    for (const [name, [, , min, max]] of Object.entries(FORECAST_FIELDS))
      if (!nullableNumber(hour[name], min, max)) throw error();
  }
  checkOrdered(row.hours, 'time', HOUR);
  if (!Array.isArray(row.days) || row.days.length > FORECAST_DAYS + 1)
    throw error();
  for (const day of row.days) {
    keys(day, ['start', 'end', 'precipitationMm', 'snowfallCm']);
    checkDayWindow(day);
    if (
      !nullableNumber(day.precipitationMm, 0, 10000) ||
      !nullableNumber(day.snowfallCm, 0, 10000)
    )
      throw error();
  }
  checkOrdered(row.days, 'start', DAY);
  if (row.state === 'missing' && (row.hours.length || row.days.length))
    throw error();
}
function validateForecast(part) {
  keys(part, [...SOURCE_KEYS, 'state', 'reason', 'retrievedAt', 'models']);
  checkSource(part, 'forecast');
  checkState(part);
  if (
    !Array.isArray(part.models) ||
    part.models.length !== FORECAST_MODELS.length
  )
    throw error();
  part.models.forEach((row, i) =>
    validateForecastModel(row, FORECAST_MODELS[i]),
  );
}
function validateEnsemble(part) {
  keys(part, [
    ...SOURCE_KEYS,
    'state',
    'reason',
    'retrievedAt',
    'model',
    'label',
    'resolutionKm',
    'runAt',
    'grid',
    'memberCount',
    'days',
  ]);
  checkSource(part, 'ensemble');
  checkState(part);
  if (
    part.model !== ENSEMBLE_MODEL.model ||
    part.label !== ENSEMBLE_MODEL.label ||
    part.resolutionKm !== ENSEMBLE_MODEL.resolutionKm ||
    !Number.isInteger(part.memberCount) ||
    part.memberCount < 0 ||
    part.memberCount > ENSEMBLE_MODEL.members
  )
    throw error();
  maybeIso(part.runAt);
  checkGrid(part.grid);
  if (!Array.isArray(part.days) || part.days.length > FORECAST_DAYS + 1)
    throw error();
  for (const day of part.days) {
    keys(day, ['start', 'end', 'members']);
    checkDayWindow(day);
    if (
      !Array.isArray(day.members) ||
      day.members.length !== part.memberCount ||
      day.members.some((v) => !nullableNumber(v, 0, 10000))
    )
      throw error();
  }
  checkOrdered(part.days, 'start', DAY);
}
function validateAntecedent(part) {
  keys(part, [
    ...SOURCE_KEYS,
    'state',
    'reason',
    'retrievedAt',
    'dataset',
    'resolutionKm',
    'grid',
    'days',
    'totalMm',
  ]);
  checkSource(part, 'antecedent');
  checkState(part);
  if (
    part.dataset !== null &&
    !Object.hasOwn(ANTECEDENT_DATASETS, part.dataset)
  )
    throw error();
  if (
    part.resolutionKm !==
    (part.dataset ? ANTECEDENT_DATASETS[part.dataset].resolutionKm : null)
  )
    throw error();
  checkGrid(part.grid);
  if (!Array.isArray(part.days) || part.days.length > ANTECEDENT_DAYS)
    throw error();
  for (const day of part.days) {
    keys(day, ['start', 'end', 'precipitationMm']);
    checkDayWindow(day);
    if (!numeric(day.precipitationMm, 0, 10000)) throw error();
  }
  checkOrdered(part.days, 'start', DAY);
  const total = part.days.reduce((sum, d) => sum + d.precipitationMm, 0);
  const complete = part.days.length === ANTECEDENT_DAYS;
  if (
    complete
      ? !numeric(part.totalMm, 0, 100000) ||
        Math.abs(part.totalMm - total) > 0.05
      : part.totalMm !== null
  )
    throw error();
}
function validateImerg(part) {
  keys(part, [
    ...SOURCE_KEYS,
    'state',
    'reason',
    'retrievedAt',
    'cell',
    'latestAt',
    'halfHours',
    'missingCount',
    'totalLowMm',
    'totalHighMm',
  ]);
  checkSource(part, 'imerg');
  checkState(part);
  checkGrid(part.cell);
  maybeIso(part.latestAt);
  if (
    !Array.isArray(part.halfHours) ||
    part.halfHours.length > IMERG_HALF_HOURS
  )
    throw error();
  for (const row of part.halfHours) {
    keys(row, ['time', 'lowMmH', 'highMmH']);
    utcIso(row.time);
    if (Date.parse(row.time) % (HOUR / 2)) throw error();
    if (row.lowMmH === null) {
      if (row.highMmH !== null) throw error();
    } else if (
      !numeric(row.lowMmH, 0, 1000) ||
      (row.highMmH !== null &&
        !(numeric(row.highMmH, 0, 1000) && row.highMmH > row.lowMmH))
    )
      throw error();
  }
  checkOrdered(part.halfHours, 'time', HOUR / 2);
  const missing =
    part.halfHours.filter((r) => r.lowMmH === null).length +
    IMERG_HALF_HOURS -
    part.halfHours.length;
  if (part.missingCount !== missing) throw error();
  if (
    !nullableNumber(part.totalLowMm, 0, 100000) ||
    !nullableNumber(part.totalHighMm, 0, 100000)
  )
    throw error();
}

/** Strict validation; returns a detached copy that carries no extra fields. */
export function validateMountainWeatherPayload(value) {
  keys(value, [
    'version',
    'requested',
    'queried',
    'window',
    'forecast',
    'ensemble',
    'antecedent',
    'imerg',
  ]);
  if (value.version !== 1) throw error();
  keys(value.requested, ['lat', 'lon', 'elevationM']);
  keys(value.queried, ['lat', 'lon', 'elevationM']);
  const expected = mountainQueryPoint(value.requested);
  if (
    expected.lat !== value.queried.lat ||
    expected.lon !== value.queried.lon ||
    expected.elevationM !== value.queried.elevationM
  )
    throw error();
  keys(value.window, ['from', 'to']);
  hourIso(value.window.from);
  hourIso(value.window.to);
  if (
    Date.parse(value.window.to) - Date.parse(value.window.from) !==
    SHEET_WINDOW_HOURS * HOUR
  )
    throw error();
  validateForecast(value.forecast);
  validateEnsemble(value.ensemble);
  validateAntecedent(value.antecedent);
  validateImerg(value.imerg);
  return JSON.parse(JSON.stringify(value));
}

/** A typed part with no values, for budget refusals and failed sources. */
export function emptyPart(
  kind,
  state = 'unavailable',
  reason = 'upstream-unavailable',
) {
  const base = { ...SOURCES[kind], state, reason, retrievedAt: null };
  if (kind === 'forecast')
    return {
      ...base,
      models: FORECAST_MODELS.map((m) => ({
        id: m.id,
        model: m.model,
        label: m.label,
        resolutionKm: m.resolutionKm,
        state: 'missing',
        runAt: null,
        grid: null,
        elevationM: null,
        unsupported: [],
        hours: [],
        days: [],
      })),
    };
  if (kind === 'ensemble')
    return {
      ...base,
      model: ENSEMBLE_MODEL.model,
      label: ENSEMBLE_MODEL.label,
      resolutionKm: ENSEMBLE_MODEL.resolutionKm,
      runAt: null,
      grid: null,
      memberCount: 0,
      days: [],
    };
  if (kind === 'antecedent')
    return {
      ...base,
      dataset: null,
      resolutionKm: null,
      grid: null,
      days: [],
      totalMm: null,
    };
  return {
    ...base,
    cell: null,
    latestAt: null,
    halfHours: [],
    missingCount: IMERG_HALF_HOURS,
    totalLowMm: null,
    totalHighMm: null,
  };
}
