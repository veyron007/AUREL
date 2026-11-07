/**
 * One pure horizon computation from a sampler payload: ray-march, Sun and
 * Moon events, shadow and peak matching. The browser runs this inside
 * `horizon.worker.js`; Node callers run it inline.
 */
import {
  DEFAULT_OBSERVER_HEIGHT_M,
  HORIZON_LABEL,
  HORIZON_METHOD,
  HORIZON_REFRACTION_K,
  MAX_OBSERVER_HEIGHT_M,
} from './constants.js';
import { MOON_METHOD, SUN_METHOD } from './ephemeris.js';
import { horizonEvents, shadowAt } from './events.js';
import { decodeGridPayload } from './grid.js';
import { marchHorizon } from './rayMarch.js';
import { matchPeaks } from './peaks.js';

export const HORIZON_LIMITS = Object.freeze([
  'Geometric visibility, terrain-only: trees, buildings, haze and cloud are not modelled.',
  'Copernicus DEM is a radar surface model; forest canopy and large buildings are partly inside its heights.',
  'DEM voids, 30–240 m sampling and refraction can move a ridge-clearing time by a few minutes.',
  'Far-field heights use averaged DEM overviews, so distant summits read lower than their true height.',
  'OpenStreetMap peak names and elevations can be wrong; compare OSM ele with the DEM height.',
  'Gnomon shadows ignore buildings and slopes; the time is the one entered on this device.',
]);

function extreme(horizon, pick) {
  let best = null;
  horizon.elevationDeg.forEach((value, index) => {
    if (value === null) return;
    if (best === null || pick(value, horizon.elevationDeg[best])) best = index;
  });
  return best === null
    ? null
    : {
        azimuthDeg: horizon.azimuthsDeg[best],
        elevationDeg: horizon.elevationDeg[best],
        distanceM: horizon.distanceM[best],
      };
}

/**
 * @param {object} input
 * @param {object} input.payload  `/api/horizon/terrain` response
 * @param {number} [input.observerHeightM]  eye height above the DEM surface
 * @param {string} input.localDate  YYYY-MM-DD in `timeZone`
 * @param {string} input.timeZone  IANA zone
 * @param {string|null} [input.shadowAt]  ISO instant for the shadow card
 * @param {number} [input.gnomonM]
 * @param {{ entries: object[], source: object|null }} [input.peaks]
 * @param {string} [input.now]  ISO computation time
 */
export function computeHorizon({
  payload,
  observerHeightM = DEFAULT_OBSERVER_HEIGHT_M,
  localDate,
  timeZone,
  shadowAt: shadowInstant = null,
  gnomonM = 1,
  peaks = { entries: [], source: null },
  now = new Date().toISOString(),
}) {
  if (
    !Number.isFinite(observerHeightM) ||
    observerHeightM < 0 ||
    observerHeightM > MAX_OBSERVER_HEIGHT_M
  )
    throw new Error('Invalid observer height.');
  const { grid, meta } = decodeGridPayload(payload);
  if (!Number.isFinite(meta.observer.groundM))
    throw new Error('The DEM has no height at this point.');
  const observer = { lat: meta.observer.lat, lon: meta.observer.lon };
  const eyeM = meta.observer.groundM + observerHeightM;
  const horizon = marchHorizon(grid, eyeM, HORIZON_REFRACTION_K);
  const events = horizonEvents({
    observer,
    eyeM,
    horizon,
    localDate,
    timeZone,
  });
  const shadow = shadowInstant
    ? shadowAt({ observer, eyeM, horizon, at: shadowInstant, gnomonM })
    : null;
  const matched = matchPeaks({
    observer,
    eyeM,
    grid,
    horizon,
    peaks: peaks.entries ?? [],
    radiusM: meta.radiusM,
  });
  return {
    version: 1,
    label: HORIZON_LABEL,
    method: HORIZON_METHOD,
    refractionK: HORIZON_REFRACTION_K,
    computedAt: now,
    query: {
      lat: observer.lat,
      lon: observer.lon,
      observerHeightM,
      localDate,
      timeZone,
      shadowAt: shadow?.at ?? null,
      gnomonM,
      radiusM: meta.radiusM,
    },
    observer: { ...observer, groundM: meta.observer.groundM, eyeM },
    horizon: {
      azimuthsDeg: horizon.azimuthsDeg,
      elevationDeg: horizon.elevationDeg,
      distanceM: horizon.distanceM,
      heightM: horizon.heightM,
      highest: extreme(horizon, (a, b) => a > b),
      lowest: extreme(horizon, (a, b) => a < b),
    },
    sun: events.sun,
    moon: events.moon,
    shadow,
    peaks: { ...matched, source: peaks.source ?? null },
    dem: {
      ...meta.source,
      voidSamples: horizon.voidSamples,
      absentTiles: meta.absentTiles,
      levels: meta.levels,
      sampling: meta.sampling,
      radiusM: meta.radiusM,
    },
    ephemeris: { sun: SUN_METHOD, moon: MOON_METHOD },
    limits: [...HORIZON_LIMITS],
  };
}
