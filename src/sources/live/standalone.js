import {
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  openSkySnapshot,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';
import { createVesselDeltaMirror, FULL_SYNC_CURSOR } from './vesselDelta.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const header = (response, name) => response.headers?.get?.(name);

function openSkyError(response) {
  const error = httpError(response, 'Flights');
  const mode = String(
    header(response, 'x-opensky-auth-mode-used') ||
      header(response, 'x-opensky-auth') ||
      '',
  ).toLowerCase();
  const reason = String(
    header(response, 'x-opensky-auth-reason') || '',
  ).toLowerCase();
  if (response.status === 429 && (!mode || mode === 'anon'))
    error.message = 'OpenSky rate limited (anonymous)';
  if (response.status === 401 || response.status === 403) {
    const reasons = {
      oauth_invalid_or_missing: 'OpenSky OAuth client missing/invalid',
      oauth_invalid_credentials: 'OpenSky OAuth rejected credentials',
      missing_oauth_creds: 'OpenSky auth missing',
      auth_required: 'OpenSky auth required',
      forced_anonymous: 'OpenSky auth required',
    };
    error.message =
      reasons[reason] ||
      (/^(oauth_|basic_)/.test(reason)
        ? 'OpenSky auth invalid'
        : mode === 'anon'
          ? 'OpenSky auth required'
          : 'OpenSky auth failed');
  }
  return error;
}

/**
 * The provider a feed response names in `X-Feed-Source`, so a server that
 * answers a feed route from another provider is reported as that provider.
 */
function feedSource(response, fallback) {
  const named = header(response, 'x-feed-source');
  return typeof named === 'string' && named.trim()
    ? named.trim().slice(0, 80)
    : fallback;
}

/** Validate a `POST /api/adsbdb/types` reply; malformed parts become empty. */
function typeBatchReply(payload) {
  const results =
    payload?.results && typeof payload.results === 'object'
      ? Object.fromEntries(
          Object.entries(payload.results).filter(
            ([, value]) => typeof value?.found === 'boolean',
          ),
        )
      : {};
  const pending = Array.isArray(payload?.pending)
    ? payload.pending.filter((hex) => typeof hex === 'string')
    : [];
  return { results, pending };
}

/** The flights feed (/api/flights); no request starts during construction. */
export function createFlightSource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Flights',
    async getSnapshot(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.latitude) && Number.isFinite(query.longitude)) {
        params.set('lat', query.latitude.toFixed(4));
        params.set('lon', query.longitude.toFixed(4));
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/flights${params.size ? '?' + params : ''}`,
        { signal },
        'Flights',
      );
      if (!response.ok) throw openSkyError(response);
      return {
        ...openSkySnapshot(payload, {
          // A fallback provider names itself in X-Flight-Source.
          source:
            header(response, 'x-flight-source') ||
            feedSource(response, 'Flights'),
          coverage:
            header(response, 'x-flight-coverage') ||
            'worldwide upstream snapshot',
          now: now(),
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/flights/track?icao24=' + encodeURIComponent(reference),
        { signal },
        'Flights',
      );
      if (!response.ok) throw httpError(response, 'Flights');
      return {
        records: normalizeAircraftTrack(payload?.path),
        complete: false,
      };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind))
        throw new LiveSourceError('unsupported', 'Enrichment unavailable');
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsbdb/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
    /**
     * Aircraft types for up to 100 ICAO24 codes in one request. Returns the
     * answers the proxy has (`results`, keyed by code, `{found}` as the
     * per-aircraft route) and the codes it is still fetching (`pending`).
     * @param {string[]} hexes
     * @param {{signal?: AbortSignal}} [options]
     * @returns {Promise<{results: Record<string, {found: boolean}>, pending: string[]}>}
     */
    async getTypeBatch(hexes, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/adsbdb/types',
        {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hexes }),
        },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return typeBatchReply(payload);
    },
  };
}

export function createMilitarySource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Military aircraft',
    async getIdentities(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        'Military aircraft',
      );
      if (!response.ok) throw httpError(response, 'Military aircraft');
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        'Military aircraft',
      );
      if (!response.ok) throw httpError(response, 'Military aircraft');
      const age = finite(header(response, 'x-feed-age-ms'));
      return {
        ...readsbSnapshot(payload, {
          source: feedSource(response, 'Military aircraft'),
          observedAtMs: now() - (age != null && age > 0 ? age : 0),
          now: now(),
          stale: header(response, 'x-feed-cache') === 'STALE',
        }),
        status: response.status,
      };
    },
    // ADSB.lol does not expose a supported live-history endpoint. Omitting
    // optional getTrack keeps the tracking layer on its accumulated trail.
  };
}

const VESSEL_STATUS_REASONS = Object.freeze({
  'missing-key': 'AISSTREAM_API_KEY not set',
  'auth-failed': 'API key rejected — check AISSTREAM_API_KEY',
  unsupported: 'live feed unsupported',
  error: 'feed down',
  closed: 'feed disconnected',
});

/** The `/api/vessels` URL for a row cap and optional area, without `since`. */
function vesselSnapshotUrl(apiUrl, origin, maxRows, area) {
  const url = new URL(apiUrl, origin);
  url.searchParams.set('maxRows', String(maxRows));
  // An area asks for the vessels around a point; servers that hold every
  // vessel may ignore it, since callers still keep only what they need.
  if (
    Number.isFinite(area?.lat) &&
    Number.isFinite(area?.lon) &&
    Number.isFinite(area?.radiusKm)
  ) {
    url.searchParams.set('lat', area.lat.toFixed(5));
    url.searchParams.set('lon', area.lon.toFixed(5));
    url.searchParams.set('radius_km', area.radiusKm.toFixed(1));
  }
  return url;
}

export function createVesselSource({
  fetchImpl = defaultFetch,
  apiUrl = '/api/vessels',
  origin = () => globalThis.location?.origin || 'http://localhost',
  delta = true,
} = {}) {
  // Rows changed since the last answer instead of every row (vesselDelta.js).
  const mirror = delta ? createVesselDeltaMirror() : null;

  /** One request; a delta mirror adds `since` and merges the answer. */
  async function request(url, since, signal) {
    const target = new URL(url);
    if (since != null) target.searchParams.set('since', since);
    const { response, payload } = await readResponse(
      fetchImpl,
      target.toString(),
      { signal, cache: 'no-store' },
      'Vessels',
    );
    if (!response.ok) {
      const error = httpError(response, 'Vessels');
      error.message = VESSEL_STATUS_REASONS[payload?.status] || error.message;
      throw error;
    }
    return { response, payload };
  }

  /** Rows of the full window, asking once more in full when a delta misses. */
  async function readWindow(url, maxRows, signal) {
    if (!mirror) return request(url, null, signal);
    const key = url.search;
    const first = await request(url, mirror.sinceFor(key), signal);
    if (!Array.isArray(first.payload?.rows)) return first;
    const rows = mirror.apply(key, first.payload, maxRows);
    if (rows) return { ...first, payload: { ...first.payload, rows } };
    const full = await request(url, FULL_SYNC_CURSOR, signal);
    if (!Array.isArray(full.payload?.rows)) return full;
    const fullRows = mirror.apply(key, full.payload, maxRows);
    return { ...full, payload: { ...full.payload, rows: fullRows } };
  }

  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Vessels',
    async getSnapshot({ maxRows = 12000, area } = {}, { signal } = {}) {
      const url = vesselSnapshotUrl(apiUrl, origin(), maxRows, area);
      let answer;
      try {
        answer = await readWindow(url, maxRows, signal);
      } catch (error) {
        // An error leaves the mirror unknown: start again from a full window.
        mirror?.reset();
        throw error;
      }
      const { response, payload } = answer;
      return {
        ...vesselSnapshot(payload, { source: feedSource(response, 'Vessels') }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/vessels/track?mmsi=' + encodeURIComponent(reference),
        { signal },
        'Vessels',
      );
      if (!response.ok) throw httpError(response, 'Vessels');
      return {
        records: normalizeVesselTrack(payload?.samples),
        complete: false,
      };
    },
  };
}
