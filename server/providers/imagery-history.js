/** Fixed NASA dated imagery, no credentials, alternate hosts or paid fallback. */
import path from 'node:path';
import { createFieldContextBudget } from './field-context-budget.js';
import { admitSameSiteKeyless } from './common/same-site.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import {
  readResponseJsonCapped,
  readResponseBytesCapped,
} from './common/http.js';
import { requestWithDeadline } from '../../src/sources/requestDeadline.js';
import { searchWindow } from '../../src/layers/recentImagery/catalog.js';
import {
  HISTORY_LIMITS,
  validateHistoryWindow,
} from '../../src/layers/recentImagery/historical.js';
import { wvsSnapshotUrl } from '../../src/layers/recentImagery/model.js';

const PREFIX = '/api/imagery-history/';
function parseQuery(url, now) {
  const kind = url.pathname.slice(PREFIX.length);
  if (!['catalog', 'preview'].includes(kind) || url.search.length > 512)
    throw new TypeError('query');
  const allowed =
    kind === 'catalog'
      ? ['bbox', 'from', 'to', 'products']
      : ['bbox', 'product', 'day'];
  if (allowed.some((key) => !url.searchParams.has(key)))
    throw new TypeError('query');
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new TypeError('query');
  const raw = url.searchParams.get('bbox')?.split(',');
  if (raw?.length !== 4 || raw.some((x) => !/^[-]?\d+(?:\.\d+)?$/.test(x)))
    throw new TypeError('bbox');
  const [west, south, east, north] = raw.map(Number);
  const query = validateHistoryWindow(
    {
      box: { west, south, east, north },
      fromDay: url.searchParams.get(kind === 'catalog' ? 'from' : 'day'),
      toDay: url.searchParams.get(kind === 'catalog' ? 'to' : 'day'),
      products: url.searchParams
        .get(kind === 'catalog' ? 'products' : 'product')
        ?.split(','),
    },
    { now },
  );
  return { kind, query };
}
export function createImageryHistoryMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget = createFieldContextBudget({
    file: path.join(process.cwd(), '.gev-cache', 'imagery-history-budget.json'),
    now,
  }),
  timeoutMs = 15000,
} = {}) {
  const cache = new Map(),
    inflight = new Map();
  let cacheBytes = 0,
    reservation = Promise.resolve(),
    cooldownUntil = 0;
  const admit = makeRateLimiter({ windowMs: 60000, max: 20, globalMax: 40 });
  async function reserve() {
    const next = reservation.then(() => budget.reserve());
    reservation = next.catch(() => {});
    const verdict = await next;
    if (!verdict.ok)
      throw Object.assign(
        new Error('Historical imagery request budget reached'),
        { code: 'history-blocked' },
      );
  }
  async function upstream(url, signal, headers = {}) {
    signal.throwIfAborted();
    if (now() < cooldownUntil)
      throw Object.assign(new Error('Provider cooling down'), {
        code: 'history-blocked',
      });
    await reserve();
    signal.throwIfAborted();
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': 'AUREL-personal-Chronicle/1.0', ...headers },
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retry = response.headers.get('retry-after'),
          seconds = /^\d+$/.test(retry || '')
            ? Number(retry) * 1000
            : Date.parse(retry) - now();
        cooldownUntil =
          now() +
          Math.min(
            86400000,
            Math.max(60000, Number.isFinite(seconds) ? seconds : 300000),
          );
      }
      throw new Error('NASA imagery provider unavailable');
    }
    return response;
  }
  async function acquire(kind, query) {
    return requestWithDeadline(
      async (signal) => {
        if (kind === 'catalog') {
          const result = await searchWindow(query, {
            now: now(),
            signal,
            fetchImpl: async (url, init) => {
              const response = await upstream(url, signal, {
                Accept: 'application/json',
                ...init?.headers,
              });
              const json = await readResponseJsonCapped(
                response,
                HISTORY_LIMITS.catalogBytes,
                signal,
              );
              return {
                ok: true,
                status: 200,
                headers: response.headers,
                json: async () => json,
              };
            },
          });
          const body = Buffer.from(JSON.stringify(result));
          if (body.length > HISTORY_LIMITS.catalogBytes)
            throw new Error('Catalogue too large');
          return {
            body,
            headers: { 'Content-Type': 'application/json' },
            ttl: result.errors.length ? 30000 : 3600000,
          };
        }
        const product = query.products[0],
          day = query.fromDay;
        const response = await upstream(
          wvsSnapshotUrl({
            product,
            day,
            box: query.box,
            width: 256,
            height: 256,
          }),
          signal,
          { Accept: 'image/png' },
        );
        const present = response.headers.get('data-present')?.toLowerCase(),
          acquisition = response.headers.get('acquisition-time');
        if (!['true', 'false'].includes(present))
          throw new Error('Pixel availability not reported');
        if (
          acquisition &&
          (!Number.isFinite(Date.parse(acquisition)) ||
            acquisition.slice(0, 10) !== day)
        )
          throw new Error('Acquisition date mismatch');
        const bytes = await readResponseBytesCapped(
          response,
          HISTORY_LIMITS.previewBytes,
          signal,
        );
        const png = Buffer.from(bytes);
        if (
          present === 'true' &&
          (!response.headers.get('content-type')?.startsWith('image/png') ||
            png.length < 24 ||
            png.toString('ascii', 12, 16) !== 'IHDR' ||
            png.readUInt32BE(16) !== 256 ||
            png.readUInt32BE(20) !== 256 ||
            !Buffer.from(bytes.slice(0, 8)).equals(
              Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            ))
        )
          throw new Error('Expected a PNG preview');
        const headers = {
          'Content-Type': 'image/png',
          'Data-Present': present,
          'X-Aurel-Probed-At': new Date(now()).toISOString(),
        };
        if (acquisition) headers['Acquisition-Time'] = acquisition;
        return {
          body: Buffer.from(bytes),
          headers,
          ttl:
            day === new Date(now()).toISOString().slice(0, 10)
              ? 300000
              : 86400000,
        };
      },
      { timeoutMs: Math.min(15000, Math.max(1, timeoutMs)) },
    );
  }
  function load(kind, query) {
    const key = JSON.stringify([kind, query]),
      old = cache.get(key);
    if (old && now() >= old.at && now() - old.at < old.ttl)
      return Promise.resolve(old);
    if (inflight.has(key)) return inflight.get(key);
    if (inflight.size >= 4)
      return Promise.reject(
        Object.assign(new Error('Imagery busy'), { code: 'history-busy' }),
      );
    const promise = acquire(kind, query)
      .then((value) => {
        if (cache.has(key)) {
          cacheBytes -= cache.get(key).body.length;
          cache.delete(key);
        }
        const entry = { ...value, at: now() };
        cache.set(key, entry);
        cacheBytes += value.body.length;
        while (cacheBytes > 8 * 1048576 || cache.size > 32) {
          const first = cache.keys().next().value;
          cacheBytes -= cache.get(first).body.length;
          cache.delete(first);
        }
        return entry;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }
  return async (req, res, next) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return next?.();
    }
    if (!url.pathname.startsWith(PREFIX)) return next?.();
    const fail = (status, message) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: message }));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(405, 'GET required');
    }
    let request;
    try {
      request = parseQuery(url, now());
    } catch {
      return fail(
        400,
        'Choose fixed products, a valid area up to 100 km and at most 31 past UTC dates',
      );
    }
    if (!admit(clientKey(req)))
      return fail(429, 'Historical imagery request limit reached');
    try {
      const result = await load(request.kind, request.query);
      if (res.destroyed) return;
      for (const [key, value] of Object.entries(result.headers))
        res.setHeader(key, value);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(result.body);
    } catch (error) {
      if (!res.destroyed)
        fail(
          error.code === 'history-blocked'
            ? 429
            : error.code === 'history-busy'
              ? 503
              : 502,
          'Historical imagery unavailable; no replacement image was used',
        );
    }
  };
}
export function imageryHistoryProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createImageryHistoryMiddleware(options));
  };
  return {
    name: 'imagery-history',
    configureServer: install,
    configurePreviewServer: install,
  };
}
