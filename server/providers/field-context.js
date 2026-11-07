import { createFieldContextBudget } from './field-context-budget.js';
import { admitSameSiteKeyless } from './common/same-site.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { readResponseJsonCapped } from './common/http.js';
import { requestWithDeadline } from '../../src/sources/requestDeadline.js';
import {
  fieldQueryPoint,
  normalizeFieldProvider,
  unavailableFieldProvider,
} from '../../src/sources/fieldContextModel.js';
const MAX_BYTES = 256 * 1024;
const CACHE_MAX = 64;
const STALE_MS = 6 * 3600000;
const TTL = { weather: 30 * 60000, airQuality: 60 * 60000 };
function retryDelay(response, clock) {
  const raw = response.headers?.get('retry-after');
  const delay = /^\d+$/.test(raw || '')
    ? Number(raw) * 1000
    : Date.parse(raw) - clock;
  return Number.isFinite(delay) && delay > 0
    ? Math.min(86400000, Math.max(60000, delay))
    : 5 * 60000;
}
function sourceUrl(point, kind) {
  const aq = kind === 'airQuality';
  const url = new URL(
    aq
      ? 'https://air-quality-api.open-meteo.com/v1/air-quality'
      : 'https://api.open-meteo.com/v1/forecast',
  );
  const params = {
    latitude: String(point.lat),
    longitude: String(point.lon),
    timezone: 'GMT',
    forecast_hours: '48',
    hourly: aq
      ? 'pm2_5,pm10,us_aqi'
      : 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code',
  };
  if (aq) params.domains = 'cams_global';
  else params.wind_speed_unit = 'ms';
  url.search = new URLSearchParams(params).toString();
  return url.href;
}
function parsePoint(url) {
  if (url.search.length > 256) throw new Error('query');
  for (const key of url.searchParams.keys())
    if (
      !['lat', 'lon', 'aq'].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      throw new Error('query');
  const values = ['lat', 'lon'].map((k) => url.searchParams.get(k));
  if (values.some((v) => !v || !/^-?\d+(?:\.\d+)?$/.test(v)))
    throw new Error('query');
  const requested = { lat: Number(values[0]), lon: Number(values[1]) };
  const aq = url.searchParams.get('aq');
  if (aq !== null && !['0', '1'].includes(aq)) throw new Error('query');
  return {
    requested,
    queried: fieldQueryPoint(requested),
    airQuality: aq !== '0',
  };
}
/** Fixed, keyless forecast capabilities. No URLs, credentials or arbitrary variables are accepted. */
export function createFieldContextMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget = createFieldContextBudget({ now }),
  timeoutMs = 9000,
} = {}) {
  const cache = new Map(),
    inflight = new Map(),
    cooldown = new Map();
  const admit = makeRateLimiter({ windowMs: 60000, max: 12, globalMax: 24 });
  let reservation = Promise.resolve();
  const reserve = () => {
    const next = reservation.then(() => budget.reserve());
    reservation = next.catch(() => {});
    return next;
  };
  const fallback = (kind, old, reason, state = 'unavailable') =>
    old &&
    now() >= Date.parse(old.retrievedAt) &&
    now() - Date.parse(old.retrievedAt) <= STALE_MS
      ? { ...old, state: 'stale', reason }
      : unavailableFieldProvider(kind, reason, state);
  async function acquire(point, kind, key, old) {
    try {
      const admission = await reserve();
      if (!admission.ok)
        return fallback(kind, old, admission.reason, 'blocked');
      const value = await requestWithDeadline(
        async (signal) => {
          const response = await fetchImpl(sourceUrl(point, kind), {
            signal,
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'AUREL-personal-field-context/1.0',
            },
          });
          if (!response.ok) {
            if (response.status === 429) {
              cooldown.set(kind, now() + retryDelay(response, now()));
              throw Object.assign(new Error('limited'), {
                code: 'rate-limited',
              });
            }
            throw new Error('upstream');
          }
          return normalizeFieldProvider(
            await readResponseJsonCapped(response, MAX_BYTES, signal),
            kind,
            now(),
          );
        },
        { timeoutMs },
      );
      if (cache.has(key)) cache.delete(key);
      cache.set(key, value);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return value;
    } catch (error) {
      return fallback(
        kind,
        old,
        error?.code === 'rate-limited'
          ? 'rate-limited'
          : 'upstream-unavailable',
      );
    }
  }
  function getSource(point, kind) {
    const key = `${kind}:${point.lat},${point.lon}`,
      old = cache.get(key);
    const age = old ? now() - Date.parse(old.retrievedAt) : Infinity;
    if (old && age >= 0 && age < TTL[kind]) return Promise.resolve(old);
    if (inflight.has(key)) return inflight.get(key);
    if ((cooldown.get(kind) || 0) > now())
      return Promise.resolve(fallback(kind, old, 'rate-limited'));
    if (inflight.size >= 8)
      return Promise.resolve(fallback(kind, old, 'rate-limited', 'blocked'));
    const pending = acquire(point, kind, key, old).finally(() =>
      inflight.delete(key),
    );
    inflight.set(key, pending);
    return pending;
  }
  return async function fieldContextMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/field-context') return next();
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
      query = parsePoint(url);
    } catch {
      return respond(400, {
        error:
          'Expected finite latitude and longitude, and optional aq=0 or aq=1',
      });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Field context request limit reached' });
    }
    const { requested, queried } = query;
    const [weather, airQuality] = await Promise.all([
      getSource(queried, 'weather'),
      query.airQuality
        ? getSource(queried, 'airQuality')
        : unavailableFieldProvider('airQuality', 'disabled'),
    ]);
    respond(200, { version: 1, requested, queried, weather, airQuality });
  };
}

/** Standalone Vite installation; keep the route's full path for validation. */
export function fieldContextProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createFieldContextMiddleware(options));
  };
  return {
    name: 'field-context',
    configureServer: install,
    configurePreviewServer: install,
  };
}
