/** Terrain-clipped rise, set and shadow from a computed horizon. */
import {
  calculateDaylight,
  resolveLocalDateTime,
} from '../planner/daylight.js';
import { bodyPosition, refractionScale } from './ephemeris.js';
import { horizonAt } from './rayMarch.js';

const MINUTE = 60000;
/** A gnomon shadow is reported only when the Sun is at least this high. */
export const MIN_SHADOW_SUN_DEG = 0.5;
export const MAX_GNOMON_M = 100;

function nextDate(localDate) {
  const at = new Date(`${localDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
function localMidnight(localDate, timeZone) {
  try {
    return Date.parse(resolveLocalDateTime(`${localDate}T00:00`, timeZone));
  } catch {
    return Date.parse(resolveLocalDateTime(`${localDate}T01:00`, timeZone));
  }
}
/** [start, end) of a civil day in an IANA time zone, epoch ms. */
export function localDayBounds(localDate, timeZone) {
  if (typeof localDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(localDate))
    throw new Error('Invalid local date.');
  return [
    localMidnight(localDate, timeZone),
    localMidnight(nextDate(localDate), timeZone),
  ];
}

/** Bisect a visibility change between two instants to one second. */
function refine(test, left, right) {
  const leftValue = test(left);
  while (right - left > 1000) {
    const middle = Math.floor((left + right) / 2);
    if (test(middle) === leftValue) left = middle;
    else right = middle;
  }
  return right;
}

/**
 * Scan a day minute by minute for when `test(ms)` (the body is visible)
 * changes. Returns the first appearance, the last disappearance and the
 * visible minutes.
 */
export function scanVisibility(test, start, end) {
  let first = null,
    last = null,
    visibleMs = 0,
    previousAt = start,
    previous = test(start),
    since = previous ? start : null;
  for (
    let at = start + MINUTE;
    previousAt < end;
    at = Math.min(at + MINUTE, end)
  ) {
    const current = test(at);
    if (current !== previous) {
      const event = refine(test, previousAt, at);
      if (current) {
        first ??= event;
        since = event;
      } else {
        last = event;
        if (since !== null) visibleMs += event - since;
        since = null;
      }
    }
    previousAt = at;
    previous = current;
    if (at >= end) break;
  }
  if (since !== null) visibleMs += end - since;
  return {
    rise: first,
    set: last,
    visibleMinutes: Math.round(visibleMs / MINUTE),
    visibleAtStart: test(start),
  };
}

/** Upper limb above the terrain horizon (or above a flat 0° horizon). */
function limbTest(body, observer, horizon, scale) {
  return (ms) => {
    const p = bodyPosition(body, observer.lat, observer.lon, ms, { scale });
    const top = p.altitude + p.semidiameterDeg;
    if (!horizon) return top >= 0;
    const ridge = horizonAt(horizon, p.azimuth);
    return top >= (ridge ?? 0);
  };
}
function centreTest(observer, horizon, scale) {
  return (ms) => {
    const p = bodyPosition('sun', observer.lat, observer.lon, ms, { scale });
    return p.altitude >= (horizonAt(horizon, p.azimuth) ?? 0);
  };
}
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Sun and Moon events for one local date: astronomical (flat sea-level
 * horizon, standard refraction) against terrain-clipped (the computed
 * horizon, refraction scaled for the observer's altitude).
 */
export function horizonEvents({
  observer,
  eyeM,
  horizon,
  localDate,
  timeZone,
}) {
  const [start, end] = localDayBounds(localDate, timeZone);
  const scale = refractionScale(eyeM);
  const daylight = calculateDaylight({
    lat: observer.lat,
    lon: observer.lon,
    localDate,
    timeZone,
  });
  const terrainSun = scanVisibility(
    limbTest('sun', observer, horizon, scale),
    start,
    end,
  );
  const directSun = scanVisibility(
    centreTest(observer, horizon, scale),
    start,
    end,
  );
  const flatMoon = scanVisibility(
    limbTest('moon', observer, null, 1),
    start,
    end,
  );
  const terrainMoon = scanVisibility(
    limbTest('moon', observer, horizon, scale),
    start,
    end,
  );
  return {
    sun: {
      astronomicalRise: daylight.sunrise,
      astronomicalSet: daylight.sunset,
      terrainRise: iso(terrainSun.rise),
      terrainSet: iso(terrainSun.set),
      directSunMinutes: directSun.visibleMinutes,
      polarState: daylight.polarState,
    },
    moon: {
      astronomicalRise: iso(flatMoon.rise),
      astronomicalSet: iso(flatMoon.set),
      terrainRise: iso(terrainMoon.rise),
      terrainSet: iso(terrainMoon.set),
    },
  };
}

/** Sun position, terrain shadow state and a vertical gnomon's shadow at one instant. */
export function shadowAt({ observer, eyeM, horizon, at, gnomonM = 1 }) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error('Invalid shadow time.');
  if (!(gnomonM > 0 && gnomonM <= MAX_GNOMON_M))
    throw new Error('Invalid gnomon height.');
  const p = bodyPosition('sun', observer.lat, observer.lon, ms, {
    scale: refractionScale(eyeM),
  });
  const ridge = horizonAt(horizon, p.azimuth);
  const aboveTerrain = p.altitude >= (ridge ?? 0);
  const measurable = aboveTerrain && p.altitude >= MIN_SHADOW_SUN_DEG;
  return {
    at: new Date(ms).toISOString(),
    sunAltitudeDeg: p.altitude,
    sunAzimuthDeg: p.azimuth,
    terrainHorizonDeg: ridge,
    sunlit: aboveTerrain,
    gnomonM,
    shadowLengthM: measurable
      ? gnomonM / Math.tan((p.altitude * Math.PI) / 180)
      : null,
    shadowAzimuthDeg: measurable ? (p.azimuth + 180) % 360 : null,
  };
}
