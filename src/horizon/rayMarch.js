/**
 * Ray-march over a polar DEM grid. Pure and synchronous: the browser runs it
 * in `horizon.worker.js`, Node (MCP, tests) runs it inline.
 */
import {
  AZIMUTH_COUNT,
  AZIMUTH_STEP_DEG,
  EARTH_RADIUS_M,
  HORIZON_REFRACTION_K,
  VOID_HEIGHT,
} from './constants.js';

const DEG = 180 / Math.PI;

/**
 * Apparent elevation angle (degrees) of a point `heightM` high at surface
 * distance `distanceM`, seen from eye height `eyeM`, with refraction `k`
 * folded into an effective Earth radius R / (1 - k).
 */
export function apparentElevationDeg(
  heightM,
  distanceM,
  eyeM,
  k = HORIZON_REFRACTION_K,
) {
  if (!(distanceM > 0)) throw new Error('Distance must be positive.');
  if (!(k >= 0 && k < 1)) throw new Error('Invalid refraction coefficient.');
  const drop = (distanceM * distanceM * (1 - k)) / (2 * EARTH_RADIUS_M);
  return Math.atan((heightM - eyeM - drop) / distanceM) * DEG;
}

/** Validate the grid shape the sampler produced. */
export function assertGrid(grid) {
  if (
    !grid ||
    !(grid.heights instanceof Int16Array) ||
    !Array.isArray(grid.distances) ||
    grid.distances.length < 2 ||
    grid.heights.length !== AZIMUTH_COUNT * grid.distances.length ||
    !grid.distances.every(
      (d, i) => Number.isFinite(d) && d > 0 && (i === 0 || d > grid.distances[i - 1]),
    )
  )
    throw new Error('Invalid horizon grid.');
}

/**
 * The horizon per azimuth: the highest apparent elevation along each ray.
 * Void samples never raise the horizon; a ray of only voids has a null angle.
 * @returns {{ azimuthsDeg: number[], elevationDeg: (number|null)[],
 *   distanceM: (number|null)[], heightM: (number|null)[], voidSamples: number,
 *   refractionK: number }}
 */
export function marchHorizon(grid, eyeM, k = HORIZON_REFRACTION_K) {
  assertGrid(grid);
  if (!Number.isFinite(eyeM)) throw new Error('Invalid observer height.');
  const n = grid.distances.length;
  const azimuthsDeg = [],
    elevationDeg = [],
    distanceM = [],
    heightM = [];
  let voidSamples = 0;
  for (let ray = 0; ray < AZIMUTH_COUNT; ray++) {
    let best = -Infinity,
      bestIndex = -1;
    for (let j = 0; j < n; j++) {
      const h = grid.heights[ray * n + j];
      if (h === VOID_HEIGHT) {
        voidSamples++;
        continue;
      }
      const angle = apparentElevationDeg(h, grid.distances[j], eyeM, k);
      if (angle > best) {
        best = angle;
        bestIndex = j;
      }
    }
    azimuthsDeg.push(ray * AZIMUTH_STEP_DEG);
    elevationDeg.push(bestIndex < 0 ? null : best);
    distanceM.push(bestIndex < 0 ? null : grid.distances[bestIndex]);
    heightM.push(bestIndex < 0 ? null : grid.heights[ray * n + bestIndex]);
  }
  return {
    azimuthsDeg,
    elevationDeg,
    distanceM,
    heightM,
    voidSamples,
    refractionK: k,
  };
}

/** Horizon elevation at any azimuth, linearly interpolated between rays. */
export function horizonAt(horizon, azimuthDeg) {
  const position =
    ((((azimuthDeg % 360) + 360) % 360) / AZIMUTH_STEP_DEG) % AZIMUTH_COUNT;
  const left = Math.floor(position),
    right = (left + 1) % AZIMUTH_COUNT,
    fraction = position - left;
  const a = horizon.elevationDeg[left],
    b = horizon.elevationDeg[right];
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return a + (b - a) * fraction;
}

/**
 * Highest apparent elevation along ray `ray` among samples nearer than
 * `beforeM`, used to decide whether a peak clears its foreground.
 */
export function nearerMaximum(grid, ray, beforeM, eyeM, k = HORIZON_REFRACTION_K) {
  const n = grid.distances.length,
    index = ((ray % AZIMUTH_COUNT) + AZIMUTH_COUNT) % AZIMUTH_COUNT;
  let best = null;
  for (let j = 0; j < n && grid.distances[j] < beforeM; j++) {
    const h = grid.heights[index * n + j];
    if (h === VOID_HEIGHT) continue;
    const angle = apparentElevationDeg(h, grid.distances[j], eyeM, k);
    if (best === null || angle > best) best = angle;
  }
  return best;
}
