import { createSourceAdapter } from './adapter.js';
import {
  QUAKE_ROW_LIMIT,
  fdsnEventParams,
  quakeRow,
  validQuakeQuery,
} from './quakeQuery.js';

export const GEOFON_EVENT_URL = 'https://geofon.gfz.de/fdsnws/event/1/query';

const COLUMNS = [
  'eventid',
  'time',
  'latitude',
  'longitude',
  'depth/km',
  'author',
  'catalog',
  'contributor',
  'contributorid',
  'magtype',
  'magnitude',
  'magauthor',
  'eventlocationname',
];

/**
 * Parse GEOFON's FDSN text format. An empty body (HTTP 204) is a real empty
 * answer. Times carry no zone designator; FDSN defines them as UTC.
 */
export function parseGeofonEvents(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { records: [], dropped: 0 };
  if (!lines[0].startsWith('#')) return null;
  const header = lines[0]
    .slice(1)
    .split('|')
    .map((name) => name.trim().toLowerCase());
  if (!COLUMNS.every((name) => header.includes(name))) return null;
  const at = (cells, name) => cells[header.indexOf(name)]?.trim() ?? '';
  const records = [];
  let dropped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('|');
    const time = at(cells, 'time');
    const row =
      cells.length >= header.length - 1 &&
      quakeRow({
        id: at(cells, 'eventid'),
        time: /[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : `${time}Z`,
        lat: at(cells, 'latitude'),
        lon: at(cells, 'longitude'),
        depthKm: at(cells, 'depth/km'),
        mag: at(cells, 'magnitude'),
        magType: at(cells, 'magtype'),
        author: at(cells, 'author') || at(cells, 'contributor') || 'GFZ',
        region: at(cells, 'eventlocationname'),
      });
    if (row) records.push(row);
    else dropped += 1;
  }
  return { records, dropped };
}

/** GFZ GEOFON event adapter (licence not stated; view-only, cited). */
export function createGeofonAdapter({ ledger, ...options }) {
  return createSourceAdapter({
    sourceId: 'geofon',
    ledger,
    ttlMs: 5 * 60_000,
    staleMaxMs: 60 * 60_000,
    accept: 'text/plain',
    request: (query) => {
      const valid = validQuakeQuery(query);
      const url = `${GEOFON_EVENT_URL}?${fdsnEventParams(valid, 'text')}`;
      return { url, key: url, limit: QUAKE_ROW_LIMIT };
    },
    parse: parseGeofonEvents,
    ...options,
  });
}
