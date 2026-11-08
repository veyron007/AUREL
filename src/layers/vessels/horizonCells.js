/**
 * Horizon test per spatial cell instead of per vessel.
 *
 * Cesium's EllipsoidalOccluder hides a point P on the ellipsoid surface when,
 * in the ellipsoid's scaled (unit sphere) space, `P · C < 1` for the camera C
 * (its second condition, `(c²-d)² > (c²-1)(1-2d+c²)`, reduces to
 * `(d-1)² > 0` for |P| = 1, so it only matters at d = 1). Below the surface
 * (`|C|² < 1`) the plane moves to `P · C < |C|²`.
 *
 * Vessels are grouped into lat/lon cells with numeric keys. Each cell keeps
 * the centroid of its members' scaled positions and the largest member
 * distance from it, so every member's `P · C` lies within
 * `centroid · C ± radius·|C|`. A cell wholly beyond the plane by more than
 * a rounding margin is visible or hidden as a whole; only a cell the plane
 * crosses (or nearly touches) tests its members one by one, with Cesium's own
 * test. Results are therefore the per-vessel results exactly.
 *
 * The index is rebuilt when the vessel set or a position changes (once per
 * AIS update); the per-camera pass allocates nothing.
 */

/** Cell size in degrees; 5° keeps a world fleet in a few hundred cells. */
export const HORIZON_CELL_DEG = 5;
const LON_CELLS = Math.ceil(360 / HORIZON_CELL_DEG);
/**
 * Margin on `P · C` beyond which a whole cell is decided without testing its
 * members. Rounding in the dot products is ~1e-15 relative; this is far
 * larger, and costs at most a few extra member tests per crossing cell.
 */
const DECIDE_MARGIN = 1e-9;

export const HORIZON_HIDDEN = 0;
export const HORIZON_VISIBLE = 1;
/** The member must be tested by itself. */
export const HORIZON_TEST = 2;

/** Numeric cell key for a latitude/longitude in degrees. */
export function horizonCellKey(lat, lon) {
  const row = Math.min(
    Math.floor((lat + 90) / HORIZON_CELL_DEG),
    Math.ceil(180 / HORIZON_CELL_DEG) - 1,
  );
  const col = Math.floor(
    ((((lon + 180) % 360) + 360) % 360) / HORIZON_CELL_DEG,
  );
  return row * LON_CELLS + col;
}

/** Member indices grouped by cell key, in first-seen cell order. */
function groupByCell(count, readLatLon, hasPoint) {
  const groups = new Map();
  const scratch = { lat: 0, lon: 0 };
  for (let i = 0; i < count; i++) {
    if (!hasPoint(i)) continue;
    readLatLon(i, scratch);
    const key = horizonCellKey(scratch.lat, scratch.lon);
    const members = groups.get(key);
    if (members) members.push(i);
    else groups.set(key, [i]);
  }
  return groups;
}

/** Centroid and bounding radius of one cell's scaled positions. */
function cellBounds(members, scaled) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of members) {
    x += scaled[i * 3];
    y += scaled[i * 3 + 1];
    z += scaled[i * 3 + 2];
  }
  x /= members.length;
  y /= members.length;
  z /= members.length;
  let radiusSquared = 0;
  for (const i of members) {
    const dx = scaled[i * 3] - x;
    const dy = scaled[i * 3 + 1] - y;
    const dz = scaled[i * 3 + 2] - z;
    radiusSquared = Math.max(radiusSquared, dx * dx + dy * dy + dz * dz);
  }
  return { x, y, z, radius: Math.sqrt(radiusSquared) };
}

/**
 * Build the cell index for `count` vessels.
 * @param {{
 *   count: number,
 *   scaled: Float64Array,
 *   readLatLon: (index: number, out: {lat: number, lon: number}) => void,
 *   hasPoint: (index: number) => boolean,
 * }} input `scaled` holds each vessel's scaled-space x, y, z; a vessel
 *   without a point is never put in a cell and always reads visible.
 */
export function buildHorizonCells({ count, scaled, readLatLon, hasPoint }) {
  const groups = groupByCell(count, readLatLon, hasPoint);
  const cellCount = groups.size;
  const keys = new Int32Array(cellCount);
  const centers = new Float64Array(cellCount * 3);
  const radii = new Float64Array(cellCount);
  const starts = new Int32Array(cellCount + 1);
  const members = new Int32Array(count);
  let cell = 0;
  let next = 0;
  for (const [key, indices] of groups) {
    const bounds = cellBounds(indices, scaled);
    keys[cell] = key;
    centers[cell * 3] = bounds.x;
    centers[cell * 3 + 1] = bounds.y;
    centers[cell * 3 + 2] = bounds.z;
    radii[cell] = bounds.radius;
    starts[cell] = next;
    for (const index of indices) members[next++] = index;
    cell++;
  }
  starts[cellCount] = next;
  return { count, cellCount, keys, centers, radii, starts, members };
}

/**
 * Classify every vessel against a camera in scaled space. Writes
 * HORIZON_VISIBLE, HORIZON_HIDDEN or HORIZON_TEST into `out` (length >= the
 * index's count). Vessels outside every cell read visible.
 * @param {ReturnType<typeof buildHorizonCells>} index
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {Uint8Array} out
 * @returns {{cellsDecided: number, cellsTested: number}}
 */
export function classifyHorizonCells(index, cx, cy, cz, out) {
  out.fill(HORIZON_VISIBLE, 0, index.count);
  const cameraSquared = cx * cx + cy * cy + cz * cz;
  const cameraLength = Math.sqrt(cameraSquared);
  // Cesium's plane: d < 1 above the surface, d < |C|² below it.
  const plane = cameraSquared - 1 < 0 ? cameraSquared : 1;
  let cellsDecided = 0;
  let cellsTested = 0;
  for (let cell = 0; cell < index.cellCount; cell++) {
    const center =
      index.centers[cell * 3] * cx +
      index.centers[cell * 3 + 1] * cy +
      index.centers[cell * 3 + 2] * cz;
    const spread = index.radii[cell] * cameraLength;
    let verdict = HORIZON_TEST;
    if (center - spread > plane + DECIDE_MARGIN) verdict = HORIZON_VISIBLE;
    else if (center + spread < plane - DECIDE_MARGIN) verdict = HORIZON_HIDDEN;
    if (verdict === HORIZON_TEST) cellsTested++;
    else cellsDecided++;
    for (let m = index.starts[cell]; m < index.starts[cell + 1]; m++)
      out[index.members[m]] = verdict;
  }
  return { cellsDecided, cellsTested };
}
