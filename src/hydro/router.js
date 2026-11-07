/**
 * Message handling shared by the routing worker and its in-thread fallback.
 * Keeps at most MAX_GRIDS routed grids, oldest evicted first.
 */
import { createGridSpec } from './grid.js';
import { routeGrid } from './d8.js';
import { queryDrop } from './route.js';

const MAX_GRIDS = 3;

export function createHydroRouter() {
  const grids = new Map();
  function load({ key, spec, heights }) {
    if (typeof key !== 'string' || !key) throw new TypeError('Missing grid key');
    const grid = createGridSpec(spec);
    if (!heights || heights.length !== grid.cols * grid.rows)
      throw new RangeError('Height array does not match the grid');
    const routed = routeGrid(grid, heights);
    grids.delete(key);
    grids.set(key, { spec: grid, routed });
    while (grids.size > MAX_GRIDS) grids.delete(grids.keys().next().value);
    return { disclosure: routed.disclosure };
  }
  function query({ key, point }) {
    const entry = grids.get(key);
    if (!entry) throw new Error('Grid is not loaded');
    return { result: queryDrop(entry.spec, entry.routed, point) };
  }
  return {
    has: (key) => grids.has(key),
    handle(message) {
      if (message.type === 'load') return load(message);
      if (message.type === 'query') return query(message);
      if (message.type === 'drop') {
        grids.delete(message.key);
        return {};
      }
      throw new TypeError('Unknown hydro message');
    },
  };
}
