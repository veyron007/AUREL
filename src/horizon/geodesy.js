/** Spherical geodesy for bounded horizon rays (≤ 200 km), shared by server and browser. */
import {
  EARTH_RADIUS_M,
  FIRST_SAMPLE_M,
  NEAR_STEP_M,
  RADIAL_GROWTH,
} from './constants.js';

const RAD = Math.PI / 180;

/** Point reached from (lat, lon) after `distanceM` along initial bearing `azimuthDeg`. */
export function destination(lat, lon, azimuthDeg, distanceM) {
  const delta = distanceM / EARTH_RADIUS_M,
    theta = azimuthDeg * RAD,
    phi = lat * RAD,
    lambda = lon * RAD;
  const sinPhi2 =
    Math.sin(phi) * Math.cos(delta) +
    Math.cos(phi) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 =
    lambda +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi),
      Math.cos(delta) - Math.sin(phi) * sinPhi2,
    );
  return {
    lat: phi2 / RAD,
    lon: ((((lambda2 / RAD + 540) % 360) + 360) % 360) - 180,
  };
}

/** Great-circle distance in metres (haversine). */
export function distanceM(a, b) {
  const dlat = (b.lat - a.lat) * RAD,
    dlon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from true north in [0, 360). */
export function bearingDeg(a, b) {
  const phi1 = a.lat * RAD,
    phi2 = b.lat * RAD,
    dlon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dlon) * Math.cos(phi2),
    x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlon);
  return (((Math.atan2(y, x) / RAD) % 360) + 360) % 360;
}

/**
 * Radial sample distances: 30 m steps to the point where 1 % of the distance
 * exceeds 30 m, then 1 % geometric growth to the radius. The last distance is
 * the radius itself.
 */
export function radialDistances(radiusM) {
  if (!Number.isFinite(radiusM) || radiusM < FIRST_SAMPLE_M * 2)
    throw new Error('Invalid horizon radius.');
  const distances = [];
  for (let d = FIRST_SAMPLE_M; d < radiusM;) {
    distances.push(Math.round(d * 10) / 10);
    d += Math.max(NEAR_STEP_M, d * RADIAL_GROWTH);
  }
  distances.push(radiusM);
  return distances;
}

/** Spacing around distance index `index`, metres (half to each neighbour). */
export function radialStepAt(distances, index) {
  const before =
    index > 0 ? distances[index] - distances[index - 1] : distances[0];
  const after =
    index < distances.length - 1
      ? distances[index + 1] - distances[index]
      : before;
  return (before + after) / 2;
}

/** Normalise any azimuth to [0, 360). */
export function normalizeAzimuth(value) {
  return ((value % 360) + 360) % 360;
}
