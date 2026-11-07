import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridSpec, rowCellAreasKm2 } from './grid.js';
import {
  D8_OUT,
  fillDepressions,
  flowDirections,
  flowAccumulation,
  routeGrid,
  snapOutlet,
  traceDownstream,
  upstreamMask,
} from './d8.js';
import { catchmentOutline, maskAreaKm2, maskRings } from './catchment.js';

const STEP = 1 / 1200; // 3 arc-seconds
const grid = (cols, rows, lat = 30.3) =>
  createGridSpec({
    west: 78,
    north: lat,
    cols,
    rows,
    stepLonDeg: STEP,
    stepLatDeg: STEP,
  });
const build = (spec, fn) => {
  const heights = new Float64Array(spec.cols * spec.rows);
  for (let r = 0; r < spec.rows; r++)
    for (let c = 0; c < spec.cols; c++) heights[r * spec.cols + c] = fn(r, c);
  return heights;
};

test('a cone drains every cell outward with no fill and no loops', () => {
  const spec = grid(41, 41);
  const heights = build(spec, (r, c) => 1000 - 10 * Math.hypot(r - 20, c - 20));
  const routed = routeGrid(spec, heights);
  assert.equal(routed.disclosure.raisedCells, 0);
  const apex = 20 * 41 + 20;
  assert.equal(routed.accumulation[apex], 1, 'nothing drains into the apex');
  const trace = traceDownstream(spec, routed.directions, 20 * 41 + 25);
  assert.equal(trace.end, 'edge');
  assert.equal(trace.cells.at(-1) % 41, 40);
  assert.ok(trace.cells.every((cell) => Math.floor(cell / 41) === 20));
  assert.equal(trace.cells.length, 16);
});

test('a south-sloping valley gathers both flanks into the channel', () => {
  const spec = grid(21, 30);
  const heights = build(spec, (r, c) => 500 - r * 2 + Math.abs(c - 10) * 5);
  const routed = routeGrid(spec, heights);
  const trace = traceDownstream(spec, routed.directions, 21 + 3);
  assert.equal(trace.end, 'edge');
  const last = trace.cells.at(-1);
  assert.equal(Math.floor(last / 21), 29, 'leaves through the south edge');
  assert.equal(last % 21, 10, 'in the channel column');
  const outlet = 29 * 21 + 10;
  const upstream = upstreamMask(spec, routed.directions, outlet);
  assert.ok(upstream.cells > 21 * 30 * 0.8);
  assert.equal(upstream.touchesEdge, true);
  assert.equal(routed.accumulation[outlet], upstream.cells);
});

test('a pit is filled, disclosed and drained', () => {
  const spec = grid(15, 15);
  const heights = build(spec, (r, c) => 100 + c);
  heights[7 * 15 + 7] = 50;
  const fill = fillDepressions(spec, heights);
  assert.equal(fill.raisedCells, 1);
  assert.ok(fill.maxRaiseM > 55.9 && fill.maxRaiseM < 56.1);
  const route = flowDirections(spec, fill.filled, heights);
  assert.equal(route.ambiguous[7 * 15 + 7], 1, 'filled pit flagged ambiguous');
  const trace = traceDownstream(
    spec,
    route.directions,
    7 * 15 + 7,
    route.ambiguous,
  );
  assert.equal(trace.end, 'edge');
  assert.ok(trace.ambiguousSteps >= 1);
});

test('a flat fan resolves every cell to an edge but marks it ambiguous', () => {
  const spec = grid(25, 25);
  const heights = build(spec, () => 600);
  const routed = routeGrid(spec, heights);
  assert.ok(routed.disclosure.ambiguousCells >= 23 * 23);
  for (const start of [12 * 25 + 12, 3 * 25 + 20, 20 * 25 + 4]) {
    const trace = traceDownstream(spec, routed.directions, start);
    assert.equal(trace.end, 'edge');
    assert.ok(trace.cells.length <= 14);
  }
});

test('missing heights act as outlets and the trace reports them', () => {
  const spec = grid(10, 10);
  const heights = build(spec, (r, c) => 100 + c);
  for (let r = 0; r < 10; r++) heights[r * 10] = NaN;
  const routed = routeGrid(spec, heights);
  const trace = traceDownstream(spec, routed.directions, 5 * 10 + 8);
  assert.equal(trace.end, 'missing');
  assert.equal(trace.cells.at(-1) % 10, 1);
  assert.equal(routed.directions[5 * 10 + 1], D8_OUT);
  assert.equal(traceDownstream(spec, routed.directions, 0).end, 'missing');
});

test('outlet snapping moves to the strongest nearby flow line only', () => {
  const spec = grid(21, 30);
  const heights = build(spec, (r, c) => 500 - r * 2 + Math.abs(c - 10) * 5);
  const routed = routeGrid(spec, heights);
  assert.equal(
    snapOutlet(spec, routed.accumulation, 20 * 21 + 12, 3) % 21,
    10,
    'moves onto the channel',
  );
  const far = snapOutlet(spec, routed.accumulation, 20 * 21 + 18, 2);
  assert.equal(far % 21, 16, 'a two-cell radius cannot reach the channel');
});

test('catchment area equals the sum of masked cell areas', () => {
  const spec = grid(12, 12);
  const mask = new Uint8Array(144);
  for (let r = 2; r < 7; r++) for (let c = 3; c < 9; c++) mask[r * 12 + c] = 1;
  const areas = rowCellAreasKm2(spec);
  let expected = 0;
  for (let r = 2; r < 7; r++) expected += 6 * areas[r];
  assert.ok(Math.abs(maskAreaKm2(spec, mask) - expected) < 1e-12);
  assert.ok(areas[0] > 0.0072 && areas[0] < 0.0076, 'about 0.0074 km² per 3″');
  const outline = catchmentOutline(spec, mask);
  assert.equal(outline.parts, 1);
  assert.equal(outline.ring.length, 5, 'four corners plus closure');
  assert.deepEqual(outline.ring[0], outline.ring.at(-1));
  assert.deepEqual(outline.ring[0].map(Number.isFinite), [true, true]);
});

test('outline keeps diagonal-only neighbours apart and counts holes', () => {
  const spec = grid(6, 6);
  const mask = new Uint8Array(36);
  mask[7] = 1;
  mask[14] = 1;
  assert.equal(catchmentOutline(spec, mask).parts, 2);
  const square = new Uint8Array(36);
  for (let r = 1; r < 5; r++) for (let c = 1; c < 5; c++) square[r * 6 + c] = 1;
  square[14] = 0;
  const outline = catchmentOutline(spec, square);
  assert.equal(outline.parts, 1);
  assert.equal(outline.holes, 1);
  assert.equal(maskRings(spec, square).length, 2);
});

test('a fixture basin delineated by D8 matches its constructed divide', () => {
  const spec = grid(30, 30);
  const heights = build(
    spec,
    (r, c) =>
      800 -
      r * 3 +
      (c < 15 ? Math.abs(c - 7) : Math.abs(c - 22)) * 6 +
      (c === 15 ? 40 : 0),
  );
  const routed = routeGrid(spec, heights);
  const east = upstreamMask(spec, routed.directions, 29 * 30 + 22);
  const west = upstreamMask(spec, routed.directions, 29 * 30 + 7);
  for (let r = 1; r < 29; r++) {
    assert.equal(east.mask[r * 30 + 25], 1);
    assert.equal(west.mask[r * 30 + 3], 1);
    assert.equal(east.mask[r * 30 + 3], 0);
    assert.equal(west.mask[r * 30 + 25], 0);
  }
});
