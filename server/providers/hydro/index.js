/**
 * Raindrop data routes. Fixed keyless capabilities only:
 *   GET /api/hydro/imerg?cells=i:j,…&window=1h|3h|24h   GIBS IMERG (no ledger)
 *   GET /api/hydro/forecast?pts=lat,lon;…                Open-Meteo, 1 unit per point
 *   GET /api/hydro/glofas?lat=…&lon=…                    Open-Meteo Flood, 7 units
 * Open-Meteo requests reserve units on the same local ledger the Planner uses
 * (`.gev-cache/field-context-budget.json`) before dispatch, including failed
 * attempts. A refused reservation never reaches the network.
 */
import { createFieldContextBudget } from '../field-context-budget.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';
import { IMERG_WINDOWS } from '../../../src/hydro/imerg.js';
import { imergCellCenter } from '../../../src/hydro/route.js';
import {
  FORECAST_UNITS_PER_POINT,
  GLOFAS_UNITS,
  createHydroUpstreams,
} from './upstreams.js';

const MAX_CELLS = 24;
const MAX_POINTS = 3;
const CACHE_MAX = 32;
const FORECAST_TTL_MS = 30 * 60_000;
const GLOFAS_TTL_MS = 6 * 3600_000;
const COORD = /^-?\d{1,3}(?:\.\d{1,6})?$/;

function only(url, keys) {
  if (url.search.length > 512) throw new Error('query');
  for (const key of url.searchParams.keys())
    if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new Error('query');
}
function point(lat, lon) {
  if (!COORD.test(lat) || !COORD.test(lon)) throw new Error('query');
  const value = { lat: Number(lat), lon: Number(lon) };
  if (Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180)
    throw new Error('query');
  return value;
}
export function parseImergQuery(url) {
  only(url, ['cells', 'window']);
  const window = url.searchParams.get('window');
  if (!Object.hasOwn(IMERG_WINDOWS, window)) throw new Error('query');
  const keys = (url.searchParams.get('cells') || '').split(',');
  if (!keys.length || keys.length > MAX_CELLS || new Set(keys).size !== keys.length)
    throw new Error('query');
  const cells = keys.map((key) => {
    const match = /^(\d{1,4}):(\d{1,4})$/.exec(key);
    if (!match || Number(match[1]) >= 3600 || Number(match[2]) >= 1800)
      throw new Error('query');
    return { key, center: imergCellCenter(key) };
  });
  const lons = cells.map((c) => c.center[0]),
    lats = cells.map((c) => c.center[1]);
  if (Math.max(...lons) - Math.min(...lons) > 2 || Math.max(...lats) - Math.min(...lats) > 2)
    throw new Error('query');
  return { cells, window, steps: IMERG_WINDOWS[window] };
}
export function parseForecastQuery(url) {
  only(url, ['pts']);
  const parts = (url.searchParams.get('pts') || '').split(';');
  if (!parts.length || parts.length > MAX_POINTS) throw new Error('query');
  return parts.map((part) => {
    const [lat, lon, extra] = part.split(',');
    if (extra !== undefined) throw new Error('query');
    return point(lat, lon);
  });
}
export function parseGlofasQuery(url) {
  only(url, ['lat', 'lon']);
  return point(url.searchParams.get('lat'), url.searchParams.get('lon'));
}

export function createHydroMiddleware({
  upstreams = createHydroUpstreams(),
  now = Date.now,
  budget = createFieldContextBudget({ now }),
  timeoutMs = 20_000,
} = {}) {
  const admit = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 40 });
  const cache = new Map(),
    inflight = new Map();
  let reservation = Promise.resolve();
  /** Reserve `units` one at a time; stop at the first refusal. */
  const reserve = (units) => {
    const next = reservation.then(async () => {
      for (let i = 0; i < units; i++) {
        const result = await budget.reserve();
        if (!result.ok) return { ...result, reserved: i };
      }
      return { ok: true, reserved: units };
    });
    reservation = next.catch(() => {});
    return next;
  };
  const remember = (key, value) => {
    cache.delete(key);
    cache.set(key, { at: now(), value });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return value;
  };
  async function ledgered(key, ttl, units, run) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return { ...hit.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const admission = await reserve(units);
      if (!admission.ok)
        return {
          state: 'blocked',
          reason: admission.reason,
          unitsReserved: admission.reserved,
        };
      try {
        const value = await requestWithDeadline(run, { timeoutMs });
        return remember(key, {
          state: 'ready',
          unitsReserved: units,
          ...value,
        });
      } catch (error) {
        return {
          state: 'unavailable',
          reason: error?.code === 'rate-limited' ? 'rate-limited' : 'upstream-unavailable',
          unitsReserved: units,
        };
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  async function imerg(query) {
    try {
      const value = await requestWithDeadline(
        (signal) => upstreams.imerg(query.cells, query.steps, signal),
        { timeoutMs },
      );
      const published = value.steps.filter((step) => step.published).length;
      return {
        state: published === value.steps.length ? 'ready' : published ? 'partial' : 'unavailable',
        window: query.window,
        ...value,
      };
    } catch {
      return { state: 'unavailable', reason: 'upstream-unavailable', window: query.window };
    }
  }

  return async function hydroMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    const route = {
      '/api/hydro/imerg': 'imerg',
      '/api/hydro/forecast': 'forecast',
      '/api/hydro/glofas': 'glofas',
    }[url.pathname];
    if (!route) return next();
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ version: 1, ...value }));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return respond(405, { error: 'Method not allowed' });
    }
    let query;
    try {
      query =
        route === 'imerg'
          ? parseImergQuery(url)
          : route === 'forecast'
            ? parseForecastQuery(url)
            : parseGlofasQuery(url);
    } catch {
      return respond(400, { error: 'Invalid hydro query' });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Hydro request limit reached' });
    }
    if (route === 'imerg') return respond(200, await imerg(query));
    if (route === 'forecast')
      return respond(
        200,
        await ledgered(
          `forecast:${query.map((p) => `${p.lat},${p.lon}`).join(';')}`,
          FORECAST_TTL_MS,
          query.length * FORECAST_UNITS_PER_POINT,
          (signal) => upstreams.forecast(query, signal),
        ),
      );
    return respond(
      200,
      await ledgered(
        `glofas:${query.lat},${query.lon}`,
        GLOFAS_TTL_MS,
        GLOFAS_UNITS,
        (signal) => upstreams.glofas(query, signal),
      ),
    );
  };
}

/** Vite installation, registered beside the field-context route. */
export function hydroProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createHydroMiddleware(options));
  };
  return {
    name: 'hydro',
    configureServer: install,
    configurePreviewServer: install,
  };
}
