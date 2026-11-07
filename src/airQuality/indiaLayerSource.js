/**
 * The India provider at the air-quality layer seam.
 *
 * The globe shows each nearby reference monitor's latest hourly particulate
 * value: pollutant, unit and measurement time, coloured neutral grey because a
 * one-hour value is not an index. NAQI and US AQI need 24 h means and live on
 * the Lens Breath card, which fetches the hours explicitly.
 *
 * Queries are bounded: only when the view's centre is inside India and the
 * view spans at most a few degrees, so the layer never asks OpenAQ about a
 * whole country (and never spends budget from a space-level view).
 */
import {
  AIR_QUALITY_UNKNOWN_COLOR,
  OBSERVATION_MAX_AGE_MS,
} from '../layers/airQuality/model.js';
import { POLLUTANTS, unitLabel } from './naqi.js';

// A portable export: the reading's risk text stays English data; the layer
// card translates it.
const msg = (text) => text;

export const INDIA_PROVIDER_ID = 'openaq-in';
/** A generous India rectangle; the server's 25 km radius bounds the query. */
export const INDIA_BOUNDS = Object.freeze({
  west: 68,
  south: 6,
  east: 98,
  north: 37.5,
});
/** Wider views would put most monitors outside the 25 km query circle. */
export const INDIA_MAX_VIEW_SPAN_DEG = 3;
const PREFERRED = ['pm25', 'pm10', 'no2', 'o3', 'so2', 'co', 'nh3'];

/** Centre of a degree rectangle, or null when out of scope for India. */
export function indiaQueryPoint(rect) {
  if (!rect) return null;
  const width =
    rect.west <= rect.east
      ? rect.east - rect.west
      : 360 - rect.west + rect.east;
  const height = rect.north - rect.south;
  if (width > INDIA_MAX_VIEW_SPAN_DEG || height > INDIA_MAX_VIEW_SPAN_DEG)
    return null;
  const lat = (rect.north + rect.south) / 2;
  let lon = rect.west + width / 2;
  if (lon > 180) lon -= 360;
  const b = INDIA_BOUNDS;
  if (lat < b.south || lat > b.north || lon < b.west || lon > b.east)
    return null;
  return { lat, lon };
}

/** One station → one layer reading (its preferred pollutant's latest hour). */
export function stationLayerReading(station, now = Date.now()) {
  const fresh = station.latest.filter((row) => {
    const at = Date.parse(row.observedAt);
    return Number.isFinite(at) && now - at <= OBSERVATION_MAX_AGE_MS;
  });
  const row = PREFERRED.map((id) =>
    fresh.find((entry) => entry.pollutant === id),
  ).find(Boolean);
  if (!row) return null;
  const unit = unitLabel(row.unit);
  const value = Math.round(row.value * 10) / 10;
  return {
    id: `${INDIA_PROVIDER_ID}:${station.id}`,
    provider: INDIA_PROVIDER_ID,
    scale: POLLUTANTS[row.pollutant].label,
    value,
    band: null,
    stationId: station.id,
    name: station.name,
    zone: station.locality ?? '',
    lat: station.lat,
    lon: station.lon,
    observedMs: Date.parse(row.observedAt),
    color: AIR_QUALITY_UNKNOWN_COLOR,
    label: `${value} ${unit}`,
    risk: msg('Latest hourly value, not an index'),
    note: station.dataProvider,
  };
}

const NO_READINGS = new Set(['needs-key', 'blocked', 'rate-limited']);
const STATE_ERRORS = Object.freeze({
  'needs-key': msg('India stations need the free OpenAQ key'),
  blocked: msg('India stations: daily request budget reached'),
  'rate-limited': msg('India stations are rate limited'),
});

/** India monitors near the view centre, as layer readings. */
export function createIndiaStationLayerSource({ stations, now = Date.now }) {
  if (typeof stations?.near !== 'function')
    throw new TypeError('India air quality requires a stations source');
  return {
    async getSnapshot({ signal, view } = {}) {
      const point = indiaQueryPoint(view);
      if (!point) return [];
      const payload = await stations.near(point, { signal, citizen: false });
      if (NO_READINGS.has(payload.stations.state))
        throw new Error(STATE_ERRORS[payload.stations.state]);
      const clock = now();
      return payload.stations.stations
        .map((station) => stationLayerReading(station, clock))
        .filter(Boolean);
    },
  };
}

/**
 * Several providers behind one snapshot. A provider that fails does not blank
 * the others; only when nothing produced readings does its error surface.
 */
export function createCompositeAirQualitySource(sources) {
  if (
    !Array.isArray(sources) ||
    sources.some((s) => typeof s?.getSnapshot !== 'function')
  )
    throw new TypeError('Composite air quality requires snapshot sources');
  return {
    async getSnapshot(options = {}) {
      const settled = await Promise.allSettled(
        sources.map((source) => source.getSnapshot(options)),
      );
      options.signal?.throwIfAborted?.();
      const readings = settled
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value);
      const failure = settled.find((result) => result.status === 'rejected');
      if (readings.length === 0 && failure) throw failure.reason;
      return readings;
    },
  };
}
