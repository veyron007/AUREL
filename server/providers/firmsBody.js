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
import {
  encodeFirmsColumns,
  FIRMS_COLUMNS_FORMAT,
} from '../../src/data/firmsColumns.js';
import { ifNoneMatchHits, snapshotCacheControl } from './common/etag.js';

export { ifNoneMatchHits };

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
export function firmsEtag(at, stale, cutoff, format = 'rows') {
  const suffix = format === FIRMS_COLUMNS_FORMAT ? '-c' : '';
  return `W/"firms-${at}-${stale ? 's' : 'f'}-${cutoff}${suffix}"`;
}

/**
 * The body format a request asked for: `?format=columns` opts into the
 * columnar body (src/data/firmsColumns.js); anything else gets the row body
 * every existing caller expects.
 * @param {string} [url]
 * @returns {'rows'|'columns'}
 */
export function firmsRequestFormat(url) {
  const query = String(url || '').split('?')[1] || '';
  const format = new URLSearchParams(query).get('format');
  return format === FIRMS_COLUMNS_FORMAT ? FIRMS_COLUMNS_FORMAT : 'rows';
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
  return snapshotCacheControl(entry.at, ttlMs, now, stale);
}

/** The fire list in the shape a format sends it. */
function firesFields(fires, format) {
  if (format !== FIRMS_COLUMNS_FORMAT) return { fires };
  return { format: FIRMS_COLUMNS_FORMAT, ...encodeFirmsColumns(fires) };
}

/**
 * One-slot memo of the serialized body per format. Holding a single body per
 * format bounds memory to one copy of the payload in each shape a client asked
 * for, which is the copy every request would build anyway.
 * @param {{ttlMs: number, stringify?: (value: unknown) => string}} options
 */
export function createFirmsBodyCache({ ttlMs, stringify = JSON.stringify }) {
  /** @type {Map<string, {entry: object, etag: string, body: string, count: number}>} */
  const slots = new Map();

  function build(entry, stale, cutoff, format) {
    const fires = filterTrailing24h(entry.fires, cutoff);
    const body = stringify({
      fetchedAt: entry.at,
      stale,
      ttlMs,
      sources: entry.sources,
      count: fires.length,
      ...firesFields(fires, format),
    });
    return {
      entry,
      etag: firmsEtag(entry.at, stale, cutoff, format),
      body,
      count: fires.length,
    };
  }

  return {
    /**
     * @param {{at: number, sources: object[], fires: object[]}} entry
     * @param {boolean} stale
     * @param {number} now
     * @param {'rows'|'columns'} [format]
     * @returns {{etag: string, body: string, count: number}}
     */
    get(entry, stale, now, format = 'rows') {
      const cutoff = firmsFilterCutoff(entry, stale, now, ttlMs);
      const etag = firmsEtag(entry.at, stale, cutoff, format);
      const slot = slots.get(format);
      if (slot?.entry === entry && slot.etag === etag) return slot;
      const fresh = build(entry, stale, cutoff, format);
      slots.set(format, fresh);
      return fresh;
    },
  };
}
