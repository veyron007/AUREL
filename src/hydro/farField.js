/**
 * Far-field continuation on a bundled HydroSHEDS HydroRIVERS v1.0 subset.
 * When the D8 trace leaves the sampled DEM window, the drop hands off to the
 * nearest HydroRIVERS reach large enough to carry it and follows NEXT_DOWN to
 * the ocean or an inland sink. HydroRIVERS has no names; names in the subset
 * come from OpenStreetMap waterways and a short curated anchor list and are
 * labelled as such.
 *
 * Subset shape (public/hydro/rivers.json):
 *   {version:1, source:{…}, naming:{…},
 *    reaches:[{id, next, upKm2, lengthKm, name|null, line:[[lon,lat],…]}]}
 * `next` is 0 at an ocean outlet; `endorheic` marks inland sinks.
 */
import { haversineM } from './grid.js';

/** Farthest a handoff may jump from the D8 exit to a reach vertex, metres. */
export const HANDOFF_MAX_M = 3000;
/** A reach must drain at least this share of the D8 exit's upstream area. */
export const HANDOFF_AREA_SHARE = 0.3;
const MAX_CHAIN = 5000;

export function validateRiverSubset(value) {
  if (value?.version !== 1 || !Array.isArray(value.reaches))
    throw new TypeError('Invalid river subset');
  const byId = new Map();
  for (const reach of value.reaches) {
    if (
      !Number.isSafeInteger(reach?.id) ||
      !Number.isSafeInteger(reach.next) ||
      !Number.isFinite(reach.upKm2) ||
      !Array.isArray(reach.line) ||
      reach.line.length < 2 ||
      !reach.line.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          Math.abs(p[0]) <= 180 &&
          Math.abs(p[1]) <= 90,
      )
    )
      throw new TypeError('Invalid river reach');
    byId.set(reach.id, reach);
  }
  return { ...value, byId };
}

/** Nearest vertex on any qualifying reach. */
export function nearestReach(network, point, { minUpKm2 = 0, maxM = HANDOFF_MAX_M } = {}) {
  let best = null;
  for (const reach of network.reaches) {
    if (reach.upKm2 < minUpKm2) continue;
    reach.line.forEach((vertex, index) => {
      const distance = haversineM(point, vertex);
      if (distance <= maxM && (!best || distance < best.distanceM))
        best = { reach, index, distanceM: distance };
    });
  }
  return best;
}

/**
 * Follow NEXT_DOWN from the reach nearest `point`.
 * @returns {{status:'ok', path:number[][], names:string[], reaches:number, end:'ocean'|'inland'|'subset-end', handoffM:number, upKm2:number} | {status:'no-reach'}}
 */
export function continueDownstream(network, point, exitUpstreamKm2 = 0) {
  const start = nearestReach(network, point, {
    minUpKm2: Math.max(1, exitUpstreamKm2 * HANDOFF_AREA_SHARE),
  });
  if (!start) return { status: 'no-reach' };
  const path = start.reach.line.slice(start.index).map((p) => [...p]);
  const names = [];
  const pushName = (name) => {
    if (name && names.at(-1) !== name) names.push(name);
  };
  pushName(start.reach.name);
  let reach = start.reach,
    count = 1,
    end = 'subset-end';
  const seen = new Set([reach.id]);
  while (count < MAX_CHAIN) {
    if (reach.next === 0) {
      end = reach.endorheic ? 'inland' : 'ocean';
      break;
    }
    const next = network.byId.get(reach.next);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    path.push(...next.line.slice(1).map((p) => [...p]));
    pushName(next.name);
    reach = next;
    count++;
  }
  return {
    status: 'ok',
    path,
    names,
    reaches: count,
    end,
    handoffM: start.distanceM,
    upKm2: reach.upKm2,
    startUpKm2: start.reach.upKm2,
  };
}

/**
 * Named rivers met along a D8 path, in order: each path point takes the name
 * of the nearest named reach vertex within `maxM`.
 */
export function namesAlong(network, path, { maxM = 600, every = 4 } = {}) {
  const named = network.reaches.filter((reach) => reach.name);
  const names = [];
  for (let i = 0; i < path.length; i += every) {
    let best = null,
      bestDistance = maxM;
    for (const reach of named)
      for (const vertex of reach.line) {
        const distance = haversineM(path[i], vertex);
        if (distance < bestDistance) {
          best = reach;
          bestDistance = distance;
        }
      }
    if (best && names.at(-1) !== best.name) names.push(best.name);
  }
  return names;
}
