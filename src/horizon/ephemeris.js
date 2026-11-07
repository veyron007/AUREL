/**
 * Local solar and lunar ephemeris; no network, no dependency.
 *
 * Sun: NOAA solar calculator equations (after Meeus, Astronomical
 * Algorithms), about 0.01° in position for 1900–2100.
 * Moon: the Astronomical Almanac low-precision series (section D), about
 * 0.3° in longitude and 0.2° in latitude, with topocentric parallax applied.
 * Universal Time is used for Terrestrial Time (ΔT ≈ 69 s is ignored), which
 * moves the Moon by under 0.01°.
 */

const RAD = Math.PI / 180,
  DEG = 180 / Math.PI;
export const SUN_METHOD =
  'NOAA solar equations (Meeus); Saemundsson refraction scaled for observer altitude';
export const MOON_METHOD =
  'Astronomical Almanac low-precision lunar series (≈0.3°); topocentric parallax; Saemundsson refraction';

const sin = (d) => Math.sin(d * RAD),
  cos = (d) => Math.cos(d * RAD),
  wrap = (d) => ((d % 360) + 360) % 360;

export function julianDay(ms) {
  return ms / 86400000 + 2440587.5;
}
const centuries = (ms) => (julianDay(ms) - 2451545) / 36525;

/** Geocentric solar coordinates and equation of time at an instant. */
export function sunCoordinates(ms) {
  const T = centuries(ms);
  const L0 = wrap(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    sin(2 * M) * (0.019993 - 0.000101 * T) +
    sin(3 * M) * 0.000289;
  const trueLongitude = L0 + C,
    trueAnomaly = M + C;
  const omega = 125.04 - 1934.136 * T;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(apparentLongitude)) * DEG;
  const rightAscension = wrap(
    Math.atan2(
      cos(obliquity) * sin(apparentLongitude),
      cos(apparentLongitude),
    ) * DEG,
  );
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTimeMin =
    4 *
    DEG *
    (y * sin(2 * L0) -
      2 * e * sin(M) +
      4 * e * y * sin(M) * cos(2 * L0) -
      0.5 * y * y * sin(4 * L0) -
      1.25 * e * e * sin(2 * M));
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * cos(trueAnomaly));
  return {
    apparentLongitude: wrap(apparentLongitude),
    declination,
    rightAscension,
    equationOfTimeMin,
    distanceAu,
    semidiameterDeg: 0.26667 / distanceAu,
  };
}

/** Greenwich mean sidereal time, degrees. */
export function siderealDeg(ms) {
  const d = julianDay(ms) - 2451545,
    T = d / 36525;
  return wrap(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T);
}

/** Horizontal coordinates from equatorial ones; azimuth clockwise from north. */
export function horizontal(rightAscension, declination, lat, lon, ms) {
  const H = siderealDeg(ms) + lon - rightAscension;
  const altitude =
    Math.asin(
      Math.max(
        -1,
        Math.min(
          1,
          sin(lat) * sin(declination) + cos(lat) * cos(declination) * cos(H),
        ),
      ),
    ) * DEG;
  const azimuth = wrap(
    Math.atan2(
      -cos(declination) * sin(H),
      sin(declination) * cos(lat) - cos(declination) * cos(H) * sin(lat),
    ) * DEG,
  );
  return { altitude, azimuth };
}

/** Geocentric lunar coordinates (low-precision series). */
export function moonCoordinates(ms) {
  const T = centuries(ms);
  const lambda =
    218.32 +
    481267.881 * T +
    6.29 * sin(135.0 + 477198.87 * T) -
    1.27 * sin(259.3 - 413335.36 * T) +
    0.66 * sin(235.7 + 890534.22 * T) +
    0.21 * sin(269.9 + 954397.74 * T) -
    0.19 * sin(357.5 + 35999.05 * T) -
    0.11 * sin(186.5 + 966404.03 * T);
  const beta =
    5.13 * sin(93.3 + 483202.02 * T) +
    0.28 * sin(228.2 + 960400.89 * T) -
    0.28 * sin(318.3 + 6003.15 * T) -
    0.17 * sin(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cos(135.0 + 477198.87 * T) +
    0.0095 * cos(259.3 - 413335.36 * T) +
    0.0078 * cos(235.7 + 890534.22 * T) +
    0.0028 * cos(269.9 + 954397.74 * T);
  const epsilon = 23.4393 - 0.013 * T;
  const x = cos(beta) * cos(lambda),
    y = cos(epsilon) * cos(beta) * sin(lambda) - sin(epsilon) * sin(beta),
    z = sin(epsilon) * cos(beta) * sin(lambda) + cos(epsilon) * sin(beta);
  return {
    longitude: wrap(lambda),
    latitude: beta,
    parallaxDeg: parallax,
    semidiameterDeg: 0.2724 * parallax,
    rightAscension: wrap(Math.atan2(y, x) * DEG),
    declination: Math.asin(z) * DEG,
  };
}

/** Standard-atmosphere scale for refraction at an observer altitude. */
export function refractionScale(altitudeM = 0) {
  const h = Math.max(0, Math.min(9000, altitudeM));
  const pressure = 1010 * Math.exp(-h / 8434),
    kelvin = 283 - 0.0065 * h;
  return (pressure / 1010) * (283 / kelvin);
}

/** Saemundsson refraction for a true altitude, degrees (clamped below −2°). */
export function refractionDeg(trueAltitude, scale = 1) {
  if (trueAltitude > 89.9) return 0;
  const h = Math.max(-2, trueAltitude);
  return (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60) * scale;
}

/**
 * Apparent topocentric position of the Sun or Moon.
 * @param {'sun'|'moon'} body
 * @returns {{ altitude: number, azimuth: number, trueAltitude: number,
 *   semidiameterDeg: number }}
 */
export function bodyPosition(
  body,
  lat,
  lon,
  ms,
  { altitudeM = 0, scale } = {},
) {
  const coordinates =
    body === 'moon' ? moonCoordinates(ms) : sunCoordinates(ms);
  const { altitude: geocentric, azimuth } = horizontal(
    coordinates.rightAscension,
    coordinates.declination,
    lat,
    lon,
    ms,
  );
  const parallax =
    body === 'moon'
      ? Math.asin(sin(coordinates.parallaxDeg) * cos(geocentric)) * DEG
      : 0;
  const trueAltitude = geocentric - parallax;
  const refraction = refractionDeg(
    trueAltitude,
    scale ?? refractionScale(altitudeM),
  );
  return {
    altitude: trueAltitude + refraction,
    azimuth,
    trueAltitude,
    semidiameterDeg: coordinates.semidiameterDeg,
  };
}
