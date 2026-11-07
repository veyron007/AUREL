/**
 * Join predicted passes, loaded plans, the cloud forecast and catalogue
 * records into per-mission lanes. Pure: inputs in, frozen rows out.
 */
import { ORBIT_WITNESS_MISSIONS } from './missions.js';
import { findSwathPasses, findSkyPasses, PASS_SEARCH_LIMITS } from './swath.js';
import { epochAgeDays, epochConfidence } from './tle.js';
import { crossCheckPass, unmatchedPlannedTakes } from './plan.js';
import { LANES, LANE_SOURCES } from './lanes.js';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
/** A catalogue record within this of a predicted crossing is that pass's product. */
export const PRODUCT_MATCH_MS = 15 * 60000;
/** Before this age a missing product reads "not catalogued yet", not "not catalogued". */
export const PRODUCT_LATENCY_MS = 5 * DAY_MS;
const SKY_DAYS = 3;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * Cloud cover at a pass from an hourly forecast, or why there is none.
 * @param {{ status: string, hours?: Array<{ timeMs: number, cloudCoverPct: number }>, validFromMs?: number, validToMs?: number, retrievedAt?: string } | null} forecast
 */
export function cloudAtPass(forecast, timeMs) {
  const base = {
    class: 'modelled',
    unit: '%',
    source: LANE_SOURCES.cloud,
    retrievedAt: forecast?.retrievedAt ?? null,
  };
  if (!forecast || !['ok', 'stale'].includes(forecast.status))
    return { ...base, status: 'unknown', valuePct: null, applicableTime: null };
  if (timeMs < forecast.validFromMs || timeMs > forecast.validToMs + HOUR_MS)
    return {
      ...base,
      status: 'beyond-forecast',
      valuePct: null,
      applicableTime: null,
    };
  let best = null;
  for (const hour of forecast.hours) {
    if (
      !best ||
      Math.abs(hour.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)
    )
      best = hour;
  }
  if (!best || Math.abs(best.timeMs - timeMs) > HOUR_MS)
    return { ...base, status: 'unknown', valuePct: null, applicableTime: null };
  return {
    ...base,
    status: forecast.status,
    valuePct: best.cloudCoverPct,
    applicableTime: iso(best.timeMs),
  };
}

/**
 * The product lane for one pass. A catalogue outage is "unknown", never "none".
 * @param {{ status: string, scenes: Array<object> } | null} catalogue
 */
export function productForPass(mission, pass, catalogue, nowMs) {
  const base = { class: 'observed', source: null, scene: null };
  if (!mission.imaging) return { ...base, status: 'not-applicable' };
  if (pass.timeMs > nowMs) return { ...base, status: 'pending' };
  if (!catalogue || !['ok', 'partial'].includes(catalogue.status))
    return { ...base, status: 'unknown' };
  const scene = catalogue.scenes
    .filter(
      (row) =>
        row.platform === mission.stacPlatform &&
        Math.abs(Date.parse(row.datetime) - pass.timeMs) <= PRODUCT_MATCH_MS,
    )
    .sort((a, b) => (a.cloudCover ?? 101) - (b.cloudCover ?? 101))[0];
  if (scene)
    return {
      ...base,
      status: 'available',
      scene: {
        id: scene.id,
        collection: scene.collection,
        datetime: scene.datetime,
        cloudCoverPct: scene.cloudCover,
      },
      source: scene.source,
    };
  if (catalogue.status === 'partial') return { ...base, status: 'unknown' };
  return {
    ...base,
    status: nowMs - pass.timeMs < PRODUCT_LATENCY_MS ? 'not-yet' : 'not-found',
  };
}

function predictedLane(mission, pass, set) {
  const ageDays = epochAgeDays(set.epochMs, pass.timeMs);
  return Object.freeze({
    class: LANES.predicted.class,
    source: LANE_SOURCES.predicted,
    applicableTime: iso(pass.timeMs),
    epoch: iso(set.epochMs),
    epochAgeDays: ageDays,
    confidence: epochConfidence(ageDays),
    ...(mission.imaging
      ? {
          crossTrackKm: pass.crossTrackKm,
          offNadirDeg: pass.offNadirDeg,
          side: pass.side,
          node: pass.node,
          solarElevationDeg: pass.solarElevationDeg,
          swathKm: pass.swathKm,
        }
      : {
          maxElevationDeg: pass.maxElevationDeg,
          riseTime: iso(pass.riseMs),
          setTime: iso(pass.setMs),
          visible: pass.visible,
        }),
  });
}

function plannedLane(mission, pass, plans, place) {
  const check = crossCheckPass(mission, pass, plans, place);
  return Object.freeze({
    class: LANES.planned.class,
    source: mission.planSatellite ? LANE_SOURCES.planned : null,
    status: mission.imaging ? check.status : 'not-applicable',
    datatake: check.datatake
      ? {
          id: check.datatake.id,
          start: iso(check.datatake.startMs),
          end: iso(check.datatake.endMs),
        }
      : null,
    fileName: check.fileName ?? null,
  });
}

function missionRows(mission, set, input) {
  const { place, fromMs, days, plans, cloud, catalogue, nowMs } = input;
  if (!set)
    return {
      mission,
      status: 'no-elements',
      passes: [],
      unplanned: [],
      truncated: false,
    };
  const search = mission.imaging
    ? findSwathPasses({
        satrec: set.satrec,
        place,
        fromMs,
        days,
        swathKm: mission.swathKm,
      })
    : findSkyPasses({
        satrec: set.satrec,
        place,
        fromMs: Math.max(fromMs, nowMs),
        days: Math.min(days, SKY_DAYS),
      });
  const passes = search.passes.map((pass) =>
    Object.freeze({
      id: `${mission.id}:${pass.timeMs}`,
      missionId: mission.id,
      timeMs: pass.timeMs,
      time: iso(pass.timeMs),
      past: pass.timeMs <= nowMs,
      nadir: pass.nadir ?? null,
      lanes: Object.freeze({
        predicted: predictedLane(mission, pass, set),
        planned: plannedLane(mission, pass, plans, place),
        product: Object.freeze(productForPass(mission, pass, catalogue, nowMs)),
        cloud: Object.freeze(
          mission.imaging
            ? cloudAtPass(cloud, pass.timeMs)
            : { status: 'not-applicable', valuePct: null },
        ),
      }),
    }),
  );
  return {
    mission,
    status: 'ok',
    epoch: iso(set.epochMs),
    epochMs: set.epochMs,
    passes,
    unplanned: unmatchedPlannedTakes(mission, search.passes, plans, place, {
      fromMs,
      toMs: fromMs + days * DAY_MS,
    }).map((take) => ({
      ...take,
      start: iso(take.startMs),
      end: iso(take.endMs),
    })),
    truncated: search.truncated,
  };
}

/**
 * Predict every mission over one place.
 * @param {{ sets: Array<object>, place: { lat: number, lon: number }, fromMs: number, days?: number, plans?: Array<object>, cloud?: object|null, catalogue?: object|null, nowMs: number }} input
 */
export function predictOrbitWitness(input) {
  const days = input.days ?? PASS_SEARCH_LIMITS.defaultDays;
  const full = { plans: [], cloud: null, catalogue: null, ...input, days };
  const bySet = new Map((input.sets || []).map((set) => [set.missionId, set]));
  return Object.freeze({
    place: { lat: input.place.lat, lon: input.place.lon },
    from: iso(input.fromMs),
    to: iso(input.fromMs + days * DAY_MS),
    generatedAt: iso(input.nowMs),
    missions: ORBIT_WITNESS_MISSIONS.map((mission) =>
      Object.freeze(missionRows(mission, bySet.get(mission.id), full)),
    ),
  });
}

/** Default window: four days back (to meet recent products) and ten ahead. */
export function defaultWindow(nowMs) {
  const fromMs = Math.floor((nowMs - 4 * DAY_MS) / HOUR_MS) * HOUR_MS;
  return { fromMs, days: 14 };
}
