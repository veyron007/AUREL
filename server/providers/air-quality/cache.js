/**
 * A bounded TTL cache with in-flight coalescing and a stale fallback window,
 * shared by the air-quality adapters.
 *
 * A fresh entry is returned without a request. A failed refresh returns the
 * previous value marked `stale` (with the failure's code as `reason`) while it
 * is younger than `staleMs`; past that the failure propagates.
 */
export function createSourceCache({
  now = Date.now,
  max = 128,
  staleMs = 6 * 3_600_000,
} = {}) {
  const entries = new Map();
  const inflight = new Map();

  const remember = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > max) entries.delete(entries.keys().next().value);
  };

  async function load(key, loader) {
    const old = entries.get(key);
    try {
      const value = await loader();
      const entry = { value, at: now() };
      remember(key, entry);
      return { value, retrievedAt: entry.at, stale: false, reason: null };
    } catch (error) {
      const age = old ? now() - old.at : Infinity;
      if (old && age >= 0 && age <= staleMs)
        return {
          value: old.value,
          retrievedAt: old.at,
          stale: true,
          reason: error?.code || 'unavailable',
        };
      throw error;
    }
  }

  return {
    /** Fresh value, a coalesced pending load, or a new load. */
    get(key, ttlMs, loader) {
      const old = entries.get(key);
      const age = old ? now() - old.at : Infinity;
      if (old && age >= 0 && age < ttlMs)
        return Promise.resolve({
          value: old.value,
          retrievedAt: old.at,
          stale: false,
          reason: null,
        });
      if (inflight.has(key)) return inflight.get(key);
      const pending = load(key, loader).finally(() => inflight.delete(key));
      inflight.set(key, pending);
      return pending;
    },
    size: () => entries.size,
  };
}

/** A typed adapter failure: `code` is the state a card shows. */
export function sourceError(code, reason = code) {
  return Object.assign(new Error(`Air-quality source ${code}`), {
    code,
    reason,
  });
}

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Seconds from Retry-After or x-ratelimit-reset, clamped to [60 s, 1 day]. */
export function retryAfterMs(response, clock) {
  const raw =
    response.headers?.get?.('retry-after') ??
    response.headers?.get?.('x-ratelimit-reset');
  const seconds = /^\d+$/.test(raw || '') ? Number(raw) * 1000 : null;
  const delay = seconds ?? Date.parse(raw) - clock;
  return Number.isFinite(delay) && delay > 0
    ? Math.min(86_400_000, Math.max(60_000, delay))
    : 5 * 60_000;
}
