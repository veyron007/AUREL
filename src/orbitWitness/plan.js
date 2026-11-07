/**
 * ESA Sentinel-2 acquisition-plan KML, read from a file the owner downloaded
 * themselves. ESA's Sentinel Online terms allow non-commercial download and
 * copying but not redistribution, so AUREL never fetches, bundles or stores
 * the file; it reads it in memory for this session only.
 */
import { ringContains } from './swath.js';

export const PLAN_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  placemarks: 5000,
  ringPoints: 512,
  files: 6,
  /** A predicted crossing within a datatake window, widened by this margin. */
  matchMarginMs: 5 * 60000,
});
const NOMINAL = 'NOBS';

const value = (block, name) =>
  new RegExp(`<Data name="${name}">\\s*<value>([^<]*)</value>`).exec(block)?.[1]?.trim() ??
  null;
/** ESA writes times without a zone; the plan is in UTC. */
function utc(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text))
    return null;
  const ms = Date.parse(`${text}Z`);
  return Number.isFinite(ms) ? ms : null;
}
function ring(block) {
  const coordinates = /<coordinates>([^<]+)<\/coordinates>/.exec(block)?.[1];
  if (!coordinates) return null;
  const points = coordinates
    .trim()
    .split(/\s+/)
    .slice(0, PLAN_LIMITS.ringPoints + 1)
    .map((pair) => pair.split(',').slice(0, 2).map(Number));
  return points.length >= 4 &&
    points.every(
      ([lon, lat]) =>
        Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90,
    )
    ? points
    : null;
}

/** Satellite from an ESA file name such as S2C_MP_ACQ__KML_20261029T120000_20261116T150000.kml. */
export function planIdentityFromName(name) {
  const match = /^(S2[ABC])_MP_ACQ__KML_(\d{8}T\d{6})_(\d{8}T\d{6})/i.exec(
    String(name || ''),
  );
  if (!match) return null;
  const stamp = (s) =>
    Date.parse(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
    );
  return {
    satellite: match[1].toUpperCase(),
    coverageStartMs: stamp(match[2]),
    coverageEndMs: stamp(match[3]),
  };
}

/**
 * Parse one plan file. Throws on anything that is not a recognisable ESA
 * Sentinel-2 plan; the caller shows a refusal instead of a partial plan.
 */
export function parseAcquisitionPlan(text, fileName) {
  if (typeof text !== 'string' || text.length > PLAN_LIMITS.bytes)
    throw new TypeError('Plan file is missing or larger than 8 MiB');
  const identity = planIdentityFromName(fileName);
  if (!identity)
    throw new TypeError('Expected an ESA Sentinel-2 acquisition plan file name');
  if (!/<kml[\s>]/.test(text) || !/S2 Planned Observations/.test(text))
    throw new TypeError('This file is not an ESA Sentinel-2 acquisition plan');
  const blocks = text.split('<Placemark>').slice(1);
  if (blocks.length > PLAN_LIMITS.placemarks)
    throw new TypeError('Plan file has too many datatakes');
  const datatakes = [];
  for (const block of blocks) {
    const startMs = utc(value(block, 'ObservationTimeStart'));
    const endMs = utc(value(block, 'ObservationTimeStop'));
    const polygon = ring(block);
    if (startMs === null || endMs === null || endMs < startMs || !polygon) continue;
    datatakes.push(
      Object.freeze({
        id: value(block, 'ID') || `${startMs}`,
        mode: value(block, 'Mode') || 'unknown',
        startMs,
        endMs,
        orbitRelative: Number(value(block, 'OrbitRelative')) || null,
        ring: polygon,
      }),
    );
  }
  return Object.freeze({
    ...identity,
    fileName: String(fileName).slice(0, 120),
    datatakes: Object.freeze(datatakes),
  });
}

/** Nominal datatakes (the only mode ESA distributes to users) covering a place. */
export function plannedOverPlace(plan, place) {
  return plan.datatakes.filter(
    (take) => take.mode === NOMINAL && ringContains(take.ring, place.lon, place.lat),
  );
}

/**
 * Cross-check one predicted pass against the loaded plans.
 * - `confirmed`: a nominal datatake over the place spans the predicted time.
 * - `contradicted`: a plan covers that time for this satellite but has no
 *   nominal datatake over the place then.
 * - `no-plan`: no loaded plan covers that time (Landsat has none admitted).
 */
export function crossCheckPass(mission, pass, plans, place) {
  if (!mission.planSatellite) return { status: 'not-published', datatake: null };
  const relevant = plans.filter(
    (plan) =>
      plan.satellite === mission.planSatellite &&
      pass.timeMs >= plan.coverageStartMs &&
      pass.timeMs <= plan.coverageEndMs,
  );
  if (!relevant.length) return { status: 'no-plan', datatake: null };
  for (const plan of relevant) {
    const take = plannedOverPlace(plan, place).find(
      (row) =>
        pass.timeMs >= row.startMs - PLAN_LIMITS.matchMarginMs &&
        pass.timeMs <= row.endMs + PLAN_LIMITS.matchMarginMs,
    );
    if (take)
      return {
        status: 'confirmed',
        datatake: { id: take.id, startMs: take.startMs, endMs: take.endMs },
        fileName: plan.fileName,
      };
  }
  return { status: 'contradicted', datatake: null, fileName: relevant[0].fileName };
}

/** Planned nominal datatakes over the place with no predicted pass beside them. */
export function unmatchedPlannedTakes(mission, passes, plans, place, { fromMs, toMs }) {
  if (!mission.planSatellite) return [];
  return plans
    .filter((plan) => plan.satellite === mission.planSatellite)
    .flatMap((plan) => plannedOverPlace(plan, place))
    .filter((take) => take.endMs >= fromMs && take.startMs <= toMs)
    .filter(
      (take) =>
        !passes.some(
          (pass) =>
            pass.timeMs >= take.startMs - PLAN_LIMITS.matchMarginMs &&
            pass.timeMs <= take.endMs + PLAN_LIMITS.matchMarginMs,
        ),
    )
    .map((take) => ({ id: take.id, startMs: take.startMs, endMs: take.endMs }));
}
