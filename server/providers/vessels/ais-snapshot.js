import { haversineKm } from '../common/geo.js';

/**
 * A newest-first view of the live vessel store, shared by every request.
 *
 * `/api/vessels` used to copy and sort up to 50,000 rows per request. The
 * snapshot sorts once per `ttlMs` and every request in between walks it.
 * Vessels that changed since the sort are marked by the store and merged in
 * at read time, so a request still sees every update the moment it lands:
 * the rows are the same as a fresh sort would give, newest first, with rows
 * older than the stale cutoff left out. Walking newest-first lets a request
 * stop at its row cap or at the cutoff without touching the rest.
 */

/** Changed vessels merged at read time before a full re-sort is cheaper. */
const MAX_PENDING_CHANGES = 5_000;

/**
 * Newest position first; among rows stored in the same millisecond, the one
 * stored last first. `_seq` is the store's change sequence, unique per row
 * version, so the order is total and a delta client can rebuild it exactly.
 */
export const newestFirst = (a, b) =>
  b._updatedAt - a._updatedAt || (b._seq ?? 0) - (a._seq ?? 0);

/**
 * @param {{
 *   entries: () => Iterable<{mmsi: string, lat: number, lon: number, _updatedAt: number}>,
 *   lookup: (key: string) => (object|undefined),
 *   staleMs: number,
 *   ttlMs: number,
 *   now?: () => number,
 * }} options
 */
export function createSortedSnapshot({
  entries,
  lookup,
  staleMs,
  ttlMs,
  now = () => Date.now(),
}) {
  let built = null; // {at, rows}
  const changed = new Set();
  let builds = 0;

  function ensureBuilt(at) {
    if (built && at - built.at < ttlMs && changed.size <= MAX_PENDING_CHANGES)
      return;
    built = { at, rows: [...entries()].sort(newestFirst) };
    changed.clear();
    builds += 1;
  }

  /** Snapshot rows and changed rows, merged newest first. */
  function* merged() {
    const fresh = [...changed]
      .map((key) => lookup(key))
      .filter(Boolean)
      .sort(newestFirst);
    let next = 0;
    for (const row of built.rows) {
      if (changed.has(row.mmsi)) continue;
      while (next < fresh.length && newestFirst(fresh[next], row) < 0)
        yield fresh[next++];
      yield row;
    }
    while (next < fresh.length) yield fresh[next++];
  }

  /**
   * The stored rows a request sees, newest first, with their internal
   * fields, and the stale cutoff they were read at.
   * @param {number} maxRows
   * @param {?{lat: number, lon: number, radiusKm: number}} [area]
   * @returns {{rows: object[], cutoff: number}}
   */
  function readWindow(maxRows, area = null) {
    const at = now();
    ensureBuilt(at);
    const cutoff = at - staleMs;
    const out = [];
    if (maxRows <= 0) return { rows: out, cutoff };
    // No changes since the sort: walk the sorted array itself.
    for (const row of changed.size ? merged() : built.rows) {
      if (row._updatedAt < cutoff) break;
      if (area && !inArea(row, area)) continue;
      out.push(row);
      if (out.length >= maxRows) break;
    }
    return { rows: out, cutoff };
  }

  return {
    /** The store calls this whenever a vessel is added, replaced or removed. */
    markChanged(key) {
      if (built) changed.add(key);
    },

    window: readWindow,

    /**
     * Rows newest first, without the internal fields.
     * @param {number} maxRows
     * @param {?{lat: number, lon: number, radiusKm: number}} [area]
     * @returns {object[]}
     */
    rows(maxRows, area = null) {
      return readWindow(maxRows, area).rows.map(visibleRow);
    },

    stats: () => ({ builds, pendingChanges: changed.size }),
  };
}

/**
 * A stored row as a client sees it: without the internal timestamp and
 * change sequence.
 * @param {object} row
 * @returns {object}
 */
export function visibleRow(row) {
  const { _updatedAt, _seq, ...visible } = row;
  return visible;
}

/** Kilometres per degree of latitude (great circle on the 6371 km sphere). */
const KM_PER_DEG_LAT = (6371 * Math.PI) / 180;

function inArea(row, area) {
  // A row further away in latitude alone than the radius cannot be inside;
  // this skips the trigonometry for almost every row of a regional request.
  if (Math.abs(row.lat - area.lat) * KM_PER_DEG_LAT > area.radiusKm)
    return false;
  return haversineKm(area.lat, area.lon, row.lat, row.lon) <= area.radiusKm;
}

/**
 * The area a `/api/vessels` request asks for, or null for every vessel. All
 * three of `lat`, `lon` and `radius_km` must be valid; anything else is read
 * as no area, which is what the route answered before it honoured one.
 * @param {URLSearchParams} params
 * @returns {?{lat: number, lon: number, radiusKm: number}}
 */
export function parseVesselArea(params) {
  const read = (name) => {
    const raw = params.get(name);
    return raw === null || raw.trim() === '' ? NaN : Number(raw);
  };
  const lat = read('lat');
  const lon = read('lon');
  const radiusKm = read('radius_km');
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  return { lat, lon, radiusKm };
}
