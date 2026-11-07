import { admitSameSiteKeyless } from '../common/same-site.js';
import { clientKey, makeRateLimiter } from '../common/rate-limit.js';
import { createSecondSourceLedgers } from './ledger.js';
import { createEmscAdapter } from './emsc.js';
import { createGeofonAdapter } from './geofon.js';
import {
  createAdsbFiAdapter,
  createAdsbLolHexAdapter,
  validHex,
} from './aircraft.js';
import { validQuakeQuery } from './quakeQuery.js';

export { SECOND_SOURCE_STATES } from './adapter.js';

/**
 * The Second Source service: independent catalogue and aggregator lookups for
 * ONE selected event or aircraft at a time. There is no background polling;
 * every upstream request answers a user selection and is bounded in space,
 * time and by its source's ledger.
 */
export function createSecondSourceService({
  fetchImpl = fetch,
  now = Date.now,
  sleep,
} = {}) {
  const ledgers = createSecondSourceLedgers({ now });
  const shared = { fetchImpl, now, ...(sleep ? { sleep } : {}) };
  const adapters = {
    emsc: createEmscAdapter({ ledger: ledgers.emsc, ...shared }),
    geofon: createGeofonAdapter({ ledger: ledgers.geofon, ...shared }),
    'adsb-fi': createAdsbFiAdapter({ ledger: ledgers['adsb-fi'], ...shared }),
    'adsb-lol': createAdsbLolHexAdapter({
      ledger: ledgers['adsb-lol'],
      ...shared,
    }),
  };
  const all = (ids, query) =>
    Promise.all(ids.map((id) => adapters[id].get(query))).then((rows) =>
      Object.fromEntries(rows.map((row) => [row.sourceId, row])),
    );
  return {
    /** EMSC and GEOFON answers for one bounded event box. */
    async quake(input) {
      const query = validQuakeQuery(input);
      if (!query) return null;
      return {
        kind: 'quake',
        query,
        sources: await all(['emsc', 'geofon'], query),
      };
    },
    /** adsb.fi and adsb.lol answers for one ICAO address. */
    async aircraft(input) {
      const hex = validHex(input?.hex);
      if (!hex) return null;
      const query = { hex };
      return {
        kind: 'aircraft',
        query,
        sources: await all(['adsb-fi', 'adsb-lol'], query),
      };
    },
    status() {
      return Object.fromEntries(
        Object.entries(ledgers).map(([id, ledger]) => [id, ledger.snapshot()]),
      );
    },
  };
}

/** Vite plugin: GET /api/second-source/{quake,aircraft,status}. */
export function secondSourceProxy(options = {}) {
  const service = createSecondSourceService(options);
  // Inbound guard in front of the per-source ledgers.
  const admit = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 60 });
  const install = (server) => {
    server.middlewares.use('/api/second-source', async (req, res) => {
      const respond = (status, body) => {
        if (res.headersSent) return;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
      };
      if (admitSameSiteKeyless(req, res)) return;
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return respond(405, { error: 'Method not allowed' });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';
      if (route === '/status') return respond(200, service.status());
      if (!admit(clientKey(req)))
        return respond(429, { error: 'rate-limited' });
      try {
        const params = url.searchParams;
        if (route === '/quake') {
          const answer = await service.quake({
            lat: params.get('lat'),
            lon: params.get('lon'),
            timeMs: params.get('time'),
          });
          return answer
            ? respond(200, answer)
            : respond(400, { error: 'invalid-query' });
        }
        if (route === '/aircraft') {
          const answer = await service.aircraft({ hex: params.get('hex') });
          return answer
            ? respond(200, answer)
            : respond(400, { error: 'invalid-query' });
        }
        return respond(404, { error: 'not-found' });
      } catch (error) {
        console.warn('[second-source]', error?.message || error);
        return respond(500, { error: 'second-source-error' });
      }
    });
  };
  return {
    name: 'second-source',
    configureServer: install,
    configurePreviewServer: install,
  };
}
