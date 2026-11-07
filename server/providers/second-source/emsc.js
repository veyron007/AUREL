import { createSourceAdapter } from './adapter.js';
import {
  QUAKE_ROW_LIMIT,
  fdsnEventParams,
  quakeRow,
  validQuakeQuery,
} from './quakeQuery.js';

export const EMSC_EVENT_URL =
  'https://www.seismicportal.eu/fdsnws/event/1/query';

/** Parse an EMSC fdsnws JSON FeatureCollection into catalogue rows. */
export function parseEmscEvents(text) {
  if (text === '') return { records: [], dropped: 0 };
  const payload = JSON.parse(text);
  if (!Array.isArray(payload?.features)) return null;
  const records = [];
  let dropped = 0;
  for (const feature of payload.features) {
    const p = feature?.properties;
    const row =
      p &&
      quakeRow({
        id: p.unid || feature.id,
        time: p.time,
        lat: p.lat,
        lon: p.lon,
        depthKm: p.depth,
        mag: p.mag,
        magType: p.magtype,
        // `auth` is the agency whose solution EMSC is relaying.
        author: p.auth,
        region: p.flynn_region,
        updatedAt: p.lastupdate,
      });
    if (row) records.push(row);
    else dropped += 1;
  }
  return { records, dropped };
}

/** EMSC SeismicPortal event adapter (CC BY 4.0). */
export function createEmscAdapter({ ledger, ...options }) {
  return createSourceAdapter({
    sourceId: 'emsc',
    ledger,
    ttlMs: 5 * 60_000,
    staleMaxMs: 60 * 60_000,
    request: (query) => {
      const valid = validQuakeQuery(query);
      const url = `${EMSC_EVENT_URL}?${fdsnEventParams(valid, 'json')}`;
      return { url, key: url, limit: QUAKE_ROW_LIMIT };
    },
    parse: parseEmscEvents,
    ...options,
  });
}
