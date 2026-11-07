/**
 * Swath geometry from SGP4 state. Spherical Earth (mean radius) for ground
 * distances; positions are geodetic from satellite.js. Everything here is a
 * model of where an instrument could look, never evidence that it did.
 */
import {
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import {
  findNextSatellitePass,
  observerSolarElevation,
} from '../data/satellitePass.js';

export const EARTH_RADIUS_KM = 6371.0088;
export const PASS_SEARCH_LIMITS = Object.freeze({
  maxDays: 14,
  defaultDays: 10,
  stepSec: 30,
  maxPasses: 40,
  maxPropagations: 60000,
  /** Beyond this ground distance the along-track sign can flip near the antipode. */
  nearKm: 4000,
});
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const DAY_MS = 86400000;

const finite = (...values) => values.every(Number.isFinite);

/** Geodetic nadir and height at an instant, or null when propagation fails. */
export function nadirAt(satrec, ms) {
  const date = new Date(ms);
  let state;
  try {
    state = propagate(satrec, date);
  } catch {
    return null;
  }
  const position = state?.position;
  if (!position || typeof position === 'boolean') return null;
  const geo = eciToGeodetic(position, gstime(date));
  const result = {
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
    altKm: geo.height,
  };
  return finite(result.lat, result.lon, result.altKm) ? result : null;
}

/** Great-circle distance in km. */
export function groundDistanceKm(a, b) {
  const p1 = a.lat * D2R,
    p2 = b.lat * D2R;
  const dp = p2 - p1,
    dl = (b.lon - a.lon) * D2R;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, radians clockwise from north. */
export function bearingRad(a, b) {
  const p1 = a.lat * D2R,
    p2 = b.lat * D2R,
    dl = (b.lon - a.lon) * D2R;
  return Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
}

/** Point reached from `start` along `bearing` (radians) for `km`. */
export function destination(start, bearing, km) {
  const d = km / EARTH_RADIUS_KM,
    p1 = start.lat * D2R,
    l1 = start.lon * D2R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(bearing),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return {
    lat: p2 * R2D,
    lon: ((((l2 * R2D + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * Cross-track (positive: place right of the direction of travel) and
 * along-track (positive: place still ahead) offsets in km.
 */
export function trackOffsets(nadir, heading, place) {
  const d13 = groundDistanceKm(nadir, place) / EARTH_RADIUS_KM;
  const delta = bearingRad(nadir, place) - heading;
  const xt = Math.asin(Math.sin(d13) * Math.sin(delta));
  const ratio = Math.cos(d13) / Math.cos(xt);
  const at = Math.acos(Math.max(-1, Math.min(1, ratio)));
  return {
    crossTrackKm: xt * EARTH_RADIUS_KM,
    alongTrackKm: at * EARTH_RADIUS_KM * Math.sign(Math.cos(delta) || 1),
    groundKm: d13 * EARTH_RADIUS_KM,
  };
}

/** Heading of the ground track at `ms`, from a one-second difference. */
function headingAt(satrec, ms, nadir = nadirAt(satrec, ms)) {
  const next = nadirAt(satrec, ms + 1000);
  return nadir && next ? bearingRad(nadir, next) : null;
}

/** Angle at the satellite between nadir and a ground point `groundKm` away. */
export function offNadirDeg(groundKm, altitudeKm) {
  const g = Math.abs(groundKm) / EARTH_RADIUS_KM;
  return (
    Math.atan2(
      EARTH_RADIUS_KM * Math.sin(g),
      EARTH_RADIUS_KM + altitudeKm - EARTH_RADIUS_KM * Math.cos(g),
    ) * R2D
  );
}

function validPlace(place) {
  return (
    finite(place?.lat, place?.lon) &&
    Math.abs(place.lat) <= 90 &&
    Math.abs(place.lon) <= 180
  );
}

function boundedWindow(fromMs, days) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(days) || days <= 0)
    throw new RangeError('Pass search needs a start time and a positive span');
  if (days > PASS_SEARCH_LIMITS.maxDays)
    throw new RangeError(
      `Pass search is limited to ${PASS_SEARCH_LIMITS.maxDays} days`,
    );
  return fromMs + days * DAY_MS;
}

/** Refine the along-track zero crossing between two instants by bisection. */
function refineCrossing(satrec, place, lowMs, highMs, budget) {
  let low = lowMs,
    high = highMs;
  for (let i = 0; i < 24 && high - low > 50; i += 1) {
    const mid = (low + high) / 2;
    const nadir = nadirAt(satrec, mid);
    const heading = headingAt(satrec, mid, nadir);
    budget.count += 2;
    if (!nadir || heading === null) return null;
    if (trackOffsets(nadir, heading, place).alongTrackKm > 0) low = mid;
    else high = mid;
  }
  const timeMs = Math.round((low + high) / 2);
  const nadir = nadirAt(satrec, timeMs);
  const heading = headingAt(satrec, timeMs, nadir);
  if (!nadir || heading === null) return null;
  return { timeMs, nadir, heading, ...trackOffsets(nadir, heading, place) };
}

/**
 * Times in [fromMs, fromMs + days) when `place` lies inside the nominal swath.
 * Optical instruments image only in daylight, so night crossings are dropped
 * unless `includeNight` is set. Bounded by days, step, passes and propagations.
 * @returns {{ passes: Array<object>, truncated: boolean }}
 */
export function findSwathPasses({
  satrec,
  place,
  fromMs,
  days = PASS_SEARCH_LIMITS.defaultDays,
  swathKm,
  includeNight = false,
}) {
  if (!satrec || !validPlace(place) || !(swathKm > 0))
    throw new TypeError('Swath search needs a satellite, a place and a swath');
  const endMs = boundedWindow(fromMs, days);
  const stepMs = PASS_SEARCH_LIMITS.stepSec * 1000;
  const budget = { count: 0 };
  const passes = [];
  let truncated = false;
  let previous = null;
  for (let t = fromMs; t < endMs; t += stepMs) {
    if (budget.count >= PASS_SEARCH_LIMITS.maxPropagations) {
      truncated = true;
      break;
    }
    const nadir = nadirAt(satrec, t);
    budget.count += 1;
    if (!nadir) {
      previous = null;
      continue;
    }
    const sample = { t, nadir };
    if (previous) {
      const heading = bearingRad(previous.nadir, nadir);
      const before = trackOffsets(previous.nadir, heading, place);
      const after = trackOffsets(nadir, heading, place);
      if (
        before.alongTrackKm > 0 &&
        after.alongTrackKm <= 0 &&
        Math.min(before.groundKm, after.groundKm) < PASS_SEARCH_LIMITS.nearKm
      ) {
        const crossing = refineCrossing(satrec, place, previous.t, t, budget);
        if (crossing && Math.abs(crossing.crossTrackKm) <= swathKm / 2) {
          const solarElevationDeg = observerSolarElevation(
            place.lat,
            place.lon,
            crossing.timeMs,
          );
          if (includeNight || solarElevationDeg > 0) {
            passes.push(describeCrossing(crossing, solarElevationDeg, swathKm));
            if (passes.length >= PASS_SEARCH_LIMITS.maxPasses) {
              truncated = true;
              break;
            }
          }
        }
      }
    }
    previous = sample;
  }
  return { passes, truncated, propagations: budget.count };
}

function describeCrossing(crossing, solarElevationDeg, swathKm) {
  const headingDeg = (((crossing.heading * R2D) % 360) + 360) % 360;
  return Object.freeze({
    timeMs: crossing.timeMs,
    crossTrackKm: crossing.crossTrackKm,
    side: crossing.crossTrackKm >= 0 ? 'right' : 'left',
    nadir: Object.freeze({ lat: crossing.nadir.lat, lon: crossing.nadir.lon }),
    altitudeKm: crossing.nadir.altKm,
    headingDeg,
    node: headingDeg > 90 && headingDeg < 270 ? 'descending' : 'ascending',
    offNadirDeg: offNadirDeg(crossing.crossTrackKm, crossing.nadir.altKm),
    solarElevationDeg,
    swathKm,
  });
}

/**
 * Nominal swath polygon around `centerMs`: a ring of [lon, lat] built from
 * nadir samples offset ±swath/2 perpendicular to the ground track.
 */
export function swathFootprint(
  satrec,
  centerMs,
  { swathKm, halfSpanSec = 24, stepSec = 4 } = {},
) {
  if (!(swathKm > 0) || !(halfSpanSec > 0) || halfSpanSec > 120)
    throw new RangeError('Footprint needs a swath and a span of at most 120 s');
  const left = [],
    right = [];
  for (let s = -halfSpanSec; s <= halfSpanSec; s += stepSec) {
    const ms = centerMs + s * 1000;
    const nadir = nadirAt(satrec, ms);
    const heading = headingAt(satrec, ms, nadir);
    if (!nadir || heading === null) return null;
    left.push(destination(nadir, heading - Math.PI / 2, swathKm / 2));
    right.push(destination(nadir, heading + Math.PI / 2, swathKm / 2));
  }
  const ring = [...left, ...right.reverse()].map((p) => [p.lon, p.lat]);
  return [...ring, ring[0]];
}

/** Even-odd point-in-ring test on [lon, lat] rings (no antimeridian wrap). */
export function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** Propagated positions for a camera path, oldest first; drops failed samples. */
export function orbitSamples(satrec, times) {
  return times
    .map((ms) => {
      const nadir = nadirAt(satrec, ms);
      return nadir
        ? { ms, ...nadir, heading: headingAt(satrec, ms, nadir) }
        : null;
    })
    .filter((sample) => sample && sample.heading !== null);
}

/** Sky passes (elevation ≥ 10°) for a non-imaging spacecraft, bounded like swath search. */
export function findSkyPasses({
  satrec,
  place,
  fromMs,
  days = 3,
  maxPasses = 12,
}) {
  if (!satrec || !validPlace(place))
    throw new TypeError('Sky pass search needs a satellite and a place');
  const endMs = boundedWindow(fromMs, days);
  const passes = [];
  let cursor = fromMs;
  while (cursor < endMs && passes.length < maxPasses) {
    const pass = findNextSatellitePass({
      satrec,
      latDeg: place.lat,
      lonDeg: place.lon,
      fromMs: cursor,
      horizonHours: Math.min(24, (endMs - cursor) / 3600000),
    });
    if (!pass) break;
    passes.push(
      Object.freeze({
        timeMs: pass.maxElevMs,
        riseMs: pass.riseMs,
        setMs: pass.setMs,
        maxElevationDeg: pass.maxElevDeg,
        visible: pass.visible,
      }),
    );
    cursor = pass.setMs + 60000;
  }
  return { passes, truncated: passes.length >= maxPasses };
}
