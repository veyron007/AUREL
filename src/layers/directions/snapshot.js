/** Detached, versioned route geometry for local project capture. No provider calls. */
export const ROUTE_SNAPSHOT_VERSION = 1;
export const MAX_SAVED_ROUTE_POSITIONS = 10_000;
const MODES = new Set(['car', 'foot', 'bike']);
const STEP_TEXT = ['instruction', 'name', 'ref', 'type', 'modifier'];
const point = (p) =>
  p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180;
const nonnegative = (n) => Number.isFinite(n) && n >= 0;
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function stepCopy(step, index) {
  if (
    !point(step) ||
    typeof step.instruction !== 'string' ||
    step.instruction.length > 1000
  )
    return null;
  const copy = { index, lat: step.lat, lon: step.lon };
  for (const field of STEP_TEXT) {
    if (step[field] === undefined) continue;
    if (typeof step[field] !== 'string' || step[field].length > 1000)
      return null;
    copy[field] = step[field];
  }
  for (const field of ['distanceM', 'durationS', 'exit']) {
    if (step[field] === undefined) continue;
    if (!nonnegative(step[field])) return null;
    copy[field] = step[field];
  }
  return copy;
}
/** Invalid saved data returns null; never repair a broken path into a plausible route. */
export function validateRouteSnapshot(value) {
  if (
    !value ||
    value.version !== ROUTE_SNAPSHOT_VERSION ||
    !MODES.has(value.mode) ||
    !point(value.a) ||
    !point(value.b) ||
    !nonnegative(value.distanceM) ||
    !nonnegative(value.durationS) ||
    !Array.isArray(value.geometry) ||
    value.geometry.length < 2 ||
    value.geometry.length > MAX_SAVED_ROUTE_POSITIONS ||
    !Array.isArray(value.steps) ||
    value.steps.length > 200
  )
    return null;
  if (
    value.lastUpdate !== null &&
    (!nonnegative(value.lastUpdate) || value.lastUpdate > 8.64e15)
  )
    return null;
  const geometry = [];
  for (const pair of value.geometry) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !point({ lon: pair[0], lat: pair[1] })
    )
      return null;
    geometry.push([pair[0], pair[1]]);
  }
  const steps = value.steps.map(stepCopy);
  if (steps.some((step) => !step)) return null;
  return freeze({
    version: ROUTE_SNAPSHOT_VERSION,
    mode: value.mode,
    a: { lat: value.a.lat, lon: value.a.lon },
    b: { lat: value.b.lat, lon: value.b.lon },
    distanceM: value.distanceM,
    durationS: value.durationS,
    geometry,
    steps,
    stepsTruncated: value.stepsTruncated === true,
    lastUpdate: value.lastUpdate,
    source: 'OSM routing',
    attribution: '© OpenStreetMap contributors',
  });
}
/** Capture only whitelisted values from the live record; arbitrary source fields never leave it. */
export function createRouteSnapshot(route, a, b, lastUpdate) {
  if (!route) return null;
  return validateRouteSnapshot({
    version: ROUTE_SNAPSHOT_VERSION,
    mode: route.mode,
    a,
    b,
    distanceM: route.distanceM,
    durationS: route.durationS,
    geometry: route.geometry,
    steps: route.steps,
    stepsTruncated: route.stepsTruncated,
    lastUpdate: lastUpdate ?? null,
  });
}
