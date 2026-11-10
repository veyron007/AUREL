/**
 * Grid index over the shown detections for the marker bands. Built once per
 * shown set; a view query then walks only the cells the padded view touches
 * instead of all ~100k detections.
 *
 * The query returns exactly what the former scan did: the first `limit`
 * detections of the FRP-sorted list (`firesByFrp`) that lie inside the
 * bounds, in that order. Each cell keeps the FRP ranks of its detections in
 * ascending order, and the query merges the touched cells by rank, so ties
 * keep their original order too.
 */

/** Cell size in degrees; about 2,000 cells hold land fires. */
export const MARKER_INDEX_CELL_DEGREES = 2;

const COLUMNS = Math.ceil(360 / MARKER_INDEX_CELL_DEGREES);
const ROWS = Math.ceil(180 / MARKER_INDEX_CELL_DEGREES);

function columnOf(lon) {
  const column = Math.floor((lon + 180) / MARKER_INDEX_CELL_DEGREES);
  return Math.min(COLUMNS - 1, Math.max(0, column));
}

function rowOf(lat) {
  const row = Math.floor((lat + 90) / MARKER_INDEX_CELL_DEGREES);
  return Math.min(ROWS - 1, Math.max(0, row));
}

/**
 * @param {Array<{lat:number, lon:number}>} firesByFrp Shown set, FRP-sorted.
 * @returns {{cells: Map<number, Int32Array>, size: number}}
 */
export function buildFireGridIndex(firesByFrp) {
  const lists = new Map();
  for (let rank = 0; rank < firesByFrp.length; rank++) {
    const fire = firesByFrp[rank];
    if (!Number.isFinite(fire?.lat) || !Number.isFinite(fire?.lon)) continue;
    // Integer cell keys: no string per detection.
    const key = rowOf(fire.lat) * COLUMNS + columnOf(fire.lon);
    let list = lists.get(key);
    if (!list) {
      list = [];
      lists.set(key, list);
    }
    list.push(rank);
  }
  const cells = new Map();
  for (const [key, list] of lists) cells.set(key, Int32Array.from(list));
  return { cells, size: firesByFrp.length };
}

function columnRanges(bounds) {
  if (!bounds.wraps) return [[columnOf(bounds.west), columnOf(bounds.east)]];
  return [
    [columnOf(bounds.west), COLUMNS - 1],
    [0, columnOf(bounds.east)],
  ];
}

/** Cell rank lists the bounds touch. */
function touchedCells(index, bounds) {
  const lists = [];
  const firstRow = rowOf(bounds.south);
  const lastRow = rowOf(bounds.north);
  for (const [first, last] of columnRanges(bounds)) {
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = first; column <= last; column++) {
        const list = index.cells.get(row * COLUMNS + column);
        if (list) lists.push(list);
      }
    }
  }
  return lists;
}

/** Binary min-heap of cursors ordered by the rank each points at. */
function heapPush(heap, cursor) {
  heap.push(cursor);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].rank <= cursor.rank) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = cursor;
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child =
        right < heap.length && heap[right].rank < heap[left].rank
          ? right
          : left;
      if (heap[child].rank >= last.rank) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  return top;
}

/**
 * The strongest `limit` detections inside `bounds`, strongest first.
 * @param {{cells: Map<number, Int32Array>}} index From buildFireGridIndex.
 * @param {Array<Object>} firesByFrp The set the index was built from.
 * @param {{west:number, south:number, east:number, north:number, wraps:boolean}} bounds
 * @param {number} limit
 * @param {function(Object, number, number): boolean} contains Exact point test.
 * @returns {Array<Object>}
 */
export function queryFireGridIndex(index, firesByFrp, bounds, limit, contains) {
  const steps = queryFireGridIndexSteps(
    index,
    firesByFrp,
    bounds,
    limit,
    contains,
  );
  for (;;) {
    const { done, value } = steps.next();
    if (done) return value;
  }
}

/** Detections merged between yields of {@link queryFireGridIndexSteps}. */
const QUERY_STEP = 2048;

/**
 * {@link queryFireGridIndex} as a generator that yields every QUERY_STEP
 * merged detections, for a caller running in time slices; it returns the
 * same array.
 * @returns {Generator<void, Array<Object>, void>}
 */
export function* queryFireGridIndexSteps(
  index,
  firesByFrp,
  bounds,
  limit,
  contains,
) {
  const heap = [];
  for (const list of touchedCells(index, bounds))
    heapPush(heap, { list, at: 0, rank: list[0] });
  const result = [];
  let merged = 0;
  while (heap.length && result.length < limit) {
    const cursor = heapPop(heap);
    const fire = firesByFrp[cursor.rank];
    if (contains(bounds, fire.lat, fire.lon)) result.push(fire);
    cursor.at += 1;
    if (cursor.at < cursor.list.length) {
      cursor.rank = cursor.list[cursor.at];
      heapPush(heap, cursor);
    }
    if (++merged % QUERY_STEP === 0) yield;
  }
  return result;
}
