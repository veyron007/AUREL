/**
 * Orbit Witness routes. Fixed keyless hosts only:
 * - /api/orbit-witness/scenes: Earth Search STAC v1 and NASA CMR-STAC LPCLOUD,
 *   bounded area and window, its own durable request ledger.
 * - /api/orbit-witness/cloud: Open-Meteo hourly cloud cover for 14 days,
 *   charged to the existing field-context (Open-Meteo) ledger.
 * Every reservation is committed before dispatch; refusal never reaches upstream.
 */
import path from 'node:path';
import { createFieldContextBudget } from '../field-context-budget.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { readResponseJsonCapped } from '../common/http.js';
import { requestWithDeadline } from '../../../src/sources/requestDeadline.js';
import {
  normalizeStacItem,
  validateSceneQuery,
  SCENE_QUERY_LIMITS,
} from '../../../src/orbitWitness/catalogueModel.js';

export const EARTH_SEARCH_SEARCH =
  'https://earth-search.aws.element84.com/v1/search';
export const CMR_STAC_SEARCH =
  'https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search';
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MAX_BYTES = 2 * 1024 * 1024;
const SCENE_TTL_MS = 10 * 60000;
const CLOUD_TTL_MS = 60 * 60000;
const CLOUD_STALE_MS = 6 * 3600000;
const CACHE_MAX = 32;
const USER_AGENT = 'AUREL-orbit-witness/1.0 (personal research desk)';

const UPSTREAMS = Object.freeze([
  Object.freeze({
    id: 'earth-search',
    url: EARTH_SEARCH_SEARCH,
    collections: 'sentinel-2-l2a,landsat-c2-l2',
  }),
  Object.freeze({
    id: 'cmr-stac-lpcloud',
    url: CMR_STAC_SEARCH,
    collections: 'HLSS30_2.0,HLSL30_2.0',
  }),
]);

const emptyRow = (id, status) => ({
  id,
  status,
  count: 0,
  truncated: false,
  scenes: [],
});

function retryDelay(response, clock) {
  const raw = response.headers?.get('retry-after');
  const delay = /^\d+$/.test(raw || '')
    ? Number(raw) * 1000
    : Date.parse(raw) - clock;
  return Number.isFinite(delay) && delay > 0
    ? Math.min(86400000, Math.max(60000, delay))
    : 15 * 60000;
}

/** Serialise reservations: the ledger lock refuses concurrent writers. */
function serialBudget(budget) {
  let chain = Promise.resolve();
  return () => {
    const next = chain.then(async () => {
      let result = await budget.reserve();
      if (!result.ok && result.reason === 'budget-busy') {
        await new Promise((resolve) => setTimeout(resolve, 150));
        result = await budget.reserve();
      }
      return result;
    });
    chain = next.catch(() => {});
    return next;
  };
}

function cacheSet(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function respond(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, header] of Object.entries(headers))
    res.setHeader(name, header);
  res.end(JSON.stringify(value));
}

function onlyKeys(url, keys) {
  if (url.search.length > 256) throw new TypeError('query');
  for (const key of url.searchParams.keys())
    if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new TypeError('query');
  if (keys.some((key) => !url.searchParams.has(key)))
    throw new TypeError('query');
}

export function parseSceneRequest(url, now) {
  onlyKeys(url, ['bbox', 'from', 'to']);
  const raw = url.searchParams.get('bbox').split(',');
  if (raw.length !== 4 || raw.some((x) => !/^-?\d+(?:\.\d+)?$/.test(x)))
    throw new TypeError('bbox');
  return validateSceneQuery(
    {
      bbox: raw.map(Number),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    },
    { now },
  );
}

export function stacSearchUrl(upstream, query) {
  const url = new URL(upstream.url);
  url.search = new URLSearchParams({
    collections: upstream.collections,
    bbox: query.bbox.join(','),
    datetime: `${query.from}T00:00:00Z/${query.to}T23:59:59Z`,
    limit: String(SCENE_QUERY_LIMITS.pageSize),
  }).toString();
  return url.href;
}

function readFeatures(upstream, json) {
  if (!Array.isArray(json?.features))
    return emptyRow(upstream.id, 'invalid-response');
  const scenes = json.features
    .map((item) => normalizeStacItem(item, upstream.id))
    .filter(Boolean);
  const matched = Number(json.numberMatched);
  const truncated =
    (Number.isFinite(matched) && matched > json.features.length) ||
    (Array.isArray(json.links) &&
      json.links.some((link) => link?.rel === 'next'));
  return {
    id: upstream.id,
    status: truncated ? 'partial' : 'ok',
    count: scenes.length,
    truncated,
    scenes,
  };
}

/** Scene search middleware; injectable transport, clock and ledger for tests. */
export function createSceneCatalogueMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget = createFieldContextBudget({
    file: path.join(
      process.cwd(),
      '.gev-cache',
      'orbit-witness-stac-budget.json',
    ),
    now,
  }),
  timeoutMs = 15000,
} = {}) {
  const cache = new Map(),
    inflight = new Map(),
    cooldown = new Map();
  const reserve = serialBudget(budget);
  const admit = makeRateLimiter({ windowMs: 60000, max: 6, globalMax: 12 });

  async function readUpstream(upstream, query) {
    if ((cooldown.get(upstream.id) || 0) > now())
      return emptyRow(upstream.id, 'rate-limited');
    const admission = await reserve();
    if (!admission.ok) return emptyRow(upstream.id, 'blocked');
    try {
      return await requestWithDeadline(
        async (signal) => {
          const response = await fetchImpl(stacSearchUrl(upstream, query), {
            signal,
            redirect: 'error',
            headers: {
              Accept: 'application/geo+json',
              'User-Agent': USER_AGENT,
            },
          });
          if (response.status === 429)
            cooldown.set(upstream.id, now() + retryDelay(response, now()));
          if (!response.ok) {
            void response.body?.cancel?.().catch(() => {});
            return emptyRow(
              upstream.id,
              response.status === 429 ? 'rate-limited' : 'unavailable',
            );
          }
          return readFeatures(
            upstream,
            await readResponseJsonCapped(response, MAX_BYTES, signal),
          );
        },
        { timeoutMs },
      );
    } catch (error) {
      return emptyRow(
        upstream.id,
        error?.name === 'TimeoutError' ? 'timeout' : 'unavailable',
      );
    }
  }

  async function search(query) {
    const rows = await Promise.all(
      UPSTREAMS.map((upstream) => readUpstream(upstream, query)),
    );
    const scenes = rows
      .flatMap((row) => row.scenes)
      .sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime))
      .slice(0, SCENE_QUERY_LIMITS.maxScenes);
    return {
      version: 1,
      retrievedAt: new Date(now()).toISOString(),
      sources: rows.map(({ id, status, count, truncated }) => ({
        id,
        status,
        count,
        truncated,
      })),
      scenes,
    };
  }

  return async function sceneCatalogueMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/orbit-witness/scenes') return next();
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET')
      return respond(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
    let query;
    try {
      query = parseSceneRequest(url, now());
    } catch {
      return respond(res, 400, {
        error:
          'Expected bbox (at most two degrees per side), from and to (1–14 past UTC days)',
      });
    }
    const key = `${query.bbox.join(',')}:${query.from}:${query.to}`;
    const old = cache.get(key);
    if (old && now() - old.at >= 0 && now() - old.at < SCENE_TTL_MS)
      return respond(res, 200, old.value);
    if (!admit(clientKey(req)))
      return respond(
        res,
        429,
        { error: 'Scene search limit reached' },
        { 'Retry-After': '60' },
      );
    let pending = inflight.get(key);
    if (!pending) {
      pending = search(query).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const value = await pending;
    if (value.sources.some((row) => ['ok', 'partial'].includes(row.status)))
      cacheSet(cache, key, { at: now(), value });
    respond(res, 200, value);
  };
}

export function parseCloudRequest(url) {
  onlyKeys(url, ['lat', 'lon']);
  const values = ['lat', 'lon'].map((k) => url.searchParams.get(k));
  if (values.some((v) => !/^-?\d+(?:\.\d+)?$/.test(v)))
    throw new TypeError('point');
  const [lat, lon] = values.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new TypeError('point');
  // About one kilometre: nearby requests share a cache entry and a reservation.
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

export function cloudForecastUrl(point) {
  const url = new URL(OPEN_METEO_FORECAST);
  url.search = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
    hourly: 'cloud_cover',
    // One variable over at most two weeks keeps the call at one Open-Meteo unit.
    forecast_days: '14',
    timezone: 'GMT',
  }).toString();
  return url.href;
}

export function normalizeCloudForecast(json, clock) {
  const times = json?.hourly?.time,
    values = json?.hourly?.cloud_cover;
  if (
    !Array.isArray(times) ||
    !Array.isArray(values) ||
    times.length !== values.length ||
    !times.length ||
    times.length > 400
  )
    throw new TypeError('cloud');
  const hours = [];
  times.forEach((time, i) => {
    if (
      typeof time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)
    )
      throw new TypeError('cloud');
    const value = values[i];
    if (Number.isFinite(value) && value >= 0 && value <= 100)
      hours.push({ time: `${time}:00.000Z`, cloudCoverPct: value });
  });
  if (!hours.length) throw new TypeError('cloud');
  return {
    version: 1,
    status: 'ok',
    retrievedAt: new Date(clock).toISOString(),
    model: 'best_match',
    hours,
  };
}

/** Cloud forecast middleware sharing the field-context ledger file by default. */
export function createCloudForecastMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget = createFieldContextBudget({ now }),
  timeoutMs = 9000,
} = {}) {
  const cache = new Map(),
    inflight = new Map();
  let cooldownUntil = 0;
  const reserve = serialBudget(budget);
  const admit = makeRateLimiter({ windowMs: 60000, max: 6, globalMax: 12 });
  const fallback = (old, reason, status = 'unavailable') =>
    old && now() - old.at >= 0 && now() - old.at <= CLOUD_STALE_MS
      ? { ...old.value, status: 'stale', reason }
      : { version: 1, status, reason, hours: [] };

  async function fetchForecast(point) {
    return requestWithDeadline(
      async (signal) => {
        const response = await fetchImpl(cloudForecastUrl(point), {
          signal,
          redirect: 'error',
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        });
        if (response.status === 429) {
          cooldownUntil = now() + retryDelay(response, now());
          throw Object.assign(new Error('limited'), { code: 'rate-limited' });
        }
        if (!response.ok) throw new Error('upstream');
        return normalizeCloudForecast(
          await readResponseJsonCapped(response, MAX_BYTES, signal),
          now(),
        );
      },
      { timeoutMs },
    );
  }

  async function acquire(point, key, old) {
    if (cooldownUntil > now()) return fallback(old, 'rate-limited');
    const admission = await reserve();
    if (!admission.ok) return fallback(old, admission.reason, 'blocked');
    try {
      const value = await fetchForecast(point);
      cacheSet(cache, key, { at: now(), value });
      return value;
    } catch (error) {
      return fallback(
        old,
        error?.code === 'rate-limited' ? 'rate-limited' : 'upstream-unavailable',
      );
    }
  }

  return async function cloudForecastMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/orbit-witness/cloud') return next();
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET')
      return respond(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
    let point;
    try {
      point = parseCloudRequest(url);
    } catch {
      return respond(res, 400, { error: 'Expected finite lat and lon' });
    }
    const key = `${point.lat},${point.lon}`;
    const old = cache.get(key);
    if (old && now() - old.at >= 0 && now() - old.at < CLOUD_TTL_MS)
      return respond(res, 200, old.value);
    if (!admit(clientKey(req)))
      return respond(
        res,
        429,
        { error: 'Cloud forecast limit reached' },
        { 'Retry-After': '60' },
      );
    let pending = inflight.get(key);
    if (!pending) {
      pending = acquire(point, key, old).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    respond(res, 200, await pending);
  };
}

/** Standalone Vite installation of both routes. */
export function orbitWitnessProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createSceneCatalogueMiddleware(options.scenes));
    server.middlewares.use(createCloudForecastMiddleware(options.cloud));
  };
  return {
    name: 'orbit-witness',
    configureServer: install,
    configurePreviewServer: install,
  };
}
