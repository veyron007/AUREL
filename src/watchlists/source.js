import { fetchFirmsAreaSource } from '../sources/firmsArea.js';
/** Reuse the existing key-preserving bounded FIRMS route, retaining HTTP cooldowns. */
export function createWatchlistSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
} = {}) {
  return {
    async check(bounds, { signal } = {}) {
      let retryAt = null;
      const context = await fetchFirmsAreaSource({
        bounds,
        signal,
        now,
        fetchImpl: async (url, init) => {
          const response = await fetchImpl(url, { ...init, redirect: 'error' });
          if (response.status === 429) {
            const raw = response.headers.get('retry-after');
            const wait = /^\d+$/.test(raw || '')
              ? Number(raw) * 1000
              : Date.parse(raw) - now();
            retryAt =
              now() +
              Math.min(
                86400000,
                Math.max(1800000, Number.isFinite(wait) ? wait : 1800000),
              );
          }
          return response;
        },
      });
      return { context, retryAt };
    },
  };
}
