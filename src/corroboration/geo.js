/** Small, dependency-free geometry for residuals. Spherical Earth, km. */
export const EARTH_RADIUS_KM = 6371.0088;
const KNOT_KMH = 1.852;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (radians) => (radians * 180) / Math.PI;

export const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value);

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(finite)) return null;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Move a point along a constant track for `seconds` at `speedKt` knots.
 * Negative seconds move it backwards. Returns null without speed and track.
 */
export function propagate({ lat, lon }, speedKt, trackDeg, seconds) {
  if (![lat, lon, speedKt, trackDeg, seconds].every(finite)) return null;
  const angular = (speedKt * KNOT_KMH * (seconds / 3600)) / EARTH_RADIUS_KM;
  const bearing = rad(trackDeg);
  const lat1 = rad(lat);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    rad(lon) +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** Round for display without inventing precision. */
export function roundTo(value, digits) {
  if (!finite(value)) return null;
  if (digits < 0) {
    const step = 10 ** -digits;
    return Math.round(value / step) * step;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
