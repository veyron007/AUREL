/**
 * Serve-once body cache and HTTP validators for `GET /api/firms`.
 *
 * A world FIRMS payload is tens of megabytes of JSON. Upstream changes at most
 * once per TTL (30 min), but clients poll every 10 min, so the body is
 * serialized once per (entry, stale flag, filter cutoff) and every request in
 * between is either the same bytes or a 304.
 *
 * Filter cutoff. A fresh entry is clamped to the trailing 24 h at its own
 * refresh time, so its body is stable for its whole TTL. A stale entry (upstream
 * down) is re-clamped once per TTL bucket, so it never serves detections more
 * than one TTL past the 24 h window. The client clamps again at ingest
 * (src/layers/firms/ingestion.js), so the map shows the same set as the old
 * per-request filter did at the moment each body arrives.
 */

import { filterTrailing24h } from '../../src/data/firmsCsv.js';

/**
 * The time the body's trailing-24 h clamp is evaluated at.
 * @param {{at: number}} entry
 * @param {boolean} stale
 * @param {number} now
 * @param {number} ttlMs
 * @returns {number}
 */
export function firmsFilterCutoff(entry, stale, now, ttlMs) {
  if (!stale) return entry.at;
  return Math.max(entry.at, Math.floor(now / ttlMs) * ttlMs);
}

/**
 * Weak validator naming exactly the inputs the body is a pure function of.
 * @param {number} at
 * @param {boolean} stale
 * @param {number} cutoff
 * @returns {string}
 */
export function firmsEtag(at, stale, cutoff) {
  return `W/"firms-${at}-${stale ? 's' : 'f'}-${cutoff}"`;
}

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
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.trim() === '*') return true;
  const wanted = opaqueTag(etag);
  return value.split(',').some((tag) => opaqueTag(tag) === wanted);
}

/**
 * Cache-Control for a FIRMS body: a fresh body may be reused until the proxy
 * would refresh upstream, never longer; a stale one must always revalidate.
 * @param {{at: number}} entry
 * @param {boolean} stale
 * @param {number} now
 * @param {number} ttlMs
 * @returns {string}
 */
export function firmsCacheControl(entry, stale, now, ttlMs) {
  if (stale) return 'no-cache';
  const seconds = Math.max(0, Math.floor((entry.at + ttlMs - now) / 1000));
  return `private, max-age=${seconds}`;
}

/**
 * One-slot memo of the serialized body. Holding a single body bounds memory to
 * one copy of the payload, which is the copy every request would build anyway.
 * @param {{ttlMs: number, stringify?: (value: unknown) => string}} options
 */
export function createFirmsBodyCache({ ttlMs, stringify = JSON.stringify }) {
  /** @type {?{entry: object, etag: string, body: string, count: number}} */
  let slot = null;

  function build(entry, stale, cutoff) {
    const fires = filterTrailing24h(entry.fires, cutoff);
    const body = stringify({
      fetchedAt: entry.at,
      stale,
      ttlMs,
      sources: entry.sources,
      count: fires.length,
      fires,
    });
    return {
      entry,
      etag: firmsEtag(entry.at, stale, cutoff),
      body,
      count: fires.length,
    };
  }

  return {
    /**
     * @param {{at: number, sources: object[], fires: object[]}} entry
     * @param {boolean} stale
     * @param {number} now
     * @returns {{etag: string, body: string, count: number}}
     */
    get(entry, stale, now) {
      const cutoff = firmsFilterCutoff(entry, stale, now, ttlMs);
      const etag = firmsEtag(entry.at, stale, cutoff);
      if (slot?.entry === entry && slot.etag === etag) return slot;
      slot = build(entry, stale, cutoff);
      return slot;
    },
  };
}
