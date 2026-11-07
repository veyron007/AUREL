/**
 * Same-site, fixed-capability air-quality routes. The browser never sees keys
 * or upstream URLs; it asks for a point and gets typed station and citizen
 * tiers back, which it renders as separate cards.
 *
 *   GET /api/air-quality/near?lat=&lon=[&detail=0|1][&station=openaq:N][&citizen=0|1]
 *   GET /api/air-quality/sensor?id=N
 */
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { fieldQueryPoint } from '../../../src/sources/fieldContextModel.js';
import { createOpenAqAdapter, OPENAQ_RADIUS_M } from './openaq.js';
import {
  createSensorCommunityAdapter,
  SENSOR_COMMUNITY_RADIUS_KM,
} from './sensor-community.js';

const NEAR = '/api/air-quality/near';
const SENSOR = '/api/air-quality/sensor';
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

const queryError = () => Object.assign(new Error('query'), { code: 'query' });

function single(url, allowed) {
  if (url.search.length > 256) throw queryError();
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw queryError();
}

function flag(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (raw !== '0' && raw !== '1') throw queryError();
  return raw === '1';
}

/** Parse and bound the near query. */
export function parseNearQuery(url) {
  single(url, ['lat', 'lon', 'detail', 'station', 'citizen']);
  const values = ['lat', 'lon'].map((key) => url.searchParams.get(key));
  if (values.some((value) => !value || !DECIMAL.test(value)))
    throw queryError();
  let requested;
  try {
    requested = fieldQueryPoint({
      lat: Number(values[0]),
      lon: Number(values[1]),
    });
  } catch {
    throw queryError();
  }
  const station = url.searchParams.get('station');
  if (station !== null && !/^openaq:\d{1,12}$/.test(station))
    throw queryError();
  return {
    requested,
    detail: flag(url, 'detail', false),
    citizen: flag(url, 'citizen', true),
    station,
  };
}

/** Parse the sensor query: one positive OpenAQ sensor id. */
export function parseSensorQuery(url) {
  single(url, ['id']);
  const raw = url.searchParams.get('id');
  if (!raw || !/^\d{1,12}$/.test(raw)) throw queryError();
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw queryError();
  return { id };
}

function respondWith(res) {
  return (status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
}

/** Pick the detail station: the requested one, else the nearest with readings. */
function detailStation(stations, requestedId) {
  if (requestedId)
    return stations.find((station) => station.id === requestedId) ?? null;
  return stations.find((station) => station.latest.length > 0) ?? null;
}

export function createAirQualityMiddleware({
  openaq = createOpenAqAdapter(),
  citizen = createSensorCommunityAdapter(),
} = {}) {
  const admit = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 40 });

  async function near(query) {
    const [stations, citizenTier] = await Promise.all([
      openaq.nearby(query.requested),
      query.citizen
        ? citizen.nearby(query.requested)
        : { state: 'disabled', reason: null, retrievedAt: null, sensors: [] },
    ]);
    let detail = null;
    if (query.detail || query.station) {
      const station = detailStation(stations.stations, query.station);
      detail = station
        ? await openaq.stationSeries(station)
        : {
            stationId: query.station,
            state: 'no-monitor',
            reason: null,
            retrievedAt: null,
            series: {},
          };
    }
    return {
      version: 1,
      requested: query.requested,
      stations: {
        tier: 'station',
        provider: 'openaq',
        radiusM: OPENAQ_RADIUS_M,
        ...stations,
        detail,
      },
      citizen: {
        tier: 'citizen',
        provider: 'sensor-community',
        radiusM: SENSOR_COMMUNITY_RADIUS_KM * 1000,
        ...citizenTier,
      },
    };
  }

  return async function airQualityMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== NEAR && url.pathname !== SENSOR) return next();
    const respond = respondWith(res);
    if (admitSameSiteKeyless(req, res)) return undefined;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return respond(405, { error: 'Method not allowed' });
    }
    let query;
    try {
      query =
        url.pathname === NEAR ? parseNearQuery(url) : parseSensorQuery(url);
    } catch {
      return respond(400, {
        error:
          url.pathname === NEAR
            ? 'Expected finite lat and lon, optional detail/citizen=0|1 and station=openaq:<id>'
            : 'Expected one numeric sensor id',
      });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Air-quality request limit reached' });
    }
    try {
      if (url.pathname === SENSOR) {
        const series = await openaq.sensorSeries(query.id);
        return respond(200, {
          version: 1,
          provider: 'openaq',
          sensorId: query.id,
          ...series,
        });
      }
      return respond(200, await near(query));
    } catch {
      return respond(502, { error: 'Air-quality sources are unavailable' });
    }
  };
}

/** Vite installation for dev and preview servers. */
export function airQualityProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createAirQualityMiddleware(options));
  };
  return {
    name: 'air-quality-stations',
    configureServer: install,
    configurePreviewServer: install,
  };
}
