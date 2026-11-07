/**
 * Where Google Photorealistic 3D Tiles are known to have no city mesh, so an
 * unavailable-3D message can say "outside coverage" instead of blaming a key.
 *
 * One gap today: a coarse outline of mainland India (island territories left
 * out). Evidence: the Dehradun coverage audit
 * (docs/design/aurel/COVERAGE-DEHRADUN.md) observed no mesh over the Doon
 * valley with a working key; the rest of India is reported, not observed,
 * so the message says "likely". Vertices are [lon, lat] in WGS84 degrees,
 * accurate to tens of kilometres near the borders: Pakistan, Nepal,
 * Bangladesh and Sri Lanka fall outside it, border towns may not.
 *
 * Pure: no Cesium, no i18n.
 * @module maps/photorealCoverage
 */

/** @typedef {{lat: number, lon: number}} GeoPoint */

const INDIA_OUTLINE = Object.freeze([
  [68.1, 23.6],
  [69.6, 24.3],
  [70.6, 25.7],
  [70.0, 27.2],
  [71.9, 27.9],
  [73.4, 29.9],
  [74.5, 31.0],
  [74.6, 32.5],
  [73.9, 34.0],
  [74.3, 35.0],
  [75.8, 35.6],
  [77.8, 35.6],
  [79.5, 34.8],
  [79.0, 32.6],
  [78.8, 31.2],
  [80.2, 30.6],
  [81.1, 30.1],
  [80.1, 28.9],
  [81.9, 27.9],
  [84.1, 27.4],
  [85.9, 26.6],
  [88.1, 26.4],
  [88.1, 27.9],
  [88.9, 27.3],
  [89.7, 26.7],
  [92.1, 26.9],
  [91.9, 27.8],
  [94.0, 29.3],
  [96.1, 29.4],
  [97.4, 28.2],
  [97.0, 27.1],
  [95.2, 26.0],
  [94.6, 24.7],
  [93.4, 23.0],
  [92.6, 21.9],
  [91.6, 22.9],
  [91.6, 24.1],
  [92.0, 25.1],
  [90.0, 25.2],
  [89.8, 25.9],
  [88.5, 26.3],
  [88.1, 25.0],
  [88.7, 24.3],
  [88.9, 23.2],
  [89.1, 21.7],
  [87.0, 21.5],
  [86.9, 20.7],
  [85.0, 19.3],
  [83.3, 17.7],
  [82.3, 16.6],
  [80.3, 15.5],
  [80.3, 13.0],
  [79.9, 10.3],
  [78.2, 8.9],
  [77.5, 8.0],
  [76.5, 8.9],
  [75.0, 12.8],
  [73.8, 15.5],
  [72.8, 19.0],
  [72.6, 21.1],
  [70.9, 20.7],
  [69.0, 22.3],
]);

/** Known gaps in Google's photorealistic mesh. */
export const PHOTOREAL_COVERAGE_GAPS = Object.freeze([
  Object.freeze({ id: 'india', outline: INDIA_OUTLINE }),
]);

const RADIANS_TO_DEGREES = 180 / Math.PI;

/** Even-odd ray cast; `outline` is a closed ring of [lon, lat] vertices. */
function insideOutline(lon, lat, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    const crosses =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * The known coverage gap a point lies in, or null.
 * @param {GeoPoint|null|undefined} point
 * @returns {string|null} The gap id, e.g. 'india'.
 */
export function photorealCoverageGapAt(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const gap = PHOTOREAL_COVERAGE_GAPS.find(({ outline }) =>
    insideOutline(lon, lat, outline),
  );
  return gap?.id ?? null;
}

/**
 * The point under a Cesium camera in degrees, or null when there is none.
 * Reads `camera.positionCartographic` (radians) without importing Cesium.
 * @param {{camera?: {positionCartographic?: {latitude: number, longitude: number}}}|null} viewer
 * @returns {GeoPoint|null}
 */
export function cameraGeoPoint(viewer) {
  try {
    const carto = viewer?.camera?.positionCartographic;
    if (!carto) return null;
    const lat = Number(carto.latitude) * RADIANS_TO_DEGREES;
    const lon = Number(carto.longitude) * RADIANS_TO_DEGREES;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    // A destroyed viewer throws on access; no point means no regional advice.
    return null;
  }
}
