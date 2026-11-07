/**
 * Catchment mask to outline and area. The outline follows cell edges (the
 * staircase is the honest shape of a D8 catchment); collinear corners are
 * dropped. Pure; shared by the worker and the tests.
 */
import { rowCellAreasKm2 } from './grid.js';

/** Sum of the spherical areas of the masked cells, km². */
export function maskAreaKm2(spec, mask) {
  const areas = rowCellAreasKm2(spec);
  let total = 0;
  for (let row = 0; row < spec.rows; row++) {
    const offset = row * spec.cols;
    let count = 0;
    for (let col = 0; col < spec.cols; col++) if (mask[offset + col]) count++;
    total += count * areas[row];
  }
  return total;
}

/**
 * Closed rings, in cell-corner coordinates [col, row], tracing the boundary of
 * the masked region with the region on the left. Outer rings run
 * counter-clockwise in (col, -row) space; holes run clockwise.
 * @returns {Array<Array<[number, number]>>}
 */
export function maskRings(spec, mask) {
  const { cols, rows } = spec;
  const inside = (r, c) =>
    r >= 0 && c >= 0 && r < rows && c < cols && mask[r * cols + c] === 1;
  // Directed boundary edges keyed by their start corner.
  const edges = new Map();
  const add = (x0, y0, x1, y1) => {
    const key = y0 * (cols + 1) + x0;
    const list = edges.get(key);
    const edge = [x0, y0, x1, y1];
    if (list) list.push(edge);
    else edges.set(key, [edge]);
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!inside(r, c)) continue;
      // Corner (x, y) = (col, row); y grows southward. Keep the cell on the left
      // when walking: north edge westward, west edge southward, and so on.
      if (!inside(r - 1, c)) add(c + 1, r, c, r);
      if (!inside(r, c - 1)) add(c, r, c, r + 1);
      if (!inside(r + 1, c)) add(c, r + 1, c + 1, r + 1);
      if (!inside(r, c + 1)) add(c + 1, r + 1, c + 1, r);
    }
  const rings = [];
  for (const startList of edges.values()) {
    while (startList.length) {
      const first = startList.pop();
      const ring = [[first[0], first[1]]];
      let [, , x, y] = first;
      let previous = first;
      let guard = 0;
      while ((x !== first[0] || y !== first[1]) && guard++ < 4 * cols * rows) {
        ring.push([x, y]);
        const list = edges.get(y * (cols + 1) + x);
        if (!list?.length) break;
        // At a pinch corner prefer the left turn, which keeps diagonal-only
        // neighbours as separate rings.
        let pick = 0;
        if (list.length > 1) {
          const dx = previous[2] - previous[0],
            dy = previous[3] - previous[1];
          pick = list.findIndex(
            (edge) => (edge[2] - edge[0]) * dy - (edge[3] - edge[1]) * dx > 0,
          );
          if (pick < 0) pick = 0;
        }
        previous = list.splice(pick, 1)[0];
        [, , x, y] = previous;
      }
      rings.push(simplifyRing(ring));
    }
  }
  return rings;
}

/** Remove corners that lie on a straight run. */
function simplifyRing(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length],
      b = ring[i],
      c = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}

/** Signed area in corner units; positive for a ring with the region on its left in (x, -y). */
export function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i],
      [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * -y1 - x1 * -y0;
  }
  return sum / 2;
}

/** Corner coordinate to [lon, lat]. */
const cornerToLonLat = (spec, [x, y]) => [
  +(spec.west + x * spec.stepLonDeg).toFixed(6),
  +(spec.north - y * spec.stepLatDeg).toFixed(6),
];

/**
 * Catchment outline as GeoJSON-ordered rings in lon/lat: the largest outer
 * ring first. `parts` counts separate outer rings (diagonal-only links).
 */
export function catchmentOutline(spec, mask) {
  const rings = maskRings(spec, mask);
  const outers = rings
    .map((ring) => ({ ring, area: ringSignedArea(ring) }))
    .filter((entry) => entry.area > 0)
    .sort((a, b) => b.area - a.area);
  const holes = rings.filter((ring) => ringSignedArea(ring) < 0).length;
  if (!outers.length) return { ring: [], parts: 0, holes };
  const ring = outers[0].ring.map((corner) => cornerToLonLat(spec, corner));
  ring.push(ring[0]);
  return { ring, parts: outers.length, holes };
}
