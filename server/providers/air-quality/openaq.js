/**
 * OpenAQ v3 adapter for reference monitors (CPCB/UKPCB stations in India).
 *
 * Every upstream request is reserved in a durable local ledger BEFORE dispatch
 * (a refused reservation never reaches the network), the key travels only in
 * the X-API-Key header, queries are bounded to a 25 km radius and three
 * stations, and responses are cached so a station costs at most one request
 * per hour per resource.
 */
import path from 'node:path';
import { createFieldContextBudget } from '../field-context-budget.js';
import { readResponseJsonCapped } from '../common/http.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';
import {
  OPENAQ_MAX_STATIONS,
  normalizeHours,
  normalizeLatest,
  normalizeLocations,
} from './openaq-model.js';
import { createSourceCache, retryAfterMs, sourceError } from './cache.js';

export const OPENAQ_ROOT = 'https://api.openaq.org/v3';
/** OpenAQ's own maximum radius. */
export const OPENAQ_RADIUS_M = 25_000;
const HOUR_MS = 3_600_000;
const TTL = Object.freeze({
  locations: 12 * HOUR_MS,
  latest: HOUR_MS,
  hours: HOUR_MS,
});
/** A newest observation older than this makes the card stale. */
export const OBSERVATION_STALE_MS = 3 * HOUR_MS;
/** No observation in this window is "no data", not merely stale. */
export const OBSERVATION_NO_DATA_MS = 24 * HOUR_MS;
const MAX_BYTES = 512 * 1024;
const RETRYABLE = new Set([500, 502, 503, 504]);
/** NAQI pollutants in the order their hours are requested. */
const SERIES_ORDER = ['pm25', 'pm10', 'no2', 'so2', 'o3', 'co', 'nh3'];

/**
 * The conservative OpenAQ ledger: 100 requests a day, 2,000 a month and 10 a
 * minute, against OpenAQ's published free limits of 60 a minute and 2,000 an
 * hour. Reservations are durable and include failed attempts and retries.
 */
export function createOpenAqBudget(options = {}) {
  return createFieldContextBudget({
    file: path.join(process.cwd(), '.gev-cache', 'openaq-budget.json'),
    dailyLimit: 100,
    monthlyLimit: 2000,
    minuteLimit: 10,
    ...options,
  });
}

/** OpenAQ truncates coordinates at four decimals; queries share 0.01° cells. */
export function openAqQueryPoint(point) {
  return {
    lat: Number(point.lat.toFixed(2)),
    lon: Number(point.lon.toFixed(2)),
  };
}

const hourFloor = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS;
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export function createOpenAqAdapter({
  fetchImpl = (...args) => globalThis.fetch(...args),
  resolveKey = () => process.env.OPENAQ_API_KEY,
  budget = createOpenAqBudget(),
  now = Date.now,
  timeoutMs = 10_000,
  retryDelayMs = 750,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const cache = createSourceCache({ now, max: 256 });
  let cooldownUntil = 0;
  let reservation = Promise.resolve();
  const reserve = () => {
    const next = reservation.then(() => budget.reserve());
    reservation = next.catch(() => {});
    return next;
  };

  async function attempt(url, key) {
    return requestWithDeadline(
      async (signal) => {
        const response = await fetchImpl(url, {
          signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'X-API-Key': key,
            'User-Agent': 'AUREL-personal-air-quality/1.0',
          },
        });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel?.().catch(() => {});
          throw sourceError('needs-key', 'key-rejected');
        }
        if (response.status === 429) {
          cooldownUntil = now() + retryAfterMs(response, now());
          await response.body?.cancel?.().catch(() => {});
          throw sourceError('rate-limited');
        }
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          throw Object.assign(sourceError('unavailable', 'upstream'), {
            retryable: RETRYABLE.has(response.status),
          });
        }
        return readResponseJsonCapped(response, MAX_BYTES, signal);
      },
      { timeoutMs },
    );
  }

  /** One budgeted GET with a single retry for transient upstream failures. */
  async function call(pathname, params) {
    const key = String(resolveKey() ?? '').trim();
    if (!key) throw sourceError('needs-key', 'no-key');
    const url = new URL(`${OPENAQ_ROOT}${pathname}`);
    url.search = new URLSearchParams(params).toString();
    for (let tries = 0; ; tries += 1) {
      if (cooldownUntil > now()) throw sourceError('rate-limited');
      const admission = await reserve();
      if (!admission.ok) throw sourceError('blocked', admission.reason);
      try {
        return await attempt(url.href, key);
      } catch (error) {
        const typed = typeof error?.code === 'string' && !error.retryable;
        if (typed || tries >= 1) {
          if (typed) throw error;
          throw sourceError('unavailable', 'upstream');
        }
        await sleep(retryDelayMs);
      }
    }
  }

  function locations(point) {
    const q = openAqQueryPoint(point);
    return cache.get(`locations:${q.lat},${q.lon}`, TTL.locations, async () =>
      normalizeLocations(
        await call('/locations', {
          coordinates: `${q.lat},${q.lon}`,
          radius: String(OPENAQ_RADIUS_M),
          monitor: 'true',
          limit: '20',
        }),
        { limit: OPENAQ_MAX_STATIONS },
      ),
    );
  }

  function latest(station) {
    return cache.get(`latest:${station.locationId}`, TTL.latest, async () =>
      normalizeLatest(
        await call(`/locations/${station.locationId}/latest`, { limit: '50' }),
        station,
      ),
    );
  }

  function sensorHours(sensorId) {
    if (!Number.isSafeInteger(sensorId) || sensorId <= 0)
      return Promise.reject(sourceError('invalid-request'));
    return cache.get(`hours:${sensorId}`, TTL.hours, async () => {
      const to = hourFloor(now()) + HOUR_MS;
      return normalizeHours(
        await call(`/sensors/${sensorId}/hours`, {
          datetime_from: iso(to - 26 * HOUR_MS),
          datetime_to: iso(to),
          limit: '40',
        }),
      );
    });
  }

  return {
    /** Nearest reference monitors and their latest values, with a typed state. */
    async nearby(point) {
      let found;
      try {
        found = await locations(point);
      } catch (error) {
        return emptyStations(error);
      }
      if (found.value.length === 0)
        return {
          state: found.stale ? 'stale' : 'no-monitor',
          reason: found.reason,
          retrievedAt: iso(found.retrievedAt),
          stations: [],
        };
      const pieces = await Promise.all(
        found.value.map((station) =>
          latest(station).then(
            (result) => ({ station, result }),
            (error) => ({ station, error }),
          ),
        ),
      );
      return summarizeStations(found, pieces, now());
    },

    /** 26 h of hourly aggregates for every NAQI pollutant of one station. */
    async stationSeries(station) {
      const sensors = SERIES_ORDER.map((pollutant) =>
        station.sensors.find((sensor) => sensor.pollutant === pollutant),
      ).filter(Boolean);
      const series = {};
      const failures = [];
      let retrievedAt = null;
      let stale = false;
      // Sequential, so a budget refusal stops further dispatch at once.
      for (const sensor of sensors) {
        try {
          const result = await sensorHours(sensor.sensorId);
          series[sensor.pollutant] = result.value;
          stale ||= result.stale;
          retrievedAt =
            retrievedAt === null
              ? result.retrievedAt
              : Math.min(retrievedAt, result.retrievedAt);
        } catch (error) {
          failures.push(error?.code || 'unavailable');
          if (error?.code === 'blocked' || error?.code === 'needs-key') break;
        }
      }
      const got = Object.keys(series).length;
      return {
        stationId: station.id,
        state: seriesState(got, sensors.length, failures, stale),
        reason: failures[0] ?? null,
        retrievedAt: iso(retrievedAt),
        series,
      };
    },

    /** Hourly aggregates for one sensor (the station-threshold watch). */
    async sensorSeries(sensorId) {
      try {
        const result = await sensorHours(sensorId);
        return {
          state: result.stale ? 'stale' : 'ok',
          reason: result.reason,
          retrievedAt: iso(result.retrievedAt),
          hours: result.value,
        };
      } catch (error) {
        return {
          state: error?.code || 'unavailable',
          reason: error?.reason || null,
          retrievedAt: null,
          hours: [],
        };
      }
    },
  };
}

function emptyStations(error) {
  return {
    state: error?.code || 'unavailable',
    reason: error?.reason || null,
    retrievedAt: null,
    stations: [],
  };
}

function seriesState(got, wanted, failures, stale) {
  if (got === 0)
    return failures[0] || (wanted === 0 ? 'no-data' : 'unavailable');
  if (failures.length || got < wanted) return 'partial';
  return stale ? 'stale' : 'ok';
}

/**
 * Typed state for a station lookup:
 * - an upstream error code when no station's readings could be retrieved;
 * - `no-data` when monitors exist but none reported in the last 24 h;
 * - `stale` when the newest reading is over 3 h old or came from cache;
 * - `partial` when some stations' readings failed;
 * - `ok` otherwise.
 */
function summarizeStations(found, pieces, clock) {
  const failures = pieces.filter((piece) => piece.error);
  const stations = pieces.map(({ station, result }) => ({
    ...station,
    latest: result?.value ?? [],
    latestRetrievedAt: iso(result?.retrievedAt),
  }));
  const retrieved = [found, ...pieces.map((piece) => piece.result)]
    .filter(Boolean)
    .map((result) => result.retrievedAt);
  const base = {
    reason: failures[0]?.error?.code ?? found.reason ?? null,
    retrievedAt: iso(Math.min(...retrieved)),
    stations,
  };
  if (failures.length === pieces.length)
    return {
      ...base,
      state: failures[0].error?.code || 'unavailable',
      reason: failures[0].error?.reason ?? null,
    };
  const newest = Math.max(
    ...stations.flatMap((station) =>
      station.latest.map((row) => Date.parse(row.observedAt)),
    ),
    -Infinity,
  );
  if (!Number.isFinite(newest) || clock - newest > OBSERVATION_NO_DATA_MS)
    return { ...base, state: 'no-data' };
  if (failures.length) return { ...base, state: 'partial' };
  const cached = found.stale || pieces.some((piece) => piece.result?.stale);
  if (cached || clock - newest > OBSERVATION_STALE_MS)
    return { ...base, state: 'stale' };
  return { ...base, state: 'ok' };
}
