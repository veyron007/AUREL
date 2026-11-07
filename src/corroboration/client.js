/**
 * Browser client for the local Second Source routes. It talks only to this
 * app's own server; the server owns every upstream request and its ledger.
 */
const STATES = new Set([
  'ok',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'denied',
]);
const MAX_RECORDS = 20;

function cleanEnvelope(value, sourceId) {
  if (!value || typeof value !== 'object') {
    return { sourceId, state: 'unavailable', records: [], reason: 'missing' };
  }
  return {
    sourceId,
    state: STATES.has(value.state) ? value.state : 'unavailable',
    retrievedAt: Number.isFinite(value.retrievedAt) ? value.retrievedAt : null,
    records: Array.isArray(value.records)
      ? value.records
          .slice(0, MAX_RECORDS)
          .filter((row) => row && typeof row === 'object')
      : [],
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 80) : null,
  };
}

/** Validate a route answer; unknown shapes become typed unavailable rows. */
export function normalizeSecondSourceAnswer(body, sourceIds) {
  return {
    sources: Object.fromEntries(
      sourceIds.map((id) => [id, cleanEnvelope(body?.sources?.[id], id)]),
    ),
  };
}

async function request(path, params, sourceIds, { fetchImpl, signal }) {
  const response = await fetchImpl(
    `/api/second-source/${path}?${new URLSearchParams(params)}`,
    {
      signal,
      headers: { Accept: 'application/json' },
    },
  );
  if (!response.ok) throw new Error(`Second Source HTTP ${response.status}`);
  return normalizeSecondSourceAnswer(await response.json(), sourceIds);
}

/** Create the client with an injectable fetch (tests, QA fixtures). */
export function createSecondSourceClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    quake({ lat, lon, timeMs }, { signal } = {}) {
      return request(
        'quake',
        { lat: String(lat), lon: String(lon), time: String(timeMs) },
        ['emsc', 'geofon'],
        { fetchImpl, signal },
      );
    },
    aircraft({ hex }, { signal } = {}) {
      return request(
        'aircraft',
        { hex: String(hex) },
        ['adsb-fi', 'adsb-lol'],
        {
          fetchImpl,
          signal,
        },
      );
    },
  };
}
