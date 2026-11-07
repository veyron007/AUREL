/**
 * One raindrop query against a routed grid: the downstream trace, the snapped
 * outlet, the upstream catchment, its area and outline, and the weights the
 * rain cards need (catchment area per IMERG 0.1° cell). Pure; the worker
 * calls it and the tests call it directly.
 */
import { cellCenter, locateCell, rowCellAreasKm2 } from './grid.js';
import { snapOutlet, traceDownstream, upstreamMask } from './d8.js';
import { catchmentOutline } from './catchment.js';

/** Radius used to move a click onto the strongest nearby flow line, cells. */
export const SNAP_RADIUS_CELLS = 3;
/** Longest trace kept; a 3″ grid never needs more inside one window. */
const MAX_TRACE_CELLS = 20_000;
/** IMERG grid spacing, degrees. */
export const IMERG_CELL_DEG = 0.1;

/** Key of the IMERG 0.1° cell containing a point: indices from −180/−90. */
export function imergCellKey(lon, lat) {
  const i = Math.floor((lon + 180) / IMERG_CELL_DEG + 1e-9),
    j = Math.floor((lat + 90) / IMERG_CELL_DEG + 1e-9);
  return `${i}:${j}`;
}

/** Centre of an IMERG cell key. */
export function imergCellCenter(key) {
  const [i, j] = key.split(':').map(Number);
  return [
    +(-180 + (i + 0.5) * IMERG_CELL_DEG).toFixed(3),
    +(-90 + (j + 0.5) * IMERG_CELL_DEG).toFixed(3),
  ];
}

/**
 * Query a routed grid.
 * @param {object} spec Grid specification.
 * @param {{directions:Uint8Array, ambiguous:Uint8Array, accumulation:Uint32Array}} routed
 * @param {{lon:number, lat:number}} point
 */
export function queryDrop(spec, routed, { lon, lat }) {
  const start = locateCell(spec, lon, lat);
  if (start < 0) return { status: 'outside-window' };
  const trace = traceDownstream(spec, routed.directions, start, routed.ambiguous);
  if (!trace.cells.length) return { status: 'no-height' };
  const cells = trace.cells.slice(0, MAX_TRACE_CELLS);
  const path = cells.map((cell) => cellCenter(spec, cell));
  const areas = rowCellAreasKm2(spec);
  const pathUpKm2 = cells.map(
    (cell) =>
      +(routed.accumulation[cell] * areas[Math.floor(cell / spec.cols)]).toFixed(2),
  );
  const outlet = snapOutlet(spec, routed.accumulation, start, SNAP_RADIUS_CELLS);
  const upstream = upstreamMask(spec, routed.directions, outlet);
  const weights = new Map();
  let areaKm2 = 0;
  for (let cell = 0; cell < upstream.mask.length; cell++) {
    if (!upstream.mask[cell]) continue;
    const row = Math.floor(cell / spec.cols);
    const [cLon, cLat] = cellCenter(spec, cell);
    const key = imergCellKey(cLon, cLat);
    weights.set(key, (weights.get(key) || 0) + areas[row]);
    areaKm2 += areas[row];
  }
  const exitCell = cells.at(-1);
  const exitRow = Math.floor(exitCell / spec.cols);
  return {
    status: 'ok',
    start: cellCenter(spec, start),
    path,
    pathUpKm2,
    end: trace.end,
    truncated: cells.length < trace.cells.length,
    steps: cells.length,
    ambiguousSteps: trace.ambiguousSteps,
    exitUpstreamKm2: routed.accumulation[exitCell] * areas[exitRow],
    outlet: cellCenter(spec, outlet),
    outletMoved: outlet !== start,
    catchment: {
      cells: upstream.cells,
      areaKm2,
      touchesEdge: upstream.touchesEdge,
      outline: catchmentOutline(spec, upstream.mask),
      imergWeights: [...weights.entries()]
        .map(([key, km2]) => ({ key, center: imergCellCenter(key), km2 }))
        .sort((a, b) => b.km2 - a.km2),
    },
  };
}
