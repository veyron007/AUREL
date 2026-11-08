/** Construct the existing live-fire endpoint without making a request. */
export function createFirmsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /**
     * Fetch the live-fire snapshot. With `etag` (the validator of the snapshot
     * the caller already holds) an unchanged snapshot answers
     * `{notModified: true}` without a body. `cache: 'no-store'` keeps the
     * browser from turning the 304 back into a cached 200 that would have to
     * be parsed again.
     * @param {{signal?: AbortSignal, etag?: ?string}} [options]
     */
    async getSnapshot({ signal, etag = null } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/firms', {
        signal,
        cache: 'no-store',
        ...(etag ? { headers: { 'If-None-Match': etag } } : {}),
      });
      signal?.throwIfAborted();
      if (response.status === 304) return { notModified: true };
      let payload;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (!response.ok) {
        if (response.status === 503 && payload?.error === 'no_key')
          return { keyRequired: true };
        throw new Error(`FIRMS HTTP ${response.status}`);
      }
      if (!Array.isArray(payload?.fires))
        throw new Error('Malformed fire snapshot');
      return { ...payload, etag: response.headers?.get?.('ETag') || null };
    },
  };
}
