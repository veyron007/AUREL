/**
 * "Ride this pass": a Scene Director scene that follows the propagated orbit
 * to the predicted crossing second, then drops to the place. It is a
 * dramatisation: time is compressed, the camera rides beside a modelled
 * position, and every shot title, the scene title and the exported record
 * say so, with the TLE epoch.
 */
import { orbitSamples, destination, swathFootprint } from './swath.js';
import { LANES } from './lanes.js';
import { msg } from '../i18n/marker.js';

export const RIDE_SCENE_PREFIX = 'orbit-witness-ride';
/** Orbit seconds before the crossing at which the ride shots are placed. */
const RIDE_OFFSETS_SEC = Object.freeze([-90, -60, -30, 0]);
const RIDE_SHOT_SEC = 4;
const DROP_SHOT_SEC = 5;
const DROP_HOLD_SEC = 6;
const CAMERA_TRAIL_KM = 220;
const DROP_ALTITUDE_M = 140000;
const R2D = 180 / Math.PI;

const iso = (ms) => new Date(ms).toISOString();
const minuteStamp = (ms) => `${iso(ms).slice(0, 16).replace('T', ' ')} UTC`;
const headingDeg = (rad) => (((rad * R2D) % 360) + 360) % 360;

/**
 * The provenance line every ride surface shows.
 * @param {(text: string, params?: object) => string} translate
 */
export function rideProvenance(translate, { epochMs, sceneId = null }) {
  return [
    translate(msg('Dramatised ride')),
    translate(msg('orbit propagated, epoch {epoch}'), {
      epoch: minuteStamp(epochMs),
    }),
    sceneId
      ? translate(msg('Image: observed {scene}'), { scene: sceneId })
      : translate(msg('Image: none catalogued')),
  ].join(' · ');
}

function pose(sample, { trailKm = CAMERA_TRAIL_KM, pitch = -28 } = {}) {
  const behind = destination(sample, sample.heading + Math.PI, trailKm);
  return {
    lat: behind.lat,
    lon: behind.lon,
    alt: Math.round(sample.altKm * 1000),
    heading: headingDeg(sample.heading),
    pitch,
    roll: 0,
    altitudeReference: 'ellipsoid',
  };
}

/**
 * Build the scene and its export record. Throws when propagation fails.
 * @param {{ mission: object, pass: { timeMs: number }, set: { satrec: object, epochMs: number, line1: string, line2: string }, place: { lat: number, lon: number, name?: string }, sceneId?: string|null, translate: Function, nowMs: number }} input
 */
export function buildRideScene({
  mission,
  pass,
  set,
  place,
  sceneId = null,
  translate,
  nowMs,
}) {
  const samples = orbitSamples(
    set.satrec,
    RIDE_OFFSETS_SEC.map((s) => pass.timeMs + s * 1000),
  );
  if (samples.length !== RIDE_OFFSETS_SEC.length)
    throw new Error('The orbit could not be propagated for this pass');
  const provenance = rideProvenance(translate, {
    epochMs: set.epochMs,
    sceneId,
  });
  const id = `${RIDE_SCENE_PREFIX}-${mission.id}-${pass.timeMs}`;
  const poses = samples.map((sample) => pose(sample));
  const shots = poses.slice(1).map((camera, index) => ({
    id: `${id}-ride-${index + 1}`,
    title: `${
      RIDE_OFFSETS_SEC[index + 1] === 0
        ? translate(msg('At the predicted crossing second'))
        : translate(msg('{seconds} s before the predicted crossing'), {
            seconds: -RIDE_OFFSETS_SEC[index + 1],
          })
    } · ${provenance}`,
    durationSec: RIDE_SHOT_SEC,
    holdSec: 0,
    move: { from: poses[index], easing: 'linear' },
    camera,
  }));
  const last = poses[poses.length - 1];
  shots.push({
    id: `${id}-drop`,
    title: `${translate(msg('Footprint over {place} at {time}'), {
      place: place.name || `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`,
      time: minuteStamp(pass.timeMs),
    })} · ${provenance}`,
    durationSec: DROP_SHOT_SEC,
    holdSec: DROP_HOLD_SEC,
    move: { from: last, easing: 'cubic-in-out' },
    camera: {
      lat: place.lat,
      lon: place.lon,
      alt: DROP_ALTITUDE_M,
      heading: last.heading,
      pitch: -90,
      roll: 0,
      altitudeReference: 'ellipsoid',
    },
  });
  const scene = {
    id,
    title: `${translate(msg('Ride this pass'))} · ${mission.label} · ${minuteStamp(pass.timeMs)} · ${translate(msg('dramatisation'))}`,
    releaseLayerIds: [],
    appliedShotPacks: [],
    shots,
  };
  const footprint = mission.swathKm
    ? swathFootprint(set.satrec, pass.timeMs, { swathKm: mission.swathKm })
    : null;
  const record = {
    kind: 'aurel-orbit-witness-ride',
    version: 1,
    lane: LANES.ride.id,
    class: LANES.ride.class,
    label: provenance,
    dramatisation: translate(
      msg(
        'Camera path and pacing are dramatised: about {factor}× faster than the orbit, beside a modelled position.',
      ),
      { factor: Math.round(30 / RIDE_SHOT_SEC) },
    ),
    mission: { id: mission.id, label: mission.label, norad: mission.norad },
    predictedCrossing: { time: iso(pass.timeMs), class: LANES.predicted.class },
    orbit: {
      class: LANES.predicted.class,
      model: 'SGP4 (satellite.js)',
      epoch: iso(set.epochMs),
      line1: set.line1,
      line2: set.line2,
      source: 'CelesTrak GP',
    },
    footprint: footprint
      ? {
          class: LANES.predicted.class,
          swathKm: mission.swathKm,
          ring: footprint,
          note: translate(
            msg(
              'Nominal swath around the predicted crossing; not a product footprint.',
            ),
          ),
        }
      : null,
    image: sceneId
      ? { class: LANES.product.class, sceneId }
      : { class: 'note', sceneId: null },
    generatedAt: iso(nowMs),
  };
  return { scene, record, footprint };
}

/** Add or replace the ride scene in a validated project snapshot (no mutation). */
export function withRideScene(project, scene) {
  const scenes = (project?.scenes || []).filter(
    (row) => !String(row.id).startsWith(RIDE_SCENE_PREFIX),
  );
  return {
    ...project,
    version: Math.max(6, project?.version || 6),
    scenes: [...scenes, scene],
  };
}
