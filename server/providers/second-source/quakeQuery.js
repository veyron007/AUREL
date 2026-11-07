/**
 * Bounded FDSN event query shared by the EMSC and GEOFON adapters.
 *
 * One selected event becomes one small box in space and time: at most
 * QUAKE_RADIUS_DEG great-circle degrees around the event and
 * QUAKE_WINDOW_S seconds either side of its origin time, capped at
 * QUAKE_ROW_LIMIT rows. Inputs are rounded so nearby repeat selections share
 * one cached answer.
 */
export const QUAKE_RADIUS_DEG = 2;
export const QUAKE_WINDOW_S = 180;
export const QUAKE_ROW_LIMIT = 20;

const isoSeconds = (ms) => new Date(ms).toISOString().slice(0, 19);

/** Validate a selected event before any upstream request is built. */
export function validQuakeQuery({ lat, lon, timeMs } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const time = Number(timeMs);
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(time) ||
    time < Date.UTC(1900, 0, 1) ||
    time > Date.UTC(2200, 0, 1)
  )
    return null;
  return {
    lat: Math.round(latitude * 100) / 100,
    lon: Math.round(longitude * 100) / 100,
    timeMs: Math.round(time / 10_000) * 10_000,
  };
}

/** FDSN query string for one bounded event box. */
export function fdsnEventParams(query, format) {
  return new URLSearchParams({
    format,
    starttime: isoSeconds(query.timeMs - QUAKE_WINDOW_S * 1000),
    endtime: isoSeconds(query.timeMs + QUAKE_WINDOW_S * 1000),
    lat: String(query.lat),
    lon: String(query.lon),
    maxradius: String(QUAKE_RADIUS_DEG),
    limit: String(QUAKE_ROW_LIMIT),
    orderby: 'time',
  });
}

const finite = (value) =>
  value !== null && value !== '' && Number.isFinite(Number(value));

/** A parsed catalogue row, or null when position or time is unusable. */
export function quakeRow({
  id,
  time,
  lat,
  lon,
  depthKm,
  mag,
  magType,
  author,
  region,
  updatedAt = null,
}) {
  const timeMs = Date.parse(time);
  if (
    !id ||
    !Number.isFinite(timeMs) ||
    !finite(lat) ||
    !finite(lon) ||
    Math.abs(Number(lat)) > 90 ||
    Math.abs(Number(lon)) > 180
  )
    return null;
  const magnitude = finite(mag) ? Number(mag) : null;
  if (magnitude !== null && (magnitude < -2 || magnitude > 10)) return null;
  return {
    id: String(id).slice(0, 64),
    timeMs,
    lat: Number(lat),
    lon: Number(lon),
    depthKm: finite(depthKm) ? Number(depthKm) : null,
    mag: magnitude,
    magType: magType ? String(magType).slice(0, 12) : null,
    author: author ? String(author).slice(0, 32) : null,
    region: region ? String(region).slice(0, 120) : null,
    updatedAt:
      updatedAt && Number.isFinite(Date.parse(updatedAt))
        ? Date.parse(updatedAt)
        : null,
  };
}
