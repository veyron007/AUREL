/**
 * `/api/horizon/terrain?lat=&lon=&radiusKm=`: the bounded polar DEM grid for
 * the Kshitij horizon engine. Keyless (Copernicus GLO-30 on AWS Open Data),
 * same-site only, rate limited, disk cached. The ray-march itself runs in
 * the caller (browser worker or Node), not here.
 */
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  AZIMUTH_COUNT,
  AZIMUTH_STEP_DEG,
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from '../../../src/horizon/constants.js';
import { GRID_VERSION, int16ToBase64 } from '../../../src/horizon/grid.js';
import {
  createByteBudget,
  createGlo30Reader,
  GLO30_SOURCE,
} from './glo30.js';
import {
  samplePolarGrid,
  SAMPLING_LEVELS,
  SAMPLING_NOTE,
} from './sampler.js';

const NUMBER = /^-?\d{1,3}(?:\.\d{1,7})?$/;
export function parseTerrainQuery(url) {
  if (url.search.length > 120) throw new Error('invalid-request');
  const value = {};
  for (const [key, input] of url.searchParams) {
    if (Object.hasOwn(value, key) || !['lat', 'lon', 'radiusKm'].includes(key))
      throw new Error('invalid-request');
    if (!NUMBER.test(input)) throw new Error('invalid-request');
    value[key] = Number(input);
  }
  const radiusKm = value.radiusKm ?? DEFAULT_RADIUS_KM;
  if (
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lon) ||
    Math.abs(value.lat) > 85 ||
    Math.abs(value.lon) > 180 ||
    !Number.isInteger(radiusKm) ||
    radiusKm < MIN_RADIUS_KM ||
    radiusKm > MAX_RADIUS_KM
  )
    throw new Error('invalid-request');
  return {
    lat: Math.round(value.lat * 1e5) / 1e5,
    lon: Math.round(value.lon * 1e5) / 1e5,
    radiusKm,
  };
}

/** Build the response payload for one bounded query. */
export function createHorizonTerrainService({ reader = createGlo30Reader(), sample = samplePolarGrid } = {}) {
  const recent = new Map(),
    inflight = new Map();
  async function compute({ lat, lon, radiusKm }) {
    const budget = createByteBudget();
    const result = await sample({
      lat,
      lon,
      radiusM: radiusKm * 1000,
      readBlock: (name, level, bx, by) => reader.readBlock(name, level, bx, by, { budget }),
      blockSize: reader.blockSize,
    });
    return {
      version: GRID_VERSION,
      observer: { lat, lon, groundM: result.groundM },
      radiusM: radiusKm * 1000,
      azimuthStepDeg: AZIMUTH_STEP_DEG,
      azimuthCount: AZIMUTH_COUNT,
      distancesM: result.distances,
      heights: int16ToBase64(result.heights),
      voidSamples: result.voidSamples,
      absentTiles: result.absentTiles,
      levels: SAMPLING_LEVELS.filter((entry) => entry.fromM < radiusKm * 1000).map(
        (entry) => ({
          level: entry.level,
          fromM: entry.fromM,
          toM: Math.min(entry.toM, radiusKm * 1000),
          resolutionArcSec: entry.resolutionArcSec,
        }),
      ),
      sampling: SAMPLING_NOTE,
      source: {
        ...GLO30_SOURCE,
        retrievedAt: result.retrievedAt,
        tiles: result.tiles,
      },
      transfer: { ...budget.snapshot(), fetchedBlocks: result.fetched, cachedBlocks: result.fromCache },
    };
  }
  return {
    async getTerrain(query) {
      const key = `${query.lat},${query.lon},${query.radiusKm}`;
      if (recent.has(key)) return recent.get(key);
      if (!inflight.has(key))
        inflight.set(
          key,
          compute(query).finally(() => inflight.delete(key)),
        );
      const payload = await inflight.get(key);
      recent.set(key, payload);
      while (recent.size > 8) recent.delete(recent.keys().next().value);
      return payload;
    },
  };
}

const ERRORS = {
  'range-budget-exceeded': [503, 'The DEM read budget for this request was exceeded.'],
  'rate-limited': [429, 'The DEM host is limiting requests; try again later.'],
  'invalid-range-response': [502, 'The DEM host returned an unexpected response.'],
};

export function createHorizonMiddleware({ service = createHorizonTerrainService() } = {}) {
  const admit = makeRateLimiter({ windowMs: 60000, max: 12, globalMax: 24 });
  return async function horizonMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/horizon/terrain') return next();
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(value));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return respond(405, { error: 'Method not allowed' });
    }
    let query;
    try {
      query = parseTerrainQuery(url);
    } catch {
      return respond(400, {
        error: 'Expected lat (±85), lon (±180) and an integer radiusKm from 10 to 200.',
      });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Horizon request limit reached' });
    }
    try {
      respond(200, await service.getTerrain(query));
    } catch (error) {
      const [status, message] = ERRORS[error?.message] ?? [
        502,
        'The DEM could not be read for this place.',
      ];
      console.warn(`[horizon-dem] ${error?.message || 'request failed'}`);
      respond(status, { error: message });
    }
  };
}

export function horizonProxy(options = {}) {
  const middleware = createHorizonMiddleware(options);
  const install = (server) => server.middlewares.use(middleware);
  return {
    name: 'kshitij-horizon-terrain',
    configureServer: install,
    configurePreviewServer: install,
  };
}
