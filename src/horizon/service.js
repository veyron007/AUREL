/**
 * `horizon_at(lat, lon, observerHeight, date)`: the one capability Planner,
 * Lens, Fieldbook and the MCP tool share. Portable: it reads the app's own
 * `/api/horizon/terrain` and bundled peaks pack through `fetchImpl`, and runs
 * the computation through `run` (a Web Worker in the browser, inline in Node).
 */
import {
  DEFAULT_OBSERVER_HEIGHT_M,
  DEFAULT_RADIUS_KM,
  MAX_OBSERVER_HEIGHT_M,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from './constants.js';
import { computeHorizon } from './compute.js';
import { MAX_GNOMON_M } from './events.js';
import { peakSourceRecord, verifyPeaksPack } from '../regions/peaks.js';

export const TERRAIN_PATH = '/api/horizon/terrain';
export const PEAKS_ROOT = '/regions/dehradun-peaks/';

/** Validate and normalise a request; throws a caller-readable message. */
export function normalizeHorizonRequest(input = {}) {
  const {
    lat,
    lon,
    observerHeightM = DEFAULT_OBSERVER_HEIGHT_M,
    localDate,
    timeZone = 'Asia/Kolkata',
    shadowAt = null,
    gnomonM = 1,
    radiusKm = DEFAULT_RADIUS_KM,
  } = input;
  if (!Number.isFinite(lat) || Math.abs(lat) > 85)
    throw new Error('Latitude must be between -85 and 85.');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180)
    throw new Error('Longitude must be between -180 and 180.');
  if (
    !Number.isFinite(observerHeightM) ||
    observerHeightM < 0 ||
    observerHeightM > MAX_OBSERVER_HEIGHT_M
  )
    throw new Error(
      `Observer height must be 0 to ${MAX_OBSERVER_HEIGHT_M} m above the DEM surface.`,
    );
  if (typeof localDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(localDate))
    throw new Error('Date must be YYYY-MM-DD.');
  const year = Number(localDate.slice(0, 4));
  if (year < 1900 || year > 2100)
    throw new Error('Date must be between 1900 and 2100.');
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error('Unknown IANA time zone.');
  }
  if (shadowAt !== null && !Number.isFinite(Date.parse(shadowAt)))
    throw new Error('Shadow time must be an ISO instant.');
  if (!Number.isFinite(gnomonM) || gnomonM <= 0 || gnomonM > MAX_GNOMON_M)
    throw new Error(
      `Gnomon height must be above 0 and at most ${MAX_GNOMON_M} m.`,
    );
  if (
    !Number.isInteger(radiusKm) ||
    radiusKm < MIN_RADIUS_KM ||
    radiusKm > MAX_RADIUS_KM
  )
    throw new Error(
      `Radius must be a whole number of km from ${MIN_RADIUS_KM} to ${MAX_RADIUS_KM}.`,
    );
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    observerHeightM,
    localDate,
    timeZone,
    shadowAt: shadowAt === null ? null : new Date(shadowAt).toISOString(),
    gnomonM,
    radiusKm,
  };
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error.length < 300)
      return new Error(body.error);
  } catch {
    /* body was not JSON */
  }
  return new Error(fallback);
}

/**
 * @param {{ fetchImpl: typeof fetch, run?: (input: object, options?: {signal?: AbortSignal}) => Promise<object> }} options
 */
export function createHorizonService({
  fetchImpl,
  run = async (input) => computeHorizon(input),
}) {
  if (typeof fetchImpl !== 'function')
    throw new TypeError('A fetch implementation is required');
  let peaks = null;
  async function loadPeaks(signal) {
    if (peaks) return peaks;
    try {
      const manifestResponse = await fetchImpl(`${PEAKS_ROOT}manifest.json`, {
        signal,
      });
      const bytesResponse = await fetchImpl(`${PEAKS_ROOT}peaks.json`, {
        signal,
      });
      if (!manifestResponse.ok || !bytesResponse.ok)
        throw new Error('peaks pack unavailable');
      const manifest = await manifestResponse.json();
      const bytes = new Uint8Array(await bytesResponse.arrayBuffer());
      const verified = await verifyPeaksPack(manifest, bytes);
      peaks = {
        entries: verified.entries,
        source: peakSourceRecord(verified.manifest),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      // No gazetteer is an honest empty peaks list, not a failed horizon.
      peaks = { entries: [], source: null };
    }
    return peaks;
  }
  return {
    /** The full computed result (precise values, for drawing and cards). */
    async horizonAt(input, { signal } = {}) {
      const request = normalizeHorizonRequest(input);
      const url = `${TERRAIN_PATH}?lat=${request.lat}&lon=${request.lon}&radiusKm=${request.radiusKm}`;
      const response = await fetchImpl(url, { signal });
      if (!response.ok)
        throw await responseError(
          response,
          `The horizon terrain service answered HTTP ${response.status}.`,
        );
      const payload = await response.json();
      const gazetteer = await loadPeaks(signal);
      signal?.throwIfAborted();
      return run(
        {
          payload,
          observerHeightM: request.observerHeightM,
          localDate: request.localDate,
          timeZone: request.timeZone,
          shadowAt: request.shadowAt,
          gnomonM: request.gnomonM,
          peaks: gazetteer,
          now: new Date().toISOString(),
        },
        { signal },
      );
    },
  };
}
