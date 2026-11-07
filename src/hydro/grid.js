/**
 * Regular geographic grid used by every hydro step. Row 0 is the northern
 * row; cell centres sit half a step inside the window edges. Pure and
 * dependency-free so the worker, the tests and the build script share it.
 */

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Hard ceiling on cells in any one grid: bounds memory in the worker. */
export const MAX_GRID_CELLS = 1_200_000;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Validate and freeze a grid specification.
 * @param {{west:number, north:number, cols:number, rows:number, stepLonDeg:number, stepLatDeg:number}} spec
 */
export function createGridSpec(spec) {
  const { west, north, cols, rows, stepLonDeg, stepLatDeg } = spec || {};
  if (
    ![west, north, stepLonDeg, stepLatDeg].every(finite) ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 3 ||
    rows < 3 ||
    cols * rows > MAX_GRID_CELLS ||
    stepLonDeg <= 0 ||
    stepLatDeg <= 0 ||
    west < -180 ||
    west + cols * stepLonDeg > 180 ||
    north > 90 ||
    north - rows * stepLatDeg < -90
  )
    throw new RangeError('Invalid hydro grid specification');
  return Object.freeze({
    west,
    north,
    cols,
    rows,
    stepLonDeg,
    stepLatDeg,
    east: west + cols * stepLonDeg,
    south: north - rows * stepLatDeg,
  });
}

/** Grid centred on a point, sized in cells; validates everything. */
export function gridAround(
  { lon, lat },
  { cols, rows, stepLonDeg, stepLatDeg },
) {
  return createGridSpec({
    west: lon - (cols / 2) * stepLonDeg,
    north: lat + (rows / 2) * stepLatDeg,
    cols,
    rows,
    stepLonDeg,
    stepLatDeg,
  });
}

/** Centre of a cell as [lon, lat]. */
export function cellCenter(spec, index) {
  const row = Math.floor(index / spec.cols),
    col = index - row * spec.cols;
  return [
    spec.west + (col + 0.5) * spec.stepLonDeg,
    spec.north - (row + 0.5) * spec.stepLatDeg,
  ];
}

/** Index of the cell containing a point, or -1 outside the grid. */
export function locateCell(spec, lon, lat) {
  if (!finite(lon) || !finite(lat)) return -1;
  const col = Math.floor((lon - spec.west) / spec.stepLonDeg),
    row = Math.floor((spec.north - lat) / spec.stepLatDeg);
  if (col < 0 || row < 0 || col >= spec.cols || row >= spec.rows) return -1;
  return row * spec.cols + col;
}

/** North-south cell size in metres (constant on a geographic grid). */
export const cellHeightM = (spec) => spec.stepLatDeg * RAD * EARTH_RADIUS_M;

/** East-west cell size in metres for each row, at the row's centre latitude. */
export function rowWidthsM(spec) {
  const widths = new Float64Array(spec.rows);
  for (let row = 0; row < spec.rows; row++) {
    const lat = spec.north - (row + 0.5) * spec.stepLatDeg;
    widths[row] = spec.stepLonDeg * RAD * EARTH_RADIUS_M * Math.cos(lat * RAD);
  }
  return widths;
}

/** Exact spherical area of one cell in each row, km². */
export function rowCellAreasKm2(spec) {
  const areas = new Float64Array(spec.rows);
  const lonSpan = spec.stepLonDeg * RAD;
  for (let row = 0; row < spec.rows; row++) {
    const top = (spec.north - row * spec.stepLatDeg) * RAD,
      bottom = (spec.north - (row + 1) * spec.stepLatDeg) * RAD;
    areas[row] =
      (EARTH_RADIUS_M ** 2 *
        lonSpan *
        Math.abs(Math.sin(top) - Math.sin(bottom))) /
      1e6;
  }
  return areas;
}

/** Great-circle distance in metres between two [lon, lat] pairs. */
export function haversineM(a, b) {
  const dLat = (b[1] - a[1]) * RAD,
    dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a [lon, lat] line, metres. */
export function lineLengthM(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++)
    total += haversineM(line[i - 1], line[i]);
  return total;
}
