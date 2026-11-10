/**
 * Client half of `/api/vessels?since=<cursor>` (server half:
 * server/providers/vessels/ais-delta.js).
 *
 * The mirror keeps the last full window it reconstructed, keyed by the
 * request's row cap and area. A delta answer is merged into a copy of it:
 * removals out, changed rows in, rows older than the server's stale cutoff
 * out, then the server's order (store time, then change sequence, newest
 * first) and row cap are applied. The result is checked against the size and
 * digest the server reports for its full window; any mismatch, a changed key,
 * an error or an answer without a cursor drops the mirror so the next request
 * (or an immediate retry) asks for the full window again.
 */

/** A `since` value no server cursor matches: asks for the full window. */
export const FULL_SYNC_CURSOR = '0';

const newestFirst = (a, b) => b._u - a._u || b._s - a._s;

/** A merged row without the cursor-mode ordering keys. */
function visibleRow(row) {
  const { _u, _s, ...visible } = row;
  return visible;
}

/** Whether a wire row carries the keys the mirror orders and checks by. */
function isSyncRow(row) {
  return (
    typeof row?.mmsi === 'string' &&
    row.mmsi !== '' &&
    Number.isFinite(row._u) &&
    Number.isFinite(row._s)
  );
}

/**
 * The window a set of rows makes under the server's rules.
 * @param {Iterable<object>} rows
 * @param {number} cutoff
 * @param {number} maxRows
 */
function windowOf(rows, cutoff, maxRows) {
  const kept = [];
  for (const row of rows) if (row._u >= cutoff) kept.push(row);
  return kept.sort(newestFirst).slice(0, Math.max(0, maxRows));
}

function digestOf(rows) {
  let digest = 0;
  for (const row of rows) digest += row._s;
  return digest;
}

/**
 * The merged rows for a delta answer, or null when it cannot be applied.
 * @param {Map<string, object>} held
 * @param {{rows: object[], removed?: unknown}} payload
 */
function mergeDelta(held, payload) {
  if (!Array.isArray(payload.removed)) return null;
  if (!payload.rows.every(isSyncRow)) return null;
  const merged = new Map(held);
  for (const mmsi of payload.removed) merged.delete(String(mmsi));
  for (const row of payload.rows) merged.set(row.mmsi, row);
  return merged.values();
}

export function createVesselDeltaMirror() {
  /** @type {?{key: string, cursor: string, rows: Map<string, object>}} */
  let held = null;

  return {
    /** The `since` value for a request with this key. */
    sinceFor(key) {
      return held?.key === key ? held.cursor : FULL_SYNC_CURSOR;
    },

    /** Forget the mirror: the next request asks for the full window. */
    reset() {
      held = null;
    },

    /**
     * Merge an answer. Returns the full window's rows (without the ordering
     * keys), or null when a delta could not be applied exactly and the caller
     * must ask again for the full window.
     * @param {string} key
     * @param {{rows: object[], delta?: boolean, cursor?: unknown, cutoff?: unknown, count?: unknown, digest?: unknown, removed?: unknown}} payload
     * @param {number} maxRows
     * @returns {?object[]}
     */
    apply(key, payload, maxRows) {
      if (
        typeof payload.cursor !== 'string' ||
        !Number.isFinite(payload.cutoff)
      ) {
        // A server without cursor mode: its rows are the full answer.
        held = null;
        return payload.delta === true ? null : payload.rows;
      }
      const isDelta = payload.delta === true;
      if (isDelta && held?.key !== key) {
        held = null;
        return null;
      }
      const source = isDelta
        ? mergeDelta(held.rows, payload)
        : payload.rows.every(isSyncRow)
          ? payload.rows
          : null;
      const rebuilt = source && windowOf(source, payload.cutoff, maxRows);
      const exact =
        rebuilt &&
        rebuilt.length === payload.count &&
        digestOf(rebuilt) === payload.digest;
      if (!exact) {
        held = null;
        // A full answer is the window itself even when its checks disagree.
        return isDelta ? null : payload.rows.map(visibleRow);
      }
      held = {
        key,
        cursor: payload.cursor,
        rows: new Map(rebuilt.map((row) => [row.mmsi, row])),
      };
      return rebuilt.map(visibleRow);
    },
  };
}
