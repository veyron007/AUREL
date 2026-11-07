/**
 * sensor.community (ODbL) citizen particulate sensors, keyless.
 *
 * These are uncalibrated low-cost optical counters (SDS011, PMS…) reporting
 * five-minute means. They are a separate tier: never a regulatory reading,
 * never the input to NAQI or US AQI, and never merged with station cards.
 */
import { readResponseJsonCapped } from '../common/http.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';
import {
  createSourceCache,
  distanceM,
  retryAfterMs,
  sourceError,
} from './cache.js';

export const SENSOR_COMMUNITY_ROOT =
  'https://data.sensor.community/airrohr/v1/filter';
/** Area filter radius in km; matches the station tier's 25 km. */
export const SENSOR_COMMUNITY_RADIUS_KM = 25;
export const SENSOR_COMMUNITY_MAX_SENSORS = 10;
/** The feed is a rolling five-minute mean; re-asking sooner returns the same. */
const TTL_MS = 5 * 60_000;
/** A newest reading older than this is stale. */
export const CITIZEN_STALE_MS = 60 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;

const finite = (value, min, max) =>
  Number.isFinite(value) && value >= min && value <= max;

/** "2026-11-07 04:10:58" is UTC in this API. */
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  )
    return null;
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function readingFromRow(row) {
  const location = row?.location;
  const lat = Number(location?.latitude);
  const lon = Number(location?.longitude);
  const observedMs = timestamp(row?.timestamp);
  if (!finite(lat, -90, 90) || !finite(lon, -180, 180) || observedMs === null)
    return null;
  if (Number(location?.indoor) === 1) return null;
  const values = Array.isArray(row.sensordatavalues)
    ? row.sensordatavalues
    : [];
  const value = (type) => {
    const raw = values.find((entry) => entry?.value_type === type)?.value;
    const number = Number(raw);
    return raw !== '' && raw !== null && finite(number, 0, 2000)
      ? number
      : null;
  };
  const pm25 = value('P2');
  const pm10 = value('P1');
  if (pm25 === null && pm10 === null) return null;
  const id = Number(location.id);
  if (!Number.isSafeInteger(id)) return null;
  return {
    id: `sensor-community:${id}`,
    locationId: id,
    sensorType:
      typeof row.sensor?.sensor_type?.name === 'string'
        ? row.sensor.sensor_type.name.slice(0, 40)
        : null,
    lat,
    lon,
    observedMs,
    pm25,
    pm10,
  };
}

/** Outdoor particulate rows → newest reading per location, nearest first. */
export function normalizeSensorCommunity(payload, point) {
  if (!Array.isArray(payload)) throw sourceError('invalid-response');
  const newest = new Map();
  for (const row of payload) {
    const reading = readingFromRow(row);
    if (!reading) continue;
    const old = newest.get(reading.locationId);
    if (!old || old.observedMs < reading.observedMs)
      newest.set(reading.locationId, reading);
  }
  return [...newest.values()]
    .map((reading) => ({
      ...reading,
      distanceM: distanceM(point, reading),
      observedAt: new Date(reading.observedMs).toISOString(),
    }))
    .filter((reading) => reading.distanceM <= SENSOR_COMMUNITY_RADIUS_KM * 1000)
    .sort((a, b) => a.distanceM - b.distanceM || a.locationId - b.locationId)
    .slice(0, SENSOR_COMMUNITY_MAX_SENSORS)
    .map(({ observedMs, ...reading }) => reading);
}

export function createSensorCommunityAdapter({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  timeoutMs = 10_000,
} = {}) {
  const cache = createSourceCache({ now, max: 64, staleMs: 2 * 3_600_000 });
  let cooldownUntil = 0;

  async function fetchArea(q) {
    if (cooldownUntil > now()) throw sourceError('rate-limited');
    return requestWithDeadline(
      async (signal) => {
        const response = await fetchImpl(
          `${SENSOR_COMMUNITY_ROOT}/area=${q.lat},${q.lon},${SENSOR_COMMUNITY_RADIUS_KM}`,
          {
            signal,
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'AUREL-personal-air-quality/1.0',
            },
          },
        );
        if (response.status === 429) {
          cooldownUntil = now() + retryAfterMs(response, now());
          await response.body?.cancel?.().catch(() => {});
          throw sourceError('rate-limited');
        }
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          throw sourceError('unavailable', 'upstream');
        }
        return normalizeSensorCommunity(
          await readResponseJsonCapped(response, MAX_BYTES, signal),
          q,
        );
      },
      { timeoutMs },
    );
  }

  return {
    /** Citizen sensors near a point with a typed state. */
    async nearby(point) {
      const q = {
        lat: Number(point.lat.toFixed(3)),
        lon: Number(point.lon.toFixed(3)),
      };
      try {
        const result = await cache.get(`area:${q.lat},${q.lon}`, TTL_MS, () =>
          fetchArea(q).catch((error) => {
            throw error?.code ? error : sourceError('unavailable', 'upstream');
          }),
        );
        const sensors = result.value;
        const newest = Math.max(
          ...sensors.map((s) => Date.parse(s.observedAt)),
          -Infinity,
        );
        let state = 'ok';
        if (sensors.length === 0) state = 'no-sensor';
        else if (result.stale || now() - newest > CITIZEN_STALE_MS)
          state = 'stale';
        return {
          state,
          reason: result.reason,
          retrievedAt: new Date(result.retrievedAt).toISOString(),
          sensors,
        };
      } catch (error) {
        return {
          state: error?.code || 'unavailable',
          reason: error?.reason || null,
          retrievedAt: null,
          sensors: [],
        };
      }
    },
  };
}
