/** Match gazetteer peaks against a computed horizon. */
import {
  AZIMUTH_COUNT,
  AZIMUTH_STEP_DEG,
  HORIZON_REFRACTION_K,
  MARGINAL_DEG,
  MAX_LISTED_PEAKS,
  VOID_HEIGHT,
} from './constants.js';
import { bearingDeg, distanceM, radialStepAt } from './geodesy.js';
import { apparentElevationDeg, nearerMaximum } from './rayMarch.js';

/** Peaks nearer than this are the observer's own hill, not skyline. */
export const MIN_PEAK_DISTANCE_M = 500;
const STATE_ORDER = ['skyline', 'visible', 'marginal', 'hidden', 'unknown'];

function radialTolerance(distances, d) {
  let index = 0;
  while (index < distances.length - 1 && distances[index] < d) index++;
  return Math.max(300, 1.5 * radialStepAt(distances, index));
}

/** Highest DEM sample around a summit: rays ±1 and the radial tolerance. */
function demSummit(grid, ray, d, toleranceM) {
  const n = grid.distances.length;
  let best = null;
  for (let offset = -1; offset <= 1; offset++) {
    const r = (ray + offset + AZIMUTH_COUNT) % AZIMUTH_COUNT;
    for (let j = 0; j < n; j++) {
      if (Math.abs(grid.distances[j] - d) > toleranceM) continue;
      const h = grid.heights[r * n + j];
      if (h !== VOID_HEIGHT && (best === null || h > best)) best = h;
    }
  }
  return best;
}

/**
 * Classify each peak inside the radius:
 * - skyline: clears nearer terrain and is the top of its bearing;
 * - visible: clears nearer terrain, farther terrain stands higher behind it;
 * - marginal: within 0.1° of the nearer terrain;
 * - hidden: below nearer terrain; unknown: no DEM value at the summit.
 */
export function matchPeaks({
  observer,
  eyeM,
  grid,
  horizon,
  peaks,
  radiusM,
  k = HORIZON_REFRACTION_K,
}) {
  const rows = [];
  for (const peak of peaks) {
    const d = distanceM(observer, peak);
    if (d < MIN_PEAK_DISTANCE_M || d > radiusM) continue;
    const azimuth = bearingDeg(observer, peak),
      ray = Math.round(azimuth / AZIMUTH_STEP_DEG) % AZIMUTH_COUNT,
      toleranceM = radialTolerance(grid.distances, d);
    const demM = demSummit(grid, ray, d, toleranceM);
    const angle = demM === null ? null : apparentElevationDeg(demM, d, eyeM, k);
    const nearer = nearerMaximum(grid, ray, d - toleranceM, eyeM, k);
    const clearance =
      angle === null ? null : nearer === null ? null : angle - nearer;
    const top = horizon.elevationDeg[ray];
    const state =
      angle === null
        ? 'unknown'
        : clearance !== null && clearance <= -MARGINAL_DEG
          ? 'hidden'
          : clearance !== null && clearance < MARGINAL_DEG
            ? 'marginal'
            : top === null || top - angle < MARGINAL_DEG
              ? 'skyline'
              : 'visible';
    rows.push({
      id: peak.id,
      name: peak.name,
      nameHi: peak.nameHi ?? null,
      lat: peak.lat,
      lon: peak.lon,
      osmEleM: peak.eleM ?? null,
      demM,
      differenceM:
        demM === null || peak.eleM == null
          ? null
          : Math.round(demM - peak.eleM),
      azimuthDeg: azimuth,
      distanceM: d,
      apparentElevationDeg: angle,
      clearanceDeg: clearance,
      state,
    });
  }
  rows.sort(
    (a, b) =>
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
      (b.apparentElevationDeg ?? -90) - (a.apparentElevationDeg ?? -90) ||
      a.id.localeCompare(b.id),
  );
  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
  rows.forEach((row) => counts[row.state]++);
  return {
    listed: rows
      .filter((row) => row.state !== 'hidden' && row.state !== 'unknown')
      .slice(0, MAX_LISTED_PEAKS),
    counts,
    considered: rows.length,
  };
}
