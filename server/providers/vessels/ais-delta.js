import { randomBytes } from 'node:crypto';

import { visibleRow } from './ais-snapshot.js';

/**
 * `/api/vessels?since=<cursor>`: only what changed since a client's last
 * answer.
 *
 * Every stored row version carries `_seq`, a change sequence that grows with
 * each add, replace or removal. A cursor names the sequence a client has seen
 * (and this server process, so a restart never reads an old cursor as new).
 * A delta answer holds the rows in the request's window with a newer sequence,
 * the ids that may have left the window since, the stale cutoff, and the
 * window's size and digest so the client can prove its merged copy equals the
 * full answer; anything that cannot be answered exactly gets the full window.
 *
 * Wire rows in this mode add `_u` (store time) and `_s` (sequence), the keys
 * the full answer is ordered by, so the client rebuilds the same order.
 * The client side is src/sources/live/vesselDelta.js.
 */

/** Removals remembered for delta answers; an older cursor gets a full answer. */
export const MAX_TOMBSTONES = 50_000;

/**
 * The store's change sequence and recent removals.
 * @param {{maxTombstones?: number, bootId?: string}} [options]
 */
export function createVesselChangeLog({
  maxTombstones = MAX_TOMBSTONES,
  bootId = randomBytes(6).toString('hex'),
} = {}) {
  let seq = 0;
  /** Removals oldest first; `floor` is the newest one forgotten. */
  let tombstones = [];
  let floor = 0;

  function trim() {
    if (tombstones.length <= maxTombstones) return;
    // Forget the older half at once so trimming stays amortised O(1).
    const keep = Math.floor(maxTombstones / 2);
    const dropped = tombstones.length - keep;
    floor = tombstones[dropped - 1].seq;
    tombstones = tombstones.slice(dropped);
  }

  return {
    /** A new sequence number for a row version about to be stored. */
    nextSeq: () => ++seq,

    /** Remember that a vessel left the store. */
    recordRemoval(mmsi) {
      tombstones.push({ mmsi, seq: ++seq });
      trim();
    },

    /** The cursor naming everything stored so far. */
    cursor: () => `${bootId}.${seq}`,

    /**
     * The sequence a cursor names, or null when it cannot be answered with a
     * delta: malformed, from another server process, ahead of this one, or
     * older than the removals still remembered.
     * @param {?string} text
     * @returns {?number}
     */
    parseCursor(text) {
      const match = /^([0-9a-f]+)\.(\d{1,15})$/.exec(String(text ?? ''));
      if (!match || match[1] !== bootId) return null;
      const since = Number(match[2]);
      if (!Number.isSafeInteger(since) || since > seq || since < floor)
        return null;
      return since;
    },

    /** Ids removed from the store after `since`. */
    removedSince(since) {
      const ids = [];
      for (let i = tombstones.length - 1; i >= 0; i--) {
        if (tombstones[i].seq <= since) break;
        ids.push(tombstones[i].mmsi);
      }
      return ids;
    },

    stats: () => ({ seq, tombstones: tombstones.length, floor }),
  };
}

/** A stored row on the wire in cursor mode. */
export function wireRow(row) {
  return { ...visibleRow(row), _u: row._updatedAt, _s: row._seq };
}

/**
 * Order-independent digest of a window: the sum of its row sequences. Each
 * row version has a unique sequence, so two sets with the same digest and
 * size hold the same row versions unless they differ in a way that sums
 * equal, which a resync on the next mismatch would still repair.
 * @param {Iterable<{_seq?: number}>} rows
 * @returns {number}
 */
export function windowDigest(rows) {
  let digest = 0;
  for (const row of rows) digest += row._seq ?? 0;
  return digest;
}

/**
 * The body fields of a cursor-mode answer.
 * @param {{
 *   window: {rows: object[], cutoff: number},
 *   since: ?number,
 *   cursor: string,
 *   removedSince: (since: number) => string[],
 *   storedRows: () => Iterable<{mmsi: string, _seq: number}>,
 * }} input
 */
export function buildVesselSyncBody({
  window,
  since,
  cursor,
  removedSince,
  storedRows,
}) {
  const shared = {
    cursor,
    cutoff: window.cutoff,
    count: window.rows.length,
    digest: windowDigest(window.rows),
    // The full window's newest fix, the same value a full answer reports.
    newestPositionAt: window.rows[0]?.last_position_UTC || null,
  };
  if (since == null)
    return { ...shared, delta: false, rows: window.rows.map(wireRow) };
  const inWindow = new Set(window.rows.map((row) => row.mmsi));
  const removed = new Set(removedSince(since));
  // A row changed since the cursor but outside the window now moved out of
  // the area, aged past the cutoff or fell below the row cap.
  for (const row of storedRows())
    if (row._seq > since && !inWindow.has(row.mmsi)) removed.add(row.mmsi);
  for (const mmsi of inWindow) removed.delete(mmsi);
  return {
    ...shared,
    delta: true,
    rows: window.rows.filter((row) => row._seq > since).map(wireRow),
    removed: [...removed],
  };
}
