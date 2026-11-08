/**
 * Signature and keyed-diff helpers for layers that poll a snapshot of a few
 * hundred records and draw each one as its own entity (earthquakes, air
 * quality). The perimeters layer showed the pattern: an unchanged poll does
 * no scene work at all, and a changed poll rebuilds only the records that
 * changed. No imports, so any layer package can carry it.
 */

/**
 * One string that changes whenever any record or any field changes, and not
 * when the source merely reorders them.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string} keyOf
 * @returns {string}
 */
export function snapshotSignature(rows, keyOf) {
  const sorted = [...rows].sort((a, b) =>
    String(keyOf(a)).localeCompare(String(keyOf(b))),
  );
  return JSON.stringify(sorted);
}

/**
 * Plan a keyed update. `previous` maps each drawn record's key to whatever the
 * layer keeps for it plus the `signature` it was drawn from.
 *
 * - `order`: one step per new row, in row order. `previous` is set when the
 *   drawn item can be kept as it is; otherwise the row must be (re)built.
 * - `drop`: drawn items that left the feed or changed (to be removed).
 *
 * @template T, I
 * @param {Map<string, {signature: string} & I>} previous
 * @param {T[]} rows
 * @param {(row: T) => string} keyOf
 * @returns {{order: Array<{key: string, row: T, signature: string, previous: ?({signature: string} & I)}>, drop: Array<{signature: string} & I>}}
 */
export function planKeyedUpdate(previous, rows, keyOf) {
  const order = rows.map((row) => {
    const key = String(keyOf(row));
    const signature = JSON.stringify(row);
    const held = previous.get(key);
    return {
      key,
      row,
      signature,
      previous: held && held.signature === signature ? held : null,
    };
  });
  const kept = new Set(
    order.filter((step) => step.previous).map((step) => step.key),
  );
  const drop = [...previous]
    .filter(([key]) => !kept.has(key))
    .map(([, entry]) => entry);
  return { order, drop };
}
