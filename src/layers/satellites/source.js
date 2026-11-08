const GROUPS = new Set([
  'stations',
  'visual',
  'gps-ops',
  'glo-ops',
  'galileo',
  'geo',
  'starlink',
]);

/** Read catalog text from the existing group endpoint using a supplied transport. */
export function createSatelliteSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /**
     * Read one group's TLE text. With `etag` (the validator of the copy the
     * caller holds) an unchanged group answers `notModified` without a body;
     * `no-store` keeps the browser from replaying its cached 200 instead.
     * @param {string} group
     * @param {{signal?: AbortSignal, etag?: ?string}} [options]
     */
    async readGroup(group, { signal, etag = null } = {}) {
      if (!GROUPS.has(group)) throw new TypeError('Unknown satellite group');
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `/api/celestrak/${group}`,
        etag
          ? { signal, cache: 'no-store', headers: { 'If-None-Match': etag } }
          : { signal },
      );
      if (response.status === 304) {
        signal?.throwIfAborted();
        return { ok: true, notModified: true, status: 304, text: '', etag };
      }
      const text = response.ok ? await response.text() : '';
      signal?.throwIfAborted();
      // The proxy serves its last copy, marked STALE-ERROR, when CelesTrak
      // is down.
      const stale = response.headers?.get?.('x-tle-cache') === 'STALE-ERROR';
      return {
        ok: response.ok,
        notModified: false,
        status: response.status,
        text,
        stale,
        etag: response.headers?.get?.('ETag') || null,
      };
    },
  };
}
