import {
  parseFirmsCsv,
  acquisitionMsUtc,
  isLikelyCsv,
} from '../../src/data/firmsCsv.js';
import { readResponseTextCapped } from './common/http.js';
import { requestWithDeadline } from '../../src/sources/requestDeadline.js';
import { fetchFirms } from './firms.js';
import { admitSameSiteKeyless } from './common/same-site.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import {
  FIRMS_AREA_SOURCES,
  FIRMS_AREA_LIMIT,
  FIRMS_AREA_LIMITATIONS,
  FIRMS_AREA_WINDOW_MS,
  validateFirmsAreaBounds,
  emptyFirmsArea,
} from '../../src/sources/firmsArea.js';

const TTL_MS = 30 * 60_000;
const BACKOFF_MS = 5 * 60_000;
const MAX_AREAS = 8;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Bounded selected-area acquisition, independent of the existing global feed. */
export function createFirmsAreaService({
  resolveKey = () => process.env.FIRMS_MAP_KEY,
  fetchImpl = (url, options) => fetchFirms(url, options, { warn: () => {} }),
  now = Date.now,
  timeoutMs = 10_000,
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  let activeKey = null;
  let nextStart = 0;
  let keyCooldownUntil = 0;

  async function fetchSource(key, source, bounds) {
    return requestWithDeadline(
      async (signal) => {
        const area = [
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
        ].join(',');
        // NASA /1 is today's UTC date, so /2 is needed before the strict 24h
        // filter. The region is bounded; this never requests world data.
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${area}/2`;
        const response = await fetchImpl(url, { signal, redirect: 'error' });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const retryMs =
            Number.isFinite(seconds) && seconds > 0
              ? seconds * 1000
              : Math.max(0, Date.parse(retry) - now());
          throw Object.assign(new Error('FIRMS source unavailable'), {
            status: response.status,
            retryMs,
          });
        }
        const text = await readResponseTextCapped(
          response,
          MAX_BODY_BYTES,
          signal,
        );
        if (!isLikelyCsv(text))
          throw Object.assign(new Error('Invalid FIRMS CSV'), {
            invalid: true,
          });
        // The legacy world parser deliberately coalesces missing FRP to zero.
        // Area evidence must retain that distinction, so reject malformed FRP
        // before calling it; a genuine numeric zero remains a valid reading.
        const lines = text.trim().split('\n');
        const header = lines[0]
          .trim()
          .toLowerCase()
          .split(',')
          .map((cell) => cell.trim());
        const frpIndex = header.indexOf('frp');
        let rejected = false;
        const valid = lines.slice(1).filter((line) => {
          if (!line.trim()) return false;
          const value = line.split(',')[frpIndex]?.trim() || '';
          const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(
            value,
          );
          if (
            !numeric ||
            !Number.isFinite(Number(value)) ||
            Number(value) < 0
          ) {
            rejected = true;
            return false;
          }
          return true;
        });
        return {
          records: parseFirmsCsv([lines[0], ...valid].join('\n')),
          rejected,
        };
      },
      { timeoutMs },
    );
  }

  async function refresh(key, bounds) {
    const at = now();
    const observations = [],
      histogram = new Map(),
      sources = [];
    let retryMs = BACKOFF_MS;
    for (const source of FIRMS_AREA_SOURCES) {
      try {
        const { records, rejected } = await fetchSource(key, source, bounds);
        let count = 0;
        for (const record of records) {
          const acquired = acquisitionMsUtc(record.acqDate, record.acqTime);
          if (
            record.lon < bounds.west ||
            record.lon > bounds.east ||
            record.lat < bounds.south ||
            record.lat > bounds.north ||
            !Number.isFinite(acquired) ||
            acquired < at - FIRMS_AREA_WINDOW_MS ||
            acquired > at
          )
            continue;
          count++;
          const histogramKey = `${source}|${acquired}`;
          const prior = histogram.get(histogramKey);
          histogram.set(histogramKey, [
            source,
            acquired,
            (prior?.[2] || 0) + 1,
          ]);
          const observation = {
            id: `${source}:${acquired}:${record.lat}:${record.lon}`,
            lat: record.lat,
            lon: record.lon,
            acquiredAt: new Date(acquired).toISOString(),
            sensor: record.instrument.slice(0, 32),
            satellite: record.satellite.slice(0, 32),
            confidence: String(record.confidence).slice(0, 16),
            frpMw: record.frp,
            source,
          };
          observations.push(observation);
        }
        sources.push({
          id: source,
          status: rejected ? 'partial' : 'ok',
          count,
        });
      } catch (error) {
        if (Number.isFinite(error?.retryMs))
          retryMs = Math.max(retryMs, error.retryMs);
        const status =
          error?.status === 429
            ? 'rate-limited'
            : error?.name === 'TimeoutError'
              ? 'timeout'
              : error?.invalid || error?.code === 'RESPONSE_TOO_LARGE'
                ? 'invalid-response'
                : 'unavailable';
        sources.push({ id: source, status, count: 0 });
        if (status === 'rate-limited') {
          if (activeKey === key)
            keyCooldownUntil = Math.max(keyCooldownUntil, now() + retryMs);
          for (const skipped of FIRMS_AREA_SOURCES.slice(sources.length))
            sources.push({ id: skipped, status: 'rate-limited', count: 0 });
          break;
        }
      }
    }
    observations.sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
    return {
      at,
      sources,
      observations: observations.slice(0, FIRMS_AREA_LIMIT),
      histogram: [...histogram.values()],
      retryMs,
    };
  }

  function payload(entry, bounds, stale = false, failures) {
    const timestamp = now();
    const result = emptyFirmsArea(bounds, timestamp);
    const observations = entry.observations.filter(
      (row) =>
        Date.parse(row.acquiredAt) >= timestamp - FIRMS_AREA_WINDOW_MS &&
        Date.parse(row.acquiredAt) <= timestamp,
    );
    const counts = new Map();
    for (const [source, at, count] of entry.histogram) {
      if (at >= timestamp - FIRMS_AREA_WINDOW_MS && at <= timestamp)
        counts.set(source, (counts.get(source) || 0) + count);
    }
    const matchedCount = [...counts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    const sources =
      failures ||
      entry.sources.map((row) => ({ ...row, count: counts.get(row.id) || 0 }));
    return {
      ...result,
      status: stale
        ? 'stale'
        : sources.every((row) => row.status === 'ok')
          ? 'ok'
          : 'partial',
      fetchedAt: entry.at,
      sources,
      matchedCount,
      count: observations.length,
      truncated: matchedCount > observations.length,
      observations,
      limitations: [...FIRMS_AREA_LIMITATIONS],
    };
  }

  async function get(input) {
    const bounds = validateFirmsAreaBounds(input);
    const key = String(resolveKey() || '').trim();
    if (!key)
      return emptyFirmsArea(
        bounds,
        now(),
        'needs-key',
        'Add the free FIRMS_MAP_KEY in provider settings to retrieve satellite observations.',
      );
    if (key !== activeKey) {
      cache.clear();
      activeKey = key;
      keyCooldownUntil = 0;
    }
    const id = JSON.stringify(bounds),
      timestamp = now();
    const old = cache.get(id);
    if (old?.entry && timestamp - old.entry.at < TTL_MS && !old.failures)
      return payload(old.entry, bounds);
    if (inflight.has(id)) return inflight.get(id);
    if (timestamp < keyCooldownUntil) {
      const sources = FIRMS_AREA_SOURCES.map((source) => ({
        id: source,
        status: 'rate-limited',
        count: 0,
      }));
      return old?.entry
        ? payload(old.entry, bounds, true, sources)
        : {
            ...emptyFirmsArea(
              bounds,
              timestamp,
              'unavailable',
              'FIRMS is temporarily rate limited; retry after the cooldown.',
            ),
            sources,
          };
    }
    if (timestamp < (old?.retryAt || 0))
      return old.entry
        ? payload(old.entry, bounds, true, old.failures)
        : {
            ...emptyFirmsArea(
              bounds,
              timestamp,
              'unavailable',
              'FIRMS is temporarily unavailable; retry after the cooldown.',
            ),
            sources: old.failures,
          };
    // At most one region acquisition and four new regions per minute. Fresh
    // cached areas bypass this budget; coordinate scrubbing cannot fan out.
    if (inflight.size || timestamp < nextStart)
      return old?.entry
        ? payload(old.entry, bounds, true)
        : emptyFirmsArea(
            bounds,
            timestamp,
            'unavailable',
            'FIRMS area requests are cooling down. Try again shortly.',
          );
    nextStart = timestamp + 15_000;
    const pending = refresh(key, bounds)
      .then((fresh) => {
        const success = fresh.sources.some((row) =>
          ['ok', 'partial'].includes(row.status),
        );
        const record = success
          ? { entry: fresh }
          : {
              entry: old?.entry,
              failures: fresh.sources,
              retryAt: now() + fresh.retryMs,
            };
        if (activeKey === key) {
          cache.delete(id);
          cache.set(id, record);
          while (cache.size > MAX_AREAS)
            cache.delete(cache.keys().next().value);
        }
        if (success) return payload(fresh, bounds);
        if (record.entry)
          return payload(record.entry, bounds, true, fresh.sources);
        return { ...emptyFirmsArea(bounds, now()), sources: fresh.sources };
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, pending);
    return pending;
  }
  return { get };
}

/** Install before firmsProxy: its legacy /api/firms mount accepts subpaths. */
export function firmsAreaProxy(options) {
  const service = createFirmsAreaService(options);
  const admit = makeRateLimiter({ windowMs: 60_000, max: 12, globalMax: 48 });
  const install = (server) => {
    server.middlewares.use('/api/firms/area', async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (admitSameSiteKeyless(req, res)) return;
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        send(405, { error: 'method_not_allowed' });
        return;
      }
      let bounds;
      try {
        const query = new URL(req.url || '/', 'http://localhost');
        const keys = ['west', 'south', 'east', 'north'];
        if (
          !['', '/'].includes(query.pathname) ||
          [...query.searchParams.keys()].some((key) => !keys.includes(key)) ||
          keys.some(
            (key) =>
              query.searchParams.getAll(key).length !== 1 ||
              !query.searchParams.get(key).trim(),
          )
        )
          throw new Error('bounds');
        bounds = validateFirmsAreaBounds(
          Object.fromEntries(
            keys.map((key) => [key, Number(query.searchParams.get(key))]),
          ),
        );
      } catch {
        send(400, {
          error: 'invalid_area',
          message:
            'Use west,south,east,north with a maximum span of 2 degrees.',
        });
        return;
      }
      if (!admit(clientKey(req))) {
        res.setHeader('Retry-After', '60');
        send(429, { error: 'FIRMS area request limit reached' });
        return;
      }
      try {
        const body = await service.get(bounds);
        send(
          body.status === 'needs-key'
            ? 503
            : body.status === 'unavailable'
              ? 502
              : 200,
          body,
        );
      } catch {
        send(502, { error: 'FIRMS observations are temporarily unavailable' });
      }
    });
  };
  return {
    name: 'firms-area-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
