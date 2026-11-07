/**
 * D8 flow routing on a bounded geographic grid.
 *
 * 1. Depressions are filled with Priority-Flood+ε (Barnes, Lehman & Mulla
 *    2014, "Priority-Flood: An optimal depression-filling and watershed-
 *    labeling algorithm", Computers & Geosciences 62, algorithm 3; equal-height outlets are expanded together). Every
 *    raised cell is counted so the method card can disclose the fill.
 * 2. Each cell drains to the neighbour with the steepest descent on the filled
 *    surface (O'Callaghan & Mark 1984). Window-edge cells always drain out,
 *    because the terrain beyond them is unknown; cells beside missing heights
 *    drain into them when no neighbour is lower.
 * 3. A cell is "ambiguous" when its second-steepest descent is within
 *    AMBIGUITY_RATIO of the steepest, or when its direction exists only because
 *    the fill imposed a gradient on a flat or pit (typical on alluvial fans).
 *
 * Inputs are plain typed arrays; nothing here touches the DOM, Cesium or a
 * network, so it runs unchanged in a Web Worker and under node:test.
 */
import { cellHeightM, rowWidthsM } from './grid.js';

/** Neighbour order: E, SE, S, SW, W, NW, N, NE (row grows southward). */
export const D8_ROW = Object.freeze([0, 1, 1, 1, 0, -1, -1, -1]);
export const D8_COL = Object.freeze([1, 1, 0, -1, -1, -1, 0, 1]);
/** Direction code: drains out of the window, or into a missing-height cell. */
export const D8_OUT = 8;
/** Direction code: the cell itself has no height. */
export const D8_NODATA = 255;
/** Height increment imposed across flats and filled pits, metres. */
export const FILL_EPSILON_M = 1e-4;
/** Second-best descent at or above this share of the best counts as ambiguous. */
export const AMBIGUITY_RATIO = 0.95;
/** A cell counts as raised when the fill lifted it by more than this, metres. */
const RAISE_REPORT_M = 1e-3;

/** Binary min-heap of cell indices keyed by height, ties broken by index. */
class CellHeap {
  constructor(keys, capacity) {
    this.keys = keys;
    this.items = new Int32Array(Math.max(16, capacity));
    this.size = 0;
  }
  less(a, b) {
    const ka = this.keys[a],
      kb = this.keys[b];
    return ka < kb || (ka === kb && a < b);
  }
  push(cell) {
    const items = this.items;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(cell, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = cell;
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items[--this.size];
    const n = this.size;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && this.less(items[r], items[l]) ? r : l;
      if (!this.less(items[m], last)) break;
      items[i] = items[m];
      i = m;
    }
    if (n > 0) items[i] = last;
    return top;
  }
}

const isMissing = (value) => !Number.isFinite(value);

function assertHeights(spec, heights) {
  if (!heights || heights.length !== spec.cols * spec.rows)
    throw new RangeError('Height array does not match the grid');
}

/** True when a cell touches the window edge or a missing-height neighbour. */
function isBoundary(spec, heights, row, col) {
  if (row === 0 || col === 0 || row === spec.rows - 1 || col === spec.cols - 1)
    return true;
  for (let k = 0; k < 8; k++)
    if (isMissing(heights[(row + D8_ROW[k]) * spec.cols + col + D8_COL[k]]))
      return true;
  return false;
}

/**
 * Priority-Flood+ε depression filling.
 * @param {object} spec Grid from createGridSpec.
 * @param {ArrayLike<number>} heights Heights in metres, NaN where missing.
 * @param {{epsilonM?: number}} [options]
 * @returns {{filled: Float64Array, raisedCells: number, maxRaiseM: number, validCells: number}}
 */
export function fillDepressions(
  spec,
  heights,
  { epsilonM = FILL_EPSILON_M } = {},
) {
  assertHeights(spec, heights);
  const { cols, rows } = spec;
  const n = cols * rows;
  const filled = Float64Array.from(heights, (v) => (isMissing(v) ? NaN : v));
  const closed = new Uint8Array(n);
  const open = new CellHeap(filled, n);
  let validCells = 0;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      if (isMissing(filled[cell])) {
        closed[cell] = 1;
        continue;
      }
      validCells++;
      if (isBoundary(spec, filled, row, col)) {
        closed[cell] = 1;
        open.push(cell);
      }
    }
  // Raised cells go through a FIFO "pit" queue (Barnes 2014). Every heap cell
  // of the current lowest height is popped as one batch before the queue runs,
  // so a flat floods in rings from all of its outlets at once and drains to
  // the nearest one rather than to whichever outlet was popped first.
  const pit = new Int32Array(n);
  let pitHead = 0,
    pitTail = 0;
  const batch = [];
  const expand = (cell) => {
    const row = Math.floor(cell / cols),
      col = cell - row * cols;
    const floor = filled[cell] + epsilonM;
    for (let k = 0; k < 8; k++) {
      const r = row + D8_ROW[k],
        c = col + D8_COL[k];
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const next = r * cols + c;
      if (closed[next]) continue;
      closed[next] = 1;
      if (filled[next] <= floor) {
        filled[next] = floor;
        pit[pitTail++] = next;
      } else open.push(next);
    }
  };
  while (open.size || pitHead < pitTail) {
    if (pitHead < pitTail) {
      expand(pit[pitHead++]);
      continue;
    }
    pitHead = pitTail = 0;
    const level = filled[open.items[0]];
    batch.length = 0;
    while (open.size && filled[open.items[0]] === level) batch.push(open.pop());
    for (const cell of batch) expand(cell);
  }
  let raisedCells = 0,
    maxRaiseM = 0;
  for (let i = 0; i < n; i++) {
    if (isMissing(heights[i])) continue;
    const raise = filled[i] - heights[i];
    if (raise > RAISE_REPORT_M) {
      raisedCells++;
      if (raise > maxRaiseM) maxRaiseM = raise;
    }
  }
  return { filled, raisedCells, maxRaiseM, validCells };
}

/**
 * Steepest-descent D8 directions on a filled surface.
 * @returns {{directions: Uint8Array, ambiguous: Uint8Array, ambiguousCells: number}}
 */
export function flowDirections(spec, filled, original = filled) {
  assertHeights(spec, filled);
  const { cols, rows } = spec;
  const n = cols * rows;
  const widths = rowWidthsM(spec),
    dy = cellHeightM(spec);
  const directions = new Uint8Array(n).fill(D8_NODATA);
  const ambiguous = new Uint8Array(n);
  let ambiguousCells = 0;
  for (let row = 0; row < rows; row++) {
    const dx = widths[row],
      diag = Math.hypot(dx, dy);
    const distance = [dx, diag, dy, diag, dx, diag, dy, diag];
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const z = filled[cell];
      if (isMissing(z)) continue;
      if (row === 0 || col === 0 || row === rows - 1 || col === cols - 1) {
        directions[cell] = D8_OUT;
        continue;
      }
      let best = -1,
        bestSlope = 0,
        secondSlope = 0,
        drainsOut = false,
        originalDescent = false;
      for (let k = 0; k < 8; k++) {
        const r = row + D8_ROW[k],
          c = col + D8_COL[k];
        if (r < 0 || c < 0 || r >= rows || c >= cols) {
          drainsOut = true;
          continue;
        }
        const next = r * cols + c;
        if (isMissing(filled[next])) {
          drainsOut = true;
          continue;
        }
        const slope = (z - filled[next]) / distance[k];
        if (original[cell] - original[next] > 0) originalDescent = true;
        if (slope > bestSlope) {
          secondSlope = bestSlope;
          bestSlope = slope;
          best = k;
        } else if (slope > secondSlope) secondSlope = slope;
      }
      if (best < 0) {
        directions[cell] = drainsOut ? D8_OUT : D8_NODATA;
        continue;
      }
      directions[cell] = best;
      if (
        !originalDescent ||
        (secondSlope > 0 && secondSlope >= AMBIGUITY_RATIO * bestSlope)
      ) {
        ambiguous[cell] = 1;
        ambiguousCells++;
      }
    }
  }
  return { directions, ambiguous, ambiguousCells };
}

/** Index of the downstream neighbour, or -1 when the cell leaves the window. */
export function downstreamCell(spec, directions, cell) {
  const k = directions[cell];
  if (k >= 8) return -1;
  const row = Math.floor(cell / spec.cols) + D8_ROW[k],
    col = (cell % spec.cols) + D8_COL[k];
  return row * spec.cols + col;
}

/**
 * Upstream cell counts (including the cell itself) via a topological pass.
 * @returns {Uint32Array}
 */
export function flowAccumulation(spec, directions) {
  const n = spec.cols * spec.rows;
  const indegree = new Uint8Array(n);
  for (let cell = 0; cell < n; cell++) {
    const next = downstreamCell(spec, directions, cell);
    if (next >= 0) indegree[next]++;
  }
  const accumulation = new Uint32Array(n);
  const queue = new Int32Array(n);
  let head = 0,
    tail = 0;
  for (let cell = 0; cell < n; cell++) {
    if (directions[cell] === D8_NODATA) continue;
    accumulation[cell] = 1;
    if (indegree[cell] === 0) queue[tail++] = cell;
  }
  while (head < tail) {
    const cell = queue[head++];
    const next = downstreamCell(spec, directions, cell);
    if (next < 0) continue;
    accumulation[next] += accumulation[cell];
    if (--indegree[next] === 0) queue[tail++] = next;
  }
  return accumulation;
}

/**
 * Follow D8 directions from a cell until the water leaves the window.
 * @returns {{cells: number[], end: 'edge'|'missing'|'loop', ambiguousSteps: number}}
 */
export function traceDownstream(spec, directions, start, ambiguous = null) {
  const cells = [];
  const seen = new Set();
  let cell = start,
    ambiguousSteps = 0;
  if (directions[cell] === D8_NODATA)
    return { cells, end: 'missing', ambiguousSteps };
  while (cell >= 0) {
    if (seen.has(cell)) return { cells, end: 'loop', ambiguousSteps };
    seen.add(cell);
    cells.push(cell);
    if (ambiguous?.[cell]) ambiguousSteps++;
    const next = downstreamCell(spec, directions, cell);
    if (next < 0) {
      const row = Math.floor(cell / spec.cols),
        col = cell % spec.cols;
      const edge =
        row === 0 ||
        col === 0 ||
        row === spec.rows - 1 ||
        col === spec.cols - 1;
      return { cells, end: edge ? 'edge' : 'missing', ambiguousSteps };
    }
    cell = next;
  }
  return { cells, end: 'missing', ambiguousSteps };
}

/**
 * Every cell whose D8 path passes through `outlet`.
 * @returns {{mask: Uint8Array, cells: number, touchesEdge: boolean}}
 */
export function upstreamMask(spec, directions, outlet) {
  const { cols, rows } = spec;
  const mask = new Uint8Array(cols * rows);
  if (directions[outlet] === D8_NODATA)
    return { mask, cells: 0, touchesEdge: false };
  const stack = [outlet];
  mask[outlet] = 1;
  let count = 0,
    touchesEdge = false;
  while (stack.length) {
    const cell = stack.pop();
    count++;
    const row = Math.floor(cell / cols),
      col = cell - row * cols;
    if (row === 0 || col === 0 || row === rows - 1 || col === cols - 1)
      touchesEdge = true;
    for (let k = 0; k < 8; k++) {
      const r = row + D8_ROW[k],
        c = col + D8_COL[k];
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const next = r * cols + c;
      if (mask[next]) continue;
      // The neighbour drains here when its direction is the reverse of k.
      if (directions[next] === (k + 4) % 8) {
        mask[next] = 1;
        stack.push(next);
      }
    }
  }
  return { mask, cells: count, touchesEdge };
}

/**
 * Move an outlet to the strongest flow line within `radiusCells`, so a click
 * beside a channel delineates the channel's catchment rather than a hillslope.
 * Ties go to the nearest cell, then the lowest index.
 */
export function snapOutlet(spec, accumulation, cell, radiusCells = 3) {
  const { cols, rows } = spec;
  const row0 = Math.floor(cell / cols),
    col0 = cell - row0 * cols;
  let best = cell,
    bestValue = accumulation[cell],
    bestDistance = 0;
  for (let dr = -radiusCells; dr <= radiusCells; dr++)
    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
      const r = row0 + dr,
        c = col0 + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const distance = dr * dr + dc * dc;
      if (distance > radiusCells * radiusCells) continue;
      const next = r * cols + c,
        value = accumulation[next];
      if (
        value > bestValue ||
        (value === bestValue && distance < bestDistance)
      ) {
        best = next;
        bestValue = value;
        bestDistance = distance;
      }
    }
  return best;
}

/** Fill, route and accumulate in one call; the worker's unit of work. */
export function routeGrid(spec, heights) {
  const fill = fillDepressions(spec, heights);
  const route = flowDirections(spec, fill.filled, heights);
  const accumulation = flowAccumulation(spec, route.directions);
  return {
    directions: route.directions,
    ambiguous: route.ambiguous,
    accumulation,
    disclosure: {
      method: 'priority-flood-epsilon',
      epsilonM: FILL_EPSILON_M,
      validCells: fill.validCells,
      raisedCells: fill.raisedCells,
      maxRaiseM: fill.maxRaiseM,
      ambiguousCells: route.ambiguousCells,
      ambiguityRatio: AMBIGUITY_RATIO,
    },
  };
}
