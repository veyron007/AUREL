/**
 * The animated drop as a timed clip: the local D8 leg plays at a constant
 * ground pace, then the far-field HydroRIVERS leg plays faster in its own
 * share of the clip. Playback time is illustrative and is labelled so; it is
 * not travel time. Pure: the globe adapter samples positionAt each frame.
 */
import { haversineM } from './grid.js';

export const DROP_CLIP = Object.freeze({ localSeconds: 6, farSeconds: 5 });

function cumulative(path) {
  const distances = [0];
  for (let i = 1; i < path.length; i++)
    distances.push(distances[i - 1] + haversineM(path[i - 1], path[i]));
  return distances;
}

function along(path, distances, fraction) {
  const total = distances.at(-1);
  if (!(total > 0)) return path[0];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let lo = 0,
    hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = distances[hi] - distances[lo];
  const t = span > 0 ? (target - distances[lo]) / span : 0;
  return [
    path[lo][0] + (path[hi][0] - path[lo][0]) * t,
    path[lo][1] + (path[hi][1] - path[lo][1]) * t,
  ];
}

/**
 * @param {number[][]} localPath D8 path, [lon, lat].
 * @param {number[][]|null} farPath HydroRIVERS continuation, or null.
 */
export function buildDropClip(localPath, farPath = null, options = DROP_CLIP) {
  if (!Array.isArray(localPath) || !localPath.length)
    throw new TypeError('A drop clip needs a path');
  const far = Array.isArray(farPath) && farPath.length > 1 ? farPath : null;
  const local = localPath.length > 1 ? localPath : [localPath[0], localPath[0]];
  const localDistances = cumulative(local);
  const farDistances = far ? cumulative(far) : null;
  const duration = options.localSeconds + (far ? options.farSeconds : 0);
  return {
    duration,
    localKm: localDistances.at(-1) / 1000,
    farKm: far ? farDistances.at(-1) / 1000 : 0,
    /** Position at `seconds` into the clip, clamped to its ends. */
    positionAt(seconds) {
      const t = Math.max(0, Math.min(duration, seconds));
      if (t <= options.localSeconds || !far)
        return along(local, localDistances, t / options.localSeconds);
      return along(
        far,
        farDistances,
        (t - options.localSeconds) / options.farSeconds,
      );
    },
    /** Which leg is playing, for the HUD label. */
    legAt(seconds) {
      return far && seconds > options.localSeconds ? 'far-field' : 'local';
    },
  };
}
