import { fetchBounded } from './transport.js';

/**
 * Typed answer states shared by every Second Source adapter.
 *   ok          parsed, every row valid, nothing truncated
 *   empty       upstream answered with no matching rows (a real "nothing")
 *   partial     some rows dropped as malformed, or the row limit was reached
 *   stale       upstream failed; the last good answer is served with its age
 *   unavailable upstream failed or answered something unparseable; no cache
 *   denied      the request ledger refused the dispatch before it left
 */
export const SECOND_SOURCE_STATES = Object.freeze([
  'ok',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'denied',
]);

/** One JSON-safe answer envelope. Records are plain parsed rows. */
export function sourceEnvelope({
  sourceId,
  state,
  retrievedAt = null,
  records = [],
  dropped = 0,
  truncated = false,
  reason = null,
  cache = 'none',
  query = null,
}) {
  return {
    sourceId,
    state: SECOND_SOURCE_STATES.includes(state) ? state : 'unavailable',
    retrievedAt,
    records: [...records],
    dropped,
    truncated,
    reason,
    cache,
    query,
  };
}

/**
 * Build one cached, single-flight, ledger-bounded adapter.
 *
 * @param {object} options
 * @param {string} options.sourceId
 * @param {{reserve: Function, settle: Function}} options.ledger
 * @param {(query: object) => {url: string, key: string, limit: number}} options.request
 * @param {(text: string, query: object) => ?{records: Array, dropped: number}} options.parse
 * @param {number} options.ttlMs Fresh cache lifetime.
 * @param {number} options.staleMaxMs Oldest answer that may be served as stale.
 * @param {number} [options.maxEntries]
 */
export function createSourceAdapter({
  sourceId,
  ledger,
  request,
  parse,
  ttlMs,
  staleMaxMs,
  maxEntries = 200,
  fetchImpl = fetch,
  now = Date.now,
  sleep,
  accept,
}) {
  /** key -> {at, envelope} of the last good answer. */
  const cache = new Map();
  const inflight = new Map();

  function remember(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function dispatch(query, { url, key, limit }) {
    const result = await fetchBounded({
      ledger,
      url,
      agent: `aurel-second-source-${sourceId}`,
      fetchImpl,
      ...(sleep ? { sleep } : {}),
      ...(accept ? { accept } : {}),
    });
    const clock = now();
    const failure = (reason) => {
      const previous = cache.get(key);
      if (previous && clock - previous.at <= staleMaxMs)
        return sourceEnvelope({
          ...previous.envelope,
          state: 'stale',
          reason,
          cache: 'stale',
        });
      return sourceEnvelope({
        sourceId,
        state: result.kind === 'denied' ? 'denied' : 'unavailable',
        reason,
        query,
      });
    };
    if (!result.ok) {
      const reason =
        result.kind === 'denied'
          ? `budget:${result.reason}`
          : result.kind === 'http'
            ? `http:${result.status}`
            : result.kind;
      return failure(reason);
    }
    let parsed = null;
    try {
      parsed = parse(result.text, query);
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.records)) return failure('malformed');
    const truncated = Number.isFinite(limit) && parsed.records.length >= limit;
    const state =
      parsed.dropped > 0 || truncated
        ? 'partial'
        : parsed.records.length
          ? 'ok'
          : 'empty';
    const envelope = sourceEnvelope({
      sourceId,
      state,
      retrievedAt: clock,
      records: parsed.records,
      dropped: parsed.dropped,
      truncated,
      query,
    });
    remember(key, { at: clock, envelope });
    return { ...envelope, cache: 'miss' };
  }

  /**
   * Answer a validated query; never throws for upstream conditions. The
   * dispatch is shared by concurrent callers, so no single caller's abort
   * cancels it; the transport deadline bounds it instead.
   */
  async function get(query) {
    const target = request(query);
    const hit = cache.get(target.key);
    if (hit && now() - hit.at < ttlMs) return { ...hit.envelope, cache: 'hit' };
    const pending = inflight.get(target.key);
    if (pending) return pending;
    const promise = dispatch(query, target).finally(() =>
      inflight.delete(target.key),
    );
    inflight.set(target.key, promise);
    return promise;
  }

  return { sourceId, get };
}
