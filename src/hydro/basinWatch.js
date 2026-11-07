/**
 * Basin rain watch: one local condition, "the IMERG 3 h basin mean exceeds a
 * threshold". It fires once per crossing: after firing it disarms until the
 * mean falls below HYSTERESIS × threshold, it respects a cooldown, and it
 * never fires twice for the same basin, window and window end. The lower
 * bound of the colormap interval is compared, so a firing means the estimate
 * is above the threshold even at the bottom of its class. No timers, storage
 * or network here.
 */

export const BASIN_WATCH_LIMITS = Object.freeze({
  watches: 4,
  minThresholdMm: 1,
  maxThresholdMm: 500,
  minCooldownMs: 3 * 3600_000,
  defaultCooldownMs: 6 * 3600_000,
  intervalMs: 30 * 60_000,
  minCoverage: 0.5,
  firedKeys: 50,
  notifications: 20,
  cells: 24,
});
export const HYSTERESIS = 0.8;
export const WATCH_WINDOW = '3h';

const fail = () => {
  throw new TypeError('Invalid basin watch');
};
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
  return value;
};
const finite = (value, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
  return value;
};
/** Accepts UTC ISO stamps with or without milliseconds (GIBS omits them). */
const stamp = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail();
  const canonical = new Date(value).toISOString();
  if (value !== canonical && value !== canonical.replace('.000Z', 'Z')) fail();
  return value;
};

export function createBasinWatch(
  { basinId, label, thresholdMm, cells, cooldownMs },
  { id = globalThis.crypto.randomUUID(), now = Date.now() } = {},
) {
  return validateBasinWatch({
    version: 1,
    id,
    basinId,
    label,
    window: WATCH_WINDOW,
    thresholdMm,
    cooldownMs: cooldownMs ?? BASIN_WATCH_LIMITS.defaultCooldownMs,
    cells: cells.map(({ key, center, km2 }) => ({ key, center, km2 })),
    createdAt: new Date(now).toISOString(),
    runtime: emptyBasinRuntime(),
  });
}

export function emptyBasinRuntime() {
  return {
    armed: true,
    lastCheckedAt: null,
    lastWindowEnd: null,
    lastLoMm: null,
    lastHiMm: null,
    lastCoverage: null,
    cooldownUntil: null,
    firedKeys: [],
    notifications: [],
  };
}

export function validateBasinWatch(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) fail();
  text(value.id);
  text(value.basinId, 120);
  text(value.label, 160);
  if (value.window !== WATCH_WINDOW) fail();
  finite(
    value.thresholdMm,
    BASIN_WATCH_LIMITS.minThresholdMm,
    BASIN_WATCH_LIMITS.maxThresholdMm,
  );
  finite(value.cooldownMs, BASIN_WATCH_LIMITS.minCooldownMs, 7 * 86400_000);
  if (
    !Array.isArray(value.cells) ||
    !value.cells.length ||
    value.cells.length > BASIN_WATCH_LIMITS.cells
  )
    fail();
  for (const cell of value.cells) {
    if (!/^\d{1,4}:\d{1,4}$/.test(cell?.key)) fail();
    finite(cell.km2, 0, 1e7);
    if (!Array.isArray(cell.center) || cell.center.length !== 2) fail();
    finite(cell.center[0], -180, 180);
    finite(cell.center[1], -90, 90);
  }
  stamp(value.createdAt);
  const r = value.runtime;
  if (!r || typeof r.armed !== 'boolean') fail();
  for (const key of ['lastCheckedAt', 'cooldownUntil'])
    if (r[key] !== null) finite(r[key], 0, 8.64e15);
  if (r.lastWindowEnd !== null) stamp(r.lastWindowEnd);
  if (
    !Array.isArray(r.firedKeys) ||
    r.firedKeys.length > BASIN_WATCH_LIMITS.firedKeys ||
    !Array.isArray(r.notifications) ||
    r.notifications.length > BASIN_WATCH_LIMITS.notifications
  )
    fail();
  r.firedKeys.forEach((key) => text(key, 200));
  return JSON.parse(JSON.stringify(value));
}

/** Identity of one evaluated window, used to refuse a second firing. */
export const firingKey = (watch, windowEnd) =>
  `${watch.basinId}:${watch.window}:${windowEnd}`;

/**
 * Apply one 3 h basin-mean observation.
 * @param {object} watch Validated watch.
 * @param {{windowEnd:string, lo:number|null, hi:number|null, coverage:number, complete:boolean}|null} observation
 * @returns {{watch: object, fired: object|null}}
 */
export function reduceBasinCheck(watch, observation, now = Date.now()) {
  const runtime = { ...watch.runtime, lastCheckedAt: now };
  const next = (patch, fired = null) => ({
    watch: validateBasinWatch({ ...watch, runtime: { ...runtime, ...patch } }),
    fired,
  });
  if (
    !observation ||
    observation.lo == null ||
    !observation.complete ||
    !(observation.coverage >= BASIN_WATCH_LIMITS.minCoverage)
  )
    return next({});
  const reading = {
    lastWindowEnd: observation.windowEnd,
    lastLoMm: observation.lo,
    lastHiMm: observation.hi,
    lastCoverage: observation.coverage,
  };
  const key = firingKey(watch, observation.windowEnd);
  if (!runtime.armed) {
    const rearm = observation.hi < HYSTERESIS * watch.thresholdMm;
    return next({ ...reading, armed: rearm });
  }
  const above = observation.lo > watch.thresholdMm;
  const cooling = runtime.cooldownUntil !== null && now < runtime.cooldownUntil;
  if (!above || cooling || runtime.firedKeys.includes(key))
    return next(reading);
  const fired = {
    id: key,
    createdAt: new Date(now).toISOString(),
    windowEnd: observation.windowEnd,
    loMm: observation.lo,
    hiMm: observation.hi,
    thresholdMm: watch.thresholdMm,
    coverage: observation.coverage,
  };
  return next(
    {
      ...reading,
      armed: false,
      cooldownUntil: now + watch.cooldownMs,
      firedKeys: [...runtime.firedKeys, key].slice(
        -BASIN_WATCH_LIMITS.firedKeys,
      ),
      notifications: [...runtime.notifications, fired].slice(
        -BASIN_WATCH_LIMITS.notifications,
      ),
    },
    fired,
  );
}
