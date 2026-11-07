/** Bounded great-circle samples along saved geometry; never reroutes. */
const R = 6371008.8,
  RAD = Math.PI / 180;
const coordinate = (pair) =>
  Array.isArray(pair) &&
  pair.length === 2 &&
  pair.every(Number.isFinite) &&
  Math.abs(pair[0]) <= 180 &&
  Math.abs(pair[1]) <= 90;
function angle(a, b) {
  const dlat = (b[1] - a[1]) * RAD,
    dlon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dlon / 2) ** 2;
  return (
    2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}
function interpolate(a, b, fraction, arc) {
  if (fraction <= 0) return [...a];
  if (fraction >= 1) return [...b];
  const vector = ([lon, lat]) => [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
    Math.sin(lat * RAD),
  ];
  const left = vector(a),
    right = vector(b),
    denom = Math.sin(arc);
  const wa = Math.sin((1 - fraction) * arc) / denom,
    wb = Math.sin(fraction * arc) / denom;
  const v = left.map((value, index) => value * wa + right[index] * wb);
  return [
    Math.atan2(v[1], v[0]) / RAD,
    Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD,
  ];
}
export function sampleRoute(
  route,
  { maxSamples = 128, minSpacingM = 250 } = {},
) {
  const geometry = route?.geometry;
  if (
    !Array.isArray(geometry) ||
    geometry.length < 2 ||
    geometry.length > 10000 ||
    !geometry.every(coordinate)
  )
    throw new Error('Invalid saved route geometry.');
  if (
    !Number.isInteger(maxSamples) ||
    maxSamples < 2 ||
    maxSamples > 128 ||
    !Number.isFinite(minSpacingM) ||
    minSpacingM <= 0
  )
    throw new Error('Invalid route sampling limits.');
  const segments = [];
  let totalDistanceM = 0;
  for (let i = 1; i < geometry.length; i++) {
    const arc = angle(geometry[i - 1], geometry[i]);
    if (arc > Math.PI - 1e-8)
      throw new Error('Ambiguous antipodal route segment.');
    if (arc < 1e-12) continue;
    const length = arc * R;
    segments.push({
      a: geometry[i - 1],
      b: geometry[i],
      arc,
      start: totalDistanceM,
      length,
    });
    totalDistanceM += length;
  }
  if (totalDistanceM > 100000000)
    throw new Error('Route exceeds the analysis distance limit.');
  if (!segments.length)
    return {
      samples: [{ lon: geometry[0][0], lat: geometry[0][1], distanceM: 0 }],
      totalDistanceM: 0,
      sampleSpacingM: 0,
    };
  const count = Math.min(
    maxSamples,
    Math.max(2, Math.floor(totalDistanceM / minSpacingM) + 1),
  );
  const sampleSpacingM = totalDistanceM / (count - 1);
  let index = 0;
  const samples = Array.from({ length: count }, (_, i) => {
    const distanceM = i === count - 1 ? totalDistanceM : i * sampleSpacingM;
    while (
      index < segments.length - 1 &&
      distanceM > segments[index].start + segments[index].length
    )
      index++;
    const segment = segments[index];
    const [lon, lat] =
      i === 0
        ? geometry[0]
        : i === count - 1
          ? geometry.at(-1)
          : interpolate(
              segment.a,
              segment.b,
              (distanceM - segment.start) / segment.length,
              segment.arc,
            );
    return { lon, lat, distanceM };
  });
  return { samples, totalDistanceM, sampleSpacingM };
}
