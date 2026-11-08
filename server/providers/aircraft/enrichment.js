import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readResponseJsonCapped } from '../common/http.js';
import {
  ADSBDB_BATCH_MAX_BODY_BYTES,
  ADSBDB_BATCH_WAIT_MS,
  ADSBDB_LRU_MAX,
  ADSBDB_UPSTREAM_CONCURRENCY,
  ADSBDB_UPSTREAM_GAP_MS,
  ADSBDB_UPSTREAM_MAX_QUEUED,
  createLruStore,
  createPacer,
  parseTypeBatchBody,
  readRequestTextCapped,
  settleWithin,
  typeResult,
} from './adsbdbStore.js';

/** Route and aircraft lookups are a few hundred bytes; 1 MiB is a hard bound. */
const ADSBDB_MAX_RESPONSE_BYTES = 1024 * 1024;
/**
 * adsbdb.com enrichment proxy: callsign → route (airline + origin/destination
 * airports) and hex → aircraft type/registration. Free community API — cached
 * aggressively: successes and 404s are kept per key for 24 hours (TTL_MS) and
 * persisted to disk so restarts don't re-hammer it; other failures are not
 * cached. Each kind keeps at most ADSBDB_LRU_MAX keys (least recently used
 * evicted on write). `POST /types` answers up to 100 ICAO24 codes at once and
 * fetches unknown ones upstream at the paced rate (adsbdbStore.js). Adapted from skylight
 * (MIT) server/src/enrich/routes.ts.
 */
export function adsbdbProxy() {
  const TTL_MS = 24 * 3600_000;
  const CACHE_PATH = path.join(process.cwd(), '.gev-cache', 'adsbdb.json');
  const routes = createLruStore(ADSBDB_LRU_MAX);
  const aircraft = createLruStore(ADSBDB_LRU_MAX);
  const storeFor = (kind) => (kind === 'route' ? routes : aircraft);
  let dirty = false;
  let loaded = false;
  const inflight = new Map();
  const pacer = createPacer({
    concurrency: ADSBDB_UPSTREAM_CONCURRENCY,
    gapMs: ADSBDB_UPSTREAM_GAP_MS,
    maxQueued: ADSBDB_UPSTREAM_MAX_QUEUED,
  });

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      routes.load(parsed.routes);
      aircraft.load(parsed.aircraft);
    } catch {
      /* first run */
    }
    setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
        const snapshot = {
          routes: routes.toJSON(),
          aircraft: aircraft.toJSON(),
        };
        await fsp.writeFile(CACHE_PATH, JSON.stringify(snapshot), 'utf8');
      } catch {
        dirty = true;
      } // retry next tick
    }, 15_000).unref?.();
  }

  const fresh = (e) => e && Date.now() - e.at < TTL_MS;

  function parseRoute(json) {
    const fr = json?.response?.flightroute;
    if (!fr?.origin || !fr?.destination) return null;
    const airport = (a) => ({
      code: a.iata_code || a.icao_code || '',
      name: a.municipality || a.name || '',
      lat: Number.isFinite(a.latitude) ? a.latitude : null,
      lon: Number.isFinite(a.longitude) ? a.longitude : null,
    });
    return {
      airline: fr.airline?.name || null,
      origin: airport(fr.origin),
      destination: airport(fr.destination),
    };
  }

  function parseAircraft(json) {
    const a = json?.response?.aircraft;
    if (!a) return null;
    return {
      typeCode: a.icao_type || null, // ICAO designator, e.g. "B738" — feeds classifyAircraft
      typeName:
        a.manufacturer && a.type
          ? `${a.manufacturer} ${a.type}`
          : a.type || null,
      registration: a.registration || null,
    };
  }

  /** One upstream lookup; successes and 404s are cached, other failures not. */
  async function fetchAndStore(kind, key) {
    const store = storeFor(kind);
    try {
      const url =
        kind === 'route'
          ? `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`
          : `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(key)}`;
      const signal = AbortSignal.timeout(8000);
      const res = await fetch(url, { signal });
      if (res.ok) {
        const payload = await readResponseJsonCapped(
          res,
          ADSBDB_MAX_RESPONSE_BYTES,
          signal,
        );
        const data =
          kind === 'route' ? parseRoute(payload) : parseAircraft(payload);
        store.set(key, { at: Date.now(), data }); // data may be null — negative cache
        dirty = true;
        return data;
      }
      if (res.status === 404) {
        store.set(key, { at: Date.now(), data: null }); // known-missing — cache the miss
        dirty = true;
      }
      // other statuses: leave uncached so we retry later
      return fresh(store.peek(key)) ? store.peek(key).data : null;
    } catch {
      return fresh(store.peek(key)) ? store.peek(key).data : null; // network error → stale if any
    }
  }

  /**
   * Shared single-flight wrapper. `paced` lookups wait for an upstream slot;
   * returns null when the paced queue is full.
   */
  function startLookup(kind, key, paced) {
    const ik = `${kind}:${key}`;
    if (inflight.has(ik)) return inflight.get(ik);
    const run = paced
      ? pacer.schedule(() => fetchAndStore(kind, key))
      : fetchAndStore(kind, key);
    if (!run) return null;
    const settled = run.finally(() => inflight.delete(ik));
    inflight.set(ik, settled);
    return settled;
  }

  function lookup(kind, key) {
    const entry = storeFor(kind).get(key);
    if (fresh(entry)) return Promise.resolve(entry.data);
    return startLookup(kind, key, false);
  }

  /**
   * Batch type lookup: cached answers at once; unknown keys are fetched at the
   * paced upstream rate, and whatever lands within ADSBDB_BATCH_WAIT_MS is
   * included. The rest come back as `pending` for the client to ask again.
   * @param {string[]} hexes
   */
  async function lookupTypes(hexes) {
    const results = {};
    const waits = [];
    for (const hex of hexes) {
      const entry = aircraft.get(hex);
      if (fresh(entry)) {
        results[hex] = typeResult(entry.data);
        continue;
      }
      const pending = startLookup('aircraft', hex, true);
      if (pending)
        waits.push(pending.then((data) => (results[hex] = typeResult(data))));
    }
    if (waits.length) await settleWithin(waits, ADSBDB_BATCH_WAIT_MS);
    const answered = { ...results };
    return {
      results: answered,
      pending: hexes.filter((hex) => !(hex in answered)),
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/adsbdb', async (req, res) => {
      await loadOnce();
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      try {
        const [, kind, rawKey] = String(req.url || '')
          .split('?')[0]
          .split('/');
        if (kind === 'types') {
          if (req.method !== 'POST')
            return send(405, { error: 'POST a JSON body' });
          const hexes = parseTypeBatchBody(
            await readRequestTextCapped(req, ADSBDB_BATCH_MAX_BODY_BYTES),
          );
          if (!hexes) return send(400, { error: 'invalid hex list' });
          return send(200, await lookupTypes(hexes));
        }
        if (kind === 'route') {
          const cs = String(rawKey || '').toUpperCase();
          if (!/^[A-Z0-9]{2,8}$/.test(cs))
            return send(400, { error: 'invalid callsign' });
          const data = await lookup('route', cs);
          return send(200, data ? { found: true, ...data } : { found: false });
        }
        if (kind === 'type') {
          const hex = String(rawKey || '').toLowerCase();
          if (!/^[0-9a-f]{6}$/.test(hex))
            return send(400, { error: 'invalid hex' });
          const data = await lookup('aircraft', hex);
          return send(200, typeResult(data));
        }
        return send(404, { error: 'unknown endpoint' });
      } catch (err) {
        console.error('[adsbdb-proxy] request failed');
        return send(500, { error: 'adsbdb proxy error' });
      }
    });
  };
  return {
    name: 'adsbdb-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
