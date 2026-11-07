/**
 * Same-origin clients for the Orbit Witness routes. They never see upstream
 * URLs or keys; the server owns admission, ledgers and caching.
 */
import { readResponseJsonCapped } from '../sources/httpBody.js';
import { requestWithDeadline } from '../sources/requestDeadline.js';
import {
  validateCataloguePayload,
  validateCloudPayload,
  validateSceneQuery,
} from './catalogueModel.js';

const MAX_BYTES = 512 * 1024;
const transportOf = (fetchImpl) =>
  fetchImpl ?? ((...args) => globalThis.fetch(...args));

async function getJson(transport, url, signal, timeoutMs) {
  return requestWithDeadline(
    async (active) => {
      const response = await transport(url, {
        signal: active,
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok)
        throw Object.assign(new Error('Orbit Witness route unavailable'), {
          code: response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
          retryAfter: response.headers?.get?.('retry-after') ?? null,
        });
      return readResponseJsonCapped(response, MAX_BYTES, active);
    },
    { signal, timeoutMs },
  );
}

/** Catalogue search over Earth Search and CMR-STAC. Outage → status "unavailable". */
export function createSceneCatalogueSource({
  fetchImpl,
  timeoutMs = 25000,
  now = Date.now,
} = {}) {
  const transport = transportOf(fetchImpl);
  return {
    async search({ bbox, from, to }, { signal } = {}) {
      const query = validateSceneQuery({ bbox, from, to }, { now: now() });
      const params = new URLSearchParams({
        bbox: query.bbox.map((v) => v.toFixed(4)).join(','),
        from: query.from,
        to: query.to,
      });
      try {
        return validateCataloguePayload(
          await getJson(
            transport,
            `/api/orbit-witness/scenes?${params}`,
            signal,
            timeoutMs,
          ),
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          version: 1,
          retrievedAt: new Date(now()).toISOString(),
          status: 'unavailable',
          reason:
            error?.code === 'RATE_LIMITED' ? 'rate-limited' : 'unavailable',
          retryAfter: error?.retryAfter ?? null,
          sources: [],
          scenes: [],
        };
      }
    },
  };
}

/** Hourly cloud cover through the shared Open-Meteo field-context ledger. */
export function createCloudForecastSource({
  fetchImpl,
  timeoutMs = 20000,
} = {}) {
  const transport = transportOf(fetchImpl);
  return {
    async forecast({ lat, lon }, { signal } = {}) {
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        throw new TypeError('Expected a place');
      const params = new URLSearchParams({
        lat: lat.toFixed(4),
        lon: lon.toFixed(4),
      });
      try {
        return validateCloudPayload(
          await getJson(
            transport,
            `/api/orbit-witness/cloud?${params}`,
            signal,
            timeoutMs,
          ),
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 'unavailable', reason: 'unavailable', hours: [] };
      }
    },
  };
}
