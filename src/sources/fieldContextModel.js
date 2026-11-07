/** Bounded scientific projection. Forecast times are validity times, never issue times. */
const HOUR = 3600000;
const SPECS = Object.freeze({
  weather: {
    sourceId: 'open-meteo-weather',
    sourceLabel: 'Open-Meteo weather models',
    attribution: 'Weather data by Open-Meteo',
    link: 'https://open-meteo.com/en/docs',
    resolutionM: null,
    nativeTimeResolutionSeconds: null,
    fields: {
      temperatureC: ['temperature_2m', -100, 70, '°C'],
      precipitationMm: ['precipitation', 0, 10000, 'mm'],
      precipitationProbabilityPct: ['precipitation_probability', 0, 100, '%'],
      windSpeedMps: ['wind_speed_10m', 0, 200, 'm/s'],
      windGustMps: ['wind_gusts_10m', 0, 200, 'm/s'],
      weatherCode: ['weather_code', 0, 99, 'wmo code'],
    },
  },
  airQuality: {
    sourceId: 'open-meteo-cams-global',
    sourceLabel: 'CAMS global air-quality model',
    attribution: 'CAMS global atmospheric composition forecasts via Open-Meteo',
    link: 'https://open-meteo.com/en/docs/air-quality-api',
    resolutionM: 45000,
    nativeTimeResolutionSeconds: 10800,
    fields: {
      pm25: ['pm2_5', 0, 100000, 'μg/m³'],
      pm10: ['pm10', 0, 100000, 'μg/m³'],
      usAqi: ['us_aqi', 0, 10000, 'USAQI'],
    },
  },
});
const error = () => new Error('Invalid field context data');
const numeric = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function fieldQueryPoint(point) {
  if (!point || !numeric(point.lat, -90, 90) || !numeric(point.lon, -180, 180))
    throw error();
  return {
    lat: Number(point.lat.toFixed(5)),
    lon: Number(point.lon.toFixed(5)),
  };
}
function utc(value, provider = false) {
  if (typeof value !== 'string') throw error();
  const normalized =
    provider && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
      ? value + ':00.000Z'
      : value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized) ||
    !Number.isFinite(Date.parse(normalized)) ||
    new Date(normalized).toISOString() !== normalized
  )
    throw error();
  return normalized;
}
function base(kind) {
  const s = SPECS[kind];
  if (!s) throw error();
  return {
    state: 'unavailable',
    kind: 'forecast',
    sourceId: s.sourceId,
    sourceLabel: s.sourceLabel,
    grid: null,
    issuedAt: null,
    retrievedAt: null,
    validFrom: null,
    validTo: null,
    timeResolutionSeconds: 3600,
    nativeTimeResolutionSeconds: s.nativeTimeResolutionSeconds,
    resolutionM: s.resolutionM,
    units: Object.fromEntries(
      Object.entries(s.fields).map(([k, v]) => [
        k,
        k === 'weatherCode' ? 'WMO' : k === 'usAqi' ? 'US AQI' : v[3],
      ]),
    ),
    hours: [],
    attribution: s.attribution,
    license: 'CC BY 4.0',
    link: s.link,
    reason: null,
  };
}
export function unavailableFieldProvider(
  kind,
  reason = 'upstream-unavailable',
  state = 'unavailable',
) {
  return { ...base(kind), state, reason };
}
export function normalizeFieldProvider(raw, kind, retrievedAt) {
  const result = base(kind),
    spec = SPECS[kind];
  if (
    !raw ||
    raw.utc_offset_seconds !== 0 ||
    !numeric(raw.latitude, -90, 90) ||
    !numeric(raw.longitude, -180, 180) ||
    !Array.isArray(raw.hourly?.time) ||
    raw.hourly.time.length < 1 ||
    raw.hourly.time.length > 48
  )
    throw error();
  for (const [key, , , unit] of Object.values(spec.fields))
    if (
      !Array.isArray(raw.hourly[key]) ||
      raw.hourly[key].length !== raw.hourly.time.length ||
      raw.hourly_units?.[key] !== unit
    )
      throw error();
  const hours = raw.hourly.time.map((time, i) => ({
    time: utc(time, true),
    ...Object.fromEntries(
      Object.entries(spec.fields).map(([name, [key, min, max]]) => [
        name,
        numeric(raw.hourly[key][i], min, max) ? raw.hourly[key][i] : null,
      ]),
    ),
  }));
  checkHours(hours, kind);
  if (!hours.some((h) => Object.keys(spec.fields).some((k) => h[k] !== null)))
    throw error();
  return {
    ...result,
    state: 'ready',
    grid: { lat: raw.latitude, lon: raw.longitude },
    retrievedAt: utc(new Date(retrievedAt).toISOString()),
    validFrom: hours[0].time,
    validTo: new Date(Date.parse(hours.at(-1).time) + HOUR).toISOString(),
    hours,
  };
}
function checkHours(hours, kind) {
  if (!Array.isArray(hours) || hours.length > 48) throw error();
  hours.forEach((row, i) => {
    utc(row.time);
    if (i && Date.parse(row.time) - Date.parse(hours[i - 1].time) !== HOUR)
      throw error();
    for (const [name, [, min, max]] of Object.entries(SPECS[kind].fields))
      if (row[name] !== null && !numeric(row[name], min, max)) throw error();
  });
}
function validateSource(value, kind) {
  const canonical = base(kind);
  if (
    !value ||
    !['ready', 'stale', 'unavailable', 'blocked'].includes(value.state) ||
    value.kind !== 'forecast' ||
    value.sourceId !== canonical.sourceId ||
    value.issuedAt !== null ||
    !value.units ||
    Object.keys(value.units).length !== Object.keys(canonical.units).length ||
    Object.entries(canonical.units).some(
      ([key, unit]) => value.units[key] !== unit,
    )
  )
    throw error();
  checkHours(value.hours, kind);
  if (['ready', 'stale'].includes(value.state)) {
    fieldQueryPoint(value.grid);
    utc(value.retrievedAt);
    utc(value.validFrom);
    utc(value.validTo);
    if (
      !value.hours.length ||
      value.validFrom !== value.hours[0].time ||
      Date.parse(value.validTo) !== Date.parse(value.hours.at(-1).time) + HOUR
    )
      throw error();
  } else if (
    value.hours.length ||
    value.grid !== null ||
    value.retrievedAt !== null ||
    value.validFrom !== null ||
    value.validTo !== null
  )
    throw error();
  if (
    value.reason !== null &&
    ![
      'upstream-unavailable',
      'budget-storage',
      'budget-busy',
      'clock-reversed',
      'daily-limit',
      'monthly-limit',
      'minute-limit',
      'disabled',
      'rate-limited',
    ].includes(value.reason)
  )
    throw error();
  return {
    ...canonical,
    state: value.state,
    reason: value.reason,
    grid: value.grid ? { lat: value.grid.lat, lon: value.grid.lon } : null,
    retrievedAt: value.retrievedAt,
    validFrom: value.validFrom,
    validTo: value.validTo,
    hours: value.hours.map((row) => ({
      time: row.time,
      ...Object.fromEntries(
        Object.keys(SPECS[kind].fields).map((k) => [k, row[k]]),
      ),
    })),
  };
}
export function validateFieldContextPayload(value) {
  if (!value || value.version !== 1) throw error();
  fieldQueryPoint(value.requested);
  fieldQueryPoint(value.queried);
  const expected = fieldQueryPoint(value.requested);
  if (expected.lat !== value.queried.lat || expected.lon !== value.queried.lon)
    throw error();
  return {
    version: 1,
    requested: { lat: value.requested.lat, lon: value.requested.lon },
    queried: expected,
    weather: validateSource(value.weather, 'weather'),
    airQuality: validateSource(value.airQuality, 'airQuality'),
  };
}
