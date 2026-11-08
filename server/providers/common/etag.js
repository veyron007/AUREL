/**
 * Shared HTTP validator helpers for providers that serve a cached snapshot.
 * A provider names its ETag after exactly the inputs its body is a pure
 * function of (usually the upstream fetch time), so the tag changes whenever
 * the bytes do, and answers a matching If-None-Match with a bodyless 304.
 */

/** Strip the weak prefix: If-None-Match uses the weak comparison. */
function opaqueTag(tag) {
  const trimmed = String(tag).trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

/**
 * Whether an If-None-Match header matches the current validator.
 * @param {string|string[]|undefined} header
 * @param {string} etag
 * @returns {boolean}
 */
export function ifNoneMatchHits(header, etag) {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (typeof value !== 'string' || !value.trim() || !etag) return false;
  if (value.trim() === '*') return true;
  const wanted = opaqueTag(etag);
  return value.split(',').some((tag) => opaqueTag(tag) === wanted);
}

/**
 * Cache-Control for a snapshot fetched at `at` that the provider keeps for
 * `ttlMs`: reusable until the provider would refresh it, never longer. A stale
 * copy (served because upstream failed) must always revalidate.
 * @param {number} at
 * @param {number} ttlMs
 * @param {number} now
 * @param {boolean} [stale]
 * @returns {string}
 */
export function snapshotCacheControl(at, ttlMs, now, stale = false) {
  if (stale) return 'no-cache';
  const seconds = Math.max(0, Math.floor((at + ttlMs - now) / 1000));
  return `private, max-age=${seconds}`;
}
